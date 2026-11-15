import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import productRoutes from '../modules/products/product.routes.js';
import reviewRoutes from '../modules/reviews/review.routes.js';
import cartRoutes from '../modules/cart/cart.routes.js';
import wishlistRoutes from '../modules/wishlist/wishlist.routes.js';
import orderRoutes from '../modules/orders/order.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import couponRoutes from '../modules/coupons/coupon.routes.js';
import adminRoutes from '../modules/admin/admin.routes.js';
import { env } from '../config/env.js';
import { ApiError } from '../lib/ApiError.js';
import { ok } from '../lib/respond.js';
import { safeEqual } from '../lib/utils.js';
import { releaseExpiredReservations } from '../modules/orders/order.service.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products/:idOrSlug/reviews', reviewRoutes);
router.use('/products', productRoutes);
router.use('/cart', cartRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/orders', orderRoutes);
router.use('/users', userRoutes);
router.use('/coupons', couponRoutes);
router.use('/admin', adminRoutes);

/** Scheduled maintenance (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
router.get('/internal/cron/release-reservations', async (req, res) => {
  const header = req.get('authorization') || '';
  if (!env.CRON_SECRET || !safeEqual(header, `Bearer ${env.CRON_SECRET}`)) throw ApiError.unauthorized();
  ok(res, { released: await releaseExpiredReservations(1000) });
});

export default router;
