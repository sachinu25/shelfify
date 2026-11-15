import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Product } from '../../models/Product.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../lib/ApiError.js';
import { ok } from '../../lib/respond.js';
import { isObjectId } from '../../lib/utils.js';
import { toProductDTO } from '../products/product.service.js';

const router = Router();
router.use(authenticate);

const params = validate({ params: z.object({ productId: z.string().refine(isObjectId, 'Invalid product id') }) });

async function respond(res, userId, status = 200) {
  const user = await User.findById(userId, 'wishlist').lean();
  const ids = user?.wishlist || [];
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  // Preserve the order in which items were saved (most recent last -> show most recent first)
  const items = ids
    .map((id) => byId.get(String(id)))
    .filter(Boolean)
    .reverse()
    .map((p) => toProductDTO(p));
  ok(res, items, status);
}

router.get('/', (req, res) => respond(res, req.user.id));

router.post('/:productId', params, async (req, res) => {
  const { productId } = req.valid.params;
  if (!(await Product.exists({ _id: productId, isActive: true }))) throw ApiError.notFound('Book not found');
  const user = await User.findById(req.user.id, 'wishlist').lean();
  if ((user?.wishlist?.length || 0) >= 200) throw ApiError.badRequest('Your wishlist is full (200 titles max)');
  await User.updateOne({ _id: req.user.id }, { $addToSet: { wishlist: productId } });
  await respond(res, req.user.id, 201);
});

router.delete('/:productId', params, async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $pull: { wishlist: req.valid.params.productId } });
  await respond(res, req.user.id);
});

export default router;
