import { Router } from 'express';
import { Coupon } from '../../models/Coupon.js';
import { ok } from '../../lib/respond.js';
import { cached } from '../../lib/cache.js';

const router = Router();

/** Publicly advertised offers shown in the bag. */
router.get('/available', async (_req, res) => {
  const coupons = await cached('coupons', 'available', 120, async () => {
    const now = new Date();
    const list = await Coupon.find({
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
        { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
      ],
    })
      .select('code description type value maxDiscount minOrderValue expiresAt usageLimit usedCount')
      .sort({ minOrderValue: 1 })
      .lean();
    return list
      .filter((c) => !c.usageLimit || c.usedCount < c.usageLimit)
      .map(({ code, description, type, value, maxDiscount, minOrderValue, expiresAt }) => ({
        code,
        description,
        type,
        value,
        maxDiscount: maxDiscount || null,
        minOrderValue: minOrderValue || 0,
        expiresAt: expiresAt || null,
      }));
  });
  ok(res, coupons);
});

export default router;
