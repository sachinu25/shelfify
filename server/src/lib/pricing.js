import { Coupon } from '../models/Coupon.js';
import { Order } from '../models/Order.js';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';
import { roundMoney } from './utils.js';

export const MAX_QTY_PER_ITEM = 10;

/**
 * Validates a coupon for a user and subtotal. Returns the coupon document.
 * Throws ApiError(422) with a user friendly reason when not applicable.
 */
export async function resolveCoupon(code, { userId, subtotal, session = null }) {
  if (!code) return null;
  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() }).session(session).lean();
  const fail = (message, c = 'COUPON_INVALID') => {
    throw new ApiError(422, message, { code: c });
  };
  const now = new Date();
  if (!coupon || !coupon.isActive) fail('This coupon code is not valid');
  if (coupon.startsAt && coupon.startsAt > now) fail('This coupon is not active yet');
  if (coupon.expiresAt && coupon.expiresAt < now) fail('This coupon has expired', 'COUPON_EXPIRED');
  // Uses held by unpaid orders count against the limit (audit M2).
  if (coupon.usageLimit && coupon.usedCount + (coupon.reservedCount || 0) >= coupon.usageLimit) {
    fail('This coupon has reached its usage limit', 'COUPON_EXHAUSTED');
  }
  if (subtotal < (coupon.minOrderValue || 0)) {
    fail(`Add items worth ₹${roundMoney(coupon.minOrderValue - subtotal)} more to use ${coupon.code}`, 'COUPON_MIN_ORDER');
  }
  if (userId && coupon.perUserLimit) {
    const used = coupon.usedBy?.find((u) => String(u.user) === String(userId))?.count || 0;
    const held = await Order.countDocuments({ user: userId, 'coupon.couponId': coupon._id, couponHeld: true }).session(session);
    if (used + held >= coupon.perUserLimit) {
      fail(held ? 'This coupon is already applied to one of your unpaid orders' : 'You have already used this coupon', 'COUPON_USED');
    }
  }
  return coupon;
}

/**
 * Atomically reserves one use of a coupon for an order awaiting payment.
 * Must run inside the checkout transaction: every reservation writes the coupon
 * document, so concurrent checkouts conflict and are retried by the driver,
 * which serialises the limit checks above. The conditional update additionally
 * guards the global limit when transactions are unavailable.
 */
export async function holdCoupon(code, { userId, subtotal, session }) {
  const coupon = await resolveCoupon(code, { userId, subtotal, session });
  const guard = coupon.usageLimit
    ? { $expr: { $lt: [{ $add: ['$usedCount', { $ifNull: ['$reservedCount', 0] }] }, '$usageLimit'] } }
    : {};
  const res = await Coupon.updateOne({ _id: coupon._id, isActive: true, ...guard }, { $inc: { reservedCount: 1 } }, { session });
  if (res.modifiedCount !== 1) throw new ApiError(422, 'This coupon has reached its usage limit', { code: 'COUPON_EXHAUSTED' });
  return coupon;
}

export function couponDiscount(coupon, subtotal) {
  if (!coupon) return 0;
  let discount = coupon.type === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.type === 'percent' && coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  return roundMoney(Math.min(discount, subtotal));
}

export function shippingFor(subtotal) {
  if (subtotal <= 0) return 0;
  return subtotal >= env.FREE_SHIPPING_THRESHOLD ? 0 : env.SHIPPING_FEE;
}

/**
 * Prices a list of `{ product, quantity }` where product is a lean Product doc.
 * All money is derived from the database, never from the client.
 */
export async function priceLines(lines, { couponCode, userId, strictCoupon = false } = {}) {
  const issues = [];
  let subtotal = 0;
  let mrpTotal = 0;

  const priced = lines.map(({ product, quantity }) => {
    const available = product && product.isActive && product.stock > 0;
    const qty = Math.min(quantity, MAX_QTY_PER_ITEM);
    if (!product || !product.isActive) issues.push({ type: 'unavailable', productId: String(product?._id || '') });
    else if (product.stock <= 0) issues.push({ type: 'out_of_stock', productId: String(product._id), title: product.title });
    else if (product.stock < qty) {
      issues.push({ type: 'insufficient_stock', productId: String(product._id), title: product.title, available: product.stock });
    }
    if (available) {
      subtotal += product.price * qty;
      mrpTotal += product.mrp * qty;
    }
    return { product, quantity: qty, available: Boolean(available), lineTotal: available ? roundMoney(product.price * qty) : 0 };
  });

  subtotal = roundMoney(subtotal);
  mrpTotal = roundMoney(mrpTotal);

  let coupon = null;
  let couponError = null;
  if (couponCode) {
    try {
      coupon = await resolveCoupon(couponCode, { userId, subtotal });
    } catch (err) {
      if (strictCoupon) throw err;
      couponError = err.message;
    }
  }

  const discount = couponDiscount(coupon, subtotal);
  const shipping = shippingFor(subtotal);
  const total = roundMoney(Math.max(0, subtotal - discount + shipping));

  return {
    lines: priced,
    issues,
    coupon: coupon ? { code: coupon.code, description: coupon.description, type: coupon.type, value: coupon.value, id: String(coupon._id) } : null,
    couponError,
    summary: {
      itemCount: priced.filter((l) => l.available).reduce((n, l) => n + l.quantity, 0),
      mrpTotal,
      subtotal,
      productSavings: roundMoney(mrpTotal - subtotal),
      couponDiscount: discount,
      shipping,
      freeShippingThreshold: env.FREE_SHIPPING_THRESHOLD,
      amountToFreeShipping: subtotal > 0 && subtotal < env.FREE_SHIPPING_THRESHOLD ? roundMoney(env.FREE_SHIPPING_THRESHOLD - subtotal) : 0,
      total,
      currency: 'INR',
    },
  };
}
