/**
 * Verifies MONGODB_URI: connectivity, replica set, transaction support and
 * read/write permission. Prints actionable hints on failure.
 *
 *   npm run db:check     -> server/.env (local)
 *   npm run prod:db      -> server/.env.production.local (production; via scripts/prod.js)
 *
 * NOTHING IS PERSISTED: the write-permission probe runs inside a transaction that
 * is always aborted. Credentials are never printed.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set in the loaded env file (see server/.env.example).');
  process.exit(1);
}
let where = 'unparseable URI';
try {
  const u = new URL(uri);
  where = `${u.protocol}//${u.hostname}${u.pathname && u.pathname !== '/' ? u.pathname : ' (no database name!)'}`;
} catch {
  /* keep default */
}
console.log(`Connecting to ${where} ...`);

const row = (label, value) => console.log(`  ${label.padEnd(24)} ${value}`);
let failed = false;

try {
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000, autoIndex: false, autoCreate: false });
  const db = conn.connection.db;
  const admin = db.admin();

  const t0 = Date.now();
  await admin.ping();
  const pingMs = Date.now() - t0;
  const hello = await admin.command({ hello: 1 });
  const build = await admin.command({ buildInfo: 1 }).catch(() => ({}));

  console.log('\nConnection');
  row('database', db.databaseName === 'test' ? 'test  <-- add /shelfify before "?" in the URI' : db.databaseName);
  row('server version', build.version || 'unknown');
  row('round trip (ping)', `${pingMs} ms`);
  row('replica set', hello.setName ? `yes (${hello.setName}, ${hello.hosts?.length || 1} members)` : 'NO - standalone');
  row('connected to primary', hello.isWritablePrimary ? 'yes' : 'no');

  // Transaction + write-permission probe: insert inside a transaction, then ABORT.
  console.log('\nTransactions & permissions (nothing is persisted)');
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const probe = db.collection('_shelfify_probe');
    await probe.insertOne({ at: new Date(), note: 'aborted connectivity probe' }, { session });
    const seen = await probe.countDocuments({}, { session });
    await session.abortTransaction();
    row('transactions', 'supported');
    row('write permission', `yes (probe saw ${seen} doc inside the transaction, then rolled back)`);
  } catch (err) {
    failed = true;
    if (session.inTransaction()) await session.abortTransaction().catch(() => {});
    if (err.code === 20 || /replica set|Transaction numbers/i.test(err.message)) row('transactions', 'NOT supported (standalone server)');
    else if (err.code === 13 || /not authorized/i.test(err.message)) row('write permission', 'NO - give the user readWrite on this database');
    else row('probe', `failed: ${err.message}`);
  } finally {
    await session.endSession();
  }
  const persisted = (await db.listCollections({ name: '_shelfify_probe' }).toArray()).length;
  row('probe left behind', persisted ? 'YES (unexpected)' : 'nothing');

  console.log('\nExisting data (read-only)');
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
  if (!collections.length) row('collections', 'none yet (fresh database - ready for seeding)');
  for (const name of collections.sort()) row(name, `${await db.collection(name).estimatedDocumentCount()} documents`);

  await mongoose.disconnect();
  console.log(failed ? '\nRESULT: problems found (see above).' : '\nRESULT: OK - ready for Shelfify (transactions enabled).');
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error(`\nFAILED: ${String(err.message).replace(/\/\/[^@\s]+@/g, '//****@')}`);
  const msg = String(err.message);
  if (/bad auth|Authentication failed/i.test(msg)) console.error('Hint: wrong username/password, or special characters in the password are not URL-encoded (@ -> %40, : -> %3A, / -> %2F).');
  else if (/ENOTFOUND|querySrv|ENODATA/i.test(msg)) console.error('Hint: the cluster hostname could not be resolved - re-copy the connection string (Atlas -> Connect -> Drivers).');
  else if (/Server selection timed out|ECONNREFUSED|whitelist|IP|ETIMEDOUT/i.test(msg)) console.error('Hint: Atlas is blocking this IP - Atlas -> Network Access -> Add IP Address -> "Add current IP address". Changes take ~1 minute.');
  else if (/not authorized/i.test(msg)) console.error('Hint: the database user needs the readWrite role on the shelfify database.');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
