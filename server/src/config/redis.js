import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Shared Redis client (works with Upstash: use its `rediss://` TCP URL).
 *
 * Redis is an optimisation, never a hard dependency:
 *  - the client connects lazily and nothing is sent at import time, so a cold
 *    start can never crash on "stream isn't writeable" (audit C1);
 *  - callers obtain the client through `readyRedis()`, which waits a bounded
 *    time for the first connection and then trips a circuit breaker so that an
 *    unavailable Redis costs at most one short wait per cooldown window;
 *  - every caller falls back to in-process behaviour when it returns null.
 */
let client = null;
let injected = false;
let unavailableUntil = 0;
const COOLDOWN_MS = 30_000;

export function isRedisConfigured() {
  return Boolean(env.REDIS_URL) || injected;
}

export function getRedis() {
  if (client) return client;
  if (!env.REDIS_URL) return null;

  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: true, // queue (bounded by commandTimeout) instead of throwing while connecting
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 1_500,
    retryStrategy: (times) => Math.min(times * 250, 3_000),
  });
  // An 'error' listener is mandatory: without it ioredis errors are thrown as uncaught events.
  client.on('error', (err) => {
    if (Date.now() >= unavailableUntil) logger.warn({ err: err.message }, 'Redis error - using in-memory fallback');
  });
  client.on('ready', () => {
    unavailableUntil = 0;
    logger.info('Redis connected');
  });
  client.connect().catch(() => {}); // failures surface via 'error' and readyRedis()
  return client;
}

/** Returns a ready client, or null when Redis is not configured or currently unavailable. */
export async function readyRedis(timeoutMs = 1_500) {
  const c = getRedis();
  if (!c) return null;
  if (c.status === 'ready') return c;
  if (c.status === 'end' || Date.now() < unavailableUntil) return null;

  const ready = await new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timer);
      c.off('ready', onReady);
      resolve(value);
    };
    const onReady = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    c.once('ready', onReady);
  });
  if (!ready) unavailableUntil = Date.now() + COOLDOWN_MS;
  return ready ? c : null;
}

export const redisHealthy = () => Boolean(client && client.status === 'ready');

/** Test hook: inject a client (e.g. ioredis-mock) or reset to the default behaviour. */
export function __setRedisClientForTests(mock) {
  client = mock || null;
  injected = Boolean(mock);
  unavailableUntil = 0;
}
