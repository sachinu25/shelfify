import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 * The process refuses to boot with an invalid production config instead of
 * failing later at request time.
 */
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  MONGODB_URI: isProd ? z.string().min(1, 'MONGODB_URI is required') : optionalString,

  JWT_ACCESS_SECRET: isProd
    ? z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
    : z.string().min(16).default('dev-only-access-secret-change-me-please'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Comma separated list of allowed browser origins (CORS)
  CLIENT_URL: z.string().default('http://localhost:5173'),
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

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  throw new Error('Invalid environment configuration');
}

const raw = parsed.data;

export const env = Object.freeze({
  ...raw,
  isProd,
  isTest,
  corsOrigins: (raw.CORS_ORIGINS || raw.CLIENT_URL)
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  clientUrl: raw.CLIENT_URL.split(',')[0].trim().replace(/\/$/, ''),
  paymentsEnabled: Boolean(raw.RAZORPAY_KEY_ID && raw.RAZORPAY_KEY_SECRET),
  emailEnabled: Boolean(raw.SMTP_HOST && raw.SMTP_USER && raw.SMTP_PASS),
});
