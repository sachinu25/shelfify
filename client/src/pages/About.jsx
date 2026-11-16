import { ArrowRight, BadgeCheck, BookOpen, ShieldCheck, Truck } from 'lucide-react';
import { useDocumentTitle } from '../hooks';
import { Button } from '../components/ui';
import { CREATOR_INITIALS, CREATOR_NAME } from '../lib/site';

const PRINCIPLES = [
  {
    icon: BookOpen,
    title: 'Curated shelves',
    body: 'Fiction, thrillers, romance, philosophy, manga and technology — chosen with care and easy to explore by genre, price and rating.',
  },
  {
    icon: BadgeCheck,
    title: 'Honest reviews',
    body: 'Ratings come only from real readers, and reviews from customers who bought the book are marked as verified purchases.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure checkout',
    body: 'Prices are confirmed on our servers and payments are processed securely by Razorpay, with instant refunds on cancellation.',
  },
  {
    icon: Truck,
    title: 'Delivered across India',
    body: 'Free delivery on orders above ₹499, order tracking from dispatch to doorstep, and cancellation any time before dispatch.',
  },
];

export default function About() {
  useDocumentTitle('About Shelfify');
  return (
    <div className="pb-8">
      <section className="container-page grid gap-10 pt-12 pb-14 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:pt-16">
        <div className="animate-fade-up">
          <p className="eyebrow mb-5 flex items-center gap-2">
            <span className="h-px w-8 bg-accent" /> About Shelfify
          </p>
          <h1 className="text-[2.4rem] leading-[1.06] sm:text-5xl lg:text-6xl">
            A bookstore built for <em className="font-normal text-accent">curious</em> readers.
          </h1>
        </div>
        <div className="space-y-4 text-lg leading-relaxed text-ink-soft animate-fade-up">
          <p>
            Shelfify is an independent online bookstore. We bring together thoughtfully chosen books — from page-turning thrillers to quiet
            philosophy — and make finding your next read simple and enjoyable.
          </p>
          <p>Every part of the store is designed around readers: clear prices, honest reviews and a checkout you can trust.</p>
        </div>
      </section>

      <section className="border-y border-line bg-cream/50">
        <div className="container-page grid gap-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <div className="mb-4 grid size-11 place-items-center rounded-full bg-white shadow-sm">
                <Icon className="size-5 text-accent" strokeWidth={1.6} />
              </div>
              <h2 className="text-xl">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container-page py-16" aria-labelledby="creator-heading">
        <div className="mx-auto max-w-3xl text-center">
          <p className="eyebrow">The story</p>
          <h2 id="creator-heading" className="mt-3 text-3xl sm:text-4xl">
            Created by <span className="whitespace-nowrap">{CREATOR_NAME}</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-ink-soft">
            Shelfify was designed and built end to end — from the storefront and reading experience to the secure checkout and the tools
            that run the store behind the scenes.
          </p>

          <figure className="mx-auto mt-10 flex max-w-md items-center gap-4 rounded-2xl border border-line bg-white/70 px-5 py-4 text-left shadow-card">
            <span
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-full bg-ink font-display text-lg tracking-wide text-paper"
            >
              {CREATOR_INITIALS}
            </span>
            <figcaption>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Founder &amp; Developer</span>
              <span className="mt-0.5 block font-display text-xl text-ink">{CREATOR_NAME}</span>
            </figcaption>
          </figure>
          <p className="sr-only">Founder &amp; Developer — {CREATOR_NAME}</p>
        </div>
      </section>

      <section className="container-page">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-ink px-6 py-10 text-paper sm:flex-row sm:items-center sm:px-10">
          <div>
            <h2 className="text-2xl text-paper sm:text-3xl">Find your next favourite book</h2>
            <p className="mt-1 text-paper/70">Browse the shelves — new arrivals, bestsellers and great deals.</p>
          </div>
          <Button as="link" to="/shop" size="lg" className="shrink-0">
            Browse the shelves <ArrowRight className="size-4" />
          </Button>
        </div>
      </section>
    </div>
  );
}
