import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../config/redis.js';
import { env } from '../config/env.js';

function store(prefix) {
  const redis = getRedis();
  if (!redis) return undefined; // in-memory store
  return new RedisStore({
    prefix: `shelfify:rl:${prefix}:`,
    sendCommand: (...args) => redis.call(...args),
  });
}

const base = (prefix, windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit: env.isTest ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store(prefix),
    passOnStoreError: true,
    message: { success: false, error: { code: 'RATE_LIMITED', message } },
  });

export const apiLimiter = base('api', 60 * 1000, 300, 'Too many requests, please slow down.');
export const authLimiter = base('auth', 15 * 60 * 1000, 20, 'Too many authentication attempts. Try again in a few minutes.');
export const paymentLimiter = base('pay', 10 * 60 * 1000, 30, 'Too many payment attempts. Please try again shortly.');
