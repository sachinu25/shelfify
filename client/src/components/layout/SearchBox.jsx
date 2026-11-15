import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api, unwrap } from '../../lib/api';
import { useDebounce } from '../../hooks';
import { formatPrice } from '../../lib/format';
import { BookCover } from '../product/BookCover';
import { cx } from '../ui';

export function SearchBox({ className, autoFocus, onNavigate }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounce(term.trim(), 220);
  const boxRef = useRef(null);

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: async () => unwrap(await api.get('/products/suggest', { params: { q: debounced } })),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onClick = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (path) => {
    setOpen(false);
    setActive(-1);
    onNavigate?.();
    navigate(path);
  };

  const submit = (e) => {
    e.preventDefault();
    if (active >= 0 && suggestions[active]) return go(`/books/${suggestions[active].slug}`);
    const q = term.trim();
    go(q ? `/shop?q=${encodeURIComponent(q)}` : '/shop');
  };

  const onKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
    } else if (e.key === 'Escape') setOpen(false);
  };

  const showPanel = open && debounced.length >= 2;

  return (
    <div ref={boxRef} className={cx('relative', className)}>
      <form onSubmit={submit} role="search">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search titles or authors"
          aria-label="Search books"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          className="h-11 w-full rounded-full border border-line bg-white/80 pl-10 pr-10 text-[15px] placeholder:text-muted/80 focus:border-accent focus:bg-white focus:outline-none focus:ring-4 focus:ring-accent/10"
        />
        {term && (
          <button type="button" onClick={() => setTerm('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </form>

      {showPanel && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-line bg-white shadow-lift animate-fade-up" role="listbox">
          {suggestions.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted">{isFetching ? 'Searching…' : `No books match “${debounced}”`}</p>
          ) : (
            <ul>
              {suggestions.map((s, i) => (
                <li key={s.id} role="option" aria-selected={i === active}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(`/books/${s.slug}`)}
                    className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left', i === active && 'bg-cream')}
                  >
                    <BookCover book={s} sizes="sm" className="w-9 shrink-0 rounded-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{s.title}</span>
                      <span className="block truncate text-xs text-muted">{s.author}</span>
                    </span>
                    <span className="text-sm font-semibold text-ink-soft">{formatPrice(s.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={submit} className="block w-full border-t border-line bg-paper px-4 py-3 text-left text-sm font-semibold text-accent hover:bg-cream">
            See all results for “{debounced}”
          </button>
        </div>
      )}
    </div>
  );
}
