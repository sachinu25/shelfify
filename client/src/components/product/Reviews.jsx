import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, MessageSquareText, Trash2 } from 'lucide-react';
import { api, unwrap } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button, ConfirmModal, Field, Pagination, Skeleton, StarInput, Stars } from '../ui';

function ReviewForm({ slug, existing, onDone }) {
  const toast = useToast();
  const [rating, setRating] = useState(existing?.rating || 0);
  const [title, setTitle] = useState(existing?.title || '');
  const [comment, setComment] = useState(existing?.comment || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return setError('Please choose a star rating');
    setSaving(true);
    setError('');
    try {
      await api.post(`/products/${slug}/reviews`, { rating, title, comment });
      toast.success(existing ? 'Your review was updated' : 'Thanks for sharing your review!');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <p className="field-label">Your rating</p>
        <StarInput value={rating} onChange={setRating} />
      </div>
      <Field label="Headline (optional)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Sum it up in a line" />
      <Field as="textarea" label="Your review (optional)" value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder="What did you love? Who would you recommend it to?" />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={saving}>
          {existing ? 'Update review' : 'Post review'}
        </Button>
        {existing && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function Reviews({ slug }) {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('recent');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const list = useQuery({
    queryKey: ['reviews', slug, page, sort],
    queryFn: async () => {
      const res = await api.get(`/products/${slug}/reviews`, { params: { page, sort, limit: 5 } });
      return { ...res.data.data, meta: res.data.meta };
    },
    placeholderData: keepPreviousData,
  });
  const mine = useQuery({
    queryKey: ['reviews', slug, 'me'],
    queryFn: async () => unwrap(await api.get(`/products/${slug}/reviews/me`)),
    enabled: isAuthenticated,
  });

  const refresh = () => {
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ['reviews', slug] });
    queryClient.invalidateQueries({ queryKey: ['product', slug] });
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete(`/products/${slug}/reviews/${mine.data.review.id}`);
      toast.info('Your review was deleted');
      setConfirmDelete(false);
      refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const summary = list.data?.summary;
  const total = summary?.count || 0;
  const myReview = mine.data?.review;

  return (
    <section id="reviews" className="grid gap-10 lg:grid-cols-[320px_1fr]">
      <div>
        <h2 className="text-3xl">Reader reviews</h2>
        {list.isLoading ? (
          <Skeleton className="mt-6 h-40" />
        ) : (
          <div className="mt-6">
            <div className="flex items-end gap-3">
              <span className="font-display text-5xl">{total ? summary.average.toFixed(1) : '—'}</span>
              <div className="pb-1.5">
                <Stars value={summary?.average || 0} />
                <p className="text-sm text-muted">{total ? `${total} review${total > 1 ? 's' : ''}` : 'No reviews yet'}</p>
              </div>
            </div>
            <div className="mt-5 space-y-1.5">
              {[5, 4, 3, 2, 1].map((s) => {
                const n = summary?.distribution?.[s] || 0;
                return (
                  <div key={s} className="flex items-center gap-3 text-sm">
                    <span className="w-6 text-muted">{s}★</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-cream">
                      <div className="h-full rounded-full bg-brass transition-all" style={{ width: total ? `${(n / total) * 100}%` : 0 }} />
                    </div>
                    <span className="w-6 text-right tabular-nums text-muted">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-8">
          {!isAuthenticated ? (
            <p className="text-sm text-ink-soft">
              <Link to="/login" state={{ from: location }} className="font-semibold text-accent hover:underline">
                Sign in
              </Link>{' '}
              to write a review.
            </p>
          ) : myReview && !editing ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Edit your review
              </Button>
              <Button variant="danger-ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          ) : (
            !editing && (
              <Button variant="dark" onClick={() => setEditing(true)}>
                Write a review
              </Button>
            )
          )}
          {mine.data?.verifiedPurchase && !myReview && <p className="mt-2 text-xs text-forest">You bought this book — your review will be marked as a verified purchase.</p>}
        </div>
      </div>

      <div>
        {editing && (
          <div className="mb-8">
            <ReviewForm slug={slug} existing={myReview} onDone={refresh} />
          </div>
        )}
        {total > 1 && (
          <div className="mb-4 flex justify-end">
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-full border border-line bg-white px-3 text-sm"
              aria-label="Sort reviews"
            >
              <option value="recent">Most recent</option>
              <option value="highest">Highest rated</option>
              <option value="lowest">Lowest rated</option>
            </select>
          </div>
        )}
        {list.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : !list.data?.items.length ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-line px-6 py-12 text-center">
            <MessageSquareText className="mb-3 size-8 text-muted" strokeWidth={1.5} />
            <p className="font-display text-xl">Be the first to review this book</p>
            <p className="mt-1 text-sm text-muted">Your thoughts help other readers choose.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.items.map((r) => (
              <li key={r.id} className="py-6 first:pt-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars value={r.rating} size="size-3.5" />
                  {r.title && <span className="font-semibold">{r.title}</span>}
                </div>
                {r.comment && <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-soft">{r.comment}</p>}
                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-ink-soft">{r.author}</span>· {formatDate(r.createdAt)}
                  {r.verifiedPurchase && (
                    <span className="inline-flex items-center gap-1 font-semibold text-forest">
                      <BadgeCheck className="size-3.5" /> Verified purchase
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={list.data?.meta} onChange={setPage} />
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        loading={deleting}
        danger
        title="Delete your review?"
        message="This permanently removes your rating and comment for this book."
        confirmLabel="Delete review"
      />
    </section>
  );
}
