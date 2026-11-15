import { Router } from 'express';
import { z } from 'zod';
import { Product, GENRES } from '../../models/Product.js';
import { Order, ORDER_STATUSES } from '../../models/Order.js';
import { Coupon } from '../../models/Coupon.js';
import { User } from '../../models/User.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { ApiError } from '../../lib/ApiError.js';
import { ok } from '../../lib/respond.js';
import { bumpNamespace } from '../../lib/cache.js';
import { escapeRegex, isObjectId, paginationMeta } from '../../lib/utils.js';
import { httpUrl, toPatchSchema } from '../../lib/validation.js';
import { getProduct, invalidateProducts, listProducts, toProductDTO } from '../products/product.service.js';
import { listQuery } from '../products/product.routes.js';
import { adminUpdateStatus, releaseExpiredReservations, toOrderDTO } from '../orders/order.service.js';
import { getAnalytics } from './analytics.service.js';

const router = Router();
router.use(authenticate, authorize('admin'));

const idParam = validate({ params: z.object({ id: z.string().refine(isObjectId, 'Invalid id') }) });
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/* ------------------------------- analytics ------------------------------ */

router.get('/analytics', validate({ query: z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 365].includes(d)).default(30) }) }), async (req, res) => {
  ok(res, await getAnalytics(req.valid.query.days));
});

/* -------------------------------- products ------------------------------ */

const productBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  author: z.string().trim().min(1, 'Author is required').max(120),
  description: z.string().trim().max(5000).optional().default(''),
  genre: z.enum(GENRES),
  price: z.coerce.number().min(0, 'Price must be positive'),
  mrp: z.coerce.number().min(0),
  // Absolute http(s) URL, or a same-site path such as /covers/x.jpg (protocol-relative //host is rejected).
  coverImage: z
    .union([
      httpUrl('Cover must be an http(s) URL or a /path'),
      z.string().trim().regex(/^\/(?!\/)[\w\-./]+$/, 'Cover must be an http(s) URL or a /path'),
      z.literal(''),
    ])
    .optional()
    .default(''),
  badge: z.string().trim().max(30).optional().default(''),
  publisher: z.string().trim().max(120).optional(),
  language: z.string().trim().max(40).optional(),
  pages: z.coerce.number().int().min(1).optional().nullable(),
  isbn: z.string().trim().max(20).optional(),
  publishedYear: z.coerce.number().int().min(1000).max(3000).optional().nullable(),
  stock: z.coerce.number().int().min(0).default(0),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  fastDelivery: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

const adminListQuery = listQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  lowStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});

router.get('/products', validate({ query: adminListQuery }), async (req, res) => {
  const { genre, ...rest } = req.valid.query;
  const { items, meta } = await listProducts({ ...rest, genres: genre, sort: rest.sort || 'newest' }, { admin: true });
  ok(res, items, 200, meta);
});

router.get('/products/:id', idParam, async (req, res) => {
  ok(res, await getProduct(req.valid.params.id, { admin: true }));
});

router.post('/products', validate({ body: productBody }), async (req, res) => {
  if (req.body.mrp < req.body.price) throw ApiError.badRequest('MRP cannot be lower than the selling price');
  const product = await Product.create(req.body);
  await invalidateProducts();
  ok(res, toProductDTO(product.toObject(), { admin: true }), 201);
});

router.patch('/products/:id', idParam, validate({ body: toPatchSchema(productBody) }), async (req, res) => {
  const product = await Product.findById(req.valid.params.id);
  if (!product) throw ApiError.notFound('Book not found');
  product.set(req.body);
  if (product.mrp < product.price) throw ApiError.badRequest('MRP cannot be lower than the selling price');
  await product.save();
  await invalidateProducts();
  ok(res, toProductDTO(product.toObject(), { admin: true }));
});

router.patch(
  '/products/:id/stock',
  idParam,
  validate({ body: z.object({ mode: z.enum(['set', 'adjust']), value: z.coerce.number().int().min(-10000).max(10000) }) }),
  async (req, res) => {
    const { mode, value } = req.body;
    const filter = { _id: req.valid.params.id };
    let update;
    if (mode === 'set') {
      if (value < 0) throw ApiError.badRequest('Stock cannot be negative');
      update = { $set: { stock: value } };
    } else {
      if (value < 0) filter.stock = { $gte: -value }; // never go below zero
      update = { $inc: { stock: value } };
    }
    const product = await Product.findOneAndUpdate(filter, update, { new: true }).lean();
    if (!product) throw ApiError.badRequest('Stock adjustment would make inventory negative or book not found');
    await Promise.all([invalidateProducts(), bumpNamespace('analytics')]);
    ok(res, toProductDTO(product, { admin: true }));
  },
);

router.delete('/products/:id', idParam, async (req, res) => {
  const id = req.valid.params.id;
  const hasOrders = await Order.exists({ 'items.product': id });
  if (hasOrders) {
    // Keep order history intact: archive instead of deleting.
    await Product.updateOne({ _id: id }, { $set: { isActive: false } });
    await invalidateProducts();
    return ok(res, { archived: true, deleted: false });
  }
  const result = await Product.deleteOne({ _id: id });
  if (!result.deletedCount) throw ApiError.notFound('Book not found');
  await Promise.all([User.updateMany({}, { $pull: { wishlist: id, cart: { product: id } } }), invalidateProducts()]);
  ok(res, { archived: false, deleted: true });
});

/* --------------------------------- orders ------------------------------- */

router.get(
  '/orders',
  validate({ query: z.object({ ...pageQuery, status: z.enum(ORDER_STATUSES).optional(), q: z.string().trim().max(100).optional() }) }),
  async (req, res) => {
    const { page, limit, status, q } = req.valid.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      const users = await User.find({ $or: [{ email: rx }, { name: rx }] }, '_id').limit(50).lean();
      filter.$or = [{ orderNumber: rx }, { user: { $in: users.map((u) => u._id) } }];
    }
    const [items, total] = await Promise.all([
      Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);
    ok(res, items.map(toOrderDTO), 200, paginationMeta(page, limit, total));
  },
);

router.patch(
  '/orders/:id/status',
  idParam,
  validate({
    body: z.object({
      status: z.enum(ORDER_STATUSES),
      note: z.string().trim().max(300).optional(),
      tracking: z
        .object({
          carrier: z.string().trim().max(60).optional(),
          number: z.string().trim().max(60).optional(),
          url: z.union([httpUrl('Tracking URL must be an http(s) URL', 300), z.literal('')]).optional(),
        })
        .optional(),
    }),
  }),
  async (req, res) => {
    const order = await adminUpdateStatus(req.valid.params.id, req.body);
    const populated = await Order.findById(order._id).populate('user', 'name email').lean();
    ok(res, toOrderDTO(populated));
  },
);

router.post('/orders/release-expired', async (_req, res) => {
  ok(res, { released: await releaseExpiredReservations(500) });
});

/* -------------------------------- coupons ------------------------------- */

const couponFields = z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,30}$/, 'Code must be 3-30 letters, numbers, - or _'),
    description: z.string().trim().max(200).optional().default(''),
    type: z.enum(['percent', 'flat']),
    value: z.coerce.number().positive('Value must be positive'),
    maxDiscount: z.coerce.number().min(0).optional().nullable(),
    minOrderValue: z.coerce.number().min(0).optional().default(0),
    startsAt: z.coerce.date().optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    usageLimit: z.coerce.number().int().min(1).optional().nullable(),
    perUserLimit: z.coerce.number().int().min(1).optional().default(1),
    isActive: z.boolean().optional().default(true),
  });

const couponBody = couponFields
  .refine((c) => c.type !== 'percent' || c.value <= 90, { message: 'Percentage discount cannot exceed 90%', path: ['value'] })
  .refine((c) => !c.startsAt || !c.expiresAt || c.startsAt < c.expiresAt, { message: 'Expiry must be after start date', path: ['expiresAt'] });
const couponPatch = toPatchSchema(couponFields);

function couponDTO(c) {
  const { usedBy, __v, ...rest } = c;
  return { ...rest, id: String(c._id), uniqueUsers: usedBy?.length || 0 };
}

router.get('/coupons', async (_req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
  ok(res, coupons.map(couponDTO));
});

router.post('/coupons', validate({ body: couponBody }), async (req, res) => {
  const coupon = await Coupon.create(req.body);
  await bumpNamespace('coupons');
  ok(res, couponDTO(coupon.toObject()), 201);
});

router.patch('/coupons/:id', idParam, validate({ body: couponPatch }), async (req, res) => {
  const coupon = await Coupon.findById(req.valid.params.id);
  if (!coupon) throw ApiError.notFound('Coupon not found');
  coupon.set(req.body);
  if (coupon.type === 'percent' && coupon.value > 90) throw ApiError.badRequest('Percentage discount cannot exceed 90%');
  if (coupon.startsAt && coupon.expiresAt && coupon.startsAt >= coupon.expiresAt) throw ApiError.badRequest('Expiry must be after start date');
  await coupon.save();
  await bumpNamespace('coupons');
  ok(res, couponDTO(coupon.toObject()));
});

router.delete('/coupons/:id', idParam, async (req, res) => {
  const result = await Coupon.deleteOne({ _id: req.valid.params.id });
  if (!result.deletedCount) throw ApiError.notFound('Coupon not found');
  await bumpNamespace('coupons');
  ok(res, { deleted: true });
});

/* --------------------------------- users -------------------------------- */

router.get(
  '/users',
  validate({ query: z.object({ ...pageQuery, q: z.string().trim().max(100).optional(), role: z.enum(['customer', 'admin']).optional() }) }),
  async (req, res) => {
    const { page, limit, q, role } = req.valid.query;
    const filter = {};
    if (role) filter.role = role;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: rx }, { email: rx }];
    }
    const [users, total] = await Promise.all([
      User.find(filter, 'name email role isBlocked createdAt lastLoginAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    const stats = await Order.aggregate([
      { $match: { user: { $in: users.map((u) => u._id) }, status: { $in: ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'] } } },
      { $group: { _id: '$user', orders: { $sum: 1 }, spent: { $sum: '$pricing.total' } } },
    ]);
    const byUser = new Map(stats.map((s) => [String(s._id), s]));
    ok(
      res,
      users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        isBlocked: u.isBlocked,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        orders: byUser.get(String(u._id))?.orders || 0,
        spent: byUser.get(String(u._id))?.spent || 0,
      })),
      200,
      paginationMeta(page, limit, total),
    );
  },
);

router.patch(
  '/users/:id',
  idParam,
  validate({ body: z.object({ role: z.enum(['customer', 'admin']).optional(), isBlocked: z.boolean().optional() }) }),
  async (req, res) => {
    if (req.valid.params.id === req.user.id) throw ApiError.badRequest('You cannot change your own role or status');
    const update = { ...req.body };
    const user = await User.findByIdAndUpdate(
      req.valid.params.id,
      // Role/status changes invalidate outstanding access tokens immediately.
      { $set: update, $inc: { tokenVersion: 1 } },
      { new: true },
    ).lean();
    if (!user) throw ApiError.notFound('User not found');
    ok(res, { id: String(user._id), name: user.name, email: user.email, role: user.role, isBlocked: user.isBlocked });
  },
);

export default router;
