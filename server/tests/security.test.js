/**
 * Regression tests for audit fixes C2 (fail-closed configuration), C3 follow-up
 * (Zod 4 PATCH defaults), M4 (webhook raw body), M6 (URL schemes) and the
 * low-severity hardening (health exposure, request ids, cache headers, query parsing).
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, register, signWebhook, startStack } from './helpers.js';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const STRONG = 'b1f0c7e4d2a95f3e8c6b4a2d0f9e7c5b3a1d8f6e4c2b0a9d7f5e3c1b9a8d6f4e';

let stack;
let app;
let M;
let adminToken;

beforeAll(async () => {
  stack = await startStack({ replSet: false });
  ({ app, models: M } = stack);
});
afterAll(() => stack?.stop());
beforeEach(async () => {
  await stack.reset();
  const admin = await register(app, { email: 'admin-sec@example.com' });
  await M.User.updateOne({ email: 'admin-sec@example.com' }, { $set: { role: 'admin' }, $inc: { tokenVersion: 1 } });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: 'admin-sec@example.com', password: 'Passw0rd!' })).body.data.accessToken;
  expect(admin.token).toBeTruthy();
});

async function loadEnv(vars) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NODE_ENV|VERCEL|JWT_|MONGODB_URI|CLIENT_URL|RAZORPAY_|CRON_SECRET|REDIS_URL)/.test(k)));
  const { stdout } = await run(process.execPath, [path.join(here, 'fixtures/load-env.mjs')], { cwd: os.tmpdir(), env: { ...clean, ...vars } });
  return JSON.parse(stdout.trim().split('\n').pop());
}

describe('C2: fail-closed configuration', () => {
  it('refuses to boot on Vercel without secrets even if NODE_ENV is unset', async () => {
    const r = await loadEnv({ VERCEL: '1', MONGODB_URI: 'mongodb://x' });
    expect(r.booted).toBe(false);
  });
  it('rejects the old public default and placeholder secrets in production', async () => {
    for (const secret of ['dev-only-access-secret-change-me-please', 'please-change-me-this-is-a-placeholder-value']) {
      const r = await loadEnv({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://x', CLIENT_URL: 'https://a.vercel.app', JWT_ACCESS_SECRET: secret });
      expect(r.booted).toBe(false);
    }
  });
  it('requires an https CLIENT_URL and paired Razorpay keys in production', async () => {
    const base = { NODE_ENV: 'production', MONGODB_URI: 'mongodb://x', JWT_ACCESS_SECRET: STRONG };
    expect((await loadEnv({ ...base, CLIENT_URL: 'http://a.vercel.app' })).booted).toBe(false);
    expect((await loadEnv({ ...base, CLIENT_URL: 'https://a.vercel.app', RAZORPAY_KEY_ID: 'rzp_test_x' })).booted).toBe(false);
  });
  it('boots on Vercel with production semantics when correctly configured', async () => {
    const r = await loadEnv({ VERCEL: '1', MONGODB_URI: 'mongodb://x', CLIENT_URL: 'https://a.vercel.app', JWT_ACCESS_SECRET: STRONG });
    expect(r).toMatchObject({ booted: true, isProd: true });
  });
  it('local development without a secret uses a random one, never a fixed default', async () => {
    const a = await loadEnv({ NODE_ENV: 'development' });
    expect(a).toMatchObject({ booted: true, isProd: false });
    expect(a.secretLength).toBeGreaterThanOrEqual(64);
  });
});

describe('Zod 4: partial updates never reset other fields', () => {
  it('PATCH product {price} keeps stock, visibility and description', async () => {
    const p = await M.Product.create({ title: 'Keep Me', slug: 'keep-me', author: 'A', genre: 'tech', price: 300, mrp: 400, stock: 17, description: 'Original', isActive: true, fastDelivery: true, badge: 'Hot' });
    const res = await request(app).patch(`/api/v1/admin/products/${p._id}`).set(bearer(adminToken)).send({ price: 350 });
    expect(res.status).toBe(200);
    const after = await M.Product.findById(p._id);
    expect([after.price, after.stock, after.description, after.isActive, after.fastDelivery, after.badge]).toEqual([350, 17, 'Original', true, true, 'Hot']);
  });
  it('PATCH coupon {isActive} keeps description and limits', async () => {
    const c = await M.Coupon.create({ code: 'KEEP10', type: 'percent', value: 10, description: 'Ten off', minOrderValue: 500, perUserLimit: 3 });
    expect((await request(app).patch(`/api/v1/admin/coupons/${c._id}`).set(bearer(adminToken)).send({ isActive: false })).status).toBe(200);
    const after = await M.Coupon.findById(c._id);
    expect([after.isActive, after.description, after.minOrderValue, after.perUserLimit]).toEqual([false, 'Ten off', 500, 3]);
  });
  it('setting a default address keeps its label and second line', async () => {
    const u = await register(app);
    const addr = { label: 'Work', fullName: 'Asha Rao', phone: '9876543210', line1: '1 Tech Park', line2: 'Tower B', city: 'Pune', state: 'Maharashtra', postalCode: '411001' };
    await request(app).post('/api/v1/users/me/addresses').set(bearer(u.token)).send({ ...addr, label: 'Home', line1: 'Home 1' });
    const list = (await request(app).post('/api/v1/users/me/addresses').set(bearer(u.token)).send(addr)).body.data;
    const work = list.find((a) => a.label === 'Work');
    const updated = (await request(app).patch(`/api/v1/users/me/addresses/${work._id}`).set(bearer(u.token)).send({ isDefault: true })).body.data;
    expect(updated.find((a) => a._id === work._id)).toMatchObject({ label: 'Work', line2: 'Tower B', isDefault: true });
  });
});

describe('M6: only http(s) URLs are accepted', () => {
  it('rejects javascript:, data: and protocol-relative URLs; accepts https and site paths', async () => {
    const u = await register(app);
    for (const bad of ['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>']) {
      expect((await request(app).patch('/api/v1/users/me').set(bearer(u.token)).send({ avatarUrl: bad })).status).toBe(422);
    }
    expect((await request(app).patch('/api/v1/users/me').set(bearer(u.token)).send({ avatarUrl: 'https://cdn.example.com/a.png' })).status).toBe(200);

    const make = (coverImage) => request(app).post('/api/v1/admin/products').set(bearer(adminToken)).send({ title: 'T', author: 'A', genre: 'tech', price: 1, mrp: 1, coverImage });
    expect((await make('javascript:alert(1)')).status).toBe(422);
    expect((await make('//evil.example/x.jpg')).status).toBe(422);
    expect((await make('/covers/ok.jpg')).status).toBe(201);
    expect((await make('https://images.example.com/c.jpg')).status).toBe(201);
  });
});

describe('M4: webhook signature uses the exact raw body', () => {
  const payload = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_none', error_description: 'x' } } } });

  it('verifies a correctly signed raw body (incl. non-ASCII bytes)', async () => {
    const unicode = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rf_1', payment_id: 'pay_none', notes: { reason: 'Café ₹ refund' } } } } });
    const res = await request(app).post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signWebhook(unicode)).send(unicode);
    expect(res.status).toBe(200);
  });
  it('rejects a body altered after signing', async () => {
    const res = await request(app).post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signWebhook(payload)).send(payload.replace('x', 'y'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });
  it('fails loudly (not as a bad signature) if a platform already parsed the body', async () => {
    const paymentRoutes = (await import('../src/modules/payments/payment.routes.js')).default;
    const parsedFirst = express().use(express.json()).use('/wh', paymentRoutes); // simulates an upstream body parser
    const res = await request(parsedFirst).post('/wh/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signWebhook(payload)).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RAW_BODY_UNAVAILABLE');
  });
});

describe('low-severity hardening', () => {
  it('health endpoint hides configuration in production unless the operator secret is sent', async () => {
    const { env } = await import('../src/config/env.js');
    expect(env.isProd).toBe(false); // in dev/test details are shown for convenience
    const dev = await request(app).get('/api/health');
    expect(dev.body.data).toHaveProperty('payments');
    // Production behaviour is exercised in a child process below
  });

  it('production health: minimal publicly, detailed with the cron secret', async () => {
    const script = `
      const { connectDB } = await import(${JSON.stringify(path.join(here, '../src/config/db.js').replace(/\\/g, '/').replace(/^/, 'file:///'))});
      const { createApp } = await import(${JSON.stringify(path.join(here, '../src/app.js').replace(/\\/g, '/').replace(/^/, 'file:///'))});
      await connectDB(process.env.MONGODB_URI);
      const s = createApp().listen(0); const b = 'http://127.0.0.1:' + s.address().port + '/api/health';
      const pub = await (await fetch(b)).json();
      const priv = await (await fetch(b, { headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET } })).json();
      console.log(JSON.stringify({ pub: pub.data, priv: priv.data })); process.exit(0);`;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
      cwd: os.tmpdir(),
      env: { ...process.env, NODE_ENV: 'production', MONGODB_URI: stack.uri, CLIENT_URL: 'https://a.vercel.app', JWT_ACCESS_SECRET: STRONG, CRON_SECRET: 'ops-secret-123', LOG_LEVEL: 'silent', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' },
    });
    const { pub, priv } = JSON.parse(stdout.trim().split('\n').pop());
    expect(Object.keys(pub).sort()).toEqual(['status', 'version']);
    expect(priv).toHaveProperty('db', 'connected');
    expect(priv).toHaveProperty('payments');
    expect(priv.node).toBe(process.version); // runtime is reported to operators only
    expect(pub).not.toHaveProperty('node');
  });

  it('only echoes safe request ids', async () => {
    expect((await request(app).get('/api/health').set('X-Request-Id', 'trace-abc12345')).headers['x-request-id']).toBe('trace-abc12345');
    const evil = await request(app).get('/api/health').set('X-Request-Id', `${'A'.repeat(300)}<script>`);
    expect(evil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('user-specific responses are not cacheable; the public catalog is', async () => {
    const u = await register(app);
    expect((await request(app).get('/api/v1/cart').set(bearer(u.token))).headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/v1/auth/me').set(bearer(u.token))).headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/v1/products')).headers['cache-control']).toMatch(/public/);
  });

  it('nested query objects are not parsed into operators', async () => {
    const res = await request(app).get('/api/v1/products?q[$ne]=x&genre[$gt]=a');
    expect(res.status).toBe(200);
  });
});
