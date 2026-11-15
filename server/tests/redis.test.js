/**
 * Regression tests for audit fixes C1 (Redis startup crash) and H4 (shared,
 * Redis-backed rate limiting and caching across serverless instances).
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import { rateLimit } from 'express-rate-limit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startStack } from './helpers.js';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

let stack;
beforeAll(async () => {
  stack = await startStack({ replSet: false });
});
afterAll(() => stack?.stop());

const readyMock = () => Object.assign(new RedisMock(), { status: 'ready' });

describe('C1: an unreachable Redis cannot crash or stall the API', () => {
  it('boots, serves requests and never raises unhandled errors', async () => {
    const { stdout } = await run(process.execPath, [path.join(here, 'fixtures/boot-with-redis.mjs')], {
      cwd: os.tmpdir(), // keep server/.env out of this run
      env: { ...process.env, NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6390', MONGODB_URI: stack.uri, LOG_LEVEL: 'silent' },
      timeout: 60_000,
    });
    const report = JSON.parse(stdout.trim().split('\n').pop());
    expect(report.crashed).toBeNull();
    expect(report.first.status).toBe(200);
    expect(report.second.status).toBe(200);
    expect(report.health.status).toBe(200);
    expect(report.first.ms).toBeLessThan(5_000); // bounded wait on a cold start
    expect(report.second.ms).toBeLessThan(500); // circuit breaker: no further waiting
  });
});

describe('H4: shared state through Redis', () => {
  let redis;
  afterEach(async () => {
    const { __setRedisClientForTests } = await import('../src/config/redis.js');
    __setRedisClientForTests(null);
  });

  it('rate limits are enforced across instances (two apps, one Redis)', async () => {
    const { __setRedisClientForTests } = await import('../src/config/redis.js');
    redis = readyMock();
    await redis.flushall();
    __setRedisClientForTests(redis);
    const { ResilientRedisStore } = await import('../src/middleware/rateLimit.js');
    const makeInstance = () =>
      express()
        .use(rateLimit({ windowMs: 60_000, limit: 4, store: new ResilientRedisStore('shared-test'), standardHeaders: 'draft-7', legacyHeaders: false }))
        .get('/', (_req, res) => res.send('ok'));
    const a = makeInstance();
    const b = makeInstance();
    const statuses = [];
    for (const app of [a, b, a, b, a]) statuses.push((await request(app).get('/')).status);
    expect(statuses).toEqual([200, 200, 200, 200, 429]); // the 5th hit is limited even though it reached instance A
  });

  it('falls back to per-instance limiting if Redis fails mid-request', async () => {
    const { __setRedisClientForTests } = await import('../src/config/redis.js');
    const broken = {
      status: 'ready',
      multi() {
        const chain = { set: () => chain, incr: () => chain, pttl: () => chain, exec: async () => Promise.reject(new Error('ECONNRESET')) };
        return chain;
      },
      decr: async () => Promise.reject(new Error('ECONNRESET')),
      del: async () => Promise.reject(new Error('ECONNRESET')),
    };
    __setRedisClientForTests(broken);
    const { ResilientRedisStore } = await import('../src/middleware/rateLimit.js');
    const app = express()
      .use(rateLimit({ windowMs: 60_000, limit: 2, store: new ResilientRedisStore('fallback-test') }))
      .get('/', (_req, res) => res.send('ok'));
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await request(app).get('/')).status);
    expect(statuses).toEqual([200, 200, 429]); // still limited, no 500s
  });

  it('cache invalidation from one instance is visible to the others', async () => {
    const { __setRedisClientForTests } = await import('../src/config/redis.js');
    const { cached, bumpNamespace, clearMemoryCache } = await import('../src/lib/cache.js');
    redis = readyMock();
    await redis.flushall();
    __setRedisClientForTests(redis);
    let loads = 0;
    const loader = async () => ({ price: 100 + loads++ });
    expect(await cached('products', 'k', 300, loader)).toEqual({ price: 100 });
    clearMemoryCache(); // "another instance": no local state at all
    expect(await cached('products', 'k', 300, loader)).toEqual({ price: 100 }); // served from Redis
    await bumpNamespace('products'); // e.g. an admin edits a price on instance A
    clearMemoryCache();
    expect(await cached('products', 'k', 300, loader)).toEqual({ price: 101 }); // instance B sees fresh data
    expect(loads).toBe(2);
  });

  it('without Redis, memory cache entries expire within the 30s cap', async () => {
    const { MEMORY_TTL_CAP_SECONDS } = await import('../src/lib/cache.js');
    expect(MEMORY_TTL_CAP_SECONDS).toBeLessThanOrEqual(30);
  });

  it('the public API works end to end with Redis enabled', async () => {
    const { __setRedisClientForTests } = await import('../src/config/redis.js');
    redis = readyMock();
    await redis.flushall();
    __setRedisClientForTests(redis);
    await stack.models.Product.create({ title: 'Cached Book', slug: 'cached-book', author: 'A', genre: 'tech', price: 300, mrp: 300, stock: 2 });
    const first = await request(stack.app).get('/api/v1/products?q=cached');
    const second = await request(stack.app).get('/api/v1/products?q=cached');
    expect(first.status).toBe(200);
    expect(second.body.data[0].title).toBe('Cached Book');
    expect((await redis.keys('shelfify:products:*')).length).toBeGreaterThan(0);
    expect((await redis.keys('shelfify:rl:api:*')).length).toBeGreaterThan(0); // global limiter used Redis
  });
});
