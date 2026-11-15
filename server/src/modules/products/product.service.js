import mongoose from 'mongoose';
import { Product, GENRES } from '../../models/Product.js';
import { Order } from '../../models/Order.js';
import { User } from '../../models/User.js';
import { cached, bumpNamespace } from '../../lib/cache.js';
import { escapeRegex, isObjectId, paginationMeta } from '../../lib/utils.js';
import { ApiError } from '../../lib/ApiError.js';

export const PRODUCT_NS = 'products';
const PUBLIC_FIELDS =
  'title slug author description genre price mrp coverImage badge publisher language pages isbn publishedYear stock lowStockThreshold fastDelivery ratingAverage ratingCount soldCount createdAt isActive';

/** Shape returned to clients (stable contract independent of the model). */
export function toProductDTO(p, { admin = false } = {}) {
  if (!p) return null;
  const discountPercent = p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0;
  const dto = {
    id: String(p._id),
    title: p.title,
    slug: p.slug,
    author: p.author,
    description: p.description,
    genre: p.genre,
    price: p.price,
    mrp: p.mrp,
    discountPercent,
    coverImage: p.coverImage || '',
    badge: p.badge || '',
    publisher: p.publisher || '',
    language: p.language || '',
    pages: p.pages || null,
    isbn: p.isbn || '',
    publishedYear: p.publishedYear || null,
    inStock: p.stock > 0,
    // Exact counts are only exposed when low, to create urgency without leaking inventory.
    stockLeft: p.stock > 0 && p.stock <= (p.lowStockThreshold ?? 5) ? p.stock : null,
    fastDelivery: Boolean(p.fastDelivery),
    rating: { average: p.ratingAverage || 0, count: p.ratingCount || 0 },
    createdAt: p.createdAt,
  };
  if (admin) {
    Object.assign(dto, {
      stock: p.stock,
      lowStockThreshold: p.lowStockThreshold,
      soldCount: p.soldCount,
      isActive: p.isActive,
      updatedAt: p.updatedAt,
    });
  }
  return dto;
}

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { price: 1, _id: 1 },
  price_desc: { price: -1, _id: -1 },
  rating: { ratingAverage: -1, ratingCount: -1, _id: 1 },
  popular: { soldCount: -1, ratingCount: -1, _id: 1 },
  title: { title: 1, _id: 1 },
};

function buildFilter(q, { includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { isActive: true };
  if (q.genres?.length) filter.genre = { $in: q.genres };
  if (q.author) filter.author = new RegExp(`^${escapeRegex(q.author)}$`, 'i');
  if (q.minPrice != null || q.maxPrice != null) {
    filter.price = {};
    if (q.minPrice != null) filter.price.$gte = q.minPrice;
    if (q.maxPrice != null) filter.price.$lte = q.maxPrice;
  }
  if (q.minRating) filter.ratingAverage = { $gte: q.minRating };
  if (q.inStock) filter.stock = { $gt: 0 };
  if (q.fastDelivery) filter.fastDelivery = true;
  if (q.lowStock) filter.$expr = { $lte: ['$stock', '$lowStockThreshold'] };
  if (q.status === 'active') filter.isActive = true;
  if (q.status === 'inactive') filter.isActive = false;
  return filter;
}

async function runQuery(filter, sort, page, limit, projection = PUBLIC_FIELDS) {
  const [items, total] = await Promise.all([
    Product.find(filter, projection)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);
  return { items, total };
}

export async function listProducts(query, { admin = false } = {}) {
  const page = query.page || 1;
  const limit = query.limit || 12;
  const execute = async () => {
    const base = buildFilter(query, { includeInactive: admin });
    let result;
    let sort = SORTS[query.sort] || SORTS.newest;
    const term = query.q?.trim();

    if (term) {
      // 1) Full-text search (stemming, relevance scoring) using the weighted text index.
      const textFilter = { ...base, $text: { $search: term } };
      const textSort = !query.sort || query.sort === 'relevance' ? { score: { $meta: 'textScore' }, _id: 1 } : sort;
      const projection = `${PUBLIC_FIELDS}${admin ? ' updatedAt' : ''}`;
      const [items, total] = await Promise.all([
        Product.find(textFilter, { score: { $meta: 'textScore' } })
          .select(projection)
          .sort(textSort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Product.countDocuments(textFilter),
      ]);
      result = { items, total };

      // 2) Fallback to partial/prefix matching (e.g. "harr" or "rowl") which $text cannot do.
      if (total === 0) {
        const rx = new RegExp(escapeRegex(term), 'i');
        if (!query.sort || query.sort === 'relevance') sort = SORTS.popular;
        result = await runQuery({ ...base, $or: [{ title: rx }, { author: rx }, { isbn: rx }] }, sort, page, limit);
      }
    } else {
      if (query.sort === 'relevance') sort = SORTS.popular;
      result = await runQuery(base, sort, page, limit, admin ? `${PUBLIC_FIELDS} updatedAt` : PUBLIC_FIELDS);
    }

    return {
      items: result.items.map((p) => toProductDTO(p, { admin })),
      meta: paginationMeta(page, limit, result.total),
    };
  };

  if (admin) return execute();
  return cached(PRODUCT_NS, `list:${JSON.stringify(query)}`, 120, execute);
}

export async function getProduct(idOrSlug, { admin = false } = {}) {
  const loader = async () => {
    const filter = isObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: String(idOrSlug).toLowerCase() };
    if (!admin) filter.isActive = true;
    const p = await Product.findOne(filter).lean();
    return p ? toProductDTO(p, { admin }) : null;
  };
  const product = admin ? await loader() : await cached(PRODUCT_NS, `one:${idOrSlug}`, 300, loader);
  if (!product) throw ApiError.notFound('Book not found');
  return product;
}

export function getCollections() {
  return cached(PRODUCT_NS, 'collections', 300, async () => {
    const active = { isActive: true };
    const [newArrivals, bestsellers, topRated, deals] = await Promise.all([
      Product.find(active, PUBLIC_FIELDS).sort(SORTS.newest).limit(8).lean(),
      Product.find(active, PUBLIC_FIELDS).sort({ soldCount: -1, ratingAverage: -1 }).limit(8).lean(),
      Product.find({ ...active, ratingCount: { $gt: 0 } }, PUBLIC_FIELDS).sort(SORTS.rating).limit(8).lean(),
      Product.aggregate([
        { $match: { ...active, stock: { $gt: 0 }, $expr: { $gt: ['$mrp', '$price'] } } },
        { $addFields: { _disc: { $divide: [{ $subtract: ['$mrp', '$price'] }, '$mrp'] } } },
        { $sort: { _disc: -1, soldCount: -1 } },
        { $limit: 8 },
      ]),
    ]);
    const map = (arr) => arr.map((p) => toProductDTO(p));
    return { newArrivals: map(newArrivals), bestsellers: map(bestsellers), topRated: map(topRated), deals: map(deals) };
  });
}

export function getFacets() {
  return cached(PRODUCT_NS, 'facets', 600, async () => {
    const [genres, [range]] = await Promise.all([
      Product.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$genre', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Product.aggregate([{ $match: { isActive: true } }, { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } }]),
    ]);
    return {
      genres: genres.map((g) => ({ value: g._id, count: g.count })),
      allGenres: GENRES,
      price: { min: range?.min ?? 0, max: range?.max ?? 0 },
    };
  });
}

export async function suggest(term) {
  const t = term?.trim();
  if (!t || t.length < 2) return [];
  return cached(PRODUCT_NS, `suggest:${t.toLowerCase()}`, 120, async () => {
    const rx = new RegExp(escapeRegex(t), 'i');
    const items = await Product.find({ isActive: true, $or: [{ title: rx }, { author: rx }] }, 'title slug author coverImage price genre')
      .sort({ soldCount: -1 })
      .limit(6)
      .lean();
    return items.map((p) => ({ id: String(p._id), title: p.title, slug: p.slug, author: p.author, coverImage: p.coverImage, price: p.price, genre: p.genre }));
  });
}

/** Content-based: same author first, then same genre, ranked by popularity and rating. */
export async function related(idOrSlug, limit = 8) {
  const product = await getProduct(idOrSlug);
  return cached(PRODUCT_NS, `related:${product.id}`, 600, async () => {
    const items = await Product.aggregate([
      {
        $match: {
          isActive: true,
          _id: { $ne: new mongoose.Types.ObjectId(product.id) },
          $or: [{ genre: product.genre }, { author: product.author }],
        },
      },
      { $addFields: { _sameAuthor: { $cond: [{ $eq: ['$author', product.author] }, 1, 0] } } },
      { $sort: { _sameAuthor: -1, soldCount: -1, ratingAverage: -1 } },
      { $limit: limit },
    ]);
    return items.map((p) => toProductDTO(p));
  });
}

/** Collaborative: products that co-occur with this one in paid orders. */
export async function alsoBought(idOrSlug, limit = 6) {
  const product = await getProduct(idOrSlug);
  return cached(PRODUCT_NS, `alsoBought:${product.id}`, 900, async () => {
    const pid = new mongoose.Types.ObjectId(product.id);
    const rows = await Order.aggregate([
      { $match: { 'items.product': pid, status: { $in: ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'] } } },
      { $sort: { createdAt: -1 } },
      { $limit: 500 },
      { $unwind: '$items' },
      { $match: { 'items.product': { $ne: pid } } },
      { $group: { _id: '$items.product', together: { $sum: 1 } } },
      { $sort: { together: -1 } },
      { $limit: limit },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
      { $unwind: '$p' },
      { $match: { 'p.isActive': true } },
      { $replaceRoot: { newRoot: '$p' } },
    ]);
    return rows.map((p) => toProductDTO(p));
  });
}

/**
 * Personalised recommendations: build an affinity profile from the user's
 * purchases (weight 3), wishlist (2) and cart (1), then rank unseen books by
 * genre/author affinity blended with popularity. Falls back to trending.
 */
export async function recommendationsFor(userId, limit = 8) {
  const trending = async () => {
    const items = await Product.find({ isActive: true, stock: { $gt: 0 } }, PUBLIC_FIELDS)
      .sort({ soldCount: -1, ratingAverage: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return { strategy: 'trending', items: items.map((p) => toProductDTO(p)) };
  };
  if (!userId) return cached(PRODUCT_NS, 'trending', 300, trending);

  const [user, orders] = await Promise.all([
    User.findById(userId, 'wishlist cart').lean(),
    Order.find({ user: userId, status: { $nin: ['pending_payment', 'expired', 'payment_failed'] } }, 'items.product')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);
  const purchased = orders.flatMap((o) => o.items.map((i) => String(i.product)));
  const weights = new Map();
  const add = (ids, w) => ids.forEach((id) => weights.set(String(id), (weights.get(String(id)) || 0) + w));
  add(purchased, 3);
  add(user?.wishlist || [], 2);
  add((user?.cart || []).map((c) => c.product), 1);
  if (weights.size === 0) return trending();

  const seeds = await Product.find({ _id: { $in: [...weights.keys()] } }, 'genre author').lean();
  const genreScore = {};
  const authorScore = {};
  for (const s of seeds) {
    const w = weights.get(String(s._id)) || 1;
    genreScore[s.genre] = (genreScore[s.genre] || 0) + w;
    authorScore[s.author] = (authorScore[s.author] || 0) + w * 1.5;
  }
  const exclude = [...new Set([...purchased, ...(user?.cart || []).map((c) => String(c.product))])].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  const genreBranches = Object.entries(genreScore).map(([g, w]) => ({ case: { $eq: ['$genre', g] }, then: w }));
  const authorBranches = Object.entries(authorScore).map(([a, w]) => ({ case: { $eq: ['$author', a] }, then: w }));

  const items = await Product.aggregate([
    {
      $match: {
        isActive: true,
        stock: { $gt: 0 },
        _id: { $nin: exclude },
        $or: [{ genre: { $in: Object.keys(genreScore) } }, { author: { $in: Object.keys(authorScore) } }],
      },
    },
    {
      $addFields: {
        _score: {
          $add: [
            genreBranches.length ? { $switch: { branches: genreBranches, default: 0 } } : 0,
            authorBranches.length ? { $switch: { branches: authorBranches, default: 0 } } : 0,
            { $multiply: [{ $ln: { $add: ['$soldCount', 1] } }, 0.5] },
            { $multiply: ['$ratingAverage', 0.3] },
          ],
        },
      },
    },
    { $sort: { _score: -1, _id: 1 } },
    { $limit: limit },
  ]);

  if (items.length < 4) return trending();
  return { strategy: 'personalised', items: items.map((p) => toProductDTO(p)) };
}

export const invalidateProducts = () => bumpNamespace(PRODUCT_NS);
