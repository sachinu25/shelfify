import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { optionalAuth } from '../../middleware/auth.js';
import { ok } from '../../lib/respond.js';
import { GENRES } from '../../models/Product.js';
import {
  alsoBought,
  getCollections,
  getFacets,
  getProduct,
  listProducts,
  recommendationsFor,
  related,
  suggest,
} from './product.service.js';

const router = Router();

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  genre: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((g) => g.trim().toLowerCase()).filter((g) => GENRES.includes(g)) : undefined)),
  author: z.string().trim().max(120).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: bool.optional(),
  fastDelivery: bool.optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'rating', 'popular', 'title']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

const idParam = z.object({ idOrSlug: z.string().trim().min(1).max(200) });

router.get('/', validate({ query: listQuery }), async (req, res) => {
  const { genre, ...rest } = req.valid.query;
  const { items, meta } = await listProducts({ ...rest, genres: genre });
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  ok(res, items, 200, meta);
});

router.get('/collections', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  ok(res, await getCollections());
});

router.get('/facets', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  ok(res, await getFacets());
});

router.get('/suggest', validate({ query: z.object({ q: z.string().trim().max(100).default('') }) }), async (req, res) => {
  ok(res, await suggest(req.valid.query.q));
});

router.get('/recommendations', optionalAuth, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  ok(res, await recommendationsFor(req.user?.id));
});

router.get('/:idOrSlug', validate({ params: idParam }), async (req, res) => {
  ok(res, await getProduct(req.valid.params.idOrSlug));
});

router.get('/:idOrSlug/related', validate({ params: idParam }), async (req, res) => {
  ok(res, await related(req.valid.params.idOrSlug));
});

router.get('/:idOrSlug/also-bought', validate({ params: idParam }), async (req, res) => {
  ok(res, await alsoBought(req.valid.params.idOrSlug));
});

export default router;
