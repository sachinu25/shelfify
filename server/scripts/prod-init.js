/**
 * Creates server/.env.production.local with freshly generated secrets and
 * placeholders for the values you obtain from Atlas, Upstash, Razorpay and SMTP.
 * Existing values are never overwritten; secrets are never printed.
 *
 *   npm run prod:init
 */
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, '.env.production.local');
const secret = () => crypto.randomBytes(48).toString('hex');

const TEMPLATE = `# =============================================================================
# Shelfify PRODUCTION configuration - LOCAL COPY. NEVER COMMIT OR SHARE.
# Git-ignored and excluded from Vercel uploads. Used only by "npm run prod:*".
# The same values are entered in Vercel -> Project Settings -> Environment Variables.
# =============================================================================
NODE_ENV=production

# --- Phase 1: MongoDB Atlas ----------------------------------------------------
# Atlas -> Connect -> Drivers. Insert the database name before "?":
#   mongodb+srv://shelfify_app:<password>@<cluster>.mongodb.net/shelfify?retryWrites=true&w=majority
MONGODB_URI=

# --- Phase 2: Upstash Redis (rediss:// TCP URL) ----------------------------------
REDIS_URL=

# --- Phase 3: Vercel -------------------------------------------------------------
# Your production URL, e.g. https://shelfify.vercel.app (must be https)
CLIENT_URL=
NODEJS_HELPERS=0

# --- Generated secrets (do not edit unless rotating) ----------------------------
JWT_ACCESS_SECRET=__GEN_JWT__
CRON_SECRET=__GEN_CRON__

# --- Later: payments (Razorpay test keys first) ----------------------------------
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# --- Later: email (optional) -------------------------------------------------------
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=Shelfify <no-reply@yourdomain.com>

# --- Production seed only (first admin account) ---------------------------------
SEED_ADMIN_NAME=Store Admin
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
`;

if (existsSync(file)) {
  // Fill in only secrets that are still missing; never overwrite anything.
  let text = readFileSync(file, 'utf8');
  let filled = 0;
  for (const key of ['JWT_ACCESS_SECRET', 'CRON_SECRET']) {
    const re = new RegExp(`^${key}=\\s*$`, 'm');
    if (re.test(text)) {
      text = text.replace(re, `${key}=${secret()}`);
      filled += 1;
    }
  }
  if (filled) writeFileSync(file, text, { mode: 0o600 });
  console.log(`server/.env.production.local already exists - left as is${filled ? ` (generated ${filled} missing secret(s))` : ''}.`);
} else {
  writeFileSync(file, TEMPLATE.replace('__GEN_JWT__', secret()).replace('__GEN_CRON__', secret()), { mode: 0o600 });
  console.log('Created server/.env.production.local');
  console.log('  JWT_ACCESS_SECRET  generated (96 hex chars)');
  console.log('  CRON_SECRET        generated (96 hex chars)');
  console.log('Fill in the remaining values as each setup phase asks for them.');
}
