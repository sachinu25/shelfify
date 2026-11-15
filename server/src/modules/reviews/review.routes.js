import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Review } from '../../models/Review.js';
import { Order } from '../../models/Order.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../lib/ApiError.js';
import { ok } from '../../lib/respond.js';
import { isObjectId, paginationMeta } from '../../lib/utils.js';
import { getProduct, invalidateProducts } from '../products/product.service.js';

// Mounted at /products/:idOrSlug/reviews
const router = Router({ mergeParams: true });

const reviewBody = z.object({
  rating: z.coerce.number().int().min(1, 'Rating is required').max(5),
  title: z.string().trim().max(120).optional().default(''),
  comment: z.string().trim().max(2000).optional().default(''),
});

const DELIVERED_LIKE = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

function toDTO(r, currentUserId) {
  return {
    id: String(r._id),
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    verifiedPurchase: r.verifiedPurchase,
    author: r.user?.name ? r.user.name.split(' ')[0] + (r.user.name.split(' ')[1] ? ` ${r.user.name.split(' ')[1][0]}.` : '') : 'Reader',
    isMine: currentUserId ? String(r.user?._id || r.user) === currentUserId : false,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

router.get(
  '/',
  validate({
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      sort: z.enum(['recent', 'highest', 'lowest']).default('recent'),
    }),
  }),
  async (req, res) => {
    const product = await getProduct(req.params.idOrSlug);
    const { page, limit, sort } = req.valid.query;
    const sortBy = { recent: { createdAt: -1 }, highest: { rating: -1, createdAt: -1 }, lowest: { rating: 1, createdAt: -1 } }[sort];
    const filter = { product: product.id };
    const [items, total, distribution] = await Promise.all([
      Review.find(filter).sort(sortBy).skip((page - 1) * limit).limit(limit).populate('user', 'name').lean(),
      Review.countDocuments(filter),
      Review.aggregate([{ $match: { product: new mongoose.Types.ObjectId(product.id) } }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
    ]);
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribution.forEach((d) => (dist[d._id] = d.count));
    ok(res, { items: items.map((r) => toDTO(r)), summary: { ...product.rating, distribution: dist } }, 200, paginationMeta(page, limit, total));
  },
);

/** Whether the signed-in user may review, and their existing review if any. */
router.get('/me', authenticate, async (req, res) => {
  const product = await getProduct(req.params.idOrSlug);
  const [mine, purchased] = await Promise.all([
    Review.findOne({ product: product.id, user: req.user.id }).lean(),
    Order.exists({ user: req.user.id, 'items.product': product.id, status: { $in: DELIVERED_LIKE } }),
  ]);
  ok(res, { review: mine ? toDTO(mine, req.user.id) : null, verifiedPurchase: Boolean(purchased) });
});

router.post('/', authenticate, validate({ body: reviewBody }), async (req, res) => {
  const product = await getProduct(req.params.idOrSlug);
  const purchased = await Order.exists({ user: req.user.id, 'items.product': product.id, status: { $in: DELIVERED_LIKE } });
  const review = await Review.findOneAndUpdate(
    { product: product.id, user: req.user.id },
    { $set: { ...req.body, verifiedPurchase: Boolean(purchased) } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  await Review.recalculate(product.id);
  await invalidateProducts();
  ok(res, toDTO(review, req.user.id), 201);
});

router.delete('/:reviewId', authenticate, async (req, res) => {
  if (!isObjectId(req.params.reviewId)) throw ApiError.badRequest('Invalid review id');
  const review = await Review.findById(req.params.reviewId);
  if (!review) throw ApiError.notFound('Review not found');
  if (String(review.user) !== req.user.id && req.user.role !== 'admin') throw ApiError.forbidden();
  await review.deleteOne();
  await Review.recalculate(review.product);
  await invalidateProducts();
  ok(res, { deleted: true });
});

export default router;
