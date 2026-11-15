import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, unwrapPage } from '../../lib/api';
import { formatDate, formatPrice } from '../../lib/format';
import { useDebounce, useDocumentTitle } from '../../hooks';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, ConfirmModal, ErrorState, Pagination, Skeleton } from '../../components/ui';
import { AdminHeader, Table } from './AdminLayout';

export default function Users() {
  useDocumentTitle('Customers');
  const { user: me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState(null); // { user, patch, title, message }
  const [busy, setBusy] = useState(false);
  const term = useDebounce(q, 300);

  const list = useQuery({
    queryKey: ['admin', 'users', term, role, page],
    queryFn: async () => unwrapPage(await api.get('/admin/users', { params: { q: term || undefined, role: role || undefined, page, limit: 20 } })),
    placeholderData: keepPreviousData,
  });

  const confirm = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/users/${action.user.id}`, action.patch);
      toast.success('Account updated');
      setAction(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <AdminHeader title="Customers" description="Accounts, lifetime value and access control." />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className="field h-10 pl-9" placeholder="Name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search customers" />
        </div>
        <select className="field h-10 w-auto" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Filter by role">
          <option value="">All roles</option>
          <option value="customer">Customers</option>
          <option value="admin">Admins</option>
        </select>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.isLoading ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <Table head={['Name', 'Joined', 'Last sign-in', 'Orders', 'Spent', 'Role', '']} empty={!list.data.items.length && <p className="p-8 text-center text-sm text-muted">No accounts found.</p>}>
          {list.data.items.map((u) => {
            const self = u.id === me?.id;
            return (
              <tr key={u.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">
                    {u.name} {self && <span className="text-xs text-muted">(you)</span>}
                  </p>
                  <p className="text-xs text-muted">{u.email}</p>
                </td>
                <td className="px-4 py-3 text-ink-soft">{formatDate(u.createdAt)}</td>
                <td className="px-4 py-3 text-ink-soft">{u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</td>
                <td className="px-4 py-3 tabular-nums">{u.orders}</td>
                <td className="px-4 py-3 tabular-nums">{formatPrice(u.spent)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {u.role === 'admin' ? <Badge tone="bg-accent-soft text-accent">Admin</Badge> : <Badge>Customer</Badge>}
                    {u.isBlocked && <Badge tone="bg-danger-soft text-danger">Blocked</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {!self && (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setAction({
                            user: u,
                            patch: { role: u.role === 'admin' ? 'customer' : 'admin' },
                            title: u.role === 'admin' ? `Remove admin access for ${u.name}?` : `Make ${u.name} an admin?`,
                            message: u.role === 'admin' ? 'They will lose access to the admin dashboard immediately.' : 'Admins can manage the catalog, orders, coupons and customer accounts.',
                          })
                        }
                      >
                        {u.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                      </Button>
                      <Button
                        size="sm"
                        variant={u.isBlocked ? 'ghost' : 'danger-ghost'}
                        onClick={() =>
                          setAction({
                            user: u,
                            patch: { isBlocked: !u.isBlocked },
                            title: u.isBlocked ? `Unblock ${u.name}?` : `Block ${u.name}?`,
                            message: u.isBlocked ? 'They will be able to sign in and shop again.' : 'They will be signed out everywhere and unable to sign in.',
                          })
                        }
                      >
                        {u.isBlocked ? 'Unblock' : 'Block'}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      <Pagination meta={list.data?.meta} onChange={setPage} />
      <ConfirmModal open={Boolean(action)} onClose={() => setAction(null)} onConfirm={confirm} loading={busy} danger={action?.patch?.isBlocked} title={action?.title} message={action?.message} confirmLabel="Confirm" />
    </div>
  );
}
