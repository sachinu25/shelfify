/**
 * Zero-setup local development: boots an in-memory MongoDB, seeds it and starts
 * the API. Data is discarded on exit. Use a real MONGODB_URI for persistence.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Use the binary cached by this package's install, regardless of where npm was invoked from.
process.env.MONGOMS_DOWNLOAD_DIR ||= path.join(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/mongodb-memory-server');
const { MongoMemoryReplSet } = await import('mongodb-memory-server');

// Single-node replica set: like MongoDB Atlas, so transactions behave exactly as in production.
const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', dbName: 'shelfify' } });
process.env.MONGODB_URI = mongo.getUri('shelfify');
console.log(`In-memory MongoDB running at ${process.env.MONGODB_URI}`);

const { seed } = await import('./seed.js');
await seed();

const { start } = await import('../src/server.js');
await start();

const stop = async () => {
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
