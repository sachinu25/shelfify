import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Mock only Razorpay's HTTP client. Signature verification uses the real HMAC code.
const rzp = vi.hoisted(() => ({ orderSeq: 0, refunds: [] }));
vi.mock('razorpay', () => ({
  default: class Razorpay {
    constructor() {
      this.orders = { create: async ({ amount }) => ({ id: `order_test_${++rzp.orderSeq}`, amount, currency: 'INR' }) };
      this.payments = {
        refund: async (paymentId, opts) => {
          rzp.refunds.push({ paymentId, ...opts });
          return { id: `rfnd_${paymentId}`, status: 'processed' };
        },
      };
    }
  },
}));

let app;
let mongo;
let models;
let clearMemoryCache;

const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'test_key_secret').update(`${orderId}|${paymentId}`).digest('hex');
const ADDRESS = { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' };

async function register(email, name = 'Reader One') {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register').send({ name, email, password: 'Passw0rd!' });
  expect(res.status).toBe(201);
  return { agent, token: res.body.data.accessToken, user: res.body.data.user };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const { connectDB } = await import('../src/config/db.js');
  await connectDB(mongo.getUri('shelfify-test'));
  ({ createApp: app } = await import('../src/app.js'));
  app = app();
  ({ clearMemoryCache } = await import('../src/lib/cache.js'));
  models = {
    Product: (await import('../src/models/Product.js')).Product,
    User: (await import('../src/models/User.js')).User,
    Order: (await import('../src/models/Order.js')).Order,
    Coupon: (await import('../src/models/Coupon.js')).Coupon,
  };
  await Promise.all(Object.values(models).map((m) => m.init()));
});

afterAll(async () => {
  const { disconnectDB } = await import('../src/config/db.js');
  await disconnectDB();
  await mongo?.stop();
});

let book;
let cheap;
beforeEach(async () => {
  await Promise.all(Object.values(models).map((m) => m.deleteMany({})));
  clearMemoryCache();
  book = await models.Product.create({ title: 'The Silent Sea', slug: 'the-silent-sea', author: 'Mira Nair', genre: 'fiction', price: 600, mrp: 800, stock: 3, description: 'An ocean mystery' });
  cheap = await models.Product.create({ title: 'Small Poems', slug: 'small-poems', author: 'Ravi K', genre: 'romance', price: 150, mrp: 150, stock: 10 });
  await models.Coupon.create({ code: 'SAVE100', type: 'flat', value: 100, minOrderValue: 500, perUserLimit: 1 });
});

describe('health & catalog', () => {
  it('reports health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.db).toBe('connected');
  });

  it('lists, filters, sorts and paginates products', async () => {
    const res = await request(app).get('/api/v1/products?sort=price_asc&limit=1');
    expect(res.status).toBe(200);
    expect(res.body.data[0].title).toBe('Small Poems');
    expect(res.body.meta).toMatchObject({ total: 2, pages: 2, hasNext: true });
    const filtered = await request(app).get('/api/v1/products?genre=fiction&minPrice=500');
    expect(filtered.body.data.map((p) => p.slug)).toEqual(['the-silent-sea']);
    expect(filtered.body.data[0].discountPercent).toBe(25);
    expect(filtered.body.data[0].stock).toBeUndefined(); // inventory not leaked publicly
  });

  it('searches with text index and partial fallback', async () => {
    const full = await request(app).get('/api/v1/products?q=ocean');
    expect(full.body.data[0].slug).toBe('the-silent-sea');
    const partial = await request(app).get('/api/v1/products?q=sil');
    expect(partial.body.data[0].slug).toBe('the-silent-sea');
  });

  it('returns 404 for unknown products and routes', async () => {
    expect((await request(app).get('/api/v1/products/nope')).status).toBe(404);
    expect((await request(app).get('/api/v1/nothing')).status).toBe(404);
  });
});

describe('auth', () => {
  it('registers, rejects duplicates, logs in and refreshes with rotation', async () => {
    const { agent } = await register('a@example.com');
    const dup = await request(app).post('/api/v1/auth/register').send({ name: 'X Y', email: 'a@example.com', password: 'Passw0rd!' });
    expect(dup.status).toBe(409);

    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'a@example.com', password: 'wrong-pass1' });
    expect(bad.status).toBe(401);

    const first = await agent.post('/api/v1/auth/refresh');
    expect(first.status).toBe(200);
    const cookie = first.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(first.body.data.accessToken).toBeTruthy();
  });

  it('detects refresh token reuse and revokes the family', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({ name: 'R U', email: 'reuse@example.com', password: 'Passw0rd!' });
    const original = reg.headers['set-cookie'][0].split(';')[0];
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', original);
    expect(rotated.status).toBe(200);
    const next = rotated.headers['set-cookie'][0].split(';')[0];
    // Replayed by a different client (a same-browser replay within the grace window is
    // legitimate multi-tab behaviour since audit fix H1 - covered in auth-sessions.test.js).
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', original).set('User-Agent', 'attacker-device/1.0');
    expect(replay.status).toBe(401);
    // the legitimately rotated token is now revoked too
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', next)).status).toBe(401);
  });

  it('rejects missing/invalid tokens and strips NoSQL operators', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer abc')).status).toBe(401);
    const inj = await request(app).post('/api/v1/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    expect(inj.status).toBe(422);
  });

  it('invalidates sessions after password change', async () => {
    const { token } = await register('pw@example.com');
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Passw0rd!', newPassword: 'NewPassw0rd' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`)).status).toBe(200);
  });
});

describe('RBAC', () => {
  it('blocks customers from admin APIs and allows admins', async () => {
    const { token } = await register('cust@example.com');
    expect((await request(app).get('/api/v1/admin/analytics').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    await models.User.updateOne({ email: 'cust@example.com' }, { $set: { role: 'admin' }, $inc: { tokenVersion: 1 } });
    // old token carries stale role/version -> rejected
    expect((await request(app).get('/api/v1/admin/analytics').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'cust@example.com', password: 'Passw0rd!' });
    const admin = login.body.data.accessToken;
    const analytics = await request(app).get('/api/v1/admin/analytics').set('Authorization', `Bearer ${admin}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.series).toHaveLength(30);

    const created = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${admin}`)
      .send({ title: 'New Book', author: 'Someone', genre: 'tech', price: 300, mrp: 400, stock: 4 });
    expect(created.status).toBe(201);
    const stock = await request(app)
      .patch(`/api/v1/admin/products/${created.body.data.id}/stock`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ mode: 'adjust', value: -10 });
    expect(stock.status).toBe(400); // cannot go negative
  });
});

describe('cart, wishlist & coupons', () => {
  it('manages the cart with server side pricing', async () => {
    const { token } = await register('cart@example.com');
    const auth = { Authorization: `Bearer ${token}` };
    let res = await request(app).post('/api/v1/cart/items').set(auth).send({ productId: String(book._id), quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.items[0].quantity).toBe(3); // capped at stock
    res = await request(app).get('/api/v1/cart?coupon=SAVE100').set(auth);
    expect(res.body.data.summary).toMatchObject({ subtotal: 1800, couponDiscount: 100, shipping: 0, total: 1700 });
    res = await request(app).get('/api/v1/cart?coupon=FAKE').set(auth);
    expect(res.body.data.couponError).toBeTruthy();
    res = await request(app).patch(`/api/v1/cart/items/${book._id}`).set(auth).send({ quantity: 1 });
    expect(res.body.data.summary.subtotal).toBe(600);
    res = await request(app).delete(`/api/v1/cart/items/${book._id}`).set(auth);
    expect(res.body.data.items).toHaveLength(0);
  });

  it('quotes and merges guest carts', async () => {
    const quote = await request(app).post('/api/v1/cart/quote').send({ items: [{ productId: String(cheap._id), quantity: 2 }] });
    expect(quote.body.data.summary).toMatchObject({ subtotal: 300, shipping: 50, total: 350 });
    const { token } = await register('merge@example.com');
    const merged = await request(app)
      .post('/api/v1/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ productId: String(cheap._id), quantity: 2 }] });
    expect(merged.body.data.items[0].quantity).toBe(2);
  });

  it('toggles wishlist items', async () => {
    const { token } = await register('wish@example.com');
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).post(`/api/v1/wishlist/${book._id}`).set(auth)).body.data).toHaveLength(1);
    expect((await request(app).post(`/api/v1/wishlist/${book._id}`).set(auth)).body.data).toHaveLength(1);
    expect((await request(app).delete(`/api/v1/wishlist/${book._id}`).set(auth)).body.data).toHaveLength(0);
  });
});

describe('checkout & payments', () => {
  async function checkout(token, opts = {}) {
    const req = request(app).post('/api/v1/orders/checkout').set('Authorization', `Bearer ${token}`);
    if (opts.key) req.set('Idempotency-Key', opts.key);
    return req.send({ address: ADDRESS, coupon: opts.coupon });
  }

  it('creates an order, reserves stock, verifies signature and fulfils idempotently', async () => {
    const { token } = await register('buyer@example.com');
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/v1/cart/items').set(auth).send({ productId: String(book._id), quantity: 2 });

    const res = await checkout(token, { key: 'checkout-key-0001', coupon: 'SAVE100' });
    expect(res.status).toBe(201);
    const { order, payment } = res.body.data;
    expect(order.pricing.total).toBe(1100);
    expect(payment.amount).toBe(110000); // paise, computed server-side
    expect(payment.keyId).toBe('rzp_test_dummy');
    expect((await models.Product.findById(book._id)).stock).toBe(1); // reserved

    // Same idempotency key -> same order, no double reservation
    const replay = await checkout(token, { key: 'checkout-key-0001', coupon: 'SAVE100' });
    expect(replay.status).toBe(200);
    expect(replay.body.data.order.id).toBe(order.id);
    expect((await models.Product.findById(book._id)).stock).toBe(1);

    // Forged signature is rejected
    const forged = await request(app)
      .post(`/api/v1/orders/${order.id}/verify`)
      .set(auth)
      .send({ razorpay_order_id: payment.razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'deadbeef' });
    expect(forged.status).toBe(400);

    const body = { razorpay_order_id: payment.razorpayOrderId, razorpay_payment_id: 'pay_1', razorpay_signature: sign(payment.razorpayOrderId, 'pay_1') };
    const ok1 = await request(app).post(`/api/v1/orders/${order.id}/verify`).set(auth).send(body);
    expect(ok1.status).toBe(200);
    expect(ok1.body.data.status).toBe('paid');
    const ok2 = await request(app).post(`/api/v1/orders/${order.id}/verify`).set(auth).send(body);
    expect(ok2.body.data.status).toBe('paid');

    const product = await models.Product.findById(book._id);
    expect(product.soldCount).toBe(2); // side effects ran once
    const coupon = await models.Coupon.findOne({ code: 'SAVE100' });
    expect(coupon.usedCount).toBe(1);
    expect((await models.User.findOne({ email: 'buyer@example.com' })).cart).toHaveLength(0);

    // Coupon per-user limit enforced on next checkout
    await request(app).post('/api/v1/cart/items').set(auth).send({ productId: String(cheap._id), quantity: 4 });
    const again = await checkout(token, { coupon: 'SAVE100' });
    expect(again.status).toBe(422);
  });

  it('prevents overselling', async () => {
    const a = await register('a1@example.com');
    const b = await register('b1@example.com');
    for (const u of [a, b]) {
      await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${u.token}`).send({ productId: String(book._id), quantity: 2 });
    }
    expect((await checkout(a.token)).status).toBe(201);
    const second = await checkout(b.token);
    expect(second.status).toBe(409);
    expect((await models.Product.findById(book._id)).stock).toBe(1);
  });

  it('processes signed webhooks once and rejects bad signatures', async () => {
    const { token } = await register('hook@example.com');
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${token}`).send({ productId: String(cheap._id), quantity: 1 });
    const { order, payment } = (await checkout(token)).body.data;
    const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh', order_id: payment.razorpayOrderId, method: 'upi' } } } });
    const sig = crypto.createHmac('sha256', 'test_webhook_secret').update(payload).digest('hex');

    const bad = await request(app).post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', 'nope').send(payload);
    expect(bad.status).toBe(400);

    for (let i = 0; i < 2; i += 1) {
      const res = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', sig)
        .set('x-razorpay-event-id', 'evt_1')
        .send(payload);
      expect(res.status).toBe(200);
    }
    const saved = await models.Order.findById(order.id);
    expect(saved.status).toBe('paid');
    expect(saved.payment.method).toBe('upi');
    expect((await models.Product.findById(cheap._id)).soldCount).toBe(1);
  });

  it('cancels a paid order with restock and refund, and releases expired reservations', async () => {
    const { token } = await register('cancel@example.com');
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/v1/cart/items').set(auth).send({ productId: String(book._id), quantity: 1 });
    const { order, payment } = (await checkout(token)).body.data;
    await request(app)
      .post(`/api/v1/orders/${order.id}/verify`)
      .set(auth)
      .send({ razorpay_order_id: payment.razorpayOrderId, razorpay_payment_id: 'pay_c', razorpay_signature: sign(payment.razorpayOrderId, 'pay_c') });
    const cancelled = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth).send({ reason: 'Changed my mind' });
    expect(cancelled.body.data.status).toBe('cancelled');
    expect(cancelled.body.data.payment.refundStatus).toBe('processed');
    expect((await models.Product.findById(book._id)).stock).toBe(3);

    // Expired reservation
    await request(app).post('/api/v1/cart/items').set(auth).send({ productId: String(book._id), quantity: 2 });
    const pending = (await checkout(token)).body.data.order;
    expect((await models.Product.findById(book._id)).stock).toBe(1);
    await models.Order.updateOne({ _id: pending.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const cron = await request(app).get('/api/v1/internal/cron/release-reservations').set('Authorization', 'Bearer test-cron-secret');
    expect(cron.body.data.released).toBe(1);
    expect((await models.Product.findById(book._id)).stock).toBe(3);
    expect((await request(app).get('/api/v1/internal/cron/release-reservations')).status).toBe(401);
  });

  it('does not let users read other users orders', async () => {
    const a = await register('owner@example.com');
    const b = await register('snoop@example.com');
    await request(app).post('/api/v1/cart/items').set('Authorization', `Bearer ${a.token}`).send({ productId: String(cheap._id), quantity: 1 });
    const { order } = (await checkout(a.token)).body.data;
    expect((await request(app).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${b.token}`)).status).toBe(404);
  });
});

describe('reviews', () => {
  it('creates/updates one review per user and recomputes ratings', async () => {
    const { token } = await register('critic@example.com');
    const auth = { Authorization: `Bearer ${token}` };
    let res = await request(app).post(`/api/v1/products/${book.slug}/reviews`).set(auth).send({ rating: 4, comment: 'Lovely' });
    expect(res.status).toBe(201);
    expect(res.body.data.verifiedPurchase).toBe(false);
    res = await request(app).post(`/api/v1/products/${book.slug}/reviews`).set(auth).send({ rating: 2 });
    const list = await request(app).get(`/api/v1/products/${book.slug}/reviews`);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data.summary).toMatchObject({ average: 2, count: 1 });
  });
});
