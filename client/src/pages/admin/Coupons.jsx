import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, unwrap } from '../../lib/api';
import { formatDate, formatPrice } from '../../lib/format';
import { useDocumentTitle } from '../../hooks';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, ConfirmModal, EmptyState, ErrorState, Field, Modal, Skeleton } from '../../components/ui';
import { AdminHeader, Table } from './AdminLayout';

const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function CouponForm({ initial, onSaved, onCancel }) {
  const toast = useToast();
  const [v, setV] = useState({
    code: initial.code || '',
    description: initial.description || '',
    type: initial.type || 'percent',
    value: initial.value ?? '',
    maxDiscount: initial.maxDiscount ?? '',
    minOrderValue: initial.minOrderValue ?? 0,
    startsAt: toInputDate(initial.startsAt),
    expiresAt: toInputDate(initial.expiresAt),
    usageLimit: initial.usageLimit ?? '',
    perUserLimit: initial.perUserLimit ?? 1,
    isActive: initial.isActive ?? true,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const num = (x) => (x === '' || x == null ? null : Number(x));
    const payload = {
      code: v.code,
      description: v.description,
      type: v.type,
      value: Number(v.value),
      maxDiscount: v.type === 'percent' ? num(v.maxDiscount) : null,
      minOrderValue: Number(v.minOrderValue) || 0,
      startsAt: v.startsAt || null,
      expiresAt: v.expiresAt ? `${v.expiresAt}T23:59:59` : null,
      usageLimit: num(v.usageLimit),
      perUserLimit: Number(v.perUserLimit) || 1,
      isActive: v.isActive,
    };
    try {
      const saved = unwrap(initial.id ? await api.patch(`/admin/coupons/${initial.id}`, payload) : await api.post('/admin/coupons', payload));
      toast.success(`Coupon ${saved.code} saved`);
      onSaved();
    } catch (err) {
      setErrors(Object.fromEntries((err.details || []).map((d) => [d.field, d.message])));
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Code" value={v.code} error={errors.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="SUMMER15" />
      <Field as="select" label="Type" value={v.type} onChange={set('type')}>
        <option value="percent">Percentage off</option>
        <option value="flat">Flat amount off</option>
      </Field>
      <Field label={v.type === 'percent' ? 'Discount (%)' : 'Discount (₹)'} inputMode="decimal" value={v.value} error={errors.value} onChange={set('value')} />
      {v.type === 'percent' ? (
        <Field label="Max discount (₹, optional)" inputMode="decimal" value={v.maxDiscount} onChange={set('maxDiscount')} />
      ) : (
        <div className="hidden sm:block" />
      )}
      <Field className="sm:col-span-2" label="Description shown to shoppers" value={v.description} maxLength={200} onChange={set('description')} />
      <Field label="Minimum order (₹)" inputMode="decimal" value={v.minOrderValue} onChange={set('minOrderValue')} />
      <Field label="Uses per customer" type="number" min="1" value={v.perUserLimit} onChange={set('perUserLimit')} />
      <Field label="Total usage limit (optional)" type="number" min="1" value={v.usageLimit} onChange={set('usageLimit')} />
      <div />
      <Field label="Starts on (optional)" type="date" value={v.startsAt} onChange={set('startsAt')} />
      <Field label="Expires on (optional)" type="date" value={v.expiresAt} error={errors.expiresAt} onChange={set('expiresAt')} />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={v.isActive} onChange={set('isActive')} className="size-4 accent-[#6b1e2b]" /> Active
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={saving}>
          {initial.id ? 'Save coupon' : 'Create coupon'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function Coupons() {
  useDocumentTitle('Coupons');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ['admin', 'coupons'], queryFn: async () => unwrap(await api.get('/admin/coupons')) });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
    queryClient.invalidateQueries({ queryKey: ['coupons'] });
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/admin/coupons/${deleting.id}`);
      toast.success('Coupon deleted');
      setDeleting(null);
      refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const state = (c) => {
    const now = Date.now();
    if (!c.isActive) return <Badge>Inactive</Badge>;
    if (c.expiresAt && new Date(c.expiresAt) < now) return <Badge tone="bg-danger-soft text-danger">Expired</Badge>;
    if (c.startsAt && new Date(c.startsAt) > now) return <Badge tone="bg-brass-soft text-warning">Scheduled</Badge>;
    if (c.usageLimit && c.usedCount >= c.usageLimit) return <Badge tone="bg-danger-soft text-danger">Exhausted</Badge>;
    return <Badge tone="bg-forest-soft text-forest">Live</Badge>;
  };

  return (
    <div>
      <AdminHeader title="Coupons" description="Create and manage discount codes. Discounts are always computed on the server." action={<Button onClick={() => setEditing({})}><Plus className="size-4" /> New coupon</Button>} />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !list.data.length ? (
        <EmptyState title="No coupons yet" description="Create your first offer to reward readers." action={<Button onClick={() => setEditing({})}>New coupon</Button>} />
      ) : (
        <Table head={['Code', 'Offer', 'Min. order', 'Validity', 'Used', 'Status', '']}>
          {list.data.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
              <td className="px-4 py-3">
                {c.type === 'percent' ? `${c.value}% off` : `${formatPrice(c.value)} off`}
                {c.maxDiscount ? <span className="text-muted"> (max {formatPrice(c.maxDiscount)})</span> : null}
                {c.description && <p className="max-w-[240px] truncate text-xs text-muted">{c.description}</p>}
              </td>
              <td className="px-4 py-3 tabular-nums">{c.minOrderValue ? formatPrice(c.minOrderValue) : '—'}</td>
              <td className="px-4 py-3 text-ink-soft">{c.expiresAt ? `Until ${formatDate(c.expiresAt)}` : 'No expiry'}</td>
              <td className="px-4 py-3 tabular-nums">
                {c.usedCount}
                {c.usageLimit ? ` / ${c.usageLimit}` : ''} <span className="text-xs text-muted">({c.uniqueUsers} customers)</span>
              </td>
              <td className="px-4 py-3">{state(c)}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="icon" variant="danger-ghost" className="size-8" onClick={() => setDeleting(c)} aria-label={`Delete ${c.code}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.code}` : 'New coupon'} size="max-w-2xl">
        {editing && (
          <CouponForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
          />
        )}
      </Modal>
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy} danger title={`Delete ${deleting?.code}?`} message="Shoppers will no longer be able to apply this code. Past orders are unaffected." confirmLabel="Delete coupon" />
    </div>
  );
}
