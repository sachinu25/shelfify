/**
 * Local development with persistent data.
 *
 *  - If MONGODB_URI is set (e.g. MongoDB Atlas in server/.env) it is used as-is.
 *  - Otherwise a local MongoDB is started with its data stored in server/.data/db,
 *    so accounts, carts and orders survive restarts (unlike `npm run dev:memory`).
 *
 * The catalog/coupons/admin are seeded idempotently, then the API runs with
 * `node --watch` so it restarts on code changes while the database stays up.
 */
import 'dotenv/config';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(root, 'node_modules/.cache/mongodb-memory-server');

process.env.LOG_PRETTY ||= 'true';

let localMongo = null;
const redact = (uri) => uri.replace(/\/\/([^:/]+):[^@]+@/, '//$1:****@');

if (process.env.MONGODB_URI) {
  console.log(`[db] Using MONGODB_URI from environment: ${redact(process.env.MONGODB_URI)}`);
} else {
  const dbPath = path.join(root, '.data', 'db');
  const port = Number(process.env.LOCAL_MONGO_PORT || 27018);
  const uri = `mongodb://127.0.0.1:${port}/shelfify`;

  // Reuse a local MongoDB that is still running (e.g. left behind by a closed terminal).
  const alreadyRunning = await new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => resolve(socket.end() && true));
    socket.once('error', () => resolve(false));
  });

  if (alreadyRunning) {
    console.log(`[db] Reusing local MongoDB already running at ${uri}`);
  } else {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mkdirSync(dbPath, { recursive: true });
    localMongo = await MongoMemoryServer.create({
      instance: { dbPath, port, storageEngine: 'wiredTiger', dbName: 'shelfify' },
    });
    console.log(`[db] Local MongoDB (persistent) at ${uri}  data: ${dbPath}`);
  }
  process.env.MONGODB_URI = uri;
}

const { seed } = await import('./seed.js');
const { disconnectDB } = await import('../src/config/db.js');
await seed({ log: (m) => console.log(`[seed] ${m}`) });
await disconnectDB();

const api = spawn(process.execPath, ['--watch-path=src', 'src/server.js'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  api.kill('SIGINT');
  // doCleanup:false keeps the data directory intact.
  if (localMongo) await localMongo.stop({ doCleanup: false, force: false }).catch(() => {});
  process.exit(0);
};
api.on('exit', (code) => {
  if (!stopping) {
    console.log(`[api] exited with code ${code}`);
    shutdown();
  }
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
