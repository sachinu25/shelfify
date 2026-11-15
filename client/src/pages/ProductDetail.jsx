import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookX, ChevronRight, Heart, ShieldCheck, ShoppingBag, Truck, RotateCcw } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { genreLabel } from '../lib/format';
import { useDocumentTitle } from '../hooks';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { Badge, Button, EmptyState, ErrorState, Price, QuantityStepper, SectionHeading, Skeleton, Stars, cx } from '../components/ui';
import { BookCover } from '../components/product/BookCover';
import { ProductRail } from '../components/product/ProductCard';
import { Reviews } from '../components/product/Reviews';

function DetailSkeleton() {
  return (
    <div className="container-page grid gap-12 py-10 lg:grid-cols-[minmax(0,440px)_1fr]">
      <Skeleton className="aspect-[3/4] rounded-3xl" />
      <div className="space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-4/5" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

export default function ProductDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { addItem, isPending } = useCart();
  const wishlist = useWishlist();
  const [qty, setQty] = useState(1);
  const [expanded, setExpanded] = useState(false);

  const product = useQuery({ queryKey: ['product', slug], queryFn: async () => unwrap(await api.get(`/products/${slug}`)) });
  const related = useQuery({ queryKey: ['related', slug], queryFn: async () => unwrap(await api.get(`/products/${slug}/related`)), enabled: product.isSuccess });
  const alsoBought = useQuery({ queryKey: ['alsoBought', slug], queryFn: async () => unwrap(await api.get(`/products/${slug}/also-bought`)), enabled: product.isSuccess });
  useDocumentTitle(product.data?.title);

  if (product.isLoading) return <DetailSkeleton />;
  if (product.isError) {
    return (
      <div className="container-page py-16">
        {product.error.status === 404 ? (
          <EmptyState icon={BookX} title="This book isn’t on our shelves" description="It may have been removed or the link is incorrect." action={<Button as="link" to="/shop">Browse all books</Button>} />
        ) : (
          <ErrorState error={product.error} onRetry={product.refetch} />
        )}
      </div>
    );
  }

  const p = product.data;
  const saved = wishlist.has(p.id);
  const longDesc = p.description?.length > 420;
  const specs = [
    ['Author', p.author],
    ['Genre', genreLabel(p.genre)],
    p.publisher && ['Publisher', p.publisher],
    p.publishedYear && ['Published', p.publishedYear],
    p.pages && ['Pages', p.pages],
    p.language && ['Language', p.language],
    p.isbn && ['ISBN', p.isbn],
  ].filter(Boolean);

  const buyNow = async () => {
    if (await addItem(p, qty)) navigate('/cart');
  };

  return (
    <div className="pb-8">
      <div className="container-page pt-6">
        <nav className="flex items-center gap-1 text-sm text-muted" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-ink">Home</Link>
          <ChevronRight className="size-3.5" />
          <Link to={`/shop?genre=${p.genre}`} className="hover:text-ink">{genreLabel(p.genre)}</Link>
          <ChevronRight className="size-3.5" />
          <span className="truncate text-ink-soft">{p.title}</span>
        </nav>
      </div>

      <div className="container-page grid gap-10 py-8 lg:grid-cols-[minmax(0,440px)_1fr] lg:gap-16">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="relative grid place-items-center rounded-[2rem] bg-cream px-10 py-12 sm:px-16">
            <BookCover book={p} sizes="lg" eager className="w-full max-w-[300px] shadow-book" />
            {p.badge && <Badge tone="bg-ink text-paper" className="absolute left-5 top-5">{p.badge}</Badge>}
          </div>
        </div>

        <div className="animate-fade-up">
          <p className="eyebrow">{genreLabel(p.genre)}</p>
          <h1 className="mt-3 text-4xl leading-tight sm:text-5xl">{p.title}</h1>
          <p className="mt-3 text-lg text-ink-soft">
            by{' '}
            <Link to={`/shop?q=${encodeURIComponent(p.author)}`} className="link-underline font-medium text-ink">
              {p.author}
            </Link>
          </p>
          <a href="#reviews" className="mt-4 inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
            <Stars value={p.rating.average} />
            {p.rating.count ? `${p.rating.average.toFixed(1)} · ${p.rating.count} review${p.rating.count > 1 ? 's' : ''}` : 'No reviews yet — be the first'}
          </a>

          <div className="mt-6 border-y border-line py-6">
            <Price price={p.price} mrp={p.mrp} size="lg" />
            <p className="mt-1 text-xs text-muted">Inclusive of all taxes</p>
            <p className={cx('mt-4 text-sm font-semibold', p.inStock ? (p.stockLeft ? 'text-warning' : 'text-success') : 'text-danger')}>
              {!p.inStock ? 'Currently out of stock' : p.stockLeft ? `Hurry — only ${p.stockLeft} left in stock` : 'In stock, ready to ship'}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {p.inStock && <QuantityStepper value={qty} onChange={setQty} max={Math.min(10, p.stockLeft || 10)} />}
              <Button size="lg" onClick={() => addItem(p, qty)} disabled={!p.inStock} loading={isPending(p.id)} className="flex-1 sm:flex-none">
                <ShoppingBag className="size-4" /> Add to bag
              </Button>
              {p.inStock && (
                <Button size="lg" variant="dark" onClick={buyNow} className="flex-1 sm:flex-none">
                  Buy now
                </Button>
              )}
              <Button
                size="icon"
                variant="secondary"
                className={cx('size-12', saved && 'text-accent')}
                onClick={() => wishlist.toggle(p)}
                aria-pressed={saved}
                aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
              >
                <Heart className="size-5" fill={saved ? 'currentColor' : 'none'} />
              </Button>
            </div>
          </div>

          <ul className="grid gap-3 py-6 text-sm text-ink-soft sm:grid-cols-3">
            <li className="flex items-center gap-2">
              <Truck className="size-4 text-accent" /> {p.fastDelivery ? 'Fast delivery available' : 'Standard delivery'}
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent" /> Secure Razorpay checkout
            </li>
            <li className="flex items-center gap-2">
              <RotateCcw className="size-4 text-accent" /> Cancel before dispatch
            </li>
          </ul>

          {p.description && (
            <div className="border-t border-line pt-6">
              <h2 className="text-2xl">About this book</h2>
              <p className={cx('mt-3 whitespace-pre-line leading-relaxed text-ink-soft', longDesc && !expanded && 'line-clamp-6')}>{p.description}</p>
              {longDesc && (
                <button onClick={() => setExpanded((e) => !e)} className="mt-2 text-sm font-semibold text-accent hover:underline">
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          )}

          <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-cream/60 p-5 text-sm sm:grid-cols-3">
            {specs.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {alsoBought.data?.length > 0 && (
        <section className="container-page py-12">
          <SectionHeading eyebrow="Readers also bought" title="Frequently bought together" />
          <ProductRail products={alsoBought.data} />
        </section>
      )}

      <div className="container-page border-t border-line py-14">
        <Reviews slug={p.slug} />
      </div>

      {(related.isLoading || related.data?.length > 0) && (
        <section className="container-page py-12">
          <SectionHeading eyebrow="More like this" title={`You might also enjoy`} />
          <ProductRail products={related.data || []} loading={related.isLoading} />
        </section>
      )}
    </div>
  );
}
