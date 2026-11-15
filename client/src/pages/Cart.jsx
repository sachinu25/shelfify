import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Heart, Lock, ShoppingBag, Trash2 } from 'lucide-react';
import { formatPrice } from '../lib/format';
import { useDocumentTitle } from '../hooks';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useAuth } from '../context/AuthContext';
import { Button, EmptyState, ErrorState, QuantityStepper, Skeleton, cx } from '../components/ui';
import { BookCover } from '../components/product/BookCover';
import { OrderSummary } from '../components/product/OrderSummary';

export default function Cart() {
  useDocumentTitle('Your bag');
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { cart, isLoading, error, refresh, updateQuantity, removeItem, isPending, count } = useCart();
  const wishlist = useWishlist();

  const moveToWishlist = async (product) => {
    if (!isAuthenticated) return wishlist.toggle(product);
    if (!wishlist.has(product.id)) await wishlist.toggle(product);
    await removeItem(product.id, { silent: true });
  };

  const blocking = cart.issues?.length > 0;

  if (isLoading) {
    return (
      <div className="container-page py-12">
        <Skeleton className="mb-8 h-12 w-56" />
        <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-page py-12">
        <ErrorState error={error} onRetry={refresh} title="We couldn’t load your bag" />
      </div>
    );
  }

  if (!cart.items.length) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={ShoppingBag}
          title="Your bag is empty"
          description="Books you add will wait here. Browse our shelves to find your next read."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button as="link" to="/shop">
                Start browsing
              </Button>
              {wishlist.count > 0 && (
                <Button as="link" to="/wishlist" variant="secondary">
                  View wishlist ({wishlist.count})
                </Button>
              )}
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-page py-10 lg:py-14">
      <div className="mb-8">
        <p className="eyebrow">Shopping bag</p>
        <h1 className="mt-2 text-4xl sm:text-5xl">
          Your bag <span className="text-muted">({count})</span>
        </h1>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          {blocking && (
            <div className="mb-5 flex gap-3 rounded-2xl border border-warning/30 bg-brass-soft/60 p-4 text-sm">
              <AlertTriangle className="size-5 shrink-0 text-warning" />
              <div>
                <p className="font-semibold">Some items need your attention</p>
                <ul className="mt-1 list-disc pl-4 text-ink-soft">
                  {cart.issues.map((i) => (
                    <li key={i.productId}>
                      {i.type === 'out_of_stock' && `“${i.title}” is now out of stock — remove it to continue.`}
                      {i.type === 'insufficient_stock' && `Only ${i.available} cop${i.available > 1 ? 'ies' : 'y'} of “${i.title}” left — reduce the quantity.`}
                      {i.type === 'unavailable' && 'A book in your bag is no longer available.'}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <ul className="divide-y divide-line rounded-3xl border border-line bg-white/60">
            {cart.items.map(({ product, quantity, available, lineTotal }) => (
              <li key={product.id} className={cx('flex gap-4 p-4 sm:gap-6 sm:p-6', isPending(product.id) && 'opacity-60')}>
                <Link to={`/books/${product.slug}`} className="w-20 shrink-0 sm:w-24">
                  <BookCover book={product} sizes="sm" className="w-full shadow-book" />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Link to={`/books/${product.slug}`} className="line-clamp-2 font-display text-lg leading-snug hover:text-accent">
                        {product.title}
                      </Link>
                      <p className="text-sm text-muted">{product.author}</p>
                      {!available && <p className="mt-1 text-sm font-semibold text-danger">Out of stock</p>}
                      {available && product.stockLeft && <p className="mt-1 text-xs font-semibold text-warning">Only {product.stockLeft} left</p>}
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatPrice(lineTotal || product.price * quantity)}</p>
                      {product.mrp > product.price && <p className="text-xs text-muted line-through">{formatPrice(product.mrp * quantity)}</p>}
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                    {available && (
                      <QuantityStepper
                        size="sm"
                        value={quantity}
                        max={Math.min(10, product.stockLeft || 10)}
                        disabled={isPending(product.id)}
                        onChange={(q) => updateQuantity(product.id, q)}
                      />
                    )}
                    <Button variant="ghost" size="sm" onClick={() => moveToWishlist(product)} disabled={isPending(product.id)}>
                      <Heart className="size-4" /> <span className="hidden sm:inline">Save for later</span>
                    </Button>
                    <Button variant="danger-ghost" size="sm" onClick={() => removeItem(product.id)} disabled={isPending(product.id)} aria-label={`Remove ${product.title}`}>
                      <Trash2 className="size-4" /> <span className="hidden sm:inline">Remove</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/shop" className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:gap-2">
            Continue shopping <ArrowRight className="size-4" />
          </Link>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <OrderSummary>
            <Button
              size="lg"
              className="w-full"
              disabled={blocking}
              onClick={() => navigate(isAuthenticated ? '/checkout' : '/login', { state: { from: { pathname: '/checkout' } } })}
            >
              <Lock className="size-4" /> {isAuthenticated ? 'Proceed to checkout' : 'Sign in to checkout'}
            </Button>
            <p className="mt-3 text-center text-xs text-muted">Prices and coupons are re-verified securely at checkout.</p>
          </OrderSummary>
        </aside>
      </div>
    </div>
  );
}
