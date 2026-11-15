import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, Package } from 'lucide-react';
import { api, unwrapPage } from '../lib/api';
import { ORDER_STATUS_META, formatDate, formatPrice } from '../lib/format';
import { useDocumentTitle } from '../hooks';
import { Badge, Button, EmptyState, ErrorState, Pagination, Skeleton, cx } from '../components/ui';
import { BookCover } from '../components/product/BookCover';

const FILTERS = [
  ['', 'All'],
  ['pending_payment', 'Awaiting payment'],
  ['paid', 'Confirmed'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
];

export function StatusBadge({ status }) {
  const m = ORDER_STATUS_META[status] || { label: status, tone: 'bg-cream text-ink-soft' };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export default function Orders() {
  useDocumentTitle('Your orders');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const orders = useQuery({
    queryKey: ['orders', page, status],
    queryFn: async () => unwrapPage(await api.get('/orders', { params: { page, limit: 8, ...(status ? { status } : {}) } })),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="container-page max-w-5xl py-10 lg:py-14">
      <p className="eyebrow">Account</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">Your orders</h1>

      <div className="scroll-rail -mx-4 mt-8 flex gap-2 overflow-x-auto px-4 pb-2">
        {FILTERS.map(([v, l]) => (
          <button
            key={l}
            onClick={() => {
              setStatus(v);
              setPage(1);
            }}
            className={cx('shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition', status === v ? 'border-ink bg-ink text-paper' : 'border-line bg-white hover:border-ink/30')}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {orders.isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36 rounded-3xl" />
            ))}
          </div>
        ) : orders.isError ? (
          <ErrorState error={orders.error} onRetry={orders.refetch} />
        ) : !orders.data.items.length ? (
          <EmptyState
            icon={Package}
            title={status ? 'No orders with this status' : 'No orders yet'}
            description={status ? 'Try a different filter.' : 'When you buy a book, you’ll be able to track it here.'}
            action={!status && <Button as="link" to="/shop">Find your next read</Button>}
          />
        ) : (
          <ul className={cx('space-y-4 transition-opacity', orders.isFetching && 'opacity-60')}>
            {orders.data.items.map((o) => (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className="group block rounded-3xl border border-line bg-white/70 p-5 transition hover:border-ink/25 hover:shadow-card sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted">Order {o.orderNumber}</p>
                      <p className="text-sm text-ink-soft">Placed {formatDate(o.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={o.status} />
                      <span className="font-semibold">{formatPrice(o.pricing.total)}</span>
                      <ChevronRight className="size-4 text-muted transition group-hover:translate-x-1" />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    {o.items.slice(0, 5).map((i) => (
                      <BookCover key={i.product} book={i} sizes="sm" className="w-11" />
                    ))}
                    {o.items.length > 5 && <span className="text-sm text-muted">+{o.items.length - 5}</span>}
                    <p className="ml-2 hidden truncate text-sm text-ink-soft sm:block">
                      {o.items.map((i) => i.title).join(', ')}
                    </p>
                  </div>
                  {o.canPay && <p className="mt-3 text-sm font-semibold text-warning">Payment pending — tap to complete</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={orders.data?.meta} onChange={setPage} />
      </div>
    </div>
  );
}
