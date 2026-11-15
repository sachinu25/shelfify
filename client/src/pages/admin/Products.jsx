import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, Search } from 'lucide-react';
import { api, unwrap, unwrapPage } from '../../lib/api';
import { GENRE_META, formatPrice, genreLabel } from '../../lib/format';
import { useDebounce, useDocumentTitle } from '../../hooks';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, ConfirmModal, ErrorState, Field, Modal, Pagination, Skeleton } from '../../components/ui';
import { BookCover } from '../../components/product/BookCover';
import { AdminHeader, Table } from './AdminLayout';

const EMPTY = { title: '', author: '', description: '', genre: 'fiction', price: '', mrp: '', coverImage: '', badge: '', publisher: '', language: 'English', pages: '', isbn: '', publishedYear: '', stock: 0, lowStockThreshold: 5, fastDelivery: false, isActive: true };

function ProductForm({ initial, onSaved, onCancel }) {
  const toast = useToast();
  const [v, setV] = useState({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!v.title.trim()) errs.title = 'Title is required';
    if (!v.author.trim()) errs.author = 'Author is required';
    if (v.price === '' || Number(v.price) < 0) errs.price = 'Enter a valid price';
    if (v.mrp === '' || Number(v.mrp) < Number(v.price)) errs.mrp = 'MRP must be ≥ selling price';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const payload = {
      ...v,
      price: Number(v.price),
      mrp: Number(v.mrp),
      stock: Number(v.stock) || 0,
      lowStockThreshold: Number(v.lowStockThreshold) || 0,
      pages: v.pages ? Number(v.pages) : null,
      publishedYear: v.publishedYear ? Number(v.publishedYear) : null,
    };
    ['id', 'slug', 'discountPercent', 'inStock', 'stockLeft', 'rating', 'soldCount', 'createdAt', 'updatedAt'].forEach((k) => delete payload[k]);
    try {
      const saved = unwrap(initial?.id ? await api.patch(`/admin/products/${initial.id}`, payload) : await api.post('/admin/products', payload));
      toast.success(initial?.id ? 'Book updated' : 'Book added to catalog');
      onSaved(saved);
    } catch (err) {
      setErrors(Object.fromEntries((err.details || []).map((d) => [d.field, d.message])));
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field className="sm:col-span-2" label="Title" value={v.title} error={errors.title} onChange={set('title')} />
      <Field label="Author" value={v.author} error={errors.author} onChange={set('author')} />
      <Field as="select" label="Genre" value={v.genre} onChange={set('genre')}>
        {Object.keys(GENRE_META).map((g) => (
          <option key={g} value={g}>
            {genreLabel(g)}
          </option>
        ))}
      </Field>
      <Field label="Selling price (₹)" inputMode="decimal" value={v.price} error={errors.price} onChange={set('price')} />
      <Field label="MRP (₹)" inputMode="decimal" value={v.mrp} error={errors.mrp} onChange={set('mrp')} />
      <Field label="Stock" type="number" min="0" value={v.stock} error={errors.stock} onChange={set('stock')} />
      <Field label="Low-stock alert at" type="number" min="0" value={v.lowStockThreshold} onChange={set('lowStockThreshold')} />
      <Field className="sm:col-span-2" label="Cover image URL" value={v.coverImage} error={errors.coverImage} onChange={set('coverImage')} placeholder="https://… or /covers/file.jpg" hint="Leave blank to use a designed typographic cover." />
      <Field className="sm:col-span-2" as="textarea" label="Description" value={v.description} onChange={set('description')} />
      <Field label="Badge (optional)" value={v.badge} maxLength={30} onChange={set('badge')} placeholder="e.g. New Arrival" />
      <Field label="Publisher" value={v.publisher} onChange={set('publisher')} />
      <Field label="ISBN" value={v.isbn} onChange={set('isbn')} />
      <Field label="Pages" type="number" min="1" value={v.pages ?? ''} onChange={set('pages')} />
      <Field label="Published year" type="number" value={v.publishedYear ?? ''} onChange={set('publishedYear')} />
      <Field label="Language" value={v.language} onChange={set('language')} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.fastDelivery} onChange={set('fastDelivery')} className="size-4 accent-[#6b1e2b]" /> Eligible for fast delivery
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.isActive} onChange={set('isActive')} className="size-4 accent-[#6b1e2b]" /> Visible in store
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={saving}>
          {initial?.id ? 'Save changes' : 'Add book'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function Products() {
  useDocumentTitle('Catalog');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);
  const [busy, setBusy] = useState(false);
  const term = useDebounce(q, 300);

  const list = useQuery({
    queryKey: ['admin', 'products', term, status, page],
    queryFn: async () => unwrapPage(await api.get('/admin/products', { params: { q: term || undefined, status, page, limit: 15 } })),
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['collections'] });
  };

  const archive = async () => {
    setBusy(true);
    try {
      const res = unwrap(await api.delete(`/admin/products/${archiving.id}`));
      toast.success(res.deleted ? 'Book deleted' : 'Book archived (it has order history)');
      setArchiving(null);
      refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <AdminHeader
        title="Catalog"
        description="Add, edit and publish books."
        action={
          <Button onClick={() => setEditing({})}>
            <Plus className="size-4" /> Add book
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            className="field h-10 pl-9"
            placeholder="Search title, author or ISBN"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            aria-label="Search catalog"
          />
        </div>
        <select
          className="field h-10 w-auto"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by visibility"
        >
          <option value="all">All books</option>
          <option value="active">Visible</option>
          <option value="inactive">Hidden / archived</option>
        </select>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Table
          head={['Book', 'Genre', 'Price', 'Stock', 'Sold', 'Rating', 'Status', '']}
          empty={!list.data.items.length && <p className="p-8 text-center text-sm text-muted">No books match your search.</p>}
        >
          {list.data.items.map((p) => (
            <tr key={p.id} className="hover:bg-paper/60">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <BookCover book={p} sizes="sm" className="w-9 shrink-0" />
                  <div className="min-w-0">
                    <p className="max-w-[260px] truncate font-medium">{p.title}</p>
                    <p className="truncate text-xs text-muted">{p.author}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">{genreLabel(p.genre)}</td>
              <td className="px-4 py-3 tabular-nums">
                {formatPrice(p.price)}
                {p.mrp > p.price && <span className="block text-xs text-muted line-through">{formatPrice(p.mrp)}</span>}
              </td>
              <td className="px-4 py-3 tabular-nums">
                <span className={p.stock === 0 ? 'font-semibold text-danger' : p.stock <= p.lowStockThreshold ? 'font-semibold text-warning' : ''}>{p.stock}</span>
              </td>
              <td className="px-4 py-3 tabular-nums">{p.soldCount}</td>
              <td className="px-4 py-3 tabular-nums">{p.rating.count ? `${p.rating.average} (${p.rating.count})` : '—'}</td>
              <td className="px-4 py-3">{p.isActive ? <Badge tone="bg-forest-soft text-forest">Visible</Badge> : <Badge>Hidden</Badge>}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(p)} aria-label={`Edit ${p.title}`}>
                    <Pencil className="size-4" />
                  </Button>
                  {p.isActive && (
                    <Button size="icon" variant="danger-ghost" className="size-8" onClick={() => setArchiving(p)} aria-label={`Archive ${p.title}`}>
                      <Archive className="size-4" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination meta={list.data?.meta} onChange={setPage} />

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Edit “${editing.title}”` : 'Add a book'} size="max-w-3xl">
        {editing && (
          <ProductForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}
      </Modal>
      <ConfirmModal
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={archive}
        loading={busy}
        danger
        title="Remove this book from the store?"
        message={`“${archiving?.title}” will be hidden from shoppers. Books with order history are archived rather than deleted so past orders stay intact.`}
        confirmLabel="Remove"
      />
    </div>
  );
}
