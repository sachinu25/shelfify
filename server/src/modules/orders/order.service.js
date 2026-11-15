import { Order, STATUS_TRANSITIONS } from '../../models/Order.js';
import { Product } from '../../models/Product.js';
import { User } from '../../models/User.js';
import { Coupon } from '../../models/Coupon.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../lib/ApiError.js';
import { priceLines } from '../../lib/pricing.js';
import { getRazorpay, verifyPaymentSignature } from '../../lib/razorpay.js';
import { sendEmail, templates } from '../../lib/email.js';
import { randomToken, toPaise } from '../../lib/utils.js';
import { invalidateProducts } from '../products/product.service.js';
import { bumpNamespace } from '../../lib/cache.js';

const PAID_STATES = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
const CUSTOMER_CANCELLABLE = ['pending_payment', 'payment_failed', 'paid', 'processing'];

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

async function reserveStock(items) {
  const done = [];
  for (const item of items) {
    const res = await Product.updateOne(
      { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
    );
    if (res.modifiedCount !== 1) {
      await restock(done);
      throw ApiError.conflict(`Only limited copies of "${item.title}" are left. Please update your bag.`, {
        code: 'INSUFFICIENT_STOCK',
        details: [{ productId: String(item.product) }],
      });
    }
    done.push(item);
  }
}

async function restock(items) {
  if (!items.length) return;
  await Product.bulkWrite(items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { stock: i.quantity } } } })));
}

/** Release stock held by unpaid orders whose reservation window has elapsed. Safe to run concurrently. */
export async function releaseExpiredReservations(limit = 100) {
  const stale = await Order.find(
    { status: { $in: ['pending_payment', 'payment_failed'] }, stockReserved: true, reservationExpiresAt: { $lt: new Date() } },
    '_id',
  )
    .limit(limit)
    .lean();
  let released = 0;
  for (const { _id } of stale) {
    const order = await Order.findOneAndUpdate(
      { _id, status: { $in: ['pending_payment', 'payment_failed'] }, stockReserved: true },
      {
        $set: { status: 'expired', stockReserved: false },
        $push: { statusHistory: { status: 'expired', note: 'Payment window elapsed, stock released', by: 'system' } },
      },
      { new: true },
    );
    if (order) {
      await restock(order.items);
      released += 1;
    }
  }
  if (released) await invalidateProducts();
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

export async function createCheckout({ userId, address, addressId, couponCode, idempotencyKey }) {
  const user = await User.findById(userId, 'name email cart addresses');
  if (!user) throw ApiError.unauthorized();

  if (idempotencyKey) {
    const existing = await Order.findOne({ user: userId, idempotencyKey });
    if (existing) return { order: toOrderDTO(existing), payment: existing.payment?.razorpayOrderId ? paymentParams(existing, user) : null, replayed: true };
  }

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

  await reserveStock(items);

  let order;
  try {
    order = await Order.create({
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
      status: 'pending_payment',
      statusHistory: [{ status: 'pending_payment', note: 'Order created, awaiting payment', by: 'customer' }],
      idempotencyKey,
      stockReserved: true,
      reservationExpiresAt: new Date(Date.now() + env.ORDER_RESERVATION_MINUTES * 60 * 1000),
    });
  } catch (err) {
    await restock(items);
    if (err?.code === 11000 && idempotencyKey) {
      const existing = await Order.findOne({ user: userId, idempotencyKey });
      if (existing) return { order: toOrderDTO(existing), payment: existing.payment?.razorpayOrderId ? paymentParams(existing, user) : null, replayed: true };
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
    await restock(items);
    order.status = 'cancelled';
    order.stockReserved = false;
    order.statusHistory.push({ status: 'cancelled', note: 'Payment gateway unavailable', by: 'system' });
    await order.save();
    throw new ApiError(502, 'Payment gateway is unavailable right now. Please try again.', { code: 'GATEWAY_ERROR' });
  }

  await invalidateProducts();
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

/* --------------------------- payment capture -------------------------- */

async function redeemCoupon(order) {
  if (!order.coupon?.couponId) return;
  const claim = await Order.updateOne({ _id: order._id, couponRedeemed: false }, { $set: { couponRedeemed: true } });
  if (claim.modifiedCount !== 1) return;
  const inc = await Coupon.updateOne(
    { _id: order.coupon.couponId, 'usedBy.user': order.user },
    { $inc: { usedCount: 1, 'usedBy.$.count': 1 } },
  );
  if (inc.matchedCount === 0) {
    await Coupon.updateOne({ _id: order.coupon.couponId }, { $inc: { usedCount: 1 }, $push: { usedBy: { user: order.user, count: 1 } } });
  }
}

async function afterPaid(order) {
  const productIds = order.items.map((i) => i.product);
  await Promise.all([
    User.updateOne({ _id: order.user }, { $pull: { cart: { product: { $in: productIds } } } }),
    Product.bulkWrite(order.items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { soldCount: i.quantity } } } }))),
    redeemCoupon(order),
  ]);
  await Promise.all([invalidateProducts(), bumpNamespace('analytics')]);

  const claim = await Order.updateOne({ _id: order._id, emailSent: false }, { $set: { emailSent: true } });
  if (claim.modifiedCount === 1) {
    const user = await User.findById(order.user, 'name email').lean();
    if (user) await sendEmail(user.email, templates.orderConfirmed(user, order));
  }
}

/**
 * Idempotently transitions an order to "paid". Safe to call from the client
 * verification endpoint and from webhooks concurrently: only the first caller
 * performs side effects.
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
      },
      $push: { statusHistory: { status: 'paid', note: 'Payment received', by } },
    },
    { new: false },
  );

  if (!previous) {
    const current = await Order.findOne(orderFilter);
    if (!current) throw ApiError.notFound('Order not found');
    return current; // already processed - idempotent replay
  }

  let order = await Order.findById(previous._id);

  // Late payment after the reservation expired: stock was released, try to claim it again.
  if (!previous.stockReserved) {
    try {
      await reserveStock(order.items);
      order.stockReserved = true;
      await order.save();
    } catch {
      logger.warn({ orderId: String(order._id) }, 'late payment but stock unavailable - refunding');
      order.status = 'cancelled';
      order.statusHistory.push({ status: 'cancelled', note: 'Stock sold out before payment completed; refund initiated', by: 'system' });
      await order.save();
      await refundOrder(order, 'Stock unavailable after late payment');
      return order;
    }
  }

  await afterPaid(order);
  order = await Order.findById(order._id);
  return order;
}

export async function verifyClientPayment(userId, orderId, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) throw ApiError.notFound('Order not found');
  if (PAID_STATES.includes(order.status)) return order; // already confirmed (e.g. by webhook)

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
    order.payment.refundId = refund.id;
    order.payment.refundStatus = refund.status || 'pending';
  } catch (err) {
    logger.error({ err: err?.error || err?.message, orderId: String(order._id) }, 'refund failed');
    order.payment.refundStatus = 'failed';
  }
  await order.save();
  return order;
}

async function cancel(order, { by, note }) {
  const wasPaid = PAID_STATES.includes(order.status);
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status },
    {
      $set: { status: 'cancelled', stockReserved: false, reservationExpiresAt: null },
      $push: { statusHistory: { status: 'cancelled', note, by } },
    },
    { new: true },
  );
  if (!updated) throw ApiError.conflict('Order status changed, please refresh and try again', { code: 'STALE_ORDER' });
  if (order.stockReserved) await restock(order.items);
  if (wasPaid) {
    await Product.bulkWrite(order.items.map((i) => ({ updateOne: { filter: { _id: i.product }, update: { $inc: { soldCount: -i.quantity } } } })));
    await refundOrder(updated, note);
  }
  await Promise.all([invalidateProducts(), bumpNamespace('analytics')]);
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
    if (user) sendEmail(user.email, templates.orderStatus(user, updated));
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
    if (status === 'refunded') await refundOrder(order, note);
    await order.save();
    updated = order;
    await bumpNamespace('analytics');
  }

  if (['shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'].includes(status)) {
    const user = await User.findById(updated.user, 'name email').lean();
    if (user) sendEmail(user.email, templates.orderStatus(user, updated));
  }
  return updated;
}
