import { Link } from 'react-router-dom';
import { Logo } from './Navbar';
import { GENRE_META } from '../../lib/format';
import { CREATOR_NAME } from '../../lib/site';

export function Footer() {
  const genres = ['fiction', 'thriller', 'romance', 'philosophy', 'manga', 'tech'];
  return (
    <footer className="mt-24 border-t border-line bg-cream/60">
      <div className="container-page grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-soft">
            An independent online bookstore for curious readers. Carefully chosen shelves, honest reviews and secure checkout.
          </p>
          <Link to="/about" className="link-underline mt-4 inline-block text-sm font-medium text-ink hover:text-accent">
            About Shelfify
          </Link>
        </div>
        <div>
          <p className="eyebrow mb-4">Browse</p>
          <ul className="space-y-2.5 text-sm">
            {genres.map((g) => (
              <li key={g}>
                <Link className="text-ink-soft hover:text-accent" to={`/shop?genre=${g}`}>
                  {GENRE_META[g].label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-4">Your account</p>
          <ul className="space-y-2.5 text-sm">
            <li><Link className="text-ink-soft hover:text-accent" to="/account">Profile & addresses</Link></li>
            <li><Link className="text-ink-soft hover:text-accent" to="/orders">Track orders</Link></li>
            <li><Link className="text-ink-soft hover:text-accent" to="/wishlist">Wishlist</Link></li>
            <li><Link className="text-ink-soft hover:text-accent" to="/cart">Shopping bag</Link></li>
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-4">Shopping with us</p>
          <ul className="space-y-2.5 text-sm text-ink-soft">
            <li>Free delivery on orders above ₹499</li>
            <li>Secure payments by Razorpay</li>
            <li>Cancel any time before dispatch</li>
            <li>Instant refunds on cancellation</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-2 py-6 text-xs text-muted md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} Shelfify. All rights reserved.</p>
          <p data-testid="creator-credit">
            Designed &amp; Developed by <span className="font-medium text-ink-soft">{CREATOR_NAME}</span>
          </p>
          <p>Prices in INR, inclusive of taxes.</p>
        </div>
      </div>
    </footer>
  );
}
