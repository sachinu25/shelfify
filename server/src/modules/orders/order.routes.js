import { Router } from 'express';
import { z } from 'zod';
import { Order, ORDER_STATUSES } from '../../models/Order.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { paymentLimiter } from '../../middleware/rateLimit.js';
import { ApiError } from '../../lib/ApiError.js';
import { ok } from '../../lib/respond.js';
import { isObjectId, paginationMeta } from '../../lib/utils.js';
import { addressSchema } from '../users/user.schemas.js';
import { createCheckout, customerCancel, retryPayment, toOrderDTO, verifyClientPayment } from './order.service.js';

const router = Router();
router.use(authenticate);

const orderParam = validate({ params: z.object({ id: z.string().refine(isObjectId, 'Invalid order id') }) });

router.post(
  '/checkout',
  paymentLimiter,
  validate({
    body: z
      .object({
        addressId: z.string().refine(isObjectId, 'Invalid address').optional(),
        address: addressSchema.optional(),
        coupon: z.string().trim().max(30).optional(),
      })
      .refine((b) => b.addressId || b.address, { message: 'A shipping address is required', path: ['address'] }),
  }),
  async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw ApiError.badRequest('Invalid Idempotency-Key header');
    const result = await createCheckout({
      userId: req.user.id,
      address: req.body.address,
      addressId: req.body.addressId,
      couponCode: req.body.coupon,
      idempotencyKey: key,
    });
    ok(res, result, result.replayed ? 200 : 201);
  },
);

router.get(
  '/',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      status: z.enum(ORDER_STATUSES).optional(),
    }),
  }),
  async (req, res) => {
    const { page, limit, status } = req.valid.query;
    const filter = { user: req.user.id, ...(status ? { status } : {}) };
    const [items, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    ok(res, items.map(toOrderDTO), 200, paginationMeta(page, limit, total));
  },
);

router.get('/:id', orderParam, async (req, res) => {
  const filter = { _id: req.valid.params.id };
  if (req.user.role !== 'admin') filter.user = req.user.id;
  const order = await Order.findOne(filter).populate('user', 'name email').lean();
  if (!order) throw ApiError.notFound('Order not found');
  ok(res, toOrderDTO(order));
});

router.post('/:id/pay', paymentLimiter, orderParam, async (req, res) => {
  ok(res, await retryPayment(req.user.id, req.valid.params.id));
});

router.post(
  '/:id/verify',
  paymentLimiter,
  orderParam,
  validate({
    body: z.object({
      razorpay_order_id: z.string().min(1).max(100),
      razorpay_payment_id: z.string().min(1).max(100),
      razorpay_signature: z.string().min(1).max(256),
    }),
  }),
  async (req, res) => {
    const order = await verifyClientPayment(req.user.id, req.valid.params.id, {
      razorpayOrderId: req.body.razorpay_order_id,
      razorpayPaymentId: req.body.razorpay_payment_id,
      razorpaySignature: req.body.razorpay_signature,
    });
    ok(res, toOrderDTO(order));
  },
);

router.post(
  '/:id/cancel',
  orderParam,
  validate({ body: z.object({ reason: z.string().trim().max(300).optional() }) }),
  async (req, res) => {
    const order = await customerCancel(req.user.id, req.valid.params.id, req.body.reason);
    ok(res, toOrderDTO(order));
  },
);

export default router;
