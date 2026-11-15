import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, BadgePercent, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { api, unwrap } from '../lib/api';
import { GENRE_META } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useDocumentTitle } from '../hooks';
import { Button, ErrorState, SectionHeading } from '../components/ui';
import { ProductRail } from '../components/product/ProductCard';
import { BookCover } from '../components/product/BookCover';
import libraryImg from '../Assets/Images/Library_pic1.webp';

function Hero({ books }) {
  const stack = books.filter((b) => b.coverImage).slice(0, 3);
  return (
    <section className="relative overflow-hidden">
      <div className="container-page grid items-center gap-12 pb-16 pt-10 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-16">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <p className="eyebrow mb-5 flex items-center gap-2">
            <span className="h-px w-8 bg-accent" /> Independent online bookstore
          </p>
          <h1 className="text-[2.6rem] leading-[1.04] sm:text-6xl lg:text-[4.4rem]">
            Find the book you’ll <em className="font-normal text-accent">still</em> be thinking about next year.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-soft">
            Hand-picked fiction, thrillers, philosophy, manga and tech — with honest reader reviews, secure checkout and delivery across India.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button as="link" to="/shop" size="lg">
              Browse the shelves <ArrowRight className="size-4" />
            </Button>
            <Button as="link" to="/shop?sort=popular" variant="secondary" size="lg">
              See bestsellers
            </Button>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
            {[
              ['₹499+', 'Free delivery'],
              ['6+', 'Curated genres'],
              ['100%', 'Secure payments'],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="font-display text-2xl text-ink">{v}</dt>
                <dd className="text-xs text-muted">{l}</dd>
              </div>
            ))}
          </dl>
        </motion.div>

        <motion.div className="relative mx-auto w-full max-w-md lg:max-w-none" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.1 }}>
          <div className="relative aspect-[5/4] overflow-hidden rounded-[2rem] shadow-lift">
            <img src={libraryImg} alt="Warm library shelves" className="size-full object-cover" fetchPriority="high" />
            <div className="absolute inset-0 bg-gradient-to-b from-ink/65 via-ink/10 to-transparent" />
            <p className="absolute left-6 right-6 top-5 font-display text-xl italic text-paper sm:text-2xl">“A reader lives a thousand lives before he dies.”</p>
          </div>
          {stack.length === 3 && (
            <div className="pointer-events-none absolute -bottom-8 -left-4 hidden w-56 sm:block lg:-left-10">
              {stack.map((b, i) => (
                <Link
                  key={b.id}
                  to={`/books/${b.slug}`}
                  className="pointer-events-auto absolute bottom-0 w-24 transition hover:-translate-y-2"
                  style={{ left: `${i * 56}px`, transform: `rotate(${(i - 1) * 6}deg)`, zIndex: 3 - Math.abs(i - 1) }}
                >
                  <BookCover book={b} className="shadow-book" sizes="sm" eager />
                </Link>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}

function Genres({ facets }) {
  const counts = new Map((facets?.genres || []).map((g) => [g.value, g.count]));
  const list = ['fiction', 'thriller', 'romance', 'philosophy', 'manga', 'tech'];
  return (
    <section className="container-page py-12">
      <SectionHeading eyebrow="Browse by genre" title="Start with a mood" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {list.map((g, i) => (
          <motion.div key={g} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
            <Link
              to={`/shop?genre=${g}`}
              className={`group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-paper ${GENRE_META[g].tone}`}
            >
              <span className="absolute right-4 top-4 font-display text-5xl text-white/10 transition group-hover:text-white/20">{String(i + 1).padStart(2, '0')}</span>
              <span className="font-display text-xl leading-tight">{GENRE_META[g].label}</span>
              <span className="mt-1 text-xs text-paper/70">{GENRE_META[g].blurb}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brass-soft">
                {counts.get(g) ? `${counts.get(g)} titles` : 'Explore'} <ArrowRight className="size-3 transition group-hover:translate-x-1" />
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Rail({ eyebrow, title, products, loading, to }) {
  if (!loading && !products?.length) return null;
  return (
    <section className="container-page py-12">
      <SectionHeading
        eyebrow={eyebrow}
        title={title}
        action={
          to && (
            <Link to={to} className="hidden items-center gap-1 text-sm font-semibold text-accent hover:gap-2 sm:inline-flex">
              View all <ArrowRight className="size-4" />
            </Link>
          )
        }
      />
      <ProductRail products={products || []} loading={loading} />
    </section>
  );
}

export default function Home() {
  useDocumentTitle();
  const { isAuthenticated, user } = useAuth();
  const collections = useQuery({ queryKey: ['collections'], queryFn: async () => unwrap(await api.get('/products/collections')) });
  const facets = useQuery({ queryKey: ['facets'], queryFn: async () => unwrap(await api.get('/products/facets')), staleTime: 300_000 });
  const recs = useQuery({
    queryKey: ['recommendations', isAuthenticated ? user?.id : 'guest'],
    queryFn: async () => unwrap(await api.get('/products/recommendations')),
  });
  const c = collections.data;

  return (
    <>
      <Hero books={c?.bestsellers || []} />

      <section className="border-y border-line bg-cream/50">
        <div className="container-page grid grid-cols-2 gap-6 py-6 text-sm lg:grid-cols-4">
          {[
            [Truck, 'Free delivery over ₹499', 'Fast dispatch on select titles'],
            [ShieldCheck, 'Secure checkout', 'Payments verified by Razorpay'],
            [RotateCcw, 'Easy cancellation', 'Instant refund before dispatch'],
            [BadgePercent, 'Member offers', 'Coupons applied at checkout'],
          ].map(([Icon, t, d]) => (
            <div key={t} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.6} />
              <div>
                <p className="font-semibold text-ink">{t}</p>
                <p className="text-xs text-muted">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {collections.isError && (
        <div className="container-page py-12">
          <ErrorState error={collections.error} onRetry={collections.refetch} title="We couldn’t load the shelves" />
        </div>
      )}

      <Rail
        eyebrow={recs.data?.strategy === 'personalised' ? `For ${user?.name?.split(' ')[0] || 'you'}` : 'Trending now'}
        title={recs.data?.strategy === 'personalised' ? 'Picked for your shelf' : 'What readers are buying'}
        products={recs.data?.items}
        loading={recs.isLoading}
        to="/shop?sort=popular"
      />
      <Genres facets={facets.data} />
      <Rail eyebrow="Just landed" title="New arrivals" products={c?.newArrivals} loading={collections.isLoading} to="/shop?sort=newest" />
      <Rail eyebrow="Great value" title="Best deals this week" products={c?.deals} loading={collections.isLoading} to="/shop?sort=price_asc" />
      <Rail eyebrow="Loved by readers" title="Top rated" products={c?.topRated} loading={false} to="/shop?sort=rating" />
    </>
  );
}
