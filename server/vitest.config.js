import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-123',
      RAZORPAY_KEY_ID: 'rzp_test_dummy',
      RAZORPAY_KEY_SECRET: 'test_key_secret',
      RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret',
      CLIENT_URL: 'http://localhost:5173',
      CRON_SECRET: 'test-cron-secret',
      // Use the binary cached by this package's install, regardless of where npm was invoked from.
      MONGOMS_DOWNLOAD_DIR: process.env.MONGOMS_DOWNLOAD_DIR || path.join(here, 'node_modules/.cache/mongodb-memory-server'),
    },
  },
});
