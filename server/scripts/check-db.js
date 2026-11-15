/**
 * Verifies that MONGODB_URI (from server/.env or the environment) is reachable
 * and has the permissions Shelfify needs. Prints actionable hints on failure.
 *
 *   npm run db:check
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Add it to server/.env (see server/.env.example).');
  process.exit(1);
}
const safe = uri.replace(/\/\/([^:/]+):[^@]+@/, '//$1:****@');
console.log(`Connecting to ${safe} ...`);

try {
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  const db = conn.connection.db;
  if (db.databaseName === 'test') {
    console.warn('Warning: no database name in the URI, so MongoDB will use "test". Add /shelfify before the "?" in the connection string.');
  }
  await db.collection('_shelfify_healthcheck').insertOne({ at: new Date() });
  await db.collection('_shelfify_healthcheck').drop();
  const products = await db.collection('products').countDocuments().catch(() => 0);
  console.log(`OK: connected to database "${db.databaseName}" on ${conn.connection.host} with read/write access.`);
  console.log(products ? `Catalog contains ${products} products.` : 'Catalog is empty. Run "npm run seed" (or "npm run dev:local", which seeds automatically).');
  await mongoose.disconnect();
  process.exit(0);
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  const msg = String(err.message);
  if (/bad auth|Authentication failed/i.test(msg)) console.error('Hint: wrong database username/password. Note: special characters in the password must be URL-encoded (e.g. @ -> %40).');
  else if (/ENOTFOUND|querySrv/i.test(msg)) console.error('Hint: the cluster hostname could not be resolved. Re-copy the connection string from Atlas -> Connect -> Drivers.');
  else if (/Server selection timed out|ECONNREFUSED|whitelist|IP/i.test(msg)) console.error('Hint: Atlas is blocking this IP. Atlas -> Network Access -> Add IP Address -> "Add current IP address".');
  else if (/not authorized/i.test(msg)) console.error('Hint: the database user needs the "Read and write to any database" role.');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}
