/**
 * Interactive, local-only helper that writes REDIS_URL into
 * server/.env.production.local. Run it in your own terminal:
 *
 *   npm run prod:set-redis
 *
 * Asks for the Upstash endpoint (not secret) and the password (hidden), builds the
 * TLS URL rediss://default:<password>@<endpoint>:<port>, TESTS it with a real PING
 * and only then replaces the REDIS_URL line. Never prints the password or the URL.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrompt, setEnvLine } from './lib/prompt.js';
import { describeSecret, probeRedis } from './lib/redis-probe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The override exists only so the helper can be tested against a scratch file.
const file = process.env.SHELFIFY_PROD_ENV_FILE || path.join(root, '.env.production.local');
if (!existsSync(file)) {
  console.error('server/.env.production.local not found - run "npm run prod:init" first.');
  process.exit(1);
}

const fail = (msg, prompt) => {
  prompt?.close();
  console.error(`\n${msg} Nothing was changed.`);
  process.exit(1);
};

console.log('\nShelfify - configure production Redis (Upstash), stored only in server/.env.production.local\n');
const p = createPrompt();

const raw = await p.ask('1) Upstash endpoint, e.g. <name>-<id>.upstash.io  (endpoint only - no password here)\n   > ');
if (raw.includes('@')) {
  fail('Please enter only the endpoint (the host name). Never paste a URL containing the password at a visible prompt.', p);
}
// Accept "host", "host:6379", "https://host" (Upstash REST URL) or "rediss://host:6379" - keep only the host.
const host = raw
  .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  .replace(/\/.*$/, '')
  .replace(/:\d+$/, '')
  .trim()
  .toLowerCase();
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) fail('That does not look like a host name.', p);
if (!host.endsWith('.upstash.io')) console.log('   note: not an *.upstash.io host - continuing, but double-check it.');
try {
  await dns.promises.lookup(host);
  console.log(`   ok - ${host} found`);
} catch {
  fail(`${host} does not exist in DNS - re-copy the endpoint from the Upstash console.`, p);
}

const portAnswer = await p.ask('2) Port [6379]: ');
const port = Number(portAnswer || 6379);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid port.', p);

const password = await p.askHidden('3) Password (input hidden): ');
const confirm = await p.askHidden('   Re-enter the password to confirm: ');
p.close();
if (!password) fail('No password entered.');
if (password !== confirm) fail('The passwords did not match.');

// Upstash requires TLS: rediss://. The username for the default ACL user is "default".
const url = `rediss://default:${encodeURIComponent(password)}@${host}:${port}`;

if (!process.env.SHELFIFY_SKIP_CONNECT_TEST) {
  // Staged probe: reports the exact failing step and the server's own reply
  // (the previous version discarded ioredis errors and only saw "Connection is closed").
  console.log('\nTesting the connection (nothing is written):');
  const { ok, stages } = await probeRedis({ host, port, username: 'default', password });
  for (const s of stages) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(18)} ${s.detail}`);
  if (!ok) {
    const failed = stages.find((s) => !s.ok);
    if (failed?.name === 'AUTH') {
      console.error(`\n  What you entered: ${describeSecret(password)}.`);
      console.error('  Use the database PASSWORD from the Redis/TCP connection details (the part after "default:" in');
      console.error('  rediss://default:...@host:6379, copy icon) - NOT the REST token shown in the REST API section.');
    }
    fail('The connection test did not pass.');
  }
  console.log('  PONG - connection OK');
}

writeFileSync(file, setEnvLine(readFileSync(file, 'utf8'), 'REDIS_URL', url), { mode: 0o600 });
console.log('\nSaved REDIS_URL to server/.env.production.local (only that line was changed).');
console.log(`  endpoint:  ${host}:${port} (TLS)`);
console.log(`  password:  ${password.length} characters - not displayed`);
console.log('\nNext: tell Claude "Redis configured" - it will run the verification checks.\n');
