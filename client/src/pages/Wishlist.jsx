import { Link, useLocation } from 'react-router-dom';
import { Heart, ShoppingBag, Trash2 } from 'lucide-react';
import { useDocumentTitle } from '../hooks';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';
import { Button, EmptyState, ErrorState, Price, Stars } from '../components/ui';
import { BookCover } from '../components/product/BookCover';
import { ProductCardSkeleton } from '../components/product/ProductCard';

export default function Wishlist() {
  useDocumentTitle('Wishlist');
  const location = useLocation();
  const { isAuthenticated, status } = useAuth();
  const { items, isLoading, error, toggle } = useWishlist();
  const { addItem, has, isPending } = useCart();

  const moveToBag = async (p) => {
    if (await addItem(p)) await toggle(p);
  };

  return (
    <div className="container-page py-10 lg:py-14">
      <p className="eyebrow">Saved for later</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">
        Wishlist {items.length > 0 && <span className="text-muted">({items.length})</span>}
      </h1>

      <div className="mt-10">
        {status !== 'loading' && !isAuthenticated ? (
          <EmptyState
            icon={Heart}
            title="Sign in to see your wishlist"
            description="Save books you love and come back to them on any device."
            action={
              <Button as="link" to="/login" state={{ from: location }}>
                Sign in
              </Button>
            }
          />
        ) : isLoading || status === 'loading' ? (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} />
        ) : !items.length ? (
          <EmptyState
            icon={Heart}
            title="Your wishlist is empty"
            description="Tap the heart on any book to save it here."
            action={<Button as="link" to="/shop">Discover books</Button>}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((p) => (
              <li key={p.id} className="flex gap-4 rounded-3xl border border-line bg-white/70 p-4 animate-fade-up">
                <Link to={`/books/${p.slug}`} className="w-24 shrink-0">
                  <BookCover book={p} sizes="sm" className="shadow-book" />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link to={`/books/${p.slug}`} className="line-clamp-2 font-display text-lg leading-snug hover:text-accent">
                    {p.title}
                  </Link>
                  <p className="text-sm text-muted">{p.author}</p>
                  {p.rating.count > 0 && <Stars value={p.rating.average} size="size-3.5" className="mt-1" />}
                  <div className="mt-2">
                    <Price price={p.price} mrp={p.mrp} />
                  </div>
                  {!p.inStock && <p className="mt-1 text-xs font-semibold text-danger">Out of stock</p>}
                  <div className="mt-auto flex gap-2 pt-3">
                    {has(p.id) ? (
                      <Button as="link" to="/cart" size="sm" variant="secondary" className="flex-1">
                        <ShoppingBag className="size-4" /> In bag · view
                      </Button>
                    ) : (
                      <Button size="sm" variant="dark" disabled={!p.inStock || isPending(p.id)} onClick={() => moveToBag(p)} className="flex-1">
                        <ShoppingBag className="size-4" /> Move to bag
                      </Button>
                    )}
                    <Button size="icon" variant="secondary" className="size-9" onClick={() => toggle(p)} aria-label={`Remove ${p.title} from wishlist`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
