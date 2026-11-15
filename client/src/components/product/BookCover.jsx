import { useState } from 'react';
import { GENRE_META } from '../../lib/format';
import { cx } from '../ui';

/**
 * Renders the cover image, or a designed typographic cover when the book has
 * no artwork (or the image fails to load) so the shelf never shows broken images.
 */
export function BookCover({ book, className, sizes = 'md', eager = false }) {
  const [failed, setFailed] = useState(false);
  const src = book?.coverImage;
  const tone = GENRE_META[book?.genre]?.tone || 'from-[#3a332c] to-[#1b1815]';

  if (!src || failed) {
    return (
      <div
        className={cx('relative flex aspect-[2/3] flex-col justify-between overflow-hidden rounded-[4px_10px_10px_4px] bg-gradient-to-br p-[9%] text-paper', tone, className)}
        role="img"
        aria-label={`Cover of ${book?.title}`}
      >
        <span className="absolute inset-y-0 left-[6%] w-px bg-white/15" />
        <span className={cx('font-sans font-semibold uppercase tracking-[0.2em] text-brass-soft/80', sizes === 'sm' ? 'text-[7px]' : 'text-[9px]')}>
          {GENRE_META[book?.genre]?.label || 'Shelfify'}
        </span>
        <span className={cx('font-display leading-[1.08] text-balance', sizes === 'sm' ? 'text-sm' : sizes === 'lg' ? 'text-3xl' : 'text-lg')}>{book?.title}</span>
        <span className={cx('font-sans text-paper/70', sizes === 'sm' ? 'text-[9px]' : 'text-xs')}>{book?.author}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Cover of ${book.title}`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={cx('aspect-[2/3] rounded-[4px_10px_10px_4px] bg-cream object-cover', className)}
    />
  );
}
