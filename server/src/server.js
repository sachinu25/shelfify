import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import { releaseExpiredReservations } from './modules/orders/order.service.js';

export async function start({ port = env.PORT } = {}) {
  await connectDB();
  const app = createApp();
  const server = app.listen(port, () => logger.info({ port, env: env.NODE_ENV }, `Shelfify API listening on http://localhost:${port}`));

  // Long-running process: sweep expired stock reservations every minute.
  const sweeper = setInterval(() => {
    releaseExpiredReservations().catch((err) => logger.warn({ err: err.message }, 'reservation sweep failed'));
  }, 60_000);
  sweeper.unref();

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(sweeper);
    server.close(async () => {
      await disconnectDB().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
  return server;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  start().catch((err) => {
    logger.fatal({ err: err.message }, 'failed to start');
    process.exit(1);
  });
}
