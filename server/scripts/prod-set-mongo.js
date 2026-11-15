/**
 * Interactive, local-only helper that writes MONGODB_URI into
 * server/.env.production.local. Run it in your own terminal:
 *
 *   npm run prod:set-mongo
 *
 * - Accepts any Atlas connection string (from ANY driver option, Compass or the
 *   shell) or just the cluster host; the <db_password> placeholder Atlas shows is
 *   not a secret.
 * - Reads the password with hidden input and URL-encodes it.
 * - Builds the standard Node.js driver SRV URI with the "shelfify" database.
 * - Replaces ONLY the MONGODB_URI line; never prints the password or the URI.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The override exists only so the helper can be tested against a scratch file.
const file = process.env.SHELFIFY_PROD_ENV_FILE || path.join(root, '.env.production.local');
if (!existsSync(file)) {
  console.error('server/.env.production.local not found - run "npm run prod:init" first.');
  process.exit(1);
}

// Interactive terminal: readline echoes keystrokes, so hidden prompts mask them with '*'.
// Non-interactive (piped) input: terminal mode off, so nothing is ever echoed.
const interactive = Boolean(process.stdin.isTTY);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
let muted = false;
rl._writeToOutput = (s) => {
  if (!muted) rl.output.write(s);
  else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n');
  else rl.output.write('*'.repeat(s.length));
};

// Line queue: works whether lines are typed one by one or arrive all at once.
const queued = [];
let waiter = null;
let closed = false;
rl.on('line', (line) => (waiter ? (waiter(line), (waiter = null)) : queued.push(line)));
rl.on('close', () => {
  closed = true;
  if (waiter) waiter(null);
});
const nextLine = () => (queued.length ? Promise.resolve(queued.shift()) : closed ? Promise.resolve(null) : new Promise((r) => (waiter = r)));

const ask = async (q) => {
  rl.output.write(q);
  return ((await nextLine()) ?? '').trim();
};
const askHidden = async (q) => {
  rl.output.write(q);
  muted = true;
  const answer = (await nextLine()) ?? '';
  muted = false;
  if (!interactive) rl.output.write('\n');
  return answer;
};

console.log('\nShelfify - configure the production MongoDB connection (stored only in server/.env.production.local)\n');

const DB_NAME = 'shelfify';
const input = await ask('1) Paste the Atlas connection string (any driver) OR just the cluster host\n   (format: <cluster-name>.<your-id>.mongodb.net - copy yours from Atlas, not an example)\n   > ');
const host = (input.match(/@([^/?\s]+)/)?.[1] || input.replace(/^mongodb(\+srv)?:\/\//, '').split(/[/?]/)[0]).trim();
if (!/^[a-z0-9.-]+\.mongodb\.net$/i.test(host) || /\.(xxxxx|ab1cd)\./i.test(host)) {
  console.error(`\nThat is not your Atlas cluster host (it must be the one shown in YOUR Atlas Connect dialog). Nothing was changed.`);
  rl.close();
  process.exit(1);
}
try {
  const records = await (await import('node:dns')).promises.resolveSrv(`_mongodb._tcp.${host}`);
  console.log(`   ok - ${host} found (${records.length} replica set members)`);
} catch {
  console.error(`\n${host} does not exist in DNS - re-copy the host from Atlas -> Connect. Nothing was changed.`);
  rl.close();
  process.exit(1);
}
const suggestedUser = input.match(/mongodb\+srv:\/\/([^:@/]+)[:@]/)?.[1];
const userAnswer = await ask(`2) Database username [${suggestedUser && !suggestedUser.includes('<') ? suggestedUser : 'shelfify_app'}]: `);
const user = userAnswer || (suggestedUser && !suggestedUser.includes('<') ? suggestedUser : 'shelfify_app');
const password = await askHidden('3) Database user password (input hidden): ');
const confirm = await askHidden('   Re-enter the password to confirm: ');
rl.close();

if (!password) {
  console.error('\nNo password entered. Nothing was changed.');
  process.exit(1);
}
if (password !== confirm) {
  console.error('\nThe passwords did not match. Nothing was changed.');
  process.exit(1);
}

const appName = host.split('.')[0];
const uri = `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}/${DB_NAME}?retryWrites=true&w=majority&appName=${encodeURIComponent(appName)}`;

// Verify the credentials BEFORE saving (read-only ping; nothing is written to the database).
if (!process.env.SHELFIFY_SKIP_CONNECT_TEST) {
  process.stdout.write('\nTesting the login against Atlas (read-only) ... ');
  const { default: mongoose } = await import('mongoose');
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  try {
    await client.connect();
    await client.db(DB_NAME).command({ ping: 1 });
    console.log('login OK');
  } catch (err) {
    const msg = String(err.message);
    console.log('FAILED');
    if (/bad auth|Authentication failed/i.test(msg)) {
      console.error(`\nAtlas rejected the password for "${user}". Use the password of the DATABASE USER (Atlas -> Database Access ->`);
      console.error(`${user} -> Edit -> Edit Password -> Autogenerate -> Copy -> Update User), wait ~1 minute, then run this again.`);
    } else if (/timed out|ECONNREFUSED|ETIMEDOUT/i.test(msg)) {
      console.error('\nAtlas did not accept the connection from this computer - check Atlas -> Network Access includes your current IP.');
    } else console.error(`\n${msg.replace(/\/\/[^@\s]+@/g, '//****@')}`);
    console.error('Nothing was changed.');
    await client.close().catch(() => {});
    process.exit(1);
  }
  await client.close();
}

const text = readFileSync(file, 'utf8');
const updated = /^MONGODB_URI=.*$/m.test(text) ? text.replace(/^MONGODB_URI=.*$/m, () => `MONGODB_URI=${uri}`) : `${text.trimEnd()}\nMONGODB_URI=${uri}\n`;
writeFileSync(file, updated, { mode: 0o600 });

console.log('\nSaved MONGODB_URI to server/.env.production.local (only that line was changed).');
console.log(`  host:      ${host}`);
console.log(`  user:      ${user}`);
console.log(`  database:  ${DB_NAME}`);
console.log(`  password:  ${password.length} characters${encodeURIComponent(password) !== password ? ' (special characters were URL-encoded)' : ''} - not displayed`);
console.log('\nNext: tell Claude "MongoDB configured" - it will run the verification checks.\n');
