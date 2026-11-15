import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, unwrap, unwrapPage } from '../../lib/api';
import { formatPrice } from '../../lib/format';
import { useDebounce, useDocumentTitle } from '../../hooks';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Checkbox, ErrorState, Pagination, Skeleton } from '../../components/ui';
import { BookCover } from '../../components/product/BookCover';
import { AdminHeader, Table } from './AdminLayout';

function StockEditor({ product, onSaved }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async (mode, raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || (mode === 'set' && n < 0)) return toast.warning('Enter a whole number');
    setBusy(true);
    try {
      onSaved(unwrap(await api.patch(`/admin/products/${product.id}/stock`, { mode, value: n })));
      setValue('');
      toast.success(`Stock for “${product.title}” updated`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button size="sm" variant="secondary" className="h-8 w-9 px-0" disabled={busy || product.stock === 0} onClick={() => apply('adjust', -1)} aria-label="Decrease stock by 1">
        −1
      </Button>
      <Button size="sm" variant="secondary" className="h-8 w-9 px-0" disabled={busy} onClick={() => apply('adjust', 1)} aria-label="Increase stock by 1">
        +1
      </Button>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value !== '') apply('set', value);
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} placeholder="Set" inputMode="numeric" className="field h-8 w-16 px-2 text-sm" aria-label={`Set stock for ${product.title}`} />
        <Button type="submit" size="sm" className="h-8" disabled={busy || value === ''} loading={busy}>
          Save
        </Button>
      </form>
    </div>
  );
}

export default function Inventory() {
  useDocumentTitle('Inventory');
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const lowStock = params.get('lowStock') === 'true';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebounce(q, 300);

  const key = ['admin', 'inventory', term, lowStock, page];
  const list = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrapPage(await api.get('/admin/products', { params: { q: term || undefined, lowStock: lowStock ? 'true' : undefined, status: 'active', sort: 'title', page, limit: 20 } })),
    placeholderData: keepPreviousData,
  });

  const onSaved = (updated) => {
    queryClient.setQueryData(key, (old) => old && { ...old, items: old.items.map((p) => (p.id === updated.id ? updated : p)) });
    queryClient.invalidateQueries({ queryKey: ['admin', 'analytics'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  return (
    <div>
      <AdminHeader title="Inventory" description="Track stock levels and restock titles before they sell out." />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className="field h-10 pl-9" placeholder="Search books" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search inventory" />
        </div>
        <Checkbox
          label="Low stock only"
          checked={lowStock}
          onChange={(e) => {
            setParams(e.target.checked ? { lowStock: 'true' } : {});
            setPage(1);
          }}
        />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Table head={['Book', 'Price', 'In stock', 'Alert at', 'Stock value', 'Adjust']} empty={!list.data.items.length && <p className="p-8 text-center text-sm text-muted">{lowStock ? 'Nothing is running low. 🎉' : 'No books found.'}</p>}>
          {list.data.items.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <BookCover book={p} sizes="sm" className="w-8 shrink-0" />
                  <div className="min-w-0">
                    <p className="max-w-[240px] truncate font-medium">{p.title}</p>
                    <p className="truncate text-xs text-muted">{p.author}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(p.price)}</td>
              <td className="px-4 py-3">
                {p.stock === 0 ? (
                  <Badge tone="bg-danger-soft text-danger">Out of stock</Badge>
                ) : p.stock <= p.lowStockThreshold ? (
                  <Badge tone="bg-brass-soft text-warning">{p.stock} · low</Badge>
                ) : (
                  <span className="tabular-nums">{p.stock}</span>
                )}
              </td>
              <td className="px-4 py-3 tabular-nums text-muted">{p.lowStockThreshold}</td>
              <td className="px-4 py-3 tabular-nums">{formatPrice(p.stock * p.price)}</td>
              <td className="px-4 py-3">
                <StockEditor product={p} onSaved={onSaved} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination meta={list.data?.meta} onChange={setPage} />
    </div>
  );
}
