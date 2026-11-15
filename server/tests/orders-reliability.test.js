/**
 * Regression tests for audit fixes M1 (transactions), M2 (coupon reservation),
 * H3 (reliable fulfilment + retries) and H2 (email reliability).
 * Runs on a real single-node replica set so MongoDB transactions execute.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { addToCart, bearer, checkout, register, signWebhook, startStack, verify } from './helpers.js';

const rzp = vi.hoisted(() => ({ orderSeq: 0, refunds: [], failRefunds: 0 }));
vi.mock('razorpay', () => ({
  default: class Razorpay {
    constructor() {
      this.orders = { create: async ({ amount }) => ({ id: `order_rel_${++rzp.orderSeq}`, amount, currency: 'INR' }) };
      this.payments = {
        refund: async (paymentId, opts) => {
          if (rzp.failRefunds > 0) {
            rzp.failRefunds -= 1;
            throw new Error('gateway timeout');
          }
          rzp.refunds.push({ paymentId, ...opts });
          return { id: `rfnd_${paymentId}`, status: 'processed' };
        },
      };
    }
  },
}));

let stack;
let app;
let M;
let book;
const CRON = { Authorization: 'Bearer test-cron-secret' };

beforeAll(async () => {
  stack = await startStack({ replSet: true });
  ({ app, models: M } = stack);
});
afterAll(() => stack?.stop());

beforeEach(async () => {
  await stack.reset();
  vi.restoreAllMocks();
  rzp.failRefunds = 0;
  book = await M.Product.create({ title: 'Ledger of Tides', slug: 'ledger-of-tides', author: 'K. Iyer', genre: 'fiction', price: 400, mrp: 500, stock: 3 });
});

const stockOf = async (id = book._id) => (await M.Product.findById(id)).stock;

describe('M1: transactional checkout', () => {
  it('uses real MongoDB transactions on a replica set', async () => {
    const u = await register(app);
    await addToCart(app, u.token, book._id, 1);
    expect((await checkout(app, u.token)).status).toBe(201);
    const { transactionsSupported } = await import('../src/lib/tx.js');
    expect(transactionsSupported()).toBe(true);
  });

  it('never oversells under concurrent checkouts (5 buyers, 3 copies)', async () => {
    const buyers = await Promise.all(Array.from({ length: 5 }, () => register(app)));
    for (const b of buyers) await addToCart(app, b.token, book._id, 1);
    const results = await Promise.all(buyers.map((b) => checkout(app, b.token)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    expect(await stockOf()).toBe(0);
    expect(await M.Order.countDocuments({ status: 'pending_payment' })).toBe(3);
  });

  it('rolls back the stock reservation and coupon hold when order creation fails', async () => {
    await M.Coupon.create({ code: 'ROLLBACK', type: 'flat', value: 50, usageLimit: 5 });
    const u = await register(app);
    await addToCart(app, u.token, book._id, 2);
    vi.spyOn(M.Order, 'create').mockRejectedValueOnce(new Error('simulated crash after reserving stock'));
    const res = await checkout(app, u.token, { coupon: 'ROLLBACK' });
    expect(res.status).toBe(500);
    expect(await stockOf()).toBe(3); // reservation rolled back by the transaction
    expect((await M.Coupon.findOne({ code: 'ROLLBACK' })).reservedCount).toBe(0);
    expect(await M.Order.countDocuments()).toBe(0);
    // and the next attempt works normally
    expect((await checkout(app, u.token, { coupon: 'ROLLBACK' })).status).toBe(201);
    expect(await stockOf()).toBe(1);
  });

  it('stays consistent even when compensating writes are impossible (hard crash) - only a transaction can do this', async () => {
    const u = await register(app);
    await addToCart(app, u.token, book._id, 2);
    vi.spyOn(M.Order, 'create').mockRejectedValueOnce(new Error('process died'));
    vi.spyOn(M.Product, 'bulkWrite').mockRejectedValue(new Error('no writes possible after the crash'));
    expect((await checkout(app, u.token)).status).toBe(500);
    expect(await stockOf()).toBe(3); // nothing leaked: the reservation was never committed
  });

  it('releases stock and coupon hold atomically when the gateway is down', async () => {
    await M.Coupon.create({ code: 'GW', type: 'flat', value: 50, usageLimit: 1 });
    const u = await register(app);
    await addToCart(app, u.token, book._id, 1);
    const { getRazorpay } = await import('../src/lib/razorpay.js');
    vi.spyOn(getRazorpay().orders, 'create').mockRejectedValueOnce(new Error('gateway down'));
    const res = await checkout(app, u.token, { coupon: 'GW' });
    expect(res.status).toBe(502);
    expect(await stockOf()).toBe(3);
    expect((await M.Coupon.findOne({ code: 'GW' })).reservedCount).toBe(0);
    expect((await M.Order.findOne()).status).toBe('cancelled');
  });
});

describe('M2: coupon reservation', () => {
  it('global limit holds under concurrency (limit 1, three buyers at once)', async () => {
    await M.Coupon.create({ code: 'ONLYONE', type: 'flat', value: 100, usageLimit: 1, perUserLimit: 1 });
    const buyers = await Promise.all([1, 2, 3].map(() => register(app)));
    for (const b of buyers) await addToCart(app, b.token, book._id, 1);
    const results = await Promise.all(buyers.map((b) => checkout(app, b.token, { coupon: 'ONLYONE' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 422).every((r) => r.body.error.code === 'COUPON_EXHAUSTED')).toBe(true);
    expect((await M.Coupon.findOne({ code: 'ONLYONE' })).reservedCount).toBe(1);
    expect(await stockOf()).toBe(2); // losers' stock reservations were rolled back
  });

  it('per-user limit holds when one user opens two checkouts at once', async () => {
    await M.Coupon.create({ code: 'ONCEEACH', type: 'flat', value: 50, perUserLimit: 1 });
    const u = await register(app);
    await addToCart(app, u.token, book._id, 1);
    const [a, b] = await Promise.all([
      checkout(app, u.token, { coupon: 'ONCEEACH', key: 'tab-a-key-0001' }),
      checkout(app, u.token, { coupon: 'ONCEEACH', key: 'tab-b-key-0002' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect((await M.Coupon.findOne({ code: 'ONCEEACH' })).reservedCount).toBe(1);
  });

  it('a held use is released when the unpaid order expires, then reusable', async () => {
    await M.Coupon.create({ code: 'HOLD1', type: 'flat', value: 50, usageLimit: 1 });
    const a = await register(app);
    const b = await register(app);
    await addToCart(app, a.token, book._id, 1);
    await addToCart(app, b.token, book._id, 1);
    const first = await checkout(app, a.token, { coupon: 'HOLD1' });
    expect(first.status).toBe(201);
    expect((await checkout(app, b.token, { coupon: 'HOLD1' })).status).toBe(422); // held by a's unpaid order
    await M.Order.updateOne({ _id: first.body.data.order.id }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    const sweep = await request(app).get('/api/v1/internal/cron/maintenance').set(CRON);
    expect(sweep.body.data.released).toBe(1);
    expect((await M.Coupon.findOne({ code: 'HOLD1' })).reservedCount).toBe(0);
    expect((await checkout(app, b.token, { coupon: 'HOLD1' })).status).toBe(201);
  });

  it('a held use converts to a real use on payment and is released on unpaid cancellation', async () => {
    await M.Coupon.create({ code: 'CONVERT', type: 'flat', value: 50, usageLimit: 5, perUserLimit: 5 });
    const u = await register(app);
    await addToCart(app, u.token, book._id, 1);
    const paid = (await checkout(app, u.token, { coupon: 'CONVERT' })).body.data;
    expect((await verify(app, u.token, paid.order.id, paid.payment.razorpayOrderId, 'pay_conv')).status).toBe(200);
    let c = await M.Coupon.findOne({ code: 'CONVERT' });
    expect([c.usedCount, c.reservedCount, c.usedBy[0].count]).toEqual([1, 0, 1]);

    await addToCart(app, u.token, book._id, 1);
    const unpaid = (await checkout(app, u.token, { coupon: 'CONVERT' })).body.data;
    expect((await M.Coupon.findOne({ code: 'CONVERT' })).reservedCount).toBe(1);
    await request(app).post(`/api/v1/orders/${unpaid.order.id}/cancel`).set(bearer(u.token)).send({});
    c = await M.Coupon.findOne({ code: 'CONVERT' });
    expect([c.usedCount, c.reservedCount]).toEqual([1, 0]);
  });
});

describe('H3: reliable fulfilment and retries', () => {
  async function paidOrderSetup({ coupon } = {}) {
    if (coupon) await M.Coupon.create({ code: coupon, type: 'flat', value: 50, usageLimit: 10, perUserLimit: 10 });
    const u = await register(app);
    await addToCart(app, u.token, book._id, 2);
    const { order, payment } = (await checkout(app, u.token, { coupon })).body.data;
    return { u, order, payment };
  }

  it('a crash during fulfilment rolls back fully and the next verify completes it exactly once', async () => {
    const { u, order, payment } = await paidOrderSetup({ coupon: 'CRASH' });
    const spy = vi.spyOn(M.Product, 'bulkWrite').mockRejectedValueOnce(new Error('process died mid-fulfilment'));
    const crashed = await verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_crash');
    expect(crashed.status).toBe(500);
    spy.mockRestore();

    let saved = await M.Order.findById(order.id);
    expect(saved.status).toBe('paid'); // payment is recorded...
    expect(saved.fulfilledAt).toBeNull(); // ...but nothing half-applied
    expect((await M.Product.findById(book._id)).soldCount).toBe(0);
    expect((await M.User.findById(u.user.id)).cart).toHaveLength(1);
    expect((await M.Coupon.findOne({ code: 'CRASH' })).usedCount).toBe(0);

    // Client retries verification (e.g. page reload) -> fulfilment completes
    expect((await verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_crash')).status).toBe(200);
    // ...and further replays never double count
    await verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_crash');
    saved = await M.Order.findById(order.id);
    expect(saved.fulfilledAt).toBeInstanceOf(Date);
    expect((await M.Product.findById(book._id)).soldCount).toBe(2);
    expect((await M.User.findById(u.user.id)).cart).toHaveLength(0);
    const c = await M.Coupon.findOne({ code: 'CRASH' });
    expect([c.usedCount, c.reservedCount]).toEqual([1, 0]);
  });

  it('the maintenance job completes fulfilment nobody retried', async () => {
    const { u, order, payment } = await paidOrderSetup();
    vi.spyOn(M.User, 'updateOne').mockRejectedValueOnce(new Error('crash'));
    expect((await verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_m')).status).toBe(500);
    vi.restoreAllMocks();
    const sweep = await request(app).get('/api/v1/internal/cron/maintenance').set(CRON);
    expect(sweep.status).toBe(200);
    expect(sweep.body.data.fulfilled).toBe(1);
    expect((await M.Product.findById(book._id)).soldCount).toBe(2);
    expect((await request(app).get('/api/v1/internal/cron/maintenance').set(CRON)).body.data.fulfilled).toBe(0);
  });

  it('verify + webhook racing each other fulfil exactly once', async () => {
    const { u, order, payment } = await paidOrderSetup();
    const payload = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_race', order_id: payment.razorpayOrderId, method: 'card' } } } });
    await Promise.all([
      verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_race'),
      request(app).post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signWebhook(payload)).set('x-razorpay-event-id', 'evt_race').send(payload),
      verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_race'),
    ]);
    expect((await M.Product.findById(book._id)).soldCount).toBe(2);
    const { sentEmails } = await import('../src/lib/email.js');
    expect(sentEmails.filter((e) => e.subject.includes(order.orderNumber))).toHaveLength(1);
  });

  it('a failed confirmation email is retried by maintenance', async () => {
    const { u, order, payment } = await paidOrderSetup();
    const email = await import('../src/lib/email.js');
    email.__setEmailTransportForTests({ sendMail: async () => Promise.reject(new Error('SMTP down')) });
    expect((await verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_mail')).status).toBe(200);
    let saved = await M.Order.findById(order.id);
    expect([saved.emailSent, saved.emailAttempts]).toEqual([false, 1]);
    email.__setEmailTransportForTests(null); // SMTP recovers
    const sweep = await request(app).get('/api/v1/internal/cron/maintenance').set(CRON);
    expect(sweep.body.data.emailsSent).toBe(1);
    saved = await M.Order.findById(order.id);
    expect([saved.emailSent, saved.emailAttempts]).toEqual([true, 2]);
  });

  it('a failed refund is retried by maintenance', async () => {
    const { u, order, payment } = await paidOrderSetup();
    await verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_refund');
    rzp.failRefunds = 1;
    const cancelled = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(u.token)).send({});
    expect(cancelled.body.data.payment.refundStatus).toBe('failed');
    expect(await stockOf()).toBe(3);
    expect((await M.Product.findById(book._id)).soldCount).toBe(0);
    const sweep = await request(app).get('/api/v1/internal/cron/maintenance').set(CRON);
    expect(sweep.body.data.refundsRetried).toBe(1);
    expect((await M.Order.findById(order.id)).payment.refundStatus).toBe('processed');
    expect(rzp.refunds.filter((r) => r.paymentId === 'pay_refund')).toHaveLength(1);
  });

  it('H2: transactional emails are complete before the response returns', async () => {
    const { sentEmails } = await import('../src/lib/email.js');
    const before = sentEmails.length;
    const u = await register(app, { email: 'welcome-check@example.com' });
    expect(sentEmails.slice(before).some((e) => e.to === 'welcome-check@example.com' && /Welcome/.test(e.subject))).toBe(true);
    await addToCart(app, u.token, book._id, 1);
    const { order, payment } = (await checkout(app, u.token)).body.data;
    await verify(app, u.token, order.id, payment.razorpayOrderId, 'pay_h2');
    const n = sentEmails.length;
    await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(bearer(u.token)).send({});
    expect(sentEmails.length).toBe(n + 1); // cancellation email sent before the response
  });
});
