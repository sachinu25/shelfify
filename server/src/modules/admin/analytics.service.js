import { Order } from '../../models/Order.js';
import { User } from '../../models/User.js';
import { Product } from '../../models/Product.js';
import { cached } from '../../lib/cache.js';
import { roundMoney } from '../../lib/utils.js';

const REVENUE_STATES = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
const TZ = 'Asia/Kolkata';

function dayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function getAnalytics(days = 30) {
  return cached('analytics', `overview:${days}`, 60, async () => {
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prevSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);
    const paidInRange = (from, to) => ({ status: { $in: REVENUE_STATES }, 'payment.paidAt': { $gte: from, $lt: to } });

    const [current, previous, daily, statusBreakdown, topProducts, genreSplit, customers, newCustomers, lowStock, recentOrders, inventory] =
      await Promise.all([
        Order.aggregate([
          { $match: paidInRange(since, now) },
          { $group: { _id: null, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 }, units: { $sum: { $sum: '$items.quantity' } } } },
        ]),
        Order.aggregate([
          { $match: paidInRange(prevSince, since) },
          { $group: { _id: null, revenue: { $sum: '$pricing.total' }, orders: { $sum: 1 } } },
        ]),
        Order.aggregate([
          { $match: paidInRange(since, now) },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$payment.paidAt', timezone: TZ } },
              revenue: { $sum: '$pricing.total' },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        Order.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        Order.aggregate([
          { $match: paidInRange(since, now) },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.product',
              title: { $first: '$items.title' },
              author: { $first: '$items.author' },
              units: { $sum: '$items.quantity' },
              revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            },
          },
          { $sort: { units: -1, revenue: -1 } },
          { $limit: 5 },
        ]),
        Order.aggregate([
          { $match: paidInRange(since, now) },
          { $unwind: '$items' },
          { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p', pipeline: [{ $project: { genre: 1 } }] } },
          { $unwind: { path: '$p', preserveNullAndEmptyArrays: true } },
          { $group: { _id: { $ifNull: ['$p.genre', 'other'] }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
          { $sort: { revenue: -1 } },
        ]),
        User.countDocuments({ role: 'customer' }),
        User.countDocuments({ role: 'customer', createdAt: { $gte: since } }),
        Product.find({ isActive: true, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }, 'title author stock lowStockThreshold slug')
          .sort({ stock: 1 })
          .limit(8)
          .lean(),
        Order.find({ status: { $ne: 'pending_payment' } }, 'orderNumber status pricing.total createdAt user')
          .populate('user', 'name email')
          .sort({ createdAt: -1 })
          .limit(6)
          .lean(),
        Product.aggregate([
          { $match: { isActive: true } },
          {
            $group: {
              _id: null,
              titles: { $sum: 1 },
              units: { $sum: '$stock' },
              value: { $sum: { $multiply: ['$stock', '$price'] } },
              outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
            },
          },
        ]),
      ]);

    // Fill gaps so charts show a continuous timeline.
    const byDay = new Map(daily.map((d) => [d._id, d]));
    const series = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
      const row = byDay.get(key);
      series.push({ date: key, revenue: roundMoney(row?.revenue || 0), orders: row?.orders || 0 });
    }

    const cur = current[0] || { revenue: 0, orders: 0, units: 0 };
    const prev = previous[0] || { revenue: 0, orders: 0 };
    const change = (a, b) => (b ? roundMoney(((a - b) / b) * 100) : null);

    return {
      rangeDays: days,
      kpis: {
        revenue: roundMoney(cur.revenue),
        revenueChange: change(cur.revenue, prev.revenue),
        orders: cur.orders,
        ordersChange: change(cur.orders, prev.orders),
        averageOrderValue: cur.orders ? roundMoney(cur.revenue / cur.orders) : 0,
        unitsSold: cur.units,
        customers,
        newCustomers,
      },
      series,
      statusBreakdown: statusBreakdown.map((s) => ({ status: s._id, count: s.count })),
      topProducts: topProducts.map((p) => ({ id: String(p._id), title: p.title, author: p.author, units: p.units, revenue: roundMoney(p.revenue) })),
      genreSplit: genreSplit.map((g) => ({ genre: g._id, revenue: roundMoney(g.revenue) })),
      inventory: inventory[0] ? { titles: inventory[0].titles, units: inventory[0].units, value: roundMoney(inventory[0].value), outOfStock: inventory[0].outOfStock } : { titles: 0, units: 0, value: 0, outOfStock: 0 },
      lowStock: lowStock.map((p) => ({ id: String(p._id), title: p.title, author: p.author, stock: p.stock, threshold: p.lowStockThreshold, slug: p.slug })),
      recentOrders: recentOrders.map((o) => ({
        id: String(o._id),
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.pricing.total,
        createdAt: o.createdAt,
        customer: o.user ? { name: o.user.name, email: o.user.email } : null,
      })),
    };
  });
}
