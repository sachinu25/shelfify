/**
 * Validates SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from the production file before
 * seeding. Prints only pass/fail per rule - never the email's password or any secret.
 *
 *   npm run prod:admin-check      (via scripts/prod.js -> server/.env.production.local only)
 */
import 'dotenv/config';
import dns from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadedDiffersFromWritten } from './lib/envfile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const email = (process.env.SEED_ADMIN_EMAIL || '').trim();
const password = process.env.SEED_ADMIN_PASSWORD || '';
const name = (process.env.SEED_ADMIN_NAME || '').trim();

const results = [];
const rule = (label, ok, note = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${note ? `  (${note})` : ''}`);
};

console.log('\nAdmin account');
rule('SEED_ADMIN_EMAIL is set', Boolean(email));
rule('SEED_ADMIN_PASSWORD is set', Boolean(password));
if (!email || !password) {
  console.log('\nRESULT: add both values to server/.env.production.local, save, and run again.');
  process.exit(1);
}

const [localPart = '', domain = ''] = email.toLowerCase().split('@');
rule('email format is valid', /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email));
rule('email domain is not a placeholder/local domain', !/(^|\.)(example\.(com|org|net)|test|local|localhost|invalid)$/i.test(domain), domain ? `domain: ${domain}` : '');
let mx = false;
try {
  mx = (await dns.promises.resolveMx(domain)).length > 0;
} catch {
  mx = false;
}
rule('email domain can receive mail (MX records)', mx, 'needed for password-reset emails');

// Local development admin (compared in memory only)
let localEnv = {};
const localFile = path.join(root, '.env');
if (existsSync(localFile)) {
  localEnv = Object.fromEntries(
    readFileSync(localFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );
}
rule('email differs from the local development admin', email.toLowerCase() !== (localEnv.SEED_ADMIN_EMAIL || '').toLowerCase());
rule('display name', true, name ? `"${name}"` : 'not set - defaults to "Store Admin"');

// What dotenv loads must equal what is written (an unquoted "#" silently truncates).
const envFile = process.env.DOTENV_CONFIG_PATH || path.join(root, '.env.production.local');
for (const key of ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_ADMIN_NAME']) {
  const problem = loadedDiffersFromWritten(envFile, key, process.env[key]);
  rule(`${key} is loaded exactly as written in the file`, !problem, problem || '');
}

console.log('\nAdmin password (value never shown)');
rule('at least 14 characters', password.length >= 14, `${password.length} characters`);
rule('contains lower-case, upper-case, digit and symbol', /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password));
rule('at most 72 bytes (bcrypt limit)', Buffer.byteLength(password, 'utf8') <= 72);
rule('no leading/trailing spaces or line breaks', !/^\s|\s$|[\r\n\t]/.test(password));
const lowered = password.toLowerCase();
const banned = ['password', 'admin', 'shelfify', 'qwerty', '123456', localPart.length >= 4 ? localPart : null].filter(Boolean);
rule('avoids obvious words (password, admin, shelfify, email name ...)', !banned.some((w) => lowered.includes(w)));
rule('not repeated characters only', new Set(password).size >= 6, `${new Set(password).size} distinct characters`);

console.log('\nReuse checks (in memory only)');
rule('differs from the LOCAL development admin password', password !== localEnv.SEED_ADMIN_PASSWORD);
const secretsInFile = ['JWT_ACCESS_SECRET', 'CRON_SECRET', 'RAZORPAY_KEY_SECRET', 'SMTP_PASS'].map((k) => process.env[k]).filter(Boolean);
for (const k of ['MONGODB_URI', 'REDIS_URL']) {
  try {
    const p = decodeURIComponent(new URL(process.env[k]).password);
    if (p) secretsInFile.push(p);
  } catch {
    /* not set */
  }
}
rule('differs from every other secret in the production file (DB, Redis, JWT, cron ...)', !secretsInFile.includes(password), `${secretsInFile.length} secrets compared`);

const ok = results.every(Boolean);
console.log(ok ? '\nRESULT: OK - admin credentials are suitable for production.' : '\nRESULT: fix the FAIL items in server/.env.production.local, save, and run again.');
process.exit(ok ? 0 : 1);
