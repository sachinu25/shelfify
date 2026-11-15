import { rateLimit, MemoryStore } from 'express-rate-limit';
import { readyRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/**
 * express-rate-limit store backed by Redis (shared across serverless instances)
 * with a per-instance in-memory fallback. Unlike rate-limit-redis it sends
 * nothing at construction time, so it cannot crash a cold start (audit C1).
 *
 * The window is a fixed window per key: SET key 0 PX window NX + INCR + PTTL in
 * one MULTI, which works on Redis 6+ and Upstash.
 */
export class ResilientRedisStore {
  constructor(prefix) {
    this.prefix = `shelfify:rl:${prefix}:`;
    this.memory = new MemoryStore();
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async increment(key) {
    const redis = await readyRedis();
    if (redis) {
      try {
        const k = this.prefix + key;
        const results = await redis.multi().set(k, '0', 'PX', this.windowMs, 'NX').incr(k).pttl(k).exec();
        const failed = results?.find(([err]) => err);
        if (failed) throw failed[0];
        const totalHits = Number(results[1][1]);
        let ttl = Number(results[2][1]);
        if (!(ttl > 0)) {
          await redis.pexpire(k, this.windowMs);
          ttl = this.windowMs;
        }
        return { totalHits, resetTime: new Date(Date.now() + ttl) };
      } catch (err) {
        logger.warn({ err: err.message }, 'rate limit store: Redis failed, using in-memory fallback');
      }
    }
    return this.memory.increment(key);
  }

  async decrement(key) {
    const redis = await readyRedis();
    if (redis) {
      try {
        await redis.decr(this.prefix + key);
        return;
      } catch {
        /* fall back */
      }
    }
    await this.memory.decrement(key);
  }

  async resetKey(key) {
    const redis = await readyRedis();
    if (redis) await redis.del(this.prefix + key).catch(() => {});
    await this.memory.resetKey(key);
  }
}

const limiter = (prefix, windowMs, limit, message, { enforceInTests = false, ...extra } = {}) =>
  rateLimit({
    windowMs,
    limit: env.isTest && !enforceInTests ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new ResilientRedisStore(prefix),
    passOnStoreError: true,
    message: { success: false, error: { code: 'RATE_LIMITED', message } },
    ...extra,
  });

export const apiLimiter = limiter('api', 60 * 1000, 300, 'Too many requests, please slow down.');
export const authLimiter = limiter('auth', 15 * 60 * 1000, 20, 'Too many authentication attempts. Try again in a few minutes.');
export const paymentLimiter = limiter('pay', 10 * 60 * 1000, 30, 'Too many payment attempts. Please try again shortly.');

/**
 * Per-account login throttle (in addition to the per-IP limiter): slows
 * credential stuffing against one account from many IPs.
 */
export const loginAccountLimiter = limiter('login-acct', 15 * 60 * 1000, 10, 'Too many sign-in attempts for this account. Try again in 15 minutes.', {
  keyGenerator: (req) => `acct:${String(req.body?.email || '').trim().toLowerCase().slice(0, 254)}`,
  skipSuccessfulRequests: true,
  enforceInTests: true,
});
