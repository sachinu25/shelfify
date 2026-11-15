import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, unwrap, unwrapPage } from '../../lib/api';
import { ORDER_STATUS_META, formatDateTime, formatPrice } from '../../lib/format';
import { useDebounce, useDocumentTitle } from '../../hooks';
import { useToast } from '../../context/ToastContext';
import { Button, ErrorState, Field, Modal, Pagination, Skeleton } from '../../components/ui';
import { StatusBadge } from '../Orders';
import { AdminHeader, Table } from './AdminLayout';

// Mirrors the server's STATUS_TRANSITIONS (server is the source of truth and re-validates).
const NEXT = {
  paid: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['refunded'],
  pending_payment: ['cancelled'],
  payment_failed: ['cancelled'],
};

function OrderPanel({ order, onUpdated }) {
  const toast = useToast();
  const options = NEXT[order.status] || [];
  const [status, setStatus] = useState(options[0] || '');
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState({ carrier: order.tracking?.carrier || '', number: order.tracking?.number || '', url: order.tracking?.url || '' });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { status, note: note || undefined };
      if (['shipped', 'out_for_delivery'].includes(status) && tracking.number) body.tracking = tracking;
      const updated = unwrap(await api.patch(`/admin/orders/${order.id}/status`, body));
      toast.success(`Order ${updated.orderNumber} → ${ORDER_STATUS_META[updated.status].label}`);
      onUpdated(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const a = order.shippingAddress;
  return (
    <div className="space-y-6 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-1">Customer</p>
          <p className="font-semibold">{order.customer?.name}</p>
          <p className="text-muted">{order.customer?.email}</p>
        </div>
        <div>
          <p className="eyebrow mb-1">Ship to</p>
          <p>
            {a.fullName}, {a.phone}
            <br />
            {a.line1}
            {a.line2 && `, ${a.line2}`}, {a.city}, {a.state} – {a.postalCode}
          </p>
        </div>
      </div>
      <div>
        <p className="eyebrow mb-2">Items</p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {order.items.map((i) => (
            <li key={i.product} className="flex justify-between gap-3 px-3 py-2">
              <span>
                {i.title} <span className="text-muted">× {i.quantity}</span>
              </span>
              <span className="tabular-nums">{formatPrice(i.price * i.quantity)}</span>
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 font-semibold">
            <span>Total{order.coupon && ` (coupon ${order.coupon.code})`}</span>
            <span>{formatPrice(order.pricing.total)}</span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted">
          Payment: {order.payment.paymentId || 'not captured'}
          {order.payment.refundStatus && ` · refund ${order.payment.refundStatus}`}
        </p>
      </div>
      <div>
        <p className="eyebrow mb-2">History</p>
        <ol className="space-y-1.5">
          {order.statusHistory.map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-36 shrink-0 text-muted">{formatDateTime(h.at)}</span>
              <span>
                <b>{ORDER_STATUS_META[h.status]?.label}</b> <span className="text-muted">({h.by})</span>
                {h.note && ` — ${h.note}`}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {options.length > 0 ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl bg-cream/60 p-4">
          <p className="font-semibold">Update status</p>
          <Field as="select" label="Move to" value={status} onChange={(e) => setStatus(e.target.value)}>
            {options.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_META[s].label}
              </option>
            ))}
          </Field>
          {['shipped', 'out_for_delivery'].includes(status) && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Carrier" value={tracking.carrier} onChange={(e) => setTracking({ ...tracking, carrier: e.target.value })} placeholder="Delhivery" />
              <Field label="Tracking no." value={tracking.number} onChange={(e) => setTracking({ ...tracking, number: e.target.value })} />
              <Field label="Tracking URL" value={tracking.url} onChange={(e) => setTracking({ ...tracking, url: e.target.value })} placeholder="https://" />
            </div>
          )}
          <Field label="Note (optional, visible to customer)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          {status === 'cancelled' && ['paid', 'processing'].includes(order.status) && (
            <p className="text-xs text-danger">Cancelling restocks the items and refunds {formatPrice(order.pricing.total)} via Razorpay.</p>
          )}
          <Button type="submit" loading={saving} variant={status === 'cancelled' ? 'danger' : 'primary'}>
            Update order
          </Button>
        </form>
      ) : (
        <p className="rounded-xl bg-cream px-4 py-3 text-muted">No further actions for this order.</p>
      )}
    </div>
  );
}

export default function AdminOrders() {
  useDocumentTitle('Orders');
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const term = useDebounce(q, 300);

  const list = useQuery({
    queryKey: ['admin', 'orders', term, status, page],
    queryFn: async () => unwrapPage(await api.get('/admin/orders', { params: { q: term || undefined, status: status || undefined, page, limit: 15 } })),
    placeholderData: keepPreviousData,
  });

  return (
    <div>
      <AdminHeader title="Orders" description="Fulfil, ship and track customer orders." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className="field h-10 pl-9" placeholder="Order number, customer name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search orders" />
        </div>
        <select className="field h-10 w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUS_META).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Table head={['Order', 'Customer', 'Placed', 'Items', 'Total', 'Status', '']} empty={!list.data.items.length && <p className="p-8 text-center text-sm text-muted">No orders found.</p>}>
          {list.data.items.map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-paper/60" onClick={() => setSelected(o)}>
              <td className="px-4 py-3 font-mono text-xs">{o.orderNumber}</td>
              <td className="px-4 py-3">
                <p className="font-medium">{o.customer?.name}</p>
                <p className="text-xs text-muted">{o.customer?.email}</p>
              </td>
              <td className="px-4 py-3 text-ink-soft">{formatDateTime(o.createdAt)}</td>
              <td className="px-4 py-3 tabular-nums">{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
              <td className="px-4 py-3 font-semibold tabular-nums">{formatPrice(o.pricing.total)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={o.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(o); }}>
                  Manage
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination meta={list.data?.meta} onChange={setPage} />
      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? `Order ${selected.orderNumber}` : ''} size="max-w-2xl">
        {selected && (
          <OrderPanel
            key={selected.id + selected.status}
            order={selected}
            onUpdated={(o) => {
              setSelected(o);
              queryClient.invalidateQueries({ queryKey: ['admin'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
