import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

let client = null;
let healthy = false;

/**
 * Returns a shared ioredis client when REDIS_URL is configured, otherwise null.
 * Redis is an optimisation: every caller must degrade gracefully without it.
 */
export function getRedis() {
  if (!env.REDIS_URL) return null;
  if (client) return client;

  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    connectTimeout: 5_000,
  });
  client.on('ready', () => {
    healthy = true;
    logger.info('Redis connected');
  });
  client.on('error', (err) => {
    if (healthy) logger.warn({ err: err.message }, 'Redis error - falling back to in-memory cache');
    healthy = false;
  });
  client.on('end', () => {
    healthy = false;
  });
  return client;
}

export const redisHealthy = () => Boolean(client && healthy);
