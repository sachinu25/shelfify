/**
 * Read-only verification of a seeded database against the seed source
 * (scripts/catalog.json and the coupon definitions). Never writes; never prints
 * the admin email or password.
 *
 *   npm run prod:verify-seed     (via scripts/prod.js -> server/.env.production.local only)
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import slugify from 'slugify';

const results = [];
const check = (label, ok, detail = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
};

const conn = await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15_000 });
const db = conn.connection.db;
console.log(`Database: ${db.databaseName} on ${new URL(process.env.MONGODB_URI).hostname}\n`);

// Load models (for declared index definitions) without triggering any writes.
const { Product } = await import('../src/models/Product.js');
const { Coupon } = await import('../src/models/Coupon.js');
const { User } = await import('../src/models/User.js');
const { Order } = await import('../src/models/Order.js');
const { Review } = await import('../src/models/Review.js');
const { RefreshToken } = await import('../src/models/RefreshToken.js');
const { WebhookEvent } = await import('../src/models/WebhookEvent.js');

const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
const expectedBySlug = new Map(catalog.map((b) => [slugify(b.title, { lower: true, strict: true }), b]));

// 1) Books
console.log('1. Books');
const products = await db.collection('products').find({}).toArray();
check('exactly 21 books', products.length === 21, `${products.length} found`);
const slugs = products.map((p) => p.slug);
check('every catalog book present (matched by slug)', [...expectedBySlug.keys()].every((s) => slugs.includes(s)));
check('no books outside the catalog', slugs.every((s) => expectedBySlug.has(s)));
const fieldsMatch = products.every((p) => {
  const e = expectedBySlug.get(p.slug);
  return e && p.title === e.title && p.author === e.author && p.genre === e.genre && p.price === e.price && p.mrp === e.mrp && (p.coverImage || '') === (e.coverImage || '');
});
check('title, author, genre, price, MRP and cover match the source', fieldsMatch);
check('all books active, ratings/sales start at zero', products.every((p) => p.isActive && p.ratingCount === 0 && p.ratingAverage === 0 && p.soldCount === 0));

// 2) Coupons
console.log('\n2. Coupons');
const coupons = await db.collection('coupons').find({}).toArray();
const byCode = Object.fromEntries(coupons.map((c) => [c.code, c]));
check('exactly 2 coupons', coupons.length === 2, coupons.map((c) => c.code).join(', '));
const b200 = byCode.BOOKS200;
check('BOOKS200: flat ₹200 off, min order ₹999, 3 uses per customer, active', Boolean(b200) && b200.type === 'flat' && b200.value === 200 && b200.minOrderValue === 999 && b200.perUserLimit === 3 && b200.isActive);
const w10 = byCode.WELCOME10;
check('WELCOME10: 10% off up to ₹150, min order ₹299, 1 use per customer, active', Boolean(w10) && w10.type === 'percent' && w10.value === 10 && w10.maxDiscount === 150 && w10.minOrderValue === 299 && w10.perUserLimit === 1 && w10.isActive);
check('coupon counters start at zero (used, reserved)', coupons.every((c) => (c.usedCount || 0) === 0 && (c.reservedCount || 0) === 0 && (c.usedBy || []).length === 0));

// 3) Indexes: every index declared in the models exists in the database
console.log('\n3. Indexes');
const keyOf = (k) => JSON.stringify(Object.entries(k));
for (const model of [Product, Coupon, User, Order, Review, RefreshToken, WebhookEvent]) {
  const name = model.collection.collectionName;
  let actual = [];
  try {
    actual = await db.collection(name).listIndexes().toArray();
  } catch {
    actual = [];
  }
  const actualKeys = new Set(actual.map((i) => keyOf(i.key)));
  // text indexes are stored as {_fts:'text', _ftsx:1}
  const hasText = actual.some((i) => i.key._fts === 'text');
  const declared = model.schema.indexes().map(([fields]) => fields);
  const missing = declared.filter((f) => (Object.values(f).includes('text') ? !hasText : !actualKeys.has(keyOf(f))));
  check(`${name.padEnd(14)} ${declared.length + 1} expected (incl. _id)`, missing.length === 0 && actualKeys.has(keyOf({ _id: 1 })), `${actual.length} present${missing.length ? `, missing: ${missing.map((m) => JSON.stringify(m)).join(' ')}` : ''}`);
}
const uniqueOk = (await db.collection('products').listIndexes().toArray()).some((i) => i.key.slug === 1 && i.unique);
check('unique index on product slug (prevents duplicate books)', uniqueOk);
const emailUnique = (await db.collection('users').listIndexes().toArray()).some((i) => i.key.email === 1 && i.unique);
check('unique index on user email', emailUnique);
const couponUnique = (await db.collection('coupons').listIndexes().toArray()).some((i) => i.key.code === 1 && i.unique);
check('unique index on coupon code', couponUnique);

// 4) Admin account
console.log('\n4. Admin account');
const users = await db.collection('users').find({}, { projection: { email: 1, role: 1, password: 1, name: 1, isBlocked: 1, tokenVersion: 1 } }).toArray();
const admins = users.filter((u) => u.role === 'admin');
check('exactly one admin account', admins.length === 1, `${admins.length} admin(s), ${users.length} user(s) total`);
const admin = admins[0];
if (admin) {
  check('admin email equals SEED_ADMIN_EMAIL (compared, not shown)', admin.email === process.env.SEED_ADMIN_EMAIL.trim().toLowerCase());
  check('password stored as a bcrypt hash (cost 12)', /^\$2[aby]\$12\$/.test(admin.password || ''));
  check('stored hash verifies against SEED_ADMIN_PASSWORD (sign-in will work)', await bcrypt.compare(process.env.SEED_ADMIN_PASSWORD, admin.password || ''));
  check('admin not blocked, fresh token version', !admin.isBlocked && (admin.tokenVersion || 0) === 0, admin.name ? `name "${admin.name}"` : '');
}

// 5) Initial inventory
console.log('\n5. Initial inventory');
const stockMatches = products.every((p) => p.stock === expectedBySlug.get(p.slug)?.stock);
check('every book has the stock defined in the source', stockMatches);
const units = products.reduce((n, p) => n + p.stock, 0);
check('total units = 450', units === 450, `${units} units`);
const soldOut = products.filter((p) => p.stock === 0).map((p) => p.title);
check('3 titles out of stock, as in the source', soldOut.length === 3, soldOut.join('; '));
check('low-stock alert threshold set on every book', products.every((p) => typeof p.lowStockThreshold === 'number'), `threshold ${[...new Set(products.map((p) => p.lowStockThreshold))].join(',')}`);

// 6) Duplicates and stray data
console.log('\n6. Duplicates and stray data');
const dupe = async (coll, field) => (await db.collection(coll).aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray()).length;
check('no duplicate books (by slug)', (await dupe('products', 'slug')) === 0);
check('no duplicate books (by title)', (await dupe('products', 'title')) === 0);
check('no duplicate coupons (by code)', (await dupe('coupons', 'code')) === 0);
check('no duplicate users (by email)', (await dupe('users', 'email')) === 0);
const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
const counts = {};
for (const c of collections) counts[c] = await db.collection(c).countDocuments();
check('no orders, reviews, sessions or webhook events yet', ['orders', 'reviews', 'refreshtokens', 'webhookevents'].every((c) => !counts[c]), JSON.stringify(counts));
check('no connectivity-probe leftovers', !collections.includes('_shelfify_probe'));

await mongoose.disconnect();
const ok = results.every(Boolean);
console.log(`\nRESULT: ${ok ? 'OK' : 'PROBLEMS FOUND'} - ${results.filter(Boolean).length}/${results.length} checks passed.`);
process.exit(ok ? 0 : 1);
