import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { Product } from '../../models/Product.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { ApiError } from '../../lib/ApiError.js';
import { ok } from '../../lib/respond.js';
import { MAX_QTY_PER_ITEM, priceLines } from '../../lib/pricing.js';
import { isObjectId } from '../../lib/utils.js';
import { toProductDTO } from '../products/product.service.js';

const router = Router();

const objectId = z.string().refine(isObjectId, 'Invalid product id');
const qty = z.coerce.number().int().min(1, 'Quantity must be at least 1').max(MAX_QTY_PER_ITEM, `Maximum ${MAX_QTY_PER_ITEM} per item`);
const couponQuery = z.object({ coupon: z.string().trim().max(30).optional() });

async function loadLines(cart) {
  const ids = cart.map((c) => c.product);
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return cart.map((c) => ({ product: byId.get(String(c.product)) || null, quantity: c.quantity })).filter((l) => l.product);
}

function serialise(priced) {
  return {
    items: priced.lines.map((l) => ({
      product: toProductDTO(l.product),
      quantity: l.quantity,
      available: l.available,
      lineTotal: l.lineTotal,
    })),
    issues: priced.issues,
    coupon: priced.coupon,
    couponError: priced.couponError,
    summary: priced.summary,
  };
}

async function respondWithCart(res, userId, couponCode, status = 200) {
  const user = await User.findById(userId, 'cart').lean();
  const lines = await loadLines(user?.cart || []);
  const priced = await priceLines(lines, { couponCode, userId });
  ok(res, serialise(priced), status);
}

async function ensurePurchasable(productId) {
  const product = await Product.findById(productId, 'isActive stock title').lean();
  if (!product || !product.isActive) throw ApiError.notFound('Book not found');
  if (product.stock <= 0) throw ApiError.conflict(`"${product.title}" is out of stock`, { code: 'OUT_OF_STOCK' });
  return product;
}

/** Public price quote for guest carts kept in the browser. */
router.post(
  '/quote',
  optionalAuth,
  validate({
    body: z.object({
      items: z.array(z.object({ productId: objectId, quantity: qty })).max(50),
      coupon: z.string().trim().max(30).optional(),
    }),
  }),
  async (req, res) => {
    const merged = new Map();
    req.body.items.forEach((i) => merged.set(i.productId, Math.min(MAX_QTY_PER_ITEM, (merged.get(i.productId) || 0) + i.quantity)));
    const lines = await loadLines([...merged].map(([product, quantity]) => ({ product, quantity })));
    ok(res, serialise(await priceLines(lines, { couponCode: req.body.coupon, userId: req.user?.id })));
  },
);

router.use(authenticate);

router.get('/', validate({ query: couponQuery }), (req, res) => respondWithCart(res, req.user.id, req.valid.query.coupon));

router.post('/items', validate({ body: z.object({ productId: objectId, quantity: qty.default(1) }) }), async (req, res) => {
  const { productId, quantity } = req.body;
  const product = await ensurePurchasable(productId);
  const user = await User.findById(req.user.id, 'cart');
  const existing = user.cart.find((c) => String(c.product) === productId);
  const desired = Math.min(MAX_QTY_PER_ITEM, product.stock, (existing?.quantity || 0) + quantity);
  if (existing) existing.quantity = desired;
  else user.cart.push({ product: productId, quantity: desired });
  if (user.cart.length > 50) throw ApiError.badRequest('Your bag is full (50 titles max)');
  await user.save();
  await respondWithCart(res, req.user.id, undefined, 201);
});

router.patch(
  '/items/:productId',
  validate({ params: z.object({ productId: objectId }), body: z.object({ quantity: qty }) }),
  async (req, res) => {
    const { productId } = req.valid.params;
    const product = await ensurePurchasable(productId);
    const quantity = Math.min(req.body.quantity, product.stock);
    const result = await User.updateOne(
      { _id: req.user.id, 'cart.product': productId },
      { $set: { 'cart.$.quantity': quantity } },
    );
    if (!result.matchedCount) throw ApiError.notFound('Item is not in your bag');
    await respondWithCart(res, req.user.id);
  },
);

router.delete('/items/:productId', validate({ params: z.object({ productId: objectId }) }), async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $pull: { cart: { product: req.valid.params.productId } } });
  await respondWithCart(res, req.user.id);
});

router.delete('/', async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $set: { cart: [] } });
  await respondWithCart(res, req.user.id);
});

/** Merge a guest cart (from localStorage) into the account cart after sign-in. */
router.post(
  '/merge',
  validate({ body: z.object({ items: z.array(z.object({ productId: objectId, quantity: qty })).max(50) }) }),
  async (req, res) => {
    const user = await User.findById(req.user.id, 'cart');
    const ids = req.body.items.map((i) => i.productId);
    const products = await Product.find({ _id: { $in: ids }, isActive: true, stock: { $gt: 0 } }, 'stock').lean();
    const stockById = new Map(products.map((p) => [String(p._id), p.stock]));
    for (const item of req.body.items) {
      const stock = stockById.get(item.productId);
      if (!stock) continue;
      const existing = user.cart.find((c) => String(c.product) === item.productId);
      if (existing) existing.quantity = Math.min(MAX_QTY_PER_ITEM, stock, Math.max(existing.quantity, item.quantity));
      else if (user.cart.length < 50) user.cart.push({ product: item.productId, quantity: Math.min(MAX_QTY_PER_ITEM, stock, item.quantity) });
    }
    await user.save();
    await respondWithCart(res, req.user.id);
  },
);

export default router;
