import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, CreditCard, PackageX, PartyPopper, Truck } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { ORDER_STATUS_META, TRACKING_STEPS, formatDate, formatDateTime, formatPrice } from '../lib/format';
import { loadRazorpay, openRazorpayCheckout } from '../lib/razorpay';
import { useDocumentTitle } from '../hooks';
import { useToast } from '../context/ToastContext';
import { useCart } from '../context/CartContext';
import { Button, ConfirmModal, EmptyState, ErrorState, PageLoader, cx } from '../components/ui';
import { BookCover } from '../components/product/BookCover';
import { StatusBadge } from './Orders';

function Timeline({ order }) {
  const terminal = ['cancelled', 'expired', 'refunded', 'payment_failed', 'pending_payment'].includes(order.status);
  if (terminal) {
    return (
      <ol className="space-y-4">
        {order.statusHistory.map((h, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent" />
            <div>
              <p className="font-semibold">{ORDER_STATUS_META[h.status]?.label || h.status}</p>
              <p className="text-sm text-muted">
                {formatDateTime(h.at)}
                {h.note && ` · ${h.note}`}
              </p>
            </div>
          </li>
        ))}
      </ol>
    );
  }
  const current = TRACKING_STEPS.indexOf(order.status);
  const at = (s) => order.statusHistory.find((h) => h.status === s)?.at;
  return (
    <ol className="relative grid gap-6 sm:grid-cols-5 sm:gap-2">
      {TRACKING_STEPS.map((s, i) => {
        const done = i <= current;
        return (
          <li key={s} className="relative flex items-start gap-3 sm:flex-col sm:items-center sm:text-center">
            {i < TRACKING_STEPS.length - 1 && (
              <span className={cx('absolute left-[15px] top-8 h-[calc(100%+8px)] w-0.5 sm:left-1/2 sm:top-[15px] sm:h-0.5 sm:w-full', i < current ? 'bg-forest' : 'bg-line')} />
            )}
            <motion.span
              initial={{ scale: 0.6 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.08 }}
              className={cx('relative z-10 grid size-8 shrink-0 place-items-center rounded-full border-2', done ? 'border-forest bg-forest text-white' : 'border-line bg-paper text-muted')}
            >
              {done ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-line" />}
            </motion.span>
            <div className="sm:mt-2">
              <p className={cx('text-sm font-semibold', done ? 'text-ink' : 'text-muted')}>{ORDER_STATUS_META[s].label}</p>
              {at(s) && <p className="text-xs text-muted">{formatDate(at(s), { day: 'numeric', month: 'short' })}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh: refreshCart } = useCart();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const order = useQuery({ queryKey: ['orders', 'detail', id], queryFn: async () => unwrap(await api.get(`/orders/${id}`)) });
  useDocumentTitle(order.data ? `Order ${order.data.orderNumber}` : 'Order');

  const update = (data) => {
    queryClient.setQueryData(['orders', 'detail', id], data);
    queryClient.invalidateQueries({ queryKey: ['orders'], refetchType: 'none' });
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const data = unwrap(await api.post(`/orders/${id}/cancel`, { reason: 'Cancelled by customer' }));
      update(data);
      toast.success(data.payment.refundStatus ? 'Order cancelled. Your refund has been initiated.' : 'Order cancelled.');
      setConfirmCancel(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    setBusy(true);
    try {
      const sdk = loadRazorpay();
      const { payment } = unwrap(await api.post(`/orders/${id}/pay`));
      if (!(await sdk)) throw new Error('Could not load the payment window.');
      const response = await openRazorpayCheckout(payment);
      update(unwrap(await api.post(`/orders/${id}/verify`, response)));
      refreshCart();
      toast.success('Payment received — your order is confirmed!');
    } catch (err) {
      if (err?.dismissed) toast.info('Payment window closed.');
      else if (err?.failed) toast.error(err.reason || 'Payment failed. Please try again.');
      else {
        toast.error(err.message);
        order.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  if (order.isLoading) return <PageLoader />;
  if (order.isError) {
    return (
      <div className="container-page py-16">
        {order.error.status === 404 ? (
          <EmptyState icon={PackageX} title="Order not found" description="We couldn’t find this order in your account." action={<Button as="link" to="/orders">Back to orders</Button>} />
        ) : (
          <ErrorState error={order.error} onRetry={order.refetch} />
        )}
      </div>
    );
  }

  const o = order.data;
  const justPlaced = params.get('placed') === '1' && o.status === 'paid';
  const a = o.shippingAddress;

  return (
    <div className="container-page max-w-5xl py-10 lg:py-14">
      <Link to="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" /> All orders
      </Link>

      {justPlaced && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex items-start gap-4 rounded-3xl bg-forest p-6 text-paper">
          <PartyPopper className="size-8 shrink-0 text-brass-soft" />
          <div>
            <h2 className="text-2xl text-paper">Thank you — your order is confirmed!</h2>
            <p className="mt-1 text-paper/80">We’ve emailed your receipt. You can follow every step of the delivery right here.</p>
          </div>
        </motion.div>
      )}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Order {o.orderNumber}</p>
          <h1 className="mt-2 text-4xl">Placed {formatDate(o.createdAt)}</h1>
        </div>
        <StatusBadge status={o.status} />
      </div>

      {o.canPay && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-warning/30 bg-brass-soft/60 p-5 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-semibold">{o.status === 'payment_failed' ? 'Your last payment attempt failed' : 'This order is waiting for payment'}</p>
            <p className="text-sm text-ink-soft">
              Your books are reserved until {formatDateTime(o.reservationExpiresAt)}.{o.payment.failureReason && ` Reason: ${o.payment.failureReason}`}
            </p>
          </div>
          <Button onClick={pay} loading={busy}>
            <CreditCard className="size-4" /> Pay {formatPrice(o.pricing.total)}
          </Button>
        </div>
      )}

      <section className="card mt-6 p-6">
        <h2 className="mb-6 flex items-center gap-2 text-2xl">
          <Truck className="size-5 text-accent" /> Tracking
        </h2>
        <Timeline order={o} />
        {o.tracking && (
          <p className="mt-6 rounded-xl bg-cream px-4 py-3 text-sm">
            {o.tracking.carrier && <b>{o.tracking.carrier}</b>} · Tracking no. <span className="font-mono">{o.tracking.number}</span>
            {o.tracking.url && (
              <a href={o.tracking.url} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-accent hover:underline">
                Track shipment
              </a>
            )}
          </p>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card p-6">
          <h2 className="text-2xl">Items</h2>
          <ul className="mt-4 divide-y divide-line">
            {o.items.map((i) => (
              <li key={i.product} className="flex items-center gap-4 py-4">
                <Link to={`/books/${i.slug}`} className="w-14 shrink-0">
                  <BookCover book={i} sizes="sm" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/books/${i.slug}`} className="font-medium hover:text-accent">
                    {i.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {i.author} · Qty {i.quantity}
                  </p>
                  {o.status === 'delivered' && (
                    <Link to={`/books/${i.slug}#reviews`} className="text-sm font-semibold text-accent hover:underline">
                      Write a review
                    </Link>
                  )}
                </div>
                <p className="font-semibold">{formatPrice(i.price * i.quantity)}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-6">
          <section className="card p-6 text-sm">
            <h2 className="text-xl">Payment summary</h2>
            <dl className="mt-4 space-y-2">
              <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd>{formatPrice(o.pricing.subtotal)}</dd></div>
              {o.pricing.couponDiscount > 0 && (
                <div className="flex justify-between text-forest"><dt>Coupon {o.coupon?.code}</dt><dd>−{formatPrice(o.pricing.couponDiscount)}</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{o.pricing.shipping ? formatPrice(o.pricing.shipping) : 'Free'}</dd></div>
              <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd>{formatPrice(o.pricing.total)}</dd></div>
            </dl>
            {o.payment.paidAt && <p className="mt-4 text-xs text-muted">Paid {formatDateTime(o.payment.paidAt)}{o.payment.method && ` via ${o.payment.method.toUpperCase()}`}</p>}
            {o.payment.refundStatus && (
              <p className="mt-2 text-xs font-semibold text-forest">
                Refund {o.payment.refundStatus === 'failed' ? 'could not be processed automatically — our team will contact you' : o.payment.refundStatus}
              </p>
            )}
          </section>
          <section className="card p-6 text-sm">
            <h2 className="text-xl">Delivering to</h2>
            <p className="mt-3 font-semibold">{a.fullName}</p>
            <p className="mt-1 text-ink-soft">
              {a.line1}
              {a.line2 && `, ${a.line2}`}
              <br />
              {a.city}, {a.state} – {a.postalCode}
            </p>
            <p className="mt-1 text-muted">{a.phone}</p>
          </section>
          {o.canCancel && (
            <Button variant="danger-ghost" className="w-full" onClick={() => setConfirmCancel(true)}>
              Cancel order
            </Button>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancel}
        loading={busy}
        danger
        title="Cancel this order?"
        message={
          ['paid', 'processing'].includes(o.status)
            ? `We’ll cancel order ${o.orderNumber} and refund ${formatPrice(o.pricing.total)} to your original payment method.`
            : `We’ll cancel order ${o.orderNumber} and release the reserved books.`
        }
        confirmLabel="Cancel order"
      />
    </div>
  );
}
