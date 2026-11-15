import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';
import { safeEqual } from './utils.js';

let instance = null;

export function getRazorpay() {
  if (!env.paymentsEnabled) {
    throw ApiError.unavailable('Online payments are not configured on this server', { code: 'PAYMENTS_DISABLED' });
  }
  if (!instance) {
    instance = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  }
  return instance;
}

/** Signature returned to Checkout: HMAC_SHA256(order_id + "|" + payment_id, key_secret) */
export function verifyPaymentSignature({ orderId, paymentId, signature }, secret = env.RAZORPAY_KEY_SECRET) {
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret) */
export function verifyWebhookSignature(rawBody, signature, secret = env.RAZORPAY_WEBHOOK_SECRET) {
  if (!secret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}
