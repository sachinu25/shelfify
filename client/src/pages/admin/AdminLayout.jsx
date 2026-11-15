import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Boxes, LayoutDashboard, Library, Menu, Package, Store, TicketPercent, Users, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { cx } from '../../components/ui';

const NAV = [
  ['/admin', 'Overview', LayoutDashboard, true],
  ['/admin/orders', 'Orders', Package],
  ['/admin/products', 'Catalog', Library],
  ['/admin/inventory', 'Inventory', Boxes],
  ['/admin/coupons', 'Coupons', TicketPercent],
  ['/admin/users', 'Customers', Users],
];

function Nav({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Admin">
      {NAV.map(([to, label, Icon, end]) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-paper text-ink shadow-sm' : 'text-paper/70 hover:bg-white/10 hover:text-paper')
          }
        >
          <Icon className="size-4" /> {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AdminLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const sidebar = (
    <div className="flex h-full flex-col bg-ink p-5 text-paper">
      <Link to="/admin" className="mb-8 flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-accent font-display text-lg font-semibold">S</span>
        <span>
          <span className="block font-display text-xl leading-none">Shelfify</span>
          <span className="text-[11px] uppercase tracking-[0.18em] text-paper/50">Admin</span>
        </span>
      </Link>
      <Nav onNavigate={() => setOpen(false)} />
      <div className="mt-auto space-y-3 border-t border-white/10 pt-5">
        <Link to="/" className="flex items-center gap-2 text-sm text-paper/70 hover:text-paper">
          <Store className="size-4" /> View storefront
        </Link>
        <p className="truncate text-xs text-paper/50">Signed in as {user?.email}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f6f2ea] lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">{sidebar}</div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-[#f6f2ea]/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-full p-2 hover:bg-cream" aria-label="Open admin menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="font-display text-lg">Shelfify Admin</span>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AdminHeader({ title, description, action }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {description && <p className="mt-1 text-ink-soft">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Responsive data table shell used across admin pages. */
export function Table({ head, children, empty }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line bg-paper text-xs uppercase tracking-wider text-muted">
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
      {empty}
    </div>
  );
}
