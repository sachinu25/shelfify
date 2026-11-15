import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MapPin, Pencil, Plus, Trash2, User } from 'lucide-react';
import { api, setAccessToken, unwrap } from '../lib/api';
import { formatDate } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from '../hooks';
import { Badge, Button, ConfirmModal, EmptyState, Field, Modal, Skeleton, cx } from '../components/ui';
import { AddressForm } from '../components/AddressForm';

function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, phone: user.phone || '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const data = unwrap(await api.patch('/users/me', form));
      setUser(data.user);
      toast.success('Profile updated');
    } catch (err) {
      setErrors(Object.fromEntries((err.details || []).map((d) => [d.field, d.message])));
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="card max-w-2xl space-y-5 p-6">
      <div className="flex items-center gap-4">
        <span className="grid size-14 place-items-center rounded-full bg-ink font-display text-2xl text-paper">{user.name[0]?.toUpperCase()}</span>
        <div>
          <p className="font-semibold">{user.email}</p>
          <p className="text-sm text-muted">Member since {formatDate(user.createdAt, { month: 'long', year: 'numeric' })}</p>
        </div>
        {user.role === 'admin' && <Badge tone="bg-accent-soft text-accent">Admin</Badge>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Phone" value={form.phone} error={errors.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <Field label="Email" value={user.email} disabled hint="Contact support to change your email address." />
      <Button type="submit" loading={saving} disabled={form.name === user.name && form.phone === (user.phone || '')}>
        Save changes
      </Button>
    </form>
  );
}

function Addresses() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // address object or {} for new
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: async () => unwrap(await api.get('/users/me/addresses')) });

  const set = (list) => queryClient.setQueryData(['addresses'], list);

  const save = async (payload) => {
    const list = editing?._id
      ? unwrap(await api.patch(`/users/me/addresses/${editing._id}`, payload))
      : unwrap(await api.post('/users/me/addresses', payload));
    set(list);
    setEditing(null);
    toast.success('Address saved');
  };

  const makeDefault = async (a) => {
    try {
      set(unwrap(await api.patch(`/users/me/addresses/${a._id}`, { isDefault: true })));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      set(unwrap(await api.delete(`/users/me/addresses/${deleting._id}`)));
      toast.info('Address removed');
      setDeleting(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (addresses.isLoading) return <Skeleton className="h-40" />;

  return (
    <div>
      {!addresses.data?.length ? (
        <EmptyState icon={MapPin} title="No saved addresses" description="Add an address to check out faster." action={<Button onClick={() => setEditing({})}>Add address</Button>} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {addresses.data.map((a) => (
              <div key={a._id} className="card flex flex-col p-5 text-sm">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{a.fullName}</p>
                  <Badge>{a.label}</Badge>
                  {a.isDefault && <Badge tone="bg-forest-soft text-forest">Default</Badge>}
                </div>
                <p className="mt-2 text-ink-soft">
                  {a.line1}
                  {a.line2 && `, ${a.line2}`}, {a.city}, {a.state} – {a.postalCode}
                </p>
                <p className="mt-1 text-muted">{a.phone}</p>
                <div className="mt-4 flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                    <Pencil className="size-3.5" /> Edit
                  </Button>
                  {!a.isDefault && (
                    <Button size="sm" variant="ghost" onClick={() => makeDefault(a)}>
                      Set as default
                    </Button>
                  )}
                  <Button size="sm" variant="danger-ghost" onClick={() => setDeleting(a)}>
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {addresses.data.length < 10 && (
            <Button variant="secondary" className="mt-5" onClick={() => setEditing({})}>
              <Plus className="size-4" /> Add address
            </Button>
          )}
        </>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?._id ? 'Edit address' : 'New address'} size="max-w-2xl">
        {editing && <AddressForm initial={editing} onSubmit={save} onCancel={() => setEditing(null)} />}
      </Modal>
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy} danger title="Remove address?" message="This address will be removed from your account." confirmLabel="Remove" />
    </div>
  );
}

function Security() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.currentPassword) errs.currentPassword = 'Enter your current password';
    if (form.newPassword.length < 8 || !/[A-Za-z]/.test(form.newPassword) || !/\d/.test(form.newPassword)) errs.newPassword = 'At least 8 characters with a letter and a number';
    if (form.confirm !== form.newPassword) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const data = unwrap(await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword }));
      setAccessToken(data.accessToken);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success(data.message);
    } catch (err) {
      if (err.code === 'INVALID_PASSWORD') setErrors({ currentPassword: err.message });
      else toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="card max-w-xl space-y-4 p-6">
      <p className="text-sm text-ink-soft">Changing your password signs you out on every other device.</p>
      <Field label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} error={errors.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
      <Field label="New password" type="password" autoComplete="new-password" value={form.newPassword} error={errors.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
      <Field label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} error={errors.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
      <Button type="submit" loading={saving}>
        Update password
      </Button>
    </form>
  );
}

const TABS = [
  ['profile', 'Profile', User, Profile],
  ['addresses', 'Addresses', MapPin, Addresses],
  ['security', 'Security', KeyRound, Security],
];

export default function Account() {
  useDocumentTitle('My account');
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t[0] === params.get('tab')) || TABS[0];
  const Panel = tab[3];
  return (
    <div className="container-page py-10 lg:py-14">
      <p className="eyebrow">Account</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">My account</h1>
      <div className="mt-8 flex gap-1 border-b border-line" role="tablist">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab[0] === key}
            onClick={() => setParams({ tab: key })}
            className={cx('-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition', tab[0] === key ? 'border-accent text-accent' : 'border-transparent text-ink-soft hover:text-ink')}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      <div className="mt-8 animate-fade-up" key={tab[0]}>
        <Panel />
      </div>
    </div>
  );
}
