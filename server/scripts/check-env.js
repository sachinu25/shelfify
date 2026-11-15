/**
 * Validates the production configuration exactly as the deployed API will, and
 * prints a masked status table. Values are never printed.
 *
 *   npm run prod:env
 */
import 'dotenv/config';

const mask = (key) => {
  const v = process.env[key];
  if (!v || !v.trim()) return 'EMPTY';
  if (/URI|URL/.test(key) && !/SECRET|PASS|TOKEN/.test(key)) {
    // Show the scheme and host only (never credentials, path or query).
    try {
      const u = new URL(v);
      return `SET (${u.protocol}//${u.hostname}${u.username ? ', with credentials' : ''})`;
    } catch {
      return 'SET (unparseable URL)';
    }
  }
  if (/SECRET|PASS|TOKEN/.test(key)) return `SET (${v.length} chars)`;
  if (key === 'RAZORPAY_KEY_ID') return `SET (${v.startsWith('rzp_live_') ? 'LIVE' : v.startsWith('rzp_test_') ? 'test' : 'unknown'} mode)`;
  if (key === 'SEED_ADMIN_EMAIL') return 'SET';
  return `SET (${v})`;
};

const groups = {
  'Required by the API': ['NODE_ENV', 'MONGODB_URI', 'JWT_ACCESS_SECRET', 'CLIENT_URL'],
  'Strongly recommended': ['REDIS_URL', 'CRON_SECRET', 'NODEJS_HELPERS'],
  'Payments (later)': ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  'Email (optional)': ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'],
  'Seed only (never set in Vercel)': ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD'],
};
for (const [title, keys] of Object.entries(groups)) {
  console.log(`\n${title}`);
  for (const k of keys) console.log(`  ${k.padEnd(26)} ${mask(k)}`);
}

console.log('\nValidation (same rules as the deployed API):');
try {
  const { env } = await import('../src/config/env.js');
  console.log(`  OK - production mode: ${env.isProd}`);
  env.warnings.forEach((w) => console.log(`  warning: ${w}`));
} catch {
  console.log('  FAILED - see the messages above; fix the listed values and run again.');
  process.exitCode = 1;
}
