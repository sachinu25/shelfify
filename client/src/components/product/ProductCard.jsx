import { Link } from 'react-router-dom';
import { Heart, ShoppingBag, Truck, Check } from 'lucide-react';
import { BookCover } from './BookCover';
import { Price, Skeleton, Stars, cx } from '../ui';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';

export function ProductCard({ product, className }) {
  const { addItem, has, isPending } = useCart();
  const wishlist = useWishlist();
  const saved = wishlist.has(product.id);
  const inCart = has(product.id);

  return (
    <article className={cx('group relative flex flex-col', className)}>
      <div className="relative rounded-2xl bg-cream/70 p-4 pb-5 transition duration-300 group-hover:bg-sand/60 sm:p-5">
        <Link to={`/books/${product.slug}`} className="block" aria-label={product.title}>
          <BookCover book={product} className="mx-auto w-[78%] shadow-book transition duration-500 group-hover:-translate-y-1.5 group-hover:rotate-[-1deg]" />
        </Link>
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {product.badge && <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-paper">{product.badge}</span>}
          {!product.inStock && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-danger">Sold out</span>}
          {product.inStock && product.stockLeft && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-warning">Only {product.stockLeft} left</span>}
        </div>
        <button
          onClick={() => wishlist.toggle(product)}
          aria-label={saved ? `Remove ${product.title} from wishlist` : `Save ${product.title} to wishlist`}
          aria-pressed={saved}
          className={cx(
            'absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:scale-105',
            saved ? 'text-accent' : 'text-ink-soft hover:text-accent',
          )}
        >
          <Heart className="size-[18px]" fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="flex flex-1 flex-col pt-3.5">
        <Link to={`/books/${product.slug}`} className="line-clamp-2 font-display text-[17px] font-medium leading-snug text-ink hover:text-accent">
          {product.title}
        </Link>
        <p className="mt-0.5 truncate text-sm text-muted">{product.author}</p>
        <div className="mt-1.5 flex h-5 items-center gap-1.5 text-xs text-muted">
          {product.rating.count > 0 ? (
            <>
              <Stars value={product.rating.average} size="size-3.5" />
              <span>({product.rating.count})</span>
            </>
          ) : (
            <span>No reviews yet</span>
          )}
          {product.fastDelivery && (
            <span className="ml-auto inline-flex items-center gap-1 text-forest">
              <Truck className="size-3.5" /> Fast
            </span>
          )}
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <Price price={product.price} mrp={product.mrp} />
        </div>
        <button
          onClick={() => addItem(product)}
          disabled={!product.inStock || isPending(product.id)}
          className={cx(
            'mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full border text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
            inCart ? 'border-forest/30 bg-forest-soft text-forest' : 'border-ink bg-ink text-paper hover:bg-ink-soft',
          )}
        >
          {inCart ? <Check className="size-4" /> : <ShoppingBag className="size-4" />}
          {!product.inStock ? 'Out of stock' : inCart ? 'In bag · add another' : 'Add to bag'}
        </button>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[3/4] rounded-2xl" />
      <Skeleton className="mt-4 h-4 w-4/5" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <Skeleton className="mt-4 h-10 rounded-full" />
    </div>
  );
}

export function ProductGrid({ products, loading, count = 8 }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:grid-cols-3 xl:grid-cols-4">
      {loading
        ? Array.from({ length: count }).map((_, i) => <ProductCardSkeleton key={i} />)
        : products.map((p, i) => (
            <div key={p.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <ProductCard product={p} />
            </div>
          ))}
    </div>
  );
}

/** Horizontal scroll rail used on home / product pages. */
export function ProductRail({ products, loading }) {
  return (
    <div className="scroll-rail -mx-4 flex snap-x gap-5 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
      {(loading ? Array.from({ length: 4 }) : products.slice(0, 8)).map((p, i) =>
        loading ? (
          <div key={i} className="w-[46%] shrink-0 snap-start sm:w-[30%] lg:w-auto">
            <ProductCardSkeleton />
          </div>
        ) : (
          <ProductCard key={p.id} product={p} className={cx('w-[46%] shrink-0 snap-start sm:w-[30%] lg:w-auto', i >= 4 && 'lg:hidden')} />
        ),
      )}
    </div>
  );
}
