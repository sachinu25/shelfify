/**
 * Idempotent seed: catalog, launch coupons and (optionally) the first admin.
 *
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='S3cure-pass' npm run seed
 *
 * Existing products are matched by slug and only missing ones are inserted, so
 * running the seed against production never overwrites live stock or prices.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import slugify from 'slugify';
import { loadedDiffersFromWritten } from './lib/envfile.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Product } from '../src/models/Product.js';
import { Coupon } from '../src/models/Coupon.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Review } from '../src/models/Review.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { WebhookEvent } from '../src/models/WebhookEvent.js';

const COUPONS = [
  { code: 'BOOKS200', description: '₹200 off on orders above ₹999', type: 'flat', value: 200, minOrderValue: 999, perUserLimit: 3 },
  { code: 'WELCOME10', description: '10% off your first order (up to ₹150)', type: 'percent', value: 10, maxDiscount: 150, minOrderValue: 299, perUserLimit: 1 },
];
const MODELS = () => [Product, Coupon, User, Order, Review, RefreshToken, WebhookEvent];

/** Read-only report of what seed() would do. Writes nothing (no indexes, no documents). */
export async function planSeed({ uri, log = console.log } = {}) {
  await connectDB(uri);
  const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
  const slugs = catalog.map((b) => slugify(b.title, { lower: true, strict: true }));
  const existingSlugs = new Set((await Product.find({ slug: { $in: slugs } }, 'slug').lean()).map((p) => p.slug));
  const existingCoupons = new Set((await Coupon.find({ code: { $in: COUPONS.map((c) => c.code) } }, 'code').lean()).map((c) => c.code));
  log('SEED PLAN (dry run - nothing will be written)');
  for (const model of MODELS()) {
    const declared = model.schema.indexes().length + 1; // + the _id index
    log(`  indexes   ${model.collection.collectionName.padEnd(14)} ensure ${declared} declared index(es) (additive, never drops)`);
  }
  log(`  catalog   would insert ${slugs.filter((s) => !existingSlugs.has(s)).length} book(s), ${existingSlugs.size} already present (existing books never modified)`);
  log(`  coupons   would insert ${COUPONS.filter((c) => !existingCoupons.has(c.code)).map((c) => c.code).join(', ') || 'none'}${existingCoupons.size ? ` (existing: ${[...existingCoupons].join(', ')})` : ''}`);
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  if (!email || !password) log('  admin     SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set - no admin would be created');
  else {
    const problem = adminPasswordProblem(password, { strict: true });
    const existing = await User.findOne({ email }, 'role').lean();
    log(`  admin     ${existing ? (existing.role === 'admin' ? 'already an admin - unchanged' : 'existing account would be promoted to admin') : 'would create a new admin account'}`);
    log(`  password  ${problem ? `REJECTED: ${problem}` : `OK (${password.length} chars)`}`);
    for (const key of ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD']) {
      const mismatch = process.env.DOTENV_CONFIG_PATH && loadedDiffersFromWritten(process.env.DOTENV_CONFIG_PATH, key, process.env[key]);
      if (mismatch) log(`  ${key.replace('SEED_ADMIN_', '').toLowerCase().padEnd(9)} REJECTED: ${mismatch}`);
    }
  }
}

/** Production admin passwords must be strong; local development keeps the old minimum. */
function adminPasswordProblem(password, { strict }) {
  if (password.length < (strict ? 14 : 10)) return `must be at least ${strict ? 14 : 10} characters`;
  if (strict && !(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password))) {
    return 'must mix upper and lower case letters, digits and a symbol';
  }
  if (Buffer.byteLength(password, 'utf8') > 72) return 'must be at most 72 bytes';
  return null;
}

export async function seed({ uri, log = console.log, strict = false } = {}) {
  await connectDB(uri);

  // Production connects with autoIndex disabled, so declared indexes are built here
  // (idempotent, additive only - existing indexes are never dropped).
  const models = MODELS();
  for (const model of models) await model.createIndexes();
  log(`Indexes ensured for ${models.length} collections`);

  const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
  let inserted = 0;
  for (const book of catalog) {
    const slug = slugify(book.title, { lower: true, strict: true });
    const res = await Product.updateOne({ slug }, { $setOnInsert: { ...book, slug } }, { upsert: true });
    if (res.upsertedCount) inserted += 1;
  }
  log(`Catalog: ${inserted} inserted, ${catalog.length - inserted} already present`);

  const coupons = COUPONS;
  for (const c of coupons) await Coupon.updateOne({ code: c.code }, { $setOnInsert: c }, { upsert: true });
  log(`Coupons ensured: ${coupons.map((c) => c.code).join(', ')}`);

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const problem = adminPasswordProblem(password, { strict });
    if (problem) throw new Error(`SEED_ADMIN_PASSWORD ${problem}`);
    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        existing.tokenVersion += 1;
        await existing.save();
        log(`Promoted ${email} to admin`);
      } else log(`Admin ${email} already exists`);
    } else {
      await User.create({ name: process.env.SEED_ADMIN_NAME || 'Store Admin', email, password, role: 'admin' });
      log(`Created admin ${email}`);
    }
  } else {
    log('No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD provided - skipping admin creation');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const plan = args.includes('--plan');
  const confirmed = args.includes('--confirm-production');
  const target = process.env.MONGODB_URI || '';
  const isLocal = /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target);
  const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) || (target && !isLocal);

  if (isProduction && !plan && !confirmed) {
    console.error('Refusing to seed a non-local/production database without explicit confirmation.');
    console.error('Review the plan first:   npm run prod:seed:plan');
    console.error('Then seed deliberately:  npm run prod:seed -- --confirm-production');
    process.exit(1);
  }

  if (isProduction && !plan && process.env.DOTENV_CONFIG_PATH) {
    for (const key of ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_ADMIN_NAME']) {
      const mismatch = loadedDiffersFromWritten(process.env.DOTENV_CONFIG_PATH, key, process.env[key]);
      if (mismatch) {
        console.error(`Refusing to seed: ${key} - ${mismatch}. Nothing was written.`);
        process.exit(1);
      }
    }
  }

  (plan ? planSeed() : seed({ strict: isProduction }))
    .then(() => disconnectDB())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await disconnectDB().catch(() => {});
      process.exit(1);
    });
}
