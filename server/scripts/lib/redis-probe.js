import dns from 'node:dns';
import tls from 'node:tls';

/**
 * Staged Redis connectivity probe used by the operator scripts. Each stage reports
 * the exact reason it failed instead of a generic "Connection is closed":
 *   1. DNS  2. TLS handshake  3. AUTH (raw RESP, exact server reply)  4. PING via ioredis
 * Server replies never contain the password, and nothing here prints credentials.
 */
export async function probeRedis({ host, port = 6379, username = 'default', password, timeoutMs = 10_000 }) {
  const stages = [];
  const add = (name, ok, detail) => stages.push({ name, ok, detail });
  const done = () => ({ ok: stages.every((s) => s.ok), stages });

  // 1) DNS
  try {
    const { address } = await dns.promises.lookup(host);
    add('DNS', true, `${host} -> ${address}`);
  } catch (err) {
    add('DNS', false, `${host} not found (${err.code}) - re-copy the endpoint`);
    return done();
  }

  // 2) TLS handshake (Upstash only accepts TLS)
  let socket;
  try {
    socket = await new Promise((resolve, reject) => {
      const s = tls.connect({ host, port, servername: host });
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`no TLS handshake within ${timeoutMs / 1000}s (wrong port or firewall?)`));
      }, timeoutMs);
      s.once('secureConnect', () => {
        clearTimeout(timer);
        resolve(s);
      });
      s.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    add('TLS', socket.authorized, `${socket.getProtocol()}, certificate ${socket.authorized ? 'valid' : `INVALID (${socket.authorizationError})`}`);
  } catch (err) {
    add('TLS', false, `${err.code || ''} ${err.message}`.trim());
    return done();
  }

  // 3) AUTH over raw RESP so we see the server's exact reply
  const send = (parts) =>
    new Promise((resolve, reject) => {
      const payload = `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;
      let buf = '';
      const timer = setTimeout(() => reject(new Error('no reply from server')), timeoutMs);
      const onData = (d) => {
        buf += d.toString();
        const i = buf.indexOf('\r\n');
        if (i >= 0) {
          clearTimeout(timer);
          socket.off('data', onData);
          resolve(buf.slice(0, i));
        }
      };
      socket.on('data', onData);
      socket.once('close', () => reject(new Error('server closed the connection')));
      socket.write(payload);
    });
  try {
    const authReply = await send(['AUTH', username, password]);
    add('AUTH', authReply === '+OK', authReply === '+OK' ? `accepted for user "${username}"` : `rejected: ${authReply.replace(/^-/, '')}`);
    if (authReply !== '+OK') {
      socket.destroy();
      return done();
    }
    const pong = await send(['PING']);
    add('PING (raw)', pong === '+PONG', pong);
  } catch (err) {
    add('AUTH', false, err.message);
  } finally {
    socket.destroy();
  }
  if (!stages.every((s) => s.ok)) return done();

  // 4) The same client library and URL form the deployed app uses
  const { default: Redis } = await import('ioredis');
  const url = `rediss://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  const client = new Redis(url, { lazyConnect: true, connectTimeout: timeoutMs, maxRetriesPerRequest: 1, retryStrategy: () => null });
  let lastError = null;
  client.on('error', (e) => (lastError = e)); // captured, not swallowed
  try {
    await client.connect();
    const reply = await client.ping();
    add('PING (app client)', reply === 'PONG', `ioredis ${reply}`);
  } catch (err) {
    add('PING (app client)', false, (lastError || err).message);
  } finally {
    client.disconnect();
  }
  return done();
}

/** Safe facts about an entered secret (never the value itself) to explain rejections. */
export function describeSecret(secret) {
  const facts = [`${secret.length} characters`];
  if (/^\s|\s$/.test(secret)) facts.push('has leading/trailing spaces');
  if (/[\r\n\t]/.test(secret)) facts.push('contains line breaks/tabs');
  if (secret.length >= 60 && /^[A-Za-z0-9+/=_-]+$/.test(secret)) facts.push('looks like an Upstash REST TOKEN (long base64), not the Redis password');
  return facts.join(', ');
}
