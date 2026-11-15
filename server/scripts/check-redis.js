/**
 * Verifies the production Redis (REDIS_URL) the way the deployed API uses it:
 *   - TLS connectivity, latency and cold-start readiness through the app's own client
 *   - rate limiting shared by two independent connections (= two serverless instances)
 *   - cache invalidation from one connection visible to the other
 * Uses uniquely named probe keys and deletes them afterwards. Never prints secrets.
 *
 *   npm run prod:redis      (via scripts/prod.js -> server/.env.production.local only)
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const url = process.env.REDIS_URL;
if (!url) {
  console.error('REDIS_URL is not set - run "npm run prod:set-redis" first.');
  process.exit(1);
}
const mock = Boolean(process.env.SHELFIFY_REDIS_MOCK); // only for testing this script without a server
const u = new URL(url);
console.log(`Redis endpoint ${u.hostname}:${u.port || 6379} (${u.protocol === 'rediss:' ? 'TLS' : 'NO TLS'})${mock ? '  [MOCK MODE]' : ''}\n`);

const row = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  row(name, `${ok ? 'OK  ' : 'FAIL'} ${detail}`);
};

const { default: Redis } = await import('ioredis');
const RedisMock = mock ? (await import('ioredis-mock')).default : null;
const redisConfig = await import('../src/config/redis.js');
const { ResilientRedisStore } = await import('../src/middleware/rateLimit.js');
const { cached, bumpNamespace, clearMemoryCache } = await import('../src/lib/cache.js');

const id = `probe-${crypto.randomBytes(4).toString('hex')}`;
let clientA;
let clientB;

try {
  // 1) The app's own client (lazy connect + bounded readiness, as on a cold start)
  console.log('Connectivity');
  let t = Date.now();
  if (mock) {
    redisConfig.__setRedisClientForTests(Object.assign(new RedisMock(), { status: 'ready' }));
  }
  clientA = await redisConfig.readyRedis(10_000);
  check('app client ready (cold start)', Boolean(clientA), clientA ? `${Date.now() - t} ms` : '- see hints below');
  if (!clientA) throw new Error('not ready');
  check('TLS', mock || u.protocol === 'rediss:', u.protocol === 'rediss:' ? 'rediss://' : 'plain redis:// - Upstash requires TLS');

  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    t = Date.now();
    await clientA.ping();
    samples.push(Date.now() - t);
  }
  check('PING round trip', true, `avg ${Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)} ms (min ${Math.min(...samples)})`);
  const version = mock ? 'mock' : (await clientA.info('server').catch(() => '')).match(/redis_version:(\S+)/)?.[1];
  row('server', version ? `Redis-compatible ${version}` : 'version not reported');

  // 2) A second, completely independent connection = another serverless instance
  clientB = mock
    ? Object.assign(new RedisMock(), { status: 'ready' })
    : new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 10_000, commandTimeout: 3_000 });
  if (!mock) {
    clientB.on('error', () => {});
    await clientB.connect();
  }
  check('second independent connection', (await clientB.ping()) === 'PONG');

  // 3) Distributed rate limiting: two stores, each with its OWN in-memory fallback.
  //    If Redis were not really used, store B would start counting at 1.
  console.log('\nRate limiting across instances');
  const storeA = new ResilientRedisStore(id);
  const storeB = new ResilientRedisStore(id);
  storeA.init({ windowMs: 60_000 });
  storeB.init({ windowMs: 60_000 });
  const hits = [];
  for (const [client, store] of [[clientA, storeA], [clientA, storeA], [clientB, storeB], [clientA, storeA], [clientB, storeB]]) {
    redisConfig.__setRedisClientForTests(client);
    hits.push((await store.increment('client-1')).totalHits);
  }
  check('shared counter A,A,B,A,B', hits.join(',') === '1,2,3,4,5', `counts ${hits.join(',')}`);
  check('5th request blocked (limit 4)', hits[4] > 4, `${hits[4]} > 4`);
  const ttl = await clientB.pttl(`shelfify:rl:${id}:client-1`);
  check('window expiry set', ttl > 0 && ttl <= 60_000, `${Math.round(ttl / 1000)} s remaining`);

  // 4) Shared cache + invalidation
  console.log('\nShared cache and invalidation');
  let loads = 0;
  const loader = async () => ({ price: 100 + loads++ });
  redisConfig.__setRedisClientForTests(clientA);
  const first = await cached(id, 'book', 60, loader);
  clearMemoryCache();
  redisConfig.__setRedisClientForTests(clientB);
  const fromOther = await cached(id, 'book', 60, loader);
  check('instance B reads A\'s cache entry', fromOther.price === first.price && loads === 1, `price ${fromOther.price}, loader calls ${loads}`);
  await bumpNamespace(id); // e.g. an admin edits a price on instance B
  clearMemoryCache();
  redisConfig.__setRedisClientForTests(clientA);
  const afterBump = await cached(id, 'book', 60, loader);
  check('invalidation from B seen by A', afterBump.price === 101 && loads === 2, `price ${afterBump.price}, loader calls ${loads}`);
} catch (err) {
  if (err.message !== 'not ready') check('unexpected error', false, String(err.message).replace(/\/\/[^@\s]+@/g, '//****@'));
  else {
    console.log('\n  Hints: check REDIS_URL with "npm run prod:set-redis" (it tests before saving); Upstash requires rediss:// (TLS);');
    console.log('         make sure the database is active in the Upstash console.');
  }
} finally {
  // 5) Cleanup: remove every probe key
  console.log('\nCleanup');
  const c = clientB || clientA;
  if (c) {
    let removed = 0;
    for (const pattern of [`shelfify:*${id}*`]) {
      let cursor = '0';
      do {
        const [next, keys] = await c.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) removed += await c.del(...keys);
      } while (cursor !== '0');
    }
    const leftover = (await c.scan('0', 'MATCH', `shelfify:*${id}*`, 'COUNT', 500))[1].length;
    check('probe keys removed', leftover === 0, `${removed} removed, ${leftover} left`);
  }
  redisConfig.__setRedisClientForTests(null);
  if (clientA && !mock) clientA.disconnect();
  if (clientB && !mock) clientB.disconnect();
  const ok = results.length > 0 && results.every(Boolean);
  console.log(ok ? '\nRESULT: OK - Redis is shared correctly across instances.' : '\nRESULT: problems found (see above).');
  process.exit(ok ? 0 : 1);
}
