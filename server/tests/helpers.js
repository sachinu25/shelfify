import crypto from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';

export const ADDRESS = { fullName: 'Asha Rao', phone: '9876543210', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' };

/** Payment signature exactly as Razorpay computes it (uses the test key secret from vitest.config.js). */
export const signPayment = (orderId, paymentId) =>
  crypto.createHmac('sha256', 'test_key_secret').update(`${orderId}|${paymentId}`).digest('hex');

export const signWebhook = (payload) => crypto.createHmac('sha256', 'test_webhook_secret').update(payload).digest('hex');

/**
 * Boots MongoDB (a single-node replica set by default, so transactions are real),
 * connects the app and returns handles. Call `stop()` in afterAll.
 */
export async function startStack({ replSet = true } = {}) {
  const { MongoMemoryReplSet, MongoMemoryServer } = await import('mongodb-memory-server');
  const mongo = replSet
    ? await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
    : await MongoMemoryServer.create();
  const { connectDB, disconnectDB } = await import('../src/config/db.js');
  await connectDB(mongo.getUri('shelfify-test'));
  const { createApp } = await import('../src/app.js');
  const models = {
    Product: (await import('../src/models/Product.js')).Product,
    User: (await import('../src/models/User.js')).User,
    Order: (await import('../src/models/Order.js')).Order,
    Coupon: (await import('../src/models/Coupon.js')).Coupon,
    RefreshToken: (await import('../src/models/RefreshToken.js')).RefreshToken,
  };
  await Promise.all(Object.values(models).map((m) => m.init()));
  const { clearMemoryCache } = await import('../src/lib/cache.js');
  return {
    app: createApp(),
    mongo,
    models,
    uri: mongo.getUri('shelfify-test'),
    async reset() {
      await Promise.all(Object.values(models).map((m) => m.deleteMany({})));
      clearMemoryCache();
    },
    async stop() {
      await disconnectDB();
      await mongo.stop();
    },
  };
}

let seq = 0;
export async function register(app, { email, name = 'Test Reader', password = 'Passw0rd!' } = {}) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register').send({ name, email: email || `user${Date.now()}${++seq}@example.com`, password });
  expect(res.status).toBe(201);
  return { agent, token: res.body.data.accessToken, user: res.body.data.user, cookie: res.headers['set-cookie'][0].split(';')[0] };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

export async function addToCart(app, token, productId, quantity = 1) {
  const res = await request(app).post('/api/v1/cart/items').set(bearer(token)).send({ productId: String(productId), quantity });
  expect(res.status).toBe(201);
  return res;
}

export function checkout(app, token, { coupon, key } = {}) {
  const req = request(app).post('/api/v1/orders/checkout').set(bearer(token));
  if (key) req.set('Idempotency-Key', key);
  return req.send({ address: ADDRESS, coupon });
}

export function verify(app, token, orderId, razorpayOrderId, paymentId) {
  return request(app)
    .post(`/api/v1/orders/${orderId}/verify`)
    .set(bearer(token))
    .send({ razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signPayment(razorpayOrderId, paymentId) });
}
