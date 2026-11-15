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
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Product } from '../src/models/Product.js';
import { Coupon } from '../src/models/Coupon.js';
import { User } from '../src/models/User.js';

export async function seed({ uri, log = console.log } = {}) {
  await connectDB(uri);

  const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
  let inserted = 0;
  for (const book of catalog) {
    const slug = slugify(book.title, { lower: true, strict: true });
    const res = await Product.updateOne({ slug }, { $setOnInsert: { ...book, slug } }, { upsert: true });
    if (res.upsertedCount) inserted += 1;
  }
  log(`Catalog: ${inserted} inserted, ${catalog.length - inserted} already present`);

  const coupons = [
    { code: 'BOOKS200', description: '₹200 off on orders above ₹999', type: 'flat', value: 200, minOrderValue: 999, perUserLimit: 3 },
    { code: 'WELCOME10', description: '10% off your first order (up to ₹150)', type: 'percent', value: 10, maxDiscount: 150, minOrderValue: 299, perUserLimit: 1 },
  ];
  for (const c of coupons) await Coupon.updateOne({ code: c.code }, { $setOnInsert: c }, { upsert: true });
  log(`Coupons ensured: ${coupons.map((c) => c.code).join(', ')}`);

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters');
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
  seed()
    .then(() => disconnectDB())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await disconnectDB().catch(() => {});
      process.exit(1);
    });
}
