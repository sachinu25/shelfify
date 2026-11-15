import { LRUCache } from 'lru-cache';
import { getRedis, redisHealthy } from '../config/redis.js';
import { logger } from '../config/logger.js';

/**
 * Two-tier read-through cache.
 *  - Redis (shared across instances) when REDIS_URL is configured and healthy.
 *  - In-process LRU otherwise (still useful on warm serverless containers).
 *
 * Invalidation uses namespace versioning: bumping a namespace version makes all
 * keys under it unreachable without needing SCAN/DEL over Redis.
 */
const memory = new LRUCache({ max: 1000, ttl: 60_000, ttlAutopurge: false });
const PREFIX = 'shelfify:';

async function getVersion(ns) {
  const redis = getRedis();
  const key = `${PREFIX}ver:${ns}`;
  if (redis && redisHealthy()) {
    try {
      return (await redis.get(key)) || '0';
    } catch {
      /* fall through */
    }
  }
  return memory.get(key) || '0';
}

export async function bumpNamespace(ns) {
  const key = `${PREFIX}ver:${ns}`;
  const next = String(Date.now());
  memory.set(key, next, { ttl: 0 });
  const redis = getRedis();
  if (redis && redisHealthy()) {
    try {
      await redis.set(key, next);
    } catch (err) {
      logger.warn({ err: err.message }, 'cache bump failed');
    }
  }
}

/**
 * @template T
 * @param {string} ns namespace (e.g. "products")
 * @param {string} key unique key within the namespace
 * @param {number} ttlSeconds
 * @param {() => Promise<T>} loader
 * @returns {Promise<T>}
 */
export async function cached(ns, key, ttlSeconds, loader) {
  const version = await getVersion(ns);
  const fullKey = `${PREFIX}${ns}:${version}:${key}`;
  const redis = getRedis();

  if (redis && redisHealthy()) {
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

  if (redis && redisHealthy()) {
    redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {});
  } else {
    memory.set(fullKey, value, { ttl: ttlSeconds * 1000 });
  }
  return value;
}

export function clearMemoryCache() {
  memory.clear();
}
