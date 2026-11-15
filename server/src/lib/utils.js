import crypto from 'node:crypto';
import mongoose from 'mongoose';

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

export const isObjectId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v);

/** Constant-time comparison of two hex/utf8 strings. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Money is handled in whole rupees (INR) and rounded to 2dp to avoid float drift. */
export const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const toPaise = (rupees) => Math.round(roundMoney(rupees) * 100);

export function paginationMeta(page, limit, total) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 };
}

export function startOfDayUTC(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
