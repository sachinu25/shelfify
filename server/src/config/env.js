import 'dotenv/config';
import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 *
 * Fail-closed (audit C2): "production semantics" apply when NODE_ENV=production OR
 * when running on Vercel (VERCEL is set by the platform), so a missing NODE_ENV can
 * never downgrade security. In production the process refuses to boot without a
 * strong JWT secret, a database URI and an https CLIENT_URL. There is no public
 * default secret anywhere: local development without a secret gets a random
 * per-process secret instead.
 */
const onVercel = Boolean(process.env.VERCEL);
const declaredEnv = process.env.NODE_ENV || 'development';
const isProd = declaredEnv === 'production' || onVercel;
const isTest = declaredEnv === 'test' && !onVercel;

// Values that must never be accepted as a production secret.
const WEAK_SECRETS = new Set([
  'dev-only-access-secret-change-me-please',
  'test-access-secret-that-is-long-enough-123',
  'changeme',
  'change-me',
  'secret',
  'your_jwt_secret_key',
]);

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const strongSecret = z
  .string({ error: 'JWT_ACCESS_SECRET is required' })
  .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
  .refine((v) => !WEAK_SECRETS.has(v) && !/change.?me|example|placeholder/i.test(v), 'JWT_ACCESS_SECRET is a known placeholder - generate a random secret');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  MONGODB_URI: isProd ? z.string({ error: 'MONGODB_URI is required' }).min(1, 'MONGODB_URI is required') : optionalString,

  JWT_ACCESS_SECRET: isProd ? strongSecret : optionalString,
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Window in which a just-rotated refresh token may be presented again by a
  // concurrent tab of the same browser without being treated as token theft.
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(30),

  // Comma separated list of allowed browser origins (CORS)
  CLIENT_URL: isProd
    ? z.string({ error: 'CLIENT_URL is required' }).refine((v) => v.split(',').every((o) => /^https:\/\/[^\s/]+/i.test(o.trim())), 'CLIENT_URL must be https:// in production')
    : z.string().default('http://localhost:5173'),
  CORS_ORIGINS: optionalString,

  REDIS_URL: optionalString,

  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: z.string().default('Shelfify <no-reply@shelfify.app>'),

  CRON_SECRET: optionalString,
  // 'lax' when the SPA reaches the API through a same-origin rewrite (default deployment);
  // 'none' only if the SPA and API live on different sites.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  // Business rules (configurable, not hardcoded in clients)
  FREE_SHIPPING_THRESHOLD: z.coerce.number().nonnegative().default(499),
  SHIPPING_FEE: z.coerce.number().nonnegative().default(50),
  ORDER_RESERVATION_MINUTES: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse(process.env);
const problems = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

if (parsed.success) {
  const d = parsed.data;
  if (Boolean(d.RAZORPAY_KEY_ID) !== Boolean(d.RAZORPAY_KEY_SECRET)) {
    problems.push('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together');
  }
  if (isProd && d.RAZORPAY_KEY_ID?.startsWith('rzp_test_') === false && !d.RAZORPAY_KEY_ID.startsWith('rzp_live_')) {
    problems.push('RAZORPAY_KEY_ID does not look like a Razorpay key');
  }
}

if (problems.length) {
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  throw new Error('Invalid environment configuration');
}

const raw = parsed.data;
const warnings = [];

let jwtSecret = raw.JWT_ACCESS_SECRET;
if (!jwtSecret) {
  // Development/test only (production is enforced above). Sessions reset on restart.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  if (!isTest) warnings.push('JWT_ACCESS_SECRET not set - using a random per-process secret (sessions reset on restart)');
}
if (isProd) {
  if (raw.RAZORPAY_KEY_ID && !raw.RAZORPAY_WEBHOOK_SECRET) warnings.push('RAZORPAY_WEBHOOK_SECRET not set - payment webhooks are disabled');
  if (!raw.CRON_SECRET) warnings.push('CRON_SECRET not set - scheduled maintenance endpoint will reject all calls');
  if (!raw.REDIS_URL) warnings.push('REDIS_URL not set - rate limits and cache are per-instance only');
  if (onVercel && process.env.NODEJS_HELPERS !== '0') warnings.push('NODEJS_HELPERS is not "0" - set it so webhook signatures are verified against the untouched raw body');
}

export const env = Object.freeze({
  ...raw,
  NODE_ENV: isProd ? 'production' : raw.NODE_ENV,
  JWT_ACCESS_SECRET: jwtSecret,
  isProd,
  isTest,
  onVercel,
  warnings,
  corsOrigins: (raw.CORS_ORIGINS || raw.CLIENT_URL)
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  clientUrl: raw.CLIENT_URL.split(',')[0].trim().replace(/\/$/, ''),
  paymentsEnabled: Boolean(raw.RAZORPAY_KEY_ID && raw.RAZORPAY_KEY_SECRET),
  emailEnabled: Boolean(raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASS),
});
