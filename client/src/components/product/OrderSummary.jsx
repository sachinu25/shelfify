import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Tag, X } from 'lucide-react';
import { api, unwrap } from '../../lib/api';
import { formatPrice } from '../../lib/format';
import { useCart } from '../../context/CartContext';
import { Button, Skeleton, cx } from '../ui';

function CouponBox() {
  const { coupon, setCoupon, cart, isFetching } = useCart();
  const [code, setCode] = useState('');
  const offers = useQuery({ queryKey: ['coupons', 'available'], queryFn: async () => unwrap(await api.get('/coupons/available')), staleTime: 120_000 });
  const applied = cart.coupon;
  const subtotal = cart.summary?.subtotal || 0;

  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-forest/30 bg-forest-soft px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="size-4 text-forest" />
          <span>
            <b className="font-semibold text-forest">{applied.code}</b> applied
          </span>
        </div>
        <button onClick={() => setCoupon('')} className="rounded-full p-1 text-forest hover:bg-white/60" aria-label="Remove coupon">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) setCoupon(code);
        }}
      >
        <div className="relative flex-1">
          <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code" className="field h-11 pl-9 uppercase" maxLength={30} />
        </div>
        <Button type="submit" variant="secondary" loading={isFetching && Boolean(coupon)} disabled={!code.trim()}>
          Apply
        </Button>
      </form>
      {coupon && cart.couponError && <p className="mt-2 text-sm text-danger">{cart.couponError}</p>}
      {offers.data?.length > 0 && (
        <div className="mt-3 space-y-2">
          {offers.data.map((o) => {
            const eligible = subtotal >= o.minOrderValue;
            return (
              <button
                key={o.code}
                type="button"
                onClick={() => {
                  setCode(o.code);
                  setCoupon(o.code);
                }}
                className={cx('flex w-full items-center justify-between rounded-xl border border-dashed px-3 py-2 text-left text-xs transition', eligible ? 'border-brass/60 bg-brass-soft/50 hover:bg-brass-soft' : 'border-line opacity-70 hover:opacity-100')}
              >
                <span>
                  <b className="font-semibold tracking-wide text-ink">{o.code}</b>
                  <span className="block text-muted">{o.description || (o.type === 'percent' ? `${o.value}% off` : `₹${o.value} off`)}</span>
                </span>
                <span className="font-semibold text-accent">Apply</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OrderSummary({ children, showCoupon = true, title = 'Order summary' }) {
  const { cart, isLoading } = useCart();
  const s = cart.summary;

  return (
    <div className="card p-6">
      <h2 className="text-2xl">{title}</h2>
      {isLoading || !s ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-8" />
        </div>
      ) : (
        <>
          {s.amountToFreeShipping > 0 && (
            <div className="mt-5 rounded-xl bg-cream p-3">
              <p className="text-xs text-ink-soft">
                Add <b className="text-ink">{formatPrice(s.amountToFreeShipping)}</b> more for free delivery
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (s.subtotal / s.freeShippingThreshold) * 100)}%` }} />
              </div>
            </div>
          )}
          <dl className="mt-5 space-y-3 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-ink-soft">Items ({s.itemCount})</dt>
              <dd>{formatPrice(s.mrpTotal)}</dd>
            </div>
            {s.productSavings > 0 && (
              <div className="flex justify-between text-forest">
                <dt>Discount on MRP</dt>
                <dd>−{formatPrice(s.productSavings)}</dd>
              </div>
            )}
            {s.couponDiscount > 0 && (
              <div className="flex justify-between text-forest">
                <dt>Coupon ({cart.coupon?.code})</dt>
                <dd>−{formatPrice(s.couponDiscount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-soft">Delivery</dt>
              <dd>{s.shipping ? formatPrice(s.shipping) : <span className="font-semibold text-forest">Free</span>}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <dt className="font-semibold">Total</dt>
              <dd className="font-display text-2xl">{formatPrice(s.total)}</dd>
            </div>
          </dl>
          {s.productSavings + s.couponDiscount > 0 && (
            <p className="mt-3 rounded-lg bg-forest-soft px-3 py-2 text-center text-sm font-medium text-forest">
              You save {formatPrice(s.productSavings + s.couponDiscount)} on this order
            </p>
          )}
          {showCoupon && (
            <div className="mt-6 border-t border-line pt-5">
              <CouponBox />
            </div>
          )}
        </>
      )}
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
