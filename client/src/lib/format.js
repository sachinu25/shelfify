const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export const formatPrice = (n) => inr.format(Number(n) || 0);
export const formatCompact = (n) => compact.format(Number(n) || 0);

export const formatDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  d ? new Intl.DateTimeFormat('en-IN', opts).format(new Date(d)) : '';

export const formatDateTime = (d) =>
  d ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : '';

export const titleCase = (s = '') => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const GENRE_META = {
  fiction: { label: 'Fiction', blurb: 'Worlds worth getting lost in', tone: 'from-[#3b2a4d] to-[#1f1830]' },
  thriller: { label: 'Thriller & Mystery', blurb: 'Clues, twists, sleepless nights', tone: 'from-[#2d3b3a] to-[#141d1c]' },
  romance: { label: 'Romance', blurb: 'Stories of the heart', tone: 'from-[#7a2c3a] to-[#3f1219]' },
  philosophy: { label: 'Philosophy', blurb: 'Big questions, quiet hours', tone: 'from-[#5b4a2a] to-[#2b2213]' },
  manga: { label: 'Manga', blurb: 'Panels that pack a punch', tone: 'from-[#1f3c5c] to-[#0f1e2f]' },
  tech: { label: 'Technology', blurb: 'Learn, build, ship', tone: 'from-[#24463a] to-[#10221b]' },
  'self-help': { label: 'Self-help', blurb: 'Grow a little every day', tone: 'from-[#6d5a2b] to-[#33290f]' },
  biography: { label: 'Biography', blurb: 'Lives well told', tone: 'from-[#4a3b33] to-[#211a16]' },
  history: { label: 'History', blurb: 'The past, illuminated', tone: 'from-[#5a3d26] to-[#2a1c11]' },
  children: { label: 'Children', blurb: 'First favourites', tone: 'from-[#2d5d6b] to-[#152d34]' },
};

export const genreLabel = (g) => GENRE_META[g]?.label || titleCase(g);

export const ORDER_STATUS_META = {
  pending_payment: { label: 'Awaiting payment', tone: 'bg-brass-soft text-warning' },
  payment_failed: { label: 'Payment failed', tone: 'bg-danger-soft text-danger' },
  paid: { label: 'Confirmed', tone: 'bg-forest-soft text-forest' },
  processing: { label: 'Packing', tone: 'bg-forest-soft text-forest' },
  shipped: { label: 'Shipped', tone: 'bg-[#e6eef8] text-[#1f4f8a]' },
  out_for_delivery: { label: 'Out for delivery', tone: 'bg-[#e6eef8] text-[#1f4f8a]' },
  delivered: { label: 'Delivered', tone: 'bg-[#e3f1e8] text-success' },
  cancelled: { label: 'Cancelled', tone: 'bg-cream text-ink-soft' },
  expired: { label: 'Expired', tone: 'bg-cream text-muted' },
  refunded: { label: 'Refunded', tone: 'bg-cream text-ink-soft' },
};

export const TRACKING_STEPS = ['paid', 'processing', 'shipped', 'out_for_delivery', 'delivered'];
