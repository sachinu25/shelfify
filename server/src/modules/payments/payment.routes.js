import { Router } from 'express';
import express from 'express';
import { env } from '../../config/env.js';
import { Order } from '../../models/Order.js';
import { WebhookEvent } from '../../models/WebhookEvent.js';
import { verifyWebhookSignature } from '../../lib/razorpay.js';
import { ok } from '../../lib/respond.js';
import { markPaid, markPaymentFailed } from '../orders/order.service.js';

const router = Router();

/** Public payment configuration - only the publishable key id is exposed. */
router.get('/config', (_req, res) => {
  ok(res, { enabled: env.paymentsEnabled, provider: 'razorpay', keyId: env.paymentsEnabled ? env.RAZORPAY_KEY_ID : null, currency: 'INR' });
});

/**
 * Razorpay webhook. Must receive the raw body for HMAC verification, so it is
 * mounted with express.raw() and registered before the global JSON parser.
 */
router.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const signature = req.get('x-razorpay-signature');

  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    req.log?.warn('webhook received but RAZORPAY_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ success: false, error: { code: 'WEBHOOK_DISABLED', message: 'Webhook not configured' } });
  }

  // The HMAC must be computed over the exact bytes Razorpay sent (audit M4). express.raw
  // provides a Buffer; a string means a platform helper decoded it (re-encode losslessly
  // as UTF-8). Anything else means the body was parsed upstream and the signature can't
  // be verified reliably - refuse loudly instead of reporting a misleading "invalid signature".
  let raw;
  if (Buffer.isBuffer(req.body)) raw = req.body;
  else if (typeof req.body === 'string') raw = Buffer.from(req.body, 'utf8');
  else {
    req.log?.error('webhook raw body unavailable - ensure NODEJS_HELPERS=0 on Vercel');
    return res.status(400).json({ success: false, error: { code: 'RAW_BODY_UNAVAILABLE', message: 'Raw request body unavailable' } });
  }
  if (!verifyWebhookSignature(raw, signature)) {
    req.log?.warn('invalid webhook signature');
    return res.status(400).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Invalid payload' } });
  }

  const eventId = req.get('x-razorpay-event-id') || `${event.event}:${event.payload?.payment?.entity?.id || event.created_at}`;
  if (await WebhookEvent.exists({ eventId })) return ok(res, { received: true, duplicate: true });

  const payment = event.payload?.payment?.entity;
  const razorpayOrderId = payment?.order_id || event.payload?.order?.entity?.id;

  switch (event.event) {
    case 'payment.captured':
    case 'order.paid': {
      if (razorpayOrderId && (await Order.exists({ 'payment.razorpayOrderId': razorpayOrderId }))) {
        await markPaid({ 'payment.razorpayOrderId': razorpayOrderId }, { paymentId: payment?.id, method: payment?.method, by: 'webhook' });
      }
      break;
    }
    case 'payment.failed': {
      if (razorpayOrderId) await markPaymentFailed(razorpayOrderId, payment?.error_description || 'Payment failed');
      break;
    }
    case 'refund.processed':
    case 'refund.failed': {
      const refund = event.payload?.refund?.entity;
      if (refund?.payment_id) {
        await Order.updateOne(
          { 'payment.razorpayPaymentId': refund.payment_id },
          { $set: { 'payment.refundId': refund.id, 'payment.refundStatus': event.event === 'refund.processed' ? 'processed' : 'failed' } },
        );
      }
      break;
    }
    default:
      break;
  }

  // Record after successful processing; processing itself is idempotent so a
  // concurrent duplicate delivery is harmless.
  await WebhookEvent.create({ eventId, event: event.event }).catch((err) => {
    if (err?.code !== 11000) throw err;
  });
  ok(res, { received: true });
});

export default router;
