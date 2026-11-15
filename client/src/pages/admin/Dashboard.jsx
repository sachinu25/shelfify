import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, IndianRupee, Package, ShoppingCart, Users } from 'lucide-react';
import { api, unwrap } from '../../lib/api';
import { ORDER_STATUS_META, formatCompact, formatDate, formatPrice, genreLabel } from '../../lib/format';
import { useDocumentTitle } from '../../hooks';
import { ErrorState, Skeleton, cx } from '../../components/ui';
import { StatusBadge } from '../Orders';
import { AdminHeader } from './AdminLayout';

const ACCENT = '#6b1e2b';
const FOREST = '#24463a';
const GRID = '#ece4d6';
const AXIS = { fontSize: 11, fill: '#847b70' };

function Kpi({ icon: Icon, label, value, change, sub }) {
  const up = change > 0;
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-soft">{label}</p>
        <Icon className="size-4 text-muted" />
      </div>
      <p className="mt-3 font-display text-3xl tabular-nums">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted">
        {change != null && (
          <span className={cx('inline-flex items-center font-semibold', up ? 'text-success' : change < 0 ? 'text-danger' : 'text-muted')}>
            {up ? <ArrowUpRight className="size-3.5" /> : change < 0 ? <ArrowDownRight className="size-3.5" /> : null}
            {Math.abs(change)}%
          </span>
        )}
        {sub}
      </p>
    </div>
  );
}

function ChartTip({ active, payload, label, money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-card">
      <p className="text-muted">{label}</p>
      <p className="mt-0.5 font-semibold text-ink">{money ? formatPrice(payload[0].value) : `${payload[0].value} orders`}</p>
    </div>
  );
}

export default function Dashboard() {
  useDocumentTitle('Admin overview');
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['admin', 'analytics', days], queryFn: async () => unwrap(await api.get('/admin/analytics', { params: { days } })) });
  const d = q.data;
  const series = (d?.series || []).map((s) => ({ ...s, label: formatDate(s.date, { day: 'numeric', month: 'short' }) }));

  return (
    <div>
      <AdminHeader
        title="Overview"
        description="Sales, orders and inventory health at a glance."
        action={
          <div className="flex rounded-full border border-line bg-white p-1" role="tablist" aria-label="Date range">
            {[7, 30, 90, 365].map((n) => (
              <button
                key={n}
                role="tab"
                aria-selected={days === n}
                onClick={() => setDays(n)}
                className={cx('rounded-full px-3 py-1.5 text-xs font-semibold transition', days === n ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink')}
              >
                {n === 365 ? '1y' : `${n}d`}
              </button>
            ))}
          </div>
        }
      />

      {q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
          <Skeleton className="h-80 rounded-2xl sm:col-span-2 lg:col-span-4" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={IndianRupee} label="Revenue" value={formatPrice(d.kpis.revenue)} change={d.kpis.revenueChange} sub={`vs previous ${days}d`} />
            <Kpi icon={ShoppingCart} label="Paid orders" value={d.kpis.orders} change={d.kpis.ordersChange} sub={`${d.kpis.unitsSold} books sold`} />
            <Kpi icon={Package} label="Avg. order value" value={formatPrice(d.kpis.averageOrderValue)} sub="per paid order" />
            <Kpi icon={Users} label="Customers" value={d.kpis.customers} sub={`+${d.kpis.newCustomers} new in ${days}d`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-sans text-sm font-semibold">Revenue</h2>
              <p className="text-xs text-muted">Daily paid revenue (INR)</p>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `₹${formatCompact(v)}`} />
                    <Tooltip content={<ChartTip money />} cursor={{ stroke: '#cbbfae', strokeDasharray: '3 3' }} />
                    <Area type="monotone" dataKey="revenue" stroke={ACCENT} strokeWidth={2} fill="url(#rev)" activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-sans text-sm font-semibold">Orders per day</h2>
              <p className="text-xs text-muted">Paid orders</p>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: '#f4ede1' }} />
                    <Bar dataKey="orders" fill={FOREST} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-sans text-sm font-semibold">Top sellers</h2>
              {d.topProducts.length ? (
                <ol className="mt-4 space-y-3">
                  {d.topProducts.map((p, i) => (
                    <li key={p.id} className="flex items-center gap-3 text-sm">
                      <span className="w-5 font-display text-lg text-muted">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.title}</p>
                        <p className="truncate text-xs text-muted">{p.author}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{p.units} sold</p>
                        <p className="text-xs text-muted">{formatPrice(p.revenue)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 text-sm text-muted">No sales in this period yet.</p>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-sans text-sm font-semibold">Revenue by genre</h2>
              {d.genreSplit.length ? (
                <ul className="mt-4 space-y-3">
                  {d.genreSplit.map((g) => {
                    const max = d.genreSplit[0].revenue || 1;
                    return (
                      <li key={g.genre} className="text-sm" title={`${genreLabel(g.genre)}: ${formatPrice(g.revenue)}`}>
                        <div className="flex justify-between">
                          <span>{genreLabel(g.genre)}</span>
                          <span className="font-semibold tabular-nums">{formatPrice(g.revenue)}</span>
                        </div>
                        <div className="mt-1.5 h-2 rounded-full bg-cream">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${(g.revenue / max) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted">No sales in this period yet.</p>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-sans text-sm font-semibold">Low stock</h2>
                <Link to="/admin/inventory?lowStock=true" className="text-xs font-semibold text-accent hover:underline">
                  Manage
                </Link>
              </div>
              <p className="mt-1 text-xs text-muted">
                {d.inventory.units} units across {d.inventory.titles} titles · {formatPrice(d.inventory.value)} stock value
              </p>
              {d.lowStock.length ? (
                <ul className="mt-4 space-y-2.5">
                  {d.lowStock.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-sm">
                      <AlertTriangle className={cx('size-4 shrink-0', p.stock === 0 ? 'text-danger' : 'text-warning')} />
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      <span className={cx('font-semibold tabular-nums', p.stock === 0 ? 'text-danger' : 'text-warning')}>{p.stock === 0 ? 'Out' : `${p.stock} left`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-success">All titles are well stocked.</p>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-sans text-sm font-semibold">Orders by status</h2>
              <p className="text-xs text-muted">Created in the last {days} days</p>
              <ul className="mt-4 space-y-2 text-sm">
                {d.statusBreakdown.length ? (
                  d.statusBreakdown
                    .sort((a, b) => b.count - a.count)
                    .map((s) => (
                      <li key={s.status} className="flex items-center justify-between">
                        <span>{ORDER_STATUS_META[s.status]?.label || s.status}</span>
                        <span className="font-semibold tabular-nums">{s.count}</span>
                      </li>
                    ))
                ) : (
                  <li className="text-muted">No orders yet.</li>
                )}
              </ul>
            </section>
            <section className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-sans text-sm font-semibold">Recent orders</h2>
                <Link to="/admin/orders" className="text-xs font-semibold text-accent hover:underline">
                  View all
                </Link>
              </div>
              {d.recentOrders.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {d.recentOrders.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                      <span className="font-mono text-xs">{o.orderNumber}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-soft">{o.customer?.name}</span>
                      <StatusBadge status={o.status} />
                      <span className="w-20 text-right font-semibold tabular-nums">{formatPrice(o.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted">No orders yet.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
