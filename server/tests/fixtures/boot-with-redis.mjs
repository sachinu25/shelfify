/**
 * Boots the real app in a fresh process with whatever REDIS_URL / MONGODB_URI the
 * parent passes, serves a few requests and reports. Used to prove that an
 * unreachable Redis can neither crash the process (audit C1) nor stall requests.
 */
let crashed = null;
process.on('unhandledRejection', (e) => {
  crashed = `unhandledRejection: ${e?.message}`;
});
process.on('uncaughtException', (e) => {
  crashed = `uncaughtException: ${e?.message}`;
});

const { connectDB, disconnectDB } = await import('../../src/config/db.js');
const { createApp } = await import('../../src/app.js');
await connectDB(process.env.MONGODB_URI);
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const timed = async (path) => {
  const t = Date.now();
  const res = await fetch(base + path);
  return { status: res.status, ms: Date.now() - t };
};

const first = await timed('/api/v1/products?limit=1'); // cold: waits (bounded) for Redis once
const second = await timed('/api/v1/products?limit=2'); // circuit open: no waiting
const health = await timed('/api/health');
await new Promise((r) => setTimeout(r, 1500)); // let any late rejection surface
console.log(JSON.stringify({ first, second, health, crashed }));
server.close();
await disconnectDB();
process.exit(0);
