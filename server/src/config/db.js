import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

/**
 * Connection is cached on globalThis so that serverless invocations that reuse
 * a warm container do not open a new connection pool per request.
 */
const cache = globalThis.__shelfifyMongo || (globalThis.__shelfifyMongo = { conn: null, promise: null });

export async function connectDB(uri = env.MONGODB_URI) {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;
  if (!uri) {
    throw new Error('MONGODB_URI is not configured. Set it in server/.env or run `npm run dev:memory`.');
  }
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, {
        maxPoolSize: env.isProd ? 10 : 5,
        serverSelectionTimeoutMS: 10_000,
        // Index builds belong to deploy-time seeding (npm run seed), not every cold start.
        autoIndex: !env.isProd,
      })
      .then((m) => {
        logger.info({ host: m.connection.host, db: m.connection.name }, 'MongoDB connected');
        return m;
      })
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

export async function disconnectDB() {
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}
