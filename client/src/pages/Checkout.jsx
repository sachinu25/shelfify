import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Lock, MapPin, Plus, ShieldCheck } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/format';
import { loadRazorpay, openRazorpayCheckout } from '../lib/razorpay';
import { useDocumentTitle } from '../hooks';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { Button, PageLoader, Skeleton, cx } from '../components/ui';
import { AddressForm } from '../components/AddressForm';
import { OrderSummary } from '../components/product/OrderSummary';
import { BookCover } from '../components/product/BookCover';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function Checkout() {
  useDocumentTitle('Checkout');
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { cart, isLoading: cartLoading, coupon, refresh } = useCart();
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [stage, setStage] = useState('');
  const idempotencyKey = useRef(newKey());

  const addresses = useQuery({ queryKey: ['addresses'], queryFn: async () => unwrap(await api.get('/users/me/addresses')) });
  const payConfig = useQuery({ queryKey: ['payments', 'config'], queryFn: async () => unwrap(await api.get('/payments/config')), staleTime: 300_000 });

  useEffect(() => {
    if (!addresses.data?.length) return;
    if (!selected || !addresses.data.some((a) => a._id === selected)) {
      setSelected((addresses.data.find((a) => a.isDefault) || addresses.data[0])._id);
    }
  }, [addresses.data, selected]);

  // A new attempt (different address/coupon/cart) gets a new idempotency key.
  const cartSignature = useMemo(() => JSON.stringify([cart.items?.map((i) => [i.product.id, i.quantity]), coupon, selected]), [cart.items, coupon, selected]);
  useEffect(() => {
    idempotencyKey.current = newKey();
  }, [cartSignature]);

  if (cartLoading) return <PageLoader />;
  if (!cart.items.length && !placing) return <Navigate to="/cart" replace />;

  const saveAddress = async (payload) => {
    const list = unwrap(await api.post('/users/me/addresses', payload));
    queryClient.setQueryData(['addresses'], list);
    setSelected(list[list.length - 1]._id);
    setAdding(false);
    toast.success('Address saved');
  };

  const placeOrder = async () => {
    if (!selected) return toast.warning('Please select a delivery address');
    setPlacing(true);
    let orderId = null;
    try {
      setStage('Reserving your books…');
      const sdkReady = loadRazorpay();
      const result = unwrap(
        await api.post('/orders/checkout', { addressId: selected, coupon: coupon || undefined }, { headers: { 'Idempotency-Key': idempotencyKey.current } }),
      );
      orderId = result.order.id;
      if (!result.payment) throw new Error('Payment could not be initialised');

      setStage('Opening secure payment…');
      if (!(await sdkReady)) throw new Error('Could not load the payment window. Check your connection and try again.');
      const response = await openRazorpayCheckout(result.payment);

      setStage('Confirming your payment…');
      await api.post(`/orders/${orderId}/verify`, response);
      idempotencyKey.current = newKey();
      refresh();
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/orders/${orderId}?placed=1`, { replace: true });
    } catch (err) {
      idempotencyKey.current = newKey();
      if (err?.dismissed) {
        toast.info('Payment was not completed. Your books are held for 30 minutes — you can pay from your order page.');
        if (orderId) navigate(`/orders/${orderId}`);
      } else if (err?.failed) {
        toast.error(err.reason || 'Your payment failed. No money was deducted — please try again.');
        if (orderId) navigate(`/orders/${orderId}`);
      } else {
        toast.error(err.message || 'We could not place your order.');
        if (err.code === 'CART_ISSUES' || err.code === 'INSUFFICIENT_STOCK') {
          refresh();
          navigate('/cart');
        }
        if (err.code?.startsWith('COUPON')) refresh();
      }
    } finally {
      setPlacing(false);
      setStage('');
    }
  };

  const paymentsOff = payConfig.data && !payConfig.data.enabled;

  return (
    <div className="container-page py-10 lg:py-14">
      <div className="mb-8">
        <p className="eyebrow flex items-center gap-1.5">
          <Lock className="size-3" /> Secure checkout
        </p>
        <h1 className="mt-2 text-4xl sm:text-5xl">Checkout</h1>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_400px]">
        <div className="space-y-8">
          <section className="card p-6">
            <h2 className="flex items-center gap-2 text-2xl">
              <MapPin className="size-5 text-accent" /> Delivery address
            </h2>
            {addresses.isLoading ? (
              <Skeleton className="mt-5 h-28" />
            ) : (
              <>
                {addresses.data?.length > 0 && !adding && (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Delivery address">
                    {addresses.data.map((a) => (
                      <button
                        key={a._id}
                        role="radio"
                        aria-checked={selected === a._id}
                        onClick={() => setSelected(a._id)}
                        className={cx(
                          'relative rounded-2xl border p-4 text-left text-sm transition',
                          selected === a._id ? 'border-accent bg-accent-soft/40 ring-4 ring-accent/10' : 'border-line bg-white hover:border-ink/30',
                        )}
                      >
                        {selected === a._id && <CheckCircle2 className="absolute right-3 top-3 size-5 text-accent" />}
                        <p className="font-semibold">
                          {a.fullName} <span className="ml-1 rounded-full bg-cream px-2 py-0.5 text-[11px] font-medium text-ink-soft">{a.label}</span>
                        </p>
                        <p className="mt-1.5 text-ink-soft">
                          {a.line1}
                          {a.line2 && `, ${a.line2}`}, {a.city}, {a.state} – {a.postalCode}
                        </p>
                        <p className="mt-1 text-muted">{a.phone}</p>
                      </button>
                    ))}
                  </div>
                )}
                {adding || !addresses.data?.length ? (
                  <div className="mt-5">
                    <AddressForm onSubmit={saveAddress} onCancel={addresses.data?.length ? () => setAdding(false) : undefined} submitLabel="Save and use this address" initial={{ isDefault: !addresses.data?.length }} />
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" className="mt-4" onClick={() => setAdding(true)}>
                    <Plus className="size-4" /> Add a new address
                  </Button>
                )}
              </>
            )}
          </section>

          <section className="card p-6">
            <h2 className="text-2xl">Review items</h2>
            <ul className="mt-5 divide-y divide-line">
              {cart.items.map(({ product, quantity }) => (
                <li key={product.id} className="flex items-center gap-4 py-3">
                  <BookCover book={product} sizes="sm" className="w-12 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{product.title}</p>
                    <p className="text-sm text-muted">Qty {quantity}</p>
                  </div>
                  <p className="font-semibold">{formatPrice(product.price * quantity)}</p>
                </li>
              ))}
            </ul>
            <Link to="/cart" className="mt-3 inline-block text-sm font-semibold text-accent hover:underline">
              Edit bag
            </Link>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <OrderSummary title="Payment">
            {paymentsOff && (
              <p className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">Online payments are temporarily unavailable. Please try again later.</p>
            )}
            <Button size="lg" className="w-full" onClick={placeOrder} loading={placing} disabled={!selected || adding || paymentsOff || cart.issues?.length > 0}>
              <CreditCard className="size-4" /> {placing ? stage || 'Processing…' : `Pay ${cart.summary ? formatPrice(cart.summary.total) : ''}`}
            </Button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="size-3.5" /> UPI, cards, net banking & wallets via Razorpay
            </p>
          </OrderSummary>
        </aside>
      </div>
    </div>
  );
}
