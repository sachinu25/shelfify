import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { SearchX, SlidersHorizontal, X } from 'lucide-react';
import { api, unwrapPage, unwrap } from '../lib/api';
import { genreLabel } from '../lib/format';
import { useDocumentTitle } from '../hooks';
import { Button, Checkbox, EmptyState, ErrorState, Pagination, Stars, cx } from '../components/ui';
import { ProductGrid } from '../components/product/ProductCard';

const SORTS = [
  ['relevance', 'Recommended'],
  ['newest', 'Newest first'],
  ['popular', 'Bestselling'],
  ['rating', 'Top rated'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
  ['title', 'Title A–Z'],
];
const PRICE_PRESETS = [
  ['Under ₹300', '', '300'],
  ['₹300 – ₹600', '300', '600'],
  ['₹600 & above', '600', ''],
];

function Filters({ params, update, facets }) {
  const genres = (params.get('genre') || '').split(',').filter(Boolean);
  const [minPrice, setMinPrice] = useState(params.get('minPrice') || '');
  const [maxPrice, setMaxPrice] = useState(params.get('maxPrice') || '');
  useEffect(() => {
    setMinPrice(params.get('minPrice') || '');
    setMaxPrice(params.get('maxPrice') || '');
  }, [params]);

  const toggleGenre = (g) => {
    const next = genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g];
    update({ genre: next.join(',') });
  };
  const group = 'border-b border-line py-6 first:pt-0';

  return (
    <div>
      <div className={group}>
        <h3 className="mb-3 font-sans text-sm font-semibold">Genre</h3>
        {(facets?.genres || []).map((g) => (
          <Checkbox key={g.value} label={genreLabel(g.value)} count={g.count} checked={genres.includes(g.value)} onChange={() => toggleGenre(g.value)} />
        ))}
      </div>

      <div className={group}>
        <h3 className="mb-3 font-sans text-sm font-semibold">Price</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {PRICE_PRESETS.map(([label, min, max]) => {
            const active = (params.get('minPrice') || '') === min && (params.get('maxPrice') || '') === max;
            return (
              <button
                key={label}
                onClick={() => update(active ? { minPrice: '', maxPrice: '' } : { minPrice: min, maxPrice: max })}
                className={cx('rounded-full border px-3 py-1.5 text-xs font-medium transition', active ? 'border-ink bg-ink text-paper' : 'border-line bg-white hover:border-ink/40')}
              >
                {label}
              </button>
            );
          })}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({ minPrice, maxPrice });
          }}
        >
          <input className="field h-10 py-0 text-sm" inputMode="numeric" placeholder="Min ₹" value={minPrice} onChange={(e) => setMinPrice(e.target.value.replace(/\D/g, ''))} aria-label="Minimum price" />
          <span className="text-muted">–</span>
          <input className="field h-10 py-0 text-sm" inputMode="numeric" placeholder="Max ₹" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ''))} aria-label="Maximum price" />
          <Button type="submit" size="sm" variant="secondary" className="h-10 shrink-0">
            Go
          </Button>
        </form>
      </div>

      <div className={group}>
        <h3 className="mb-3 font-sans text-sm font-semibold">Customer rating</h3>
        {[4, 3, 2].map((r) => {
          const active = params.get('minRating') === String(r);
          return (
            <button
              key={r}
              onClick={() => update({ minRating: active ? '' : String(r) })}
              className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition', active ? 'bg-cream font-semibold text-ink' : 'text-ink-soft hover:bg-cream/60')}
            >
              <Stars value={r} size="size-3.5" /> & up
            </button>
          );
        })}
      </div>

      <div className={group}>
        <h3 className="mb-3 font-sans text-sm font-semibold">Availability</h3>
        <Checkbox label="In stock only" checked={params.get('inStock') === 'true'} onChange={(e) => update({ inStock: e.target.checked ? 'true' : '' })} />
        <Checkbox label="Fast delivery" checked={params.get('fastDelivery') === 'true'} onChange={(e) => update({ fastDelivery: e.target.checked ? 'true' : '' })} />
      </div>
    </div>
  );
}

export default function Shop() {
  const [params, setParams] = useSearchParams();
  const [drawer, setDrawer] = useState(false);
  const q = params.get('q') || '';
  const page = Number(params.get('page') || 1);
  useDocumentTitle(q ? `Results for “${q}”` : params.get('genre') ? genreLabel(params.get('genre').split(',')[0]) : 'Shop all books');

  const query = Object.fromEntries([...params.entries()].filter(([, v]) => v));
  const products = useQuery({
    queryKey: ['products', query],
    queryFn: async () => unwrapPage(await api.get('/products', { params: { limit: 12, ...query } })),
    placeholderData: keepPreviousData,
  });
  const facets = useQuery({ queryKey: ['facets'], queryFn: async () => unwrap(await api.get('/products/facets')), staleTime: 300_000 });

  // Functional update: rapid successive changes (filter, then sort) always build on
  // the latest URL instead of a stale render-time snapshot.
  const update = (patch, { resetPage = true } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      if (resetPage) next.delete('page');
      return next;
    });
  };

  const chips = [];
  if (q) chips.push(['q', `“${q}”`]);
  (params.get('genre') || '').split(',').filter(Boolean).forEach((g) => chips.push(['genre:' + g, genreLabel(g)]));
  if (params.get('minPrice') || params.get('maxPrice')) chips.push(['price', `₹${params.get('minPrice') || 0} – ${params.get('maxPrice') ? '₹' + params.get('maxPrice') : 'any'}`]);
  if (params.get('minRating')) chips.push(['minRating', `${params.get('minRating')}★ & up`]);
  if (params.get('inStock')) chips.push(['inStock', 'In stock']);
  if (params.get('fastDelivery')) chips.push(['fastDelivery', 'Fast delivery']);

  const removeChip = (key) => {
    if (key.startsWith('genre:')) {
      const g = key.split(':')[1];
      update({ genre: (params.get('genre') || '').split(',').filter((x) => x && x !== g).join(',') });
    } else if (key === 'price') update({ minPrice: '', maxPrice: '' });
    else update({ [key]: '' });
  };

  const meta = products.data?.meta;
  const heading = q ? `Results for “${q}”` : chips.length === 1 && chips[0][0].startsWith('genre:') ? chips[0][1] : 'All books';

  return (
    <div className="container-page py-8 lg:py-12">
      <div className="mb-8 flex flex-col gap-2">
        <p className="eyebrow">The shelves</p>
        <h1 className="text-4xl sm:text-5xl">{heading}</h1>
        <p className="text-ink-soft">{meta ? `${meta.total} ${meta.total === 1 ? 'book' : 'books'}` : 'Loading…'}</p>
      </div>

      <div className="grid gap-10 lg:grid-cols-[250px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <Filters params={params} update={update} facets={facets.data} />
          </div>
        </aside>

        <div>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setDrawer(true)}>
              <SlidersHorizontal className="size-4" /> Filters {chips.length > 0 && `(${chips.length})`}
            </Button>
            <div className="flex flex-1 flex-wrap gap-2">
              {chips.map(([key, label]) => (
                <button key={key} onClick={() => removeChip(key)} className="inline-flex items-center gap-1.5 rounded-full bg-cream px-3 py-1.5 text-xs font-medium text-ink hover:bg-sand">
                  {label} <X className="size-3" />
                </button>
              ))}
              {chips.length > 1 && (
                <button onClick={() => setParams(new URLSearchParams())} className="px-2 text-xs font-semibold text-accent hover:underline">
                  Clear all
                </button>
              )}
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm text-ink-soft">
              <span className="hidden sm:inline">Sort by</span>
              <select
                value={params.get('sort') || 'relevance'}
                onChange={(e) => update({ sort: e.target.value === 'relevance' ? '' : e.target.value })}
                className="h-9 rounded-full border border-line bg-white px-3 pr-8 text-sm font-medium text-ink focus:border-accent focus:outline-none"
              >
                {SORTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {products.isError ? (
            <ErrorState error={products.error} onRetry={products.refetch} />
          ) : !products.isLoading && products.data?.items.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No books match these filters"
              description={q ? `We couldn’t find anything for “${q}”. Try a different spelling, an author’s name, or fewer filters.` : 'Try widening the price range or removing a filter.'}
              action={<Button onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>}
            />
          ) : (
            <div className={cx('transition-opacity', products.isFetching && !products.isLoading && 'opacity-60')}>
              <ProductGrid products={products.data?.items || []} loading={products.isLoading} count={12} />
            </div>
          )}

          <Pagination
            meta={meta}
            onChange={(p) => {
              update({ page: p > 1 ? String(p) : '' }, { resetPage: false });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
          {meta && page > meta.pages && meta.total > 0 && (
            <p className="mt-6 text-center text-sm text-muted">
              That page doesn’t exist.{' '}
              <button className="font-semibold text-accent" onClick={() => update({ page: '' }, { resetPage: false })}>
                Go to page 1
              </button>
            </p>
          )}
        </div>
      </div>

      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl bg-paper"
            >
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="text-xl">Filters</h2>
                <button onClick={() => setDrawer(false)} aria-label="Close filters" className="rounded-full p-2 hover:bg-cream">
                  <X className="size-5" />
                </button>
              </div>
              <div className="overflow-y-auto px-5 py-6">
                <Filters params={params} update={update} facets={facets.data} />
              </div>
              <div className="flex gap-3 border-t border-line p-4">
                <Button variant="secondary" className="flex-1" onClick={() => setParams(new URLSearchParams())}>
                  Clear all
                </Button>
                <Button className="flex-1" onClick={() => setDrawer(false)}>
                  Show {meta?.total ?? ''} books
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
