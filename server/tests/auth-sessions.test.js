/**
 * Regression tests for audit fix H1 (concurrent refresh / session revocation)
 * and the login hardening added alongside it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { register, startStack } from './helpers.js';

let stack;
let app;
let M;
const UA = 'Mozilla/5.0 (Windows NT 10.0) Shelfify-Test-Browser';

beforeAll(async () => {
  stack = await startStack({ replSet: true });
  ({ app, models: M } = stack);
});
afterAll(() => stack?.stop());
beforeEach(() => stack.reset());

const refresh = (cookie, ua = UA) => request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('User-Agent', ua);
const cookieOf = (res) => res.headers['set-cookie']?.[0]?.split(';')[0];

async function session() {
  const res = await request(app).post('/api/v1/auth/register').set('User-Agent', UA).send({ name: 'Tab User', email: `tabs${Date.now()}@example.com`, password: 'Passw0rd!' });
  expect(res.status).toBe(201);
  return cookieOf(res);
}

describe('H1: concurrent refresh', () => {
  it('several tabs restoring the session at the same moment all stay signed in', async () => {
    const cookie = await session();
    const results = await Promise.all([refresh(cookie), refresh(cookie), refresh(cookie)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    // every tab's new token keeps working afterwards
    for (const r of results) expect((await refresh(cookieOf(r))).status).toBe(200);
  });

  it('a replay from a different device is treated as theft and ends the whole family', async () => {
    const cookie = await session();
    const rotated = await refresh(cookie);
    expect((await refresh(cookie, 'curl/8.0 attacker')).status).toBe(401);
    expect((await refresh(cookieOf(rotated))).status).toBe(401);
    expect(await M.RefreshToken.countDocuments({ revokedReason: 'reuse' })).toBeGreaterThan(0);
  });

  it('a replay after the grace window is treated as theft', async () => {
    const cookie = await session();
    const rotated = await refresh(cookie);
    await M.RefreshToken.updateMany({ revokedReason: 'rotated' }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
    expect((await refresh(cookie)).status).toBe(401);
    expect((await refresh(cookieOf(rotated))).status).toBe(401);
  });

  it('the grace window cannot resurrect a logged-out session', async () => {
    const cookie = await session();
    const rotated = await refresh(cookie);
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', cookieOf(rotated)).set('User-Agent', UA)).status).toBe(200);
    expect((await refresh(cookie)).status).toBe(401); // old token, still inside the grace window
    expect((await refresh(cookieOf(rotated))).status).toBe(401);
  });

  it('the grace budget is limited', async () => {
    const cookie = await session();
    await refresh(cookie); // normal rotation
    const replays = [];
    for (let i = 0; i < 4; i += 1) replays.push((await refresh(cookie)).status);
    expect(replays).toEqual([200, 200, 200, 401]);
  });

  it('a password change still revokes every session', async () => {
    const reg = await request(app).post('/api/v1/auth/register').set('User-Agent', UA).send({ name: 'P W', email: 'pwchange@example.com', password: 'Passw0rd!' });
    const cookie = cookieOf(reg);
    const changed = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${reg.body.data.accessToken}`)
      .set('User-Agent', UA)
      .send({ currentPassword: 'Passw0rd!', newPassword: 'N3wPassword' });
    expect(changed.status).toBe(200);
    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe('login hardening', () => {
  it('throttles repeated failures per account across different IPs', async () => {
    await register(app, { email: 'target@example.com' });
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`) // a different client IP each time
        .send({ email: 'target@example.com', password: `wrong-pass-${i}` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // another account is unaffected
    await register(app, { email: 'bystander@example.com' });
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'bystander@example.com', password: 'Passw0rd!' })).status).toBe(200);
  });

  it('unknown email and wrong password are indistinguishable', async () => {
    await register(app, { email: 'known@example.com' });
    const a = await request(app).post('/api/v1/auth/login').send({ email: 'known@example.com', password: 'bad-password-1' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'bad-password-1' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('rejects passwords bcrypt would silently truncate (> 72 bytes)', async () => {
    const long = `${'é'.repeat(40)}1a`; // 82 bytes in UTF-8, only 42 characters
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'Long PW', email: 'longpw@example.com', password: long });
    expect(res.status).toBe(422);
  });
});
