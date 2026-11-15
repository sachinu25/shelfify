import { LRUCache } from 'lru-cache';
import { isRedisConfigured, readyRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';

/**
 * Read-through cache.
 *  - Redis (shared by every serverless instance) when configured and reachable.
 *  - In-process LRU otherwise. Without a shared Redis, other instances cannot see
 *    invalidations, so memory TTLs are capped to keep admin edits (price, stock,
 *    visibility) from lingering on warm instances (audit H4).
 *
 * Invalidation uses namespace versioning: bumping a namespace version makes all
 * keys under it unreachable without SCAN/DEL.
 */
const memory = new LRUCache({ max: 1000, ttl: 60_000, ttlAutopurge: false });
const PREFIX = 'shelfify:';
export const MEMORY_TTL_CAP_SECONDS = 30;

async function getVersion(ns, redis) {
  const key = `${PREFIX}ver:${ns}`;
  if (redis) {
    try {
      return (await redis.get(key)) || '0';
    } catch {
      /* fall through to memory */
    }
  }
  return memory.get(key) || '0';
}

export async function bumpNamespace(ns) {
  const key = `${PREFIX}ver:${ns}`;
  const next = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  memory.set(key, next, { ttl: 0 });
  const redis = await readyRedis();
  if (redis) {
    try {
      await redis.set(key, next);
    } catch (err) {
      logger.warn({ err: err.message, ns }, 'cache invalidation could not reach Redis');
    }
  } else if (isRedisConfigured()) {
    logger.warn({ ns }, 'cache invalidation skipped Redis (unavailable)');
  }
}

/**
 * @template T
 * @param {string} ns namespace (e.g. "products")
 * @param {string} key unique key within the namespace
 * @param {number} ttlSeconds TTL when served from Redis
 * @param {() => Promise<T>} loader
 * @returns {Promise<T>}
 */
export async function cached(ns, key, ttlSeconds, loader) {
  const redis = await readyRedis();
  const version = await getVersion(ns, redis);
  const fullKey = `${PREFIX}${ns}:${version}:${key}`;

  if (redis) {
    try {
      const hit = await redis.get(fullKey);
      if (hit) return JSON.parse(hit);
    } catch (err) {
      logger.debug({ err: err.message }, 'redis get failed');
    }
  } else {
    const hit = memory.get(fullKey);
    if (hit !== undefined) return hit;
  }

  const value = await loader();

  if (redis) {
    try {
      await redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      logger.debug({ err: err.message }, 'redis set failed');
    }
  } else {
    memory.set(fullKey, value, { ttl: Math.min(ttlSeconds, MEMORY_TTL_CAP_SECONDS) * 1000 });
  }
  return value;
}

export function clearMemoryCache() {
  memory.clear();
}
