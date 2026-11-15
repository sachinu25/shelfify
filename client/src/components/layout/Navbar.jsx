import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, LayoutDashboard, LogOut, Menu, Package, ShoppingBag, User, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useToast } from '../../context/ToastContext';
import { SearchBox } from './SearchBox';
import { cx } from '../ui';

const LINKS = [
  { to: '/shop', label: 'Shop all' },
  { to: '/shop?genre=fiction', label: 'Fiction' },
  { to: '/shop?genre=thriller', label: 'Thrillers' },
  { to: '/shop?genre=manga', label: 'Manga' },
  { to: '/shop?sort=popular', label: 'Bestsellers' },
];

export function Logo({ className }) {
  return (
    <Link to="/" className={cx('flex items-center gap-2', className)} aria-label="Shelfify home">
      <span className="grid size-9 place-items-center rounded-xl bg-accent font-display text-lg font-semibold text-paper shadow-sm">S</span>
      <span className="font-display text-2xl font-semibold tracking-tight text-ink">Shelfify</span>
    </Link>
  );
}

function CountBadge({ n }) {
  if (!n) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-[18px] text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}

function AccountMenu() {
  const { user, isAdmin, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const item = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-soft hover:bg-cream hover:text-ink';
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid size-10 place-items-center rounded-full bg-ink font-semibold text-paper transition hover:bg-ink-soft"
      >
        {user.name?.[0]?.toUpperCase() || <User className="size-4" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role="menu"
            className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-line bg-white p-2 shadow-lift"
          >
            <div className="border-b border-line px-3 pb-3 pt-2">
              <p className="truncate font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
            <div className="pt-2" onClick={() => setOpen(false)}>
              <Link to="/account" className={item} role="menuitem">
                <User className="size-4" /> My account
              </Link>
              <Link to="/orders" className={item} role="menuitem">
                <Package className="size-4" /> Orders
              </Link>
              <Link to="/wishlist" className={item} role="menuitem">
                <Heart className="size-4" /> Wishlist
              </Link>
              {isAdmin && (
                <Link to="/admin" className={item} role="menuitem">
                  <LayoutDashboard className="size-4" /> Admin dashboard
                </Link>
              )}
              <button
                role="menuitem"
                className={cx(item, 'text-danger hover:bg-danger-soft hover:text-danger')}
                onClick={async () => {
                  await logout();
                  toast.info('You have been signed out.');
                  navigate('/');
                }}
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Navbar() {
  const { isAuthenticated, status } = useAuth();
  const { count } = useCart();
  const wishlist = useWishlist();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const iconBtn = 'relative grid size-10 place-items-center rounded-full text-ink-soft transition hover:bg-cream hover:text-ink';

  return (
    <header className={cx('sticky top-0 z-40 border-b transition-colors', scrolled ? 'border-line bg-paper/90 backdrop-blur-md' : 'border-transparent bg-paper')}>
      <div className="container-page flex h-[68px] items-center gap-4">
        <button className={cx(iconBtn, 'lg:hidden')} onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <Logo />
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <NavLink
              key={l.label}
              to={l.to}
              end
              className={({ isActive }) =>
                cx('rounded-full px-3 py-2 text-sm font-medium transition', isActive && l.to === '/shop' ? 'text-accent' : 'text-ink-soft hover:text-ink')
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <SearchBox className="ml-auto hidden w-full max-w-sm md:block" />
        <div className="ml-auto flex items-center gap-1 md:ml-2">
          <Link to="/wishlist" className={cx(iconBtn, 'hidden sm:grid')} aria-label={`Wishlist (${wishlist.count} items)`}>
            <Heart className="size-5" />
            <CountBadge n={wishlist.count} />
          </Link>
          <Link to="/cart" className={iconBtn} aria-label={`Bag (${count} items)`}>
            <ShoppingBag className="size-5" />
            <CountBadge n={count} />
          </Link>
          {status === 'loading' ? (
            <span className="ml-1 size-10 rounded-full skeleton" />
          ) : isAuthenticated ? (
            <div className="ml-1">
              <AccountMenu />
            </div>
          ) : (
            <Link to="/login" state={{ from: location }} className="ml-1 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-ink-soft">
              Sign in
            </Link>
          )}
        </div>
      </div>
      <div className="container-page pb-3 md:hidden">
        <SearchBox />
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div className="absolute inset-0 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-paper p-5 shadow-lift"
            >
              <div className="flex items-center justify-between">
                <Logo />
                <button className={iconBtn} onClick={() => setMobileOpen(false)} aria-label="Close menu">
                  <X className="size-5" />
                </button>
              </div>
              <nav className="mt-8 flex flex-col gap-1" aria-label="Mobile">
                {LINKS.map((l) => (
                  <Link key={l.label} to={l.to} className="rounded-xl px-3 py-3 font-display text-xl hover:bg-cream">
                    {l.label}
                  </Link>
                ))}
                <hr className="my-3 border-line" />
                <Link to="/wishlist" className="rounded-xl px-3 py-3 text-ink-soft hover:bg-cream">
                  Wishlist
                </Link>
                {isAuthenticated && (
                  <>
                    <Link to="/orders" className="rounded-xl px-3 py-3 text-ink-soft hover:bg-cream">
                      Orders
                    </Link>
                    <Link to="/account" className="rounded-xl px-3 py-3 text-ink-soft hover:bg-cream">
                      My account
                    </Link>
                  </>
                )}
              </nav>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </header>
  );
}
