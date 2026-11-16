/**
 * Syncs production environment variables from server/.env.production.local to the
 * linked Vercel project, without ever printing or passing values on a command line.
 *
 *   npm run vercel:env:plan    -> names/status only, changes nothing (default)
 *   npm run vercel:env:apply   -> adds/overwrites the variables in Vercel "production"
 *
 * - Values go to `vercel env add` through STDIN (never argv, which other processes can see).
 * - Secrets are stored as Sensitive (write-only in the Vercel dashboard).
 * - Production environment only: preview deployments do not receive production
 *   credentials (and the API refuses to start without them, by design).
 * - Never sent: NODE_ENV (Vercel sets it; forcing it would make the install step skip
 *   the build's devDependencies) and SEED_* (local seeding only).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'server', '.env.production.local');
const apply = process.argv.includes('--apply');

// name -> { secret, requires? }
const VARS = {
  MONGODB_URI: { secret: true, required: true },
  JWT_ACCESS_SECRET: { secret: true, required: true },
  CLIENT_URL: { secret: false, required: true },
  REDIS_URL: { secret: true },
  CRON_SECRET: { secret: true },
  NODEJS_HELPERS: { secret: false },
  RAZORPAY_KEY_ID: { secret: false, requires: 'RAZORPAY_KEY_SECRET' },
  RAZORPAY_KEY_SECRET: { secret: true, requires: 'RAZORPAY_KEY_ID' },
  RAZORPAY_WEBHOOK_SECRET: { secret: true },
  SMTP_HOST: { secret: false, requires: 'SMTP_PASS' },
  SMTP_PORT: { secret: false, requires: 'SMTP_HOST' },
  SMTP_USER: { secret: true, requires: 'SMTP_HOST' },
  SMTP_PASS: { secret: true, requires: 'SMTP_HOST' },
  EMAIL_FROM: { secret: false, requires: 'SMTP_HOST' },
};
const NEVER = ['NODE_ENV', 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_ADMIN_NAME'];

if (!existsSync(envFile)) {
  console.error('server/.env.production.local not found.');
  process.exit(1);
}
const values = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) values[m[1]] = m[2].trim();
}

const run = (args, input) =>
  new Promise((resolve) => {
    // Fixed argument list (names only); values are written to stdin.
    const child = spawn(`vercel ${args.join(' ')}`, { cwd: root, shell: true, env: process.env });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });

const linked = existsSync(path.join(root, '.vercel', 'project.json'));
let existing = new Set();
if (linked) {
  const { code, out } = await run(['env', 'ls', 'production']);
  if (code === 0) existing = new Set([...out.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s/gm)].map((m) => m[1]));
}

const plan = [];
for (const [name, meta] of Object.entries(VARS)) {
  const v = values[name] || '';
  let action = 'send';
  let why = '';
  if (!v) {
    action = 'skip';
    why = meta.required ? 'MISSING (required)' : 'empty in local file';
  } else if (meta.requires && !values[meta.requires]) {
    action = 'skip';
    why = `needs ${meta.requires}`;
  }
  plan.push({ name, action, secret: meta.secret, v, why });
}

console.log(`Vercel project: ${linked ? 'linked' : 'NOT linked yet (run "vercel link" first)'}  |  target: production only\n`);
for (const p of plan) {
  const status = p.action === 'send' ? `${p.secret ? 'Sensitive' : 'Config   '}  ${p.secret ? `${p.v.length} chars` : p.v}` : p.why;
  const remote = linked ? (existing.has(p.name) ? '  (exists in Vercel - will overwrite)' : p.action === 'send' ? '  (new)' : '') : '';
  console.log(`  ${p.action === 'send' ? 'SEND' : 'skip'}  ${p.name.padEnd(24)} ${status}${p.action === 'send' ? remote : ''}`);
}
console.log(`\n  never sent: ${NEVER.join(', ')}`);

const missing = plan.filter((p) => p.why.startsWith('MISSING'));
if (missing.length) {
  console.error(`\nRequired values missing: ${missing.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
if (!apply) {
  console.log('\nPlan only - nothing was sent. Run "npm run vercel:env:apply" to apply.');
  process.exit(0);
}
if (!linked) {
  console.error('\nNot linked to a Vercel project - nothing was sent.');
  process.exit(1);
}

console.log('\nApplying ...');
let failures = 0;
for (const p of plan.filter((x) => x.action === 'send')) {
  const args = ['env', 'add', p.name, '--environment', 'production', p.secret ? '--sensitive' : '--no-sensitive', '--force', '--yes'];
  const { code, out } = await run(args, p.v);
  // Never echo CLI output verbatim (defence in depth): report only success/failure and a scrubbed reason.
  if (code === 0) console.log(`  ok    ${p.name}`);
  else {
    failures += 1;
    const reason = out.split(/\r?\n/).find((l) => /error|invalid|not found|denied/i.test(l)) || `exit code ${code}`;
    console.log(`  FAIL  ${p.name}: ${reason.split(p.v).join('****').trim().slice(0, 160)}`);
  }
}
console.log(failures ? `\n${failures} variable(s) failed.` : '\nAll variables set in Vercel (production).');
process.exit(failures ? 1 : 0);
