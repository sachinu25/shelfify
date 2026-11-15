import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

let supported = null; // null = unknown, then true/false after the first attempt

const unsupported = (err) =>
  err?.code === 20 || /Transaction numbers are only allowed|transactions are not supported|replica set/i.test(String(err?.message));

/**
 * Runs `fn(session)` inside a MongoDB transaction (audit M1).
 *
 * MongoDB Atlas is always a replica set, so production gets real all-or-nothing
 * transactions; the driver retries transient write conflicts automatically, which
 * also serialises concurrent checkouts touching the same stock/coupon documents.
 * On a standalone server (some local setups) `fn(null)` runs without a
 * transaction and callers keep their compensating logic as a safety net.
 *
 * `fn` may run more than once (transient-error retries), so it must not perform
 * external side effects (payments, emails) - do those after it resolves.
 */
export async function withTransaction(fn) {
  if (supported === false) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    supported = true;
    return result;
  } catch (err) {
    if (supported !== true && unsupported(err)) {
      supported = false;
      logger.warn('MongoDB transactions unavailable (standalone server) - using compensating writes');
      return fn(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

export const transactionsSupported = () => supported;

/** Test hook. */
export function __resetTransactionSupport() {
  supported = null;
}
