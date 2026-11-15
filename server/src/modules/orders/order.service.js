import { Order, STATUS_TRANSITIONS } from '../../models/Order.js';
import { Product } from '../../models/Product.js';
import { User } from '../../models/User.js';
import { Coupon } from '../../models/Coupon.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../lib/ApiError.js';
import { holdCoupon, priceLines } from '../../lib/pricing.js';
import { getRazorpay, verifyPaymentSignature } from '../../lib/razorpay.js';
import { sendEmail, templates } from '../../lib/email.js';
import { randomToken, toPaise } from '../../lib/utils.js';
import { withTransaction } from '../../lib/tx.js';
import { invalidateProducts } from '../products/product.service.js';
import { bumpNamespace } from '../../lib/cache.js';

const PAID_STATES = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
const CUSTOMER_CANCELLABLE = ['pending_payment', 'payment_failed', 'paid', 'processing'];
const MAX_EMAIL_ATTEMPTS = 5;
const MAX_REFUND_ATTEMPTS = 5;

function orderNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `SF-${ymd}-${randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}`;
}

export function toOrderDTO(o) {
  return {
    id: String(o._id),
    orderNumber: o.orderNumber,
    status: o.status,
    statusHistory: o.statusHistory,
    items: o.items.map((i) => ({ ...i, product: String(i.product) })),
    shippingAddress: o.shippingAddress,
    pricing: o.pricing,
    coupon: o.coupon?.code ? { code: o.coupon.code } : null,
    payment: {
      provider: o.payment?.provider,
      razorpayOrderId: o.payment?.razorpayOrderId,
      paymentId: o.payment?.razorpayPaymentId,
      method: o.payment?.method,
      paidAt: o.payment?.paidAt,
      refundStatus: o.payment?.refundStatus,
      failureReason: o.payment?.failureReason,
    },
    tracking: o.tracking?.number ? o.tracking : null,
    reservationExpiresAt: o.reservationExpiresAt,
    canCancel: CUSTOMER_CANCELLABLE.includes(o.status),
    canPay: ['pending_payment', 'payment_failed'].includes(o.status) && (!o.reservationExpiresAt || o.reservationExpiresAt > new Date()),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    ...(o.user?.email ? { customer: { id: String(o.user._id), name: o.user.name, email: o.user.email } } : {}),
  };
}

/* ----------------------------- inventory ----------------------------- */

/**
 * Conditionally decrements stock for each item. Inside a transaction a failure
 * aborts everything; without one (standalone MongoDB) the already-reserved
 * items are compensated before throwing.
 */
async function reserveStock(items, session = null) {
  const done = [];
  for (const item of items) {
    const res = await Product.updateOne(
      { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { session },
    );
    if (res.modifiedCount !== 1) {
      if (!session) await restock(done);
      throw ApiError.conflict(`Only limited copies of "${item.title}" are left. Please update your bag.`, {
        code: 'INSUFFICIENT_STOCK',
        details: [{ productId: String(item.product) }],
      });
    }
    done.push(item);
  }
}

async function restock(items, session = null) {
  if (!items.length) return;
  await Product.bulkWrite(
    items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { stock: i.quantity } } } })),
    { session },
  );
}

/* ------------------------------ coupons ------------------------------ */

/** Releases a coupon use held by an unpaid order (idempotent via the couponHeld claim). */
async function releaseCouponHold(order, session = null) {
  if (!order.coupon?.couponId) return;
  const claim = await Order.updateOne({ _id: order._id, couponHeld: true }, { $set: { couponHeld: false } }, { session });
  if (claim.modifiedCount !== 1) return;
  await Coupon.updateOne({ _id: order.coupon.couponId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } }, { session });
}

/** Converts the hold (if any) into a real coupon use. Idempotent via couponRedeemed. */
async function redeemCoupon(order, session = null) {
  if (!order.coupon?.couponId) return;
  const claim = await Order.findOneAndUpdate(
    { _id: order._id, couponRedeemed: false },
    { $set: { couponRedeemed: true, couponHeld: false } },
    { new: false, session },
  );
  if (!claim) return;
  const inc = { usedCount: 1 };
  if (claim.couponHeld) inc.reservedCount = -1;
  const res = await Coupon.updateOne({ _id: order.coupon.couponId, 'usedBy.user': order.user }, { $inc: { ...inc, 'usedBy.$.count': 1 } }, { session });
  if (res.matchedCount === 0) {
    await Coupon.updateOne({ _id: order.coupon.couponId }, { $inc: inc, $push: { usedBy: { user: order.user, count: 1 } } }, { session });
  }
}

/* --------------------------- reservations ---------------------------- */

/** Release stock and coupon holds of unpaid orders whose window elapsed. Safe to run concurrently. */
export async function releaseExpiredReservations(limit = 100) {
  const stale = await Order.find(
    { status: { $in: ['pending_payment', 'payment_failed'] }, stockReserved: true, reservationExpiresAt: { $lt: new Date() } },
    '_id',
  )
    .limit(limit)
    .lean();
  let released = 0;
  for (const { _id } of stale) {
    const expired = await withTransaction(async (session) => {
      const order = await Order.findOneAndUpdate(
        { _id, status: { $in: ['pending_payment', 'payment_failed'] }, stockReserved: true },
        {
          $set: { status: 'expired', stockReserved: false },
          $push: { statusHistory: { status: 'expired', note: 'Payment window elapsed, stock released', by: 'system' } },
        },
        { new: true, session },
      );
      if (!order) return null;
      await restock(order.items, session);
      await releaseCouponHold(order, session);
      return order;
    });
    if (expired) released += 1;
  }
  if (released) await Promise.all([invalidateProducts(), bumpNamespace('coupons')]);
  return released;
}

/* ------------------------------ checkout ----------------------------- */

function paymentParams(order, user) {
  return {
    keyId: env.RAZORPAY_KEY_ID,
    razorpayOrderId: order.payment.razorpayOrderId,
    amount: toPaise(order.pricing.total),
    currency: order.pricing.currency,
    name: 'Shelfify',
    description: `Order ${order.orderNumber}`,
    prefill: { name: user?.name, email: user?.email, contact: order.shippingAddress?.phone },
  };
}

async function replayIdempotent(userId, idempotencyKey, user) {
  if (!idempotencyKey) return null;
  const existing = await Order.findOne({ user: userId, idempotencyKey });
  if (!existing) return null;
  return { order: toOrderDTO(existing), payment: existing.payment?.razorpayOrderId ? paymentParams(existing, user) : null, replayed: true };
}

/** Cancels an order that was never paid: restores stock and releases the coupon hold atomically. */
async function cancelUnpaid(orderId, note) {
  await withTransaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: { $in: ['pending_payment', 'payment_failed'] } },
      { $set: { status: 'cancelled', stockReserved: false }, $push: { statusHistory: { status: 'cancelled', note, by: 'system' } } },
      { new: false, session },
    );
    if (!order) return;
    if (order.stockReserved) await restock(order.items, session);
    await releaseCouponHold(order, session);
  });
}

export async function createCheckout({ userId, address, addressId, couponCode, idempotencyKey }) {
  const user = await User.findById(userId, 'name email cart addresses');
  if (!user) throw ApiError.unauthorized();

  const replay = await replayIdempotent(userId, idempotencyKey, user);
  if (replay) return replay;

  // Fail fast before touching inventory if payments are not configured.
  const razorpay = getRazorpay();

  await releaseExpiredReservations().catch((err) => logger.warn({ err: err.message }, 'reservation sweep failed'));

  let shippingAddress = address;
  if (addressId) {
    const saved = user.addresses.id(addressId);
    if (!saved) throw ApiError.badRequest('Selected address was not found', { code: 'ADDRESS_NOT_FOUND' });
    shippingAddress = saved.toObject();
  }
  if (!shippingAddress) throw ApiError.badRequest('A shipping address is required', { code: 'ADDRESS_REQUIRED' });

  if (!user.cart.length) throw ApiError.badRequest('Your bag is empty', { code: 'CART_EMPTY' });
  const products = await Product.find({ _id: { $in: user.cart.map((c) => c.product) } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const lines = user.cart.map((c) => ({ product: byId.get(String(c.product)) || null, quantity: c.quantity }));

  const priced = await priceLines(lines.filter((l) => l.product), { couponCode, userId, strictCoupon: true });
  if (priced.issues.length) {
    throw ApiError.conflict('Some items in your bag are no longer available in the requested quantity', {
      code: 'CART_ISSUES',
      details: priced.issues,
    });
  }
  const items = priced.lines.map(({ product, quantity }) => ({
    product: product._id,
    title: product.title,
    author: product.author,
    slug: product.slug,
    coverImage: product.coverImage,
    price: product.price,
    mrp: product.mrp,
    quantity,
  }));

  const orderDoc = {
    orderNumber: orderNumber(),
    user: userId,
    items,
    shippingAddress: {
      fullName: shippingAddress.fullName,
      phone: shippingAddress.phone,
      line1: shippingAddress.line1,
      line2: shippingAddress.line2,
      city: shippingAddress.city,
      state: shippingAddress.state,
      postalCode: shippingAddress.postalCode,
      country: shippingAddress.country || 'India',
    },
    pricing: {
      subtotal: priced.summary.subtotal,
      mrpTotal: priced.summary.mrpTotal,
      couponDiscount: priced.summary.couponDiscount,
      shipping: priced.summary.shipping,
      total: priced.summary.total,
      currency: 'INR',
    },
    coupon: priced.coupon ? { code: priced.coupon.code, couponId: priced.coupon.id } : undefined,
    couponHeld: false,
    status: 'pending_payment',
    statusHistory: [{ status: 'pending_payment', note: 'Order created, awaiting payment', by: 'customer' }],
    idempotencyKey,
    stockReserved: true,
    reservationExpiresAt: new Date(Date.now() + env.ORDER_RESERVATION_MINUTES * 60 * 1000),
  };

  // Stock reservation, coupon hold and order creation commit or roll back together (audit M1/M2).
  let order;
  try {
    order = await withTransaction(async (session) => {
      await reserveStock(items, session);
      let held = false;
      try {
        if (priced.coupon) {
          await holdCoupon(priced.coupon.code, { userId, subtotal: priced.summary.subtotal, session });
          held = true;
        }
        const [created] = await Order.create([{ ...orderDoc, couponHeld: held }], { session });
        return created;
      } catch (err) {
        if (!session) {
          // No transaction available: compensate manually.
          await restock(items);
          if (held) await Coupon.updateOne({ _id: priced.coupon.id, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } });
        }
        throw err;
      }
    });
  } catch (err) {
    if (err?.code === 11000 && idempotencyKey) {
      const again = await replayIdempotent(userId, idempotencyKey, user);
      if (again) return again;
    }
    throw err;
  }

  try {
    const rzpOrder = await razorpay.orders.create({
      amount: toPaise(order.pricing.total),
      currency: 'INR',
      receipt: order.orderNumber,
      notes: { orderId: String(order._id), userId: String(userId) },
    });
    order.payment = { provider: 'razorpay', razorpayOrderId: rzpOrder.id };
    await order.save();
  } catch (err) {
    logger.error({ err: err?.error || err?.message, orderId: String(order._id) }, 'razorpay order creation failed');
    await cancelUnpaid(order._id, 'Payment gateway unavailable');
    throw new ApiError(502, 'Payment gateway is unavailable right now. Please try again.', { code: 'GATEWAY_ERROR' });
  }

  await Promise.all([invalidateProducts(), bumpNamespace('coupons')]);
  return { order: toOrderDTO(order), payment: paymentParams(order, user), replayed: false };
}

/** Returns payment parameters to retry payment for an order still awaiting payment. */
export async function retryPayment(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw ApiError.notFound('Order not found');
  if (!['pending_payment', 'payment_failed'].includes(order.status)) {
    throw ApiError.conflict('This order is not awaiting payment', { code: 'NOT_PAYABLE' });
  }
  if (order.reservationExpiresAt && order.reservationExpiresAt < new Date()) {
    await releaseExpiredReservations();
    throw ApiError.conflict('The payment window for this order has expired. Please place a new order.', { code: 'ORDER_EXPIRED' });
  }
  getRazorpay();
  const user = await User.findById(userId, 'name email').lean();
  return { order: toOrderDTO(order), payment: paymentParams(order, user) };
}

/* --------------------------- fulfilment (H3) -------------------------- */

/** Sends the confirmation email at most once; failed sends are released for retry. */
async function sendConfirmationEmail(orderId) {
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, emailSent: false, emailAttempts: { $lt: MAX_EMAIL_ATTEMPTS } },
    { $set: { emailSent: true }, $inc: { emailAttempts: 1 } },
    { new: true },
  );
  if (!claimed) return false;
  const user = await User.findById(claimed.user, 'name email').lean();
  const delivered = user ? await sendEmail(user.email, templates.orderConfirmed(user, claimed)) : true;
  if (!delivered) await Order.updateOne({ _id: orderId }, { $set: { emailSent: false } });
  return delivered;
}

/**
 * Applies post-payment side effects exactly once (audit H3): clears the bought
 * items from the cart, bumps sales counters and redeems the coupon - all inside
 * one transaction together with setting `fulfilledAt`. If the process dies part
 * way, nothing is committed and the next verify call, webhook delivery or
 * maintenance run retries. Safe to call repeatedly and concurrently.
 */
export async function fulfillOrder(orderId) {
  const order = await withTransaction(async (session) => {
    const claimed = await Order.findOneAndUpdate(
      { _id: orderId, status: { $in: PAID_STATES }, fulfilledAt: { $type: 'null' } },
      { $set: { fulfilledAt: new Date() } },
      { new: true, session },
    );
    if (!claimed) return null;
    const productIds = claimed.items.map((i) => i.product);
    await User.updateOne({ _id: claimed.user }, { $pull: { cart: { product: { $in: productIds } } } }, { session });
    await Product.bulkWrite(
      claimed.items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { soldCount: i.quantity } } } })),
      { session },
    );
    await redeemCoupon(claimed, session);
    return claimed;
  });
  if (order) await Promise.all([invalidateProducts(), bumpNamespace('analytics'), bumpNamespace('coupons')]);
  await sendConfirmationEmail(orderId);
  return Boolean(order);
}

/**
 * Idempotently transitions an order to "paid", then fulfils it. Safe to call from
 * the client verification endpoint and webhooks concurrently: only the first
 * caller transitions; every caller (re)attempts any unfinished fulfilment.
 */
export async function markPaid(orderFilter, { paymentId, method, by = 'system' }) {
  const previous = await Order.findOneAndUpdate(
    { ...orderFilter, status: { $in: ['pending_payment', 'payment_failed', 'expired'] } },
    {
      $set: {
        status: 'paid',
        'payment.razorpayPaymentId': paymentId,
        'payment.method': method,
        'payment.paidAt': new Date(),
        'payment.failureReason': null,
        reservationExpiresAt: null,
        fulfilledAt: null,
      },
      $push: { statusHistory: { status: 'paid', note: 'Payment received', by } },
    },
    { new: false },
  );

  if (!previous) {
    const current = await Order.findOne(orderFilter);
    if (!current) throw ApiError.notFound('Order not found');
    // Already paid (replay): finish any fulfilment a crashed earlier attempt left behind.
    if (PAID_STATES.includes(current.status) && current.fulfilledAt === null) await fulfillOrder(current._id);
    return Order.findById(current._id);
  }

  // Late payment after the reservation expired: stock was released, claim it again.
  if (!previous.stockReserved) {
    try {
      await withTransaction(async (session) => {
        await reserveStock(previous.items, session);
        await Order.updateOne({ _id: previous._id }, { $set: { stockReserved: true } }, { session });
      });
    } catch {
      logger.warn({ orderId: String(previous._id) }, 'late payment but stock unavailable - refunding');
      const order = await Order.findOneAndUpdate(
        { _id: previous._id, status: 'paid' },
        { $set: { status: 'cancelled' }, $push: { statusHistory: { status: 'cancelled', note: 'Stock sold out before payment completed; refund initiated', by: 'system' } } },
        { new: true },
      );
      if (order) await refundOrder(order, 'Stock unavailable after late payment');
      return Order.findById(previous._id);
    }
  }

  await fulfillOrder(previous._id);
  return Order.findById(previous._id);
}

export async function verifyClientPayment(userId, orderId, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw ApiError.notFound('Order not found');
  if (PAID_STATES.includes(order.status)) {
    // Already confirmed (e.g. by webhook); complete fulfilment if it was interrupted.
    if (order.fulfilledAt === null) await fulfillOrder(order._id);
    return Order.findById(order._id);
  }

  if (order.payment?.razorpayOrderId !== razorpayOrderId) {
    throw ApiError.badRequest('Payment does not belong to this order', { code: 'PAYMENT_MISMATCH' });
  }
  const valid = verifyPaymentSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature });
  if (!valid) {
    logger.warn({ orderId: String(order._id) }, 'invalid payment signature');
    throw ApiError.badRequest('Payment verification failed', { code: 'PAYMENT_VERIFICATION_FAILED' });
  }
  return markPaid({ _id: order._id }, { paymentId: razorpayPaymentId, by: 'customer' });
}

export async function markPaymentFailed(razorpayOrderId, reason) {
  await Order.updateOne(
    { 'payment.razorpayOrderId': razorpayOrderId, status: 'pending_payment' },
    {
      $set: { status: 'payment_failed', 'payment.failureReason': reason?.slice(0, 300) },
      $push: { statusHistory: { status: 'payment_failed', note: reason?.slice(0, 300), by: 'webhook' } },
    },
  );
}

/* ---------------------------- cancellations --------------------------- */

export async function refundOrder(order, reason) {
  if (!order.payment?.razorpayPaymentId || order.payment.refundId) return order;
  try {
    const refund = await getRazorpay().payments.refund(order.payment.razorpayPaymentId, {
      amount: toPaise(order.pricing.total),
      notes: { orderId: String(order._id), reason: reason?.slice(0, 200) || 'Order cancelled' },
    });
    await Order.updateOne(
      { _id: order._id },
      { $set: { 'payment.refundId': refund.id, 'payment.refundStatus': refund.status || 'pending' }, $inc: { refundAttempts: 1 } },
    );
  } catch (err) {
    logger.error({ err: err?.error || err?.message, orderId: String(order._id) }, 'refund failed');
    await Order.updateOne({ _id: order._id }, { $set: { 'payment.refundStatus': 'failed' }, $inc: { refundAttempts: 1 } });
  }
  return Order.findById(order._id);
}

async function cancel(order, { by, note }) {
  const wasPaid = PAID_STATES.includes(order.status);
  // Sales counters were bumped only if fulfilment ran. Orders created before the
  // fulfilledAt field existed (Mongoose fills in the default) were fulfilled on payment.
  const legacyOrder = typeof order.$isDefault === 'function' && order.$isDefault('fulfilledAt');
  const wasFulfilled = Boolean(order.fulfilledAt) || (wasPaid && legacyOrder);

  const updated = await withTransaction(async (session) => {
    const doc = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status },
      {
        $set: { status: 'cancelled', stockReserved: false, reservationExpiresAt: null },
        $push: { statusHistory: { status: 'cancelled', note, by } },
      },
      { new: true, session },
    );
    if (!doc) throw ApiError.conflict('Order status changed, please refresh and try again', { code: 'STALE_ORDER' });
    if (order.stockReserved) await restock(order.items, session);
    if (wasFulfilled) {
      await Product.bulkWrite(
        order.items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { soldCount: -i.quantity } } } })),
        { session },
      );
    }
    await releaseCouponHold(order, session);
    return doc;
  });

  if (wasPaid) await refundOrder(updated, note);
  await Promise.all([invalidateProducts(), bumpNamespace('analytics'), bumpNamespace('coupons')]);
  return Order.findById(order._id);
}

export async function customerCancel(userId, orderId, reason) {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw ApiError.notFound('Order not found');
  if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
    throw ApiError.conflict('This order can no longer be cancelled', { code: 'NOT_CANCELLABLE' });
  }
  const updated = await cancel(order, { by: 'customer', note: reason || 'Cancelled by customer' });
  if (PAID_STATES.includes(order.status)) {
    const user = await User.findById(userId, 'name email').lean();
    if (user) await sendEmail(user.email, templates.orderStatus(user, updated)); // awaited (audit H2)
  }
  return updated;
}

export async function adminUpdateStatus(orderId, { status, note, tracking }) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (status === order.status && tracking) {
    order.tracking = { ...order.tracking?.toObject?.(), ...tracking };
    await order.save();
    return order;
  }
  const allowed = STATUS_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(`Cannot move an order from "${order.status}" to "${status}"`, { code: 'INVALID_TRANSITION' });
  }

  let updated;
  if (status === 'cancelled') {
    updated = await cancel(order, { by: 'admin', note: note || 'Cancelled by Shelfify' });
  } else if (status === 'paid') {
    throw ApiError.badRequest('Orders are marked paid only by verified payment events', { code: 'INVALID_TRANSITION' });
  } else {
    order.status = status;
    if (tracking) order.tracking = { ...order.tracking?.toObject?.(), ...tracking };
    order.statusHistory.push({ status, note, by: 'admin' });
    await order.save();
    if (status === 'refunded') await refundOrder(order, note);
    updated = await Order.findById(order._id);
    await bumpNamespace('analytics');
  }

  if (['shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'].includes(status)) {
    const user = await User.findById(updated.user, 'name email').lean();
    if (user) await sendEmail(user.email, templates.orderStatus(user, updated)); // awaited (audit H2)
  }
  return updated;
}

/* ---------------------------- maintenance ----------------------------- */

/**
 * Self-healing sweep, run by Vercel Cron and by the long-running server:
 * releases expired reservations, finishes interrupted fulfilments, retries
 * confirmation emails and failed refunds. Every step is idempotent.
 */
export async function runMaintenance({ limit = 100 } = {}) {
  const result = { released: 0, fulfilled: 0, emailsSent: 0, refundsRetried: 0 };
  result.released = await releaseExpiredReservations(limit);

  const unfulfilled = await Order.find({ status: { $in: PAID_STATES }, fulfilledAt: { $type: 'null' } }, '_id').limit(limit).lean();
  for (const { _id } of unfulfilled) if (await fulfillOrder(_id)) result.fulfilled += 1;

  const unsentEmails = await Order.find(
    { status: { $in: PAID_STATES }, fulfilledAt: { $type: 'date' }, emailSent: false, emailAttempts: { $lt: MAX_EMAIL_ATTEMPTS } },
    '_id',
  )
    .limit(limit)
    .lean();
  for (const { _id } of unsentEmails) if (await sendConfirmationEmail(_id)) result.emailsSent += 1;

  if (env.paymentsEnabled) {
    const refunds = await Order.find({
      status: { $in: ['cancelled', 'refunded'] },
      'payment.razorpayPaymentId': { $type: 'string' },
      'payment.refundId': null, // matches missing or null
      refundAttempts: { $lt: MAX_REFUND_ATTEMPTS },
      $or: [{ 'payment.refundStatus': 'failed' }, { 'payment.refundStatus': { $exists: false } }, { 'payment.refundStatus': null }],
    }).limit(limit);
    for (const order of refunds) {
      await refundOrder(order, 'Automatic refund retry');
      result.refundsRetried += 1;
    }
  }
  return result;
}
