'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

interface Branch {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
}
interface BranchAssignment {
  branchId: string;
  branch: { id: string; name: string; slug: string };
}
interface Member {
  id: string;
  userId: string;
  role: string;
  status: string;
  user: { id: string; email: string; displayName: string };
  branchAssignments: BranchAssignment[];
}

const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF', 'WAITER'] as const;

function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusColor(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-50 text-emerald-700';
    case 'INVITED': return 'bg-amber-50 text-amber-800';
    case 'SUSPENDED': return 'bg-red-50 text-red-700';
    case 'REVOKED': return 'bg-slate-100 text-slate-500';
    default: return 'bg-slate-100 text-slate-600';
  }
}

/* -------------------------------------------------------------------------- */
/*                          TeamManagement                                    */
/* -------------------------------------------------------------------------- */

export function TeamManagement() {
  const { accessToken, csrfToken, profile } = useAuth();
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const [tab, setTab] = useState('team');
  const [notice, setNotice] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['memberships', tenantId] });
    queryClient.invalidateQueries({ queryKey: ['branches'] });
  };

  const members = useQuery({
    queryKey: ['memberships', tenantId],
    enabled: Boolean(accessToken && tenantId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<Member[]>>('/memberships', { accessToken, tenantId })).data,
  });

  const branches = useQuery({
    queryKey: ['branches'],
    enabled: Boolean(accessToken),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<Branch[]>>('/branches', { accessToken, tenantId })).data,
  });

  if (!membership || !['OWNER', 'MANAGER'].includes(membership.role)) {
    return <p role="alert">Permission denied.</p>;
  }

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">People &amp; locations</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Team &amp; branches</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Invite staff, assign roles, and manage branch access.
          </p>
        </div>
        <button
          onClick={() => { setNotice(null); setShowInvite(true); }}
          className="min-h-11 rounded-xl bg-dark px-5 text-sm font-bold text-white shadow-sm transition hover:bg-dark-muted"
        >
          + Invite member
        </button>
      </div>

      {notice && (
        <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
          {notice}
        </div>
      )}

      {(members.isLoading || branches.isLoading) && (
        <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading team…</p>
      )}

      {(members.isError || branches.isError) && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          Could not load team data. Check the API connection and try again.
        </div>
      )}

      {!members.isLoading && !members.isError && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="team">Team ({members.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="branches">Branches ({branches.data?.length ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="team">
            <TeamList
              members={members.data ?? []}
              branches={branches.data ?? []}
              accessToken={accessToken!}
              csrfToken={csrfToken}
              tenantId={tenantId}
              myUserId={profile?.id ?? ''}
              onNotice={setNotice}
              onInvalidate={invalidate}
            />
          </TabsContent>

          <TabsContent value="branches">
            <BranchesList
              branches={branches.data ?? []}
              accessToken={accessToken!}
              csrfToken={csrfToken}
              tenantId={tenantId}
              isOwner={membership.role === 'OWNER'}
              onNotice={setNotice}
              onInvalidate={invalidate}
            />
          </TabsContent>
        </Tabs>
      )}

      {showInvite && (
        <InviteDialog
          branches={branches.data ?? []}
          accessToken={accessToken!}
          csrfToken={csrfToken}
          tenantId={tenantId}
          callerRole={membership.role}
          onClose={() => setShowInvite(false)}
          onCreated={async () => {
            setShowInvite(false);
            await members.refetch();
            setNotice('Invitation sent.');
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                              TeamList                                      */
/* -------------------------------------------------------------------------- */

function TeamList({
  members,
  branches,
  accessToken,
  csrfToken,
  tenantId,
  myUserId,
  onNotice,
  onInvalidate,
}: {
  members: Member[];
  branches: Branch[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  myUserId: string;
  onNotice: (msg: string | null) => void;
  onInvalidate: () => void;
}) {
  const [editing, setEditing] = useState<Member | null>(null);

  if (members.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">No team members</p>
          <p className="mt-2 text-sm text-ink-muted">Invite your first team member to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-black/[.07] bg-white shadow-sm">
        <table className="w-full min-w-[700px] text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-ink-muted">
              <th className="px-5 py-4">Member</th>
              <th className="px-5 py-4">Role</th>
              <th className="px-5 py-4">Branch access</th>
              <th className="px-5 py-4">Status</th>
              <th className="px-5 py-4" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const branchNames = m.branchAssignments.map((a) => a.branch.name).join(', ') || 'All branches';
              return (
                <tr className="border-t border-line text-sm" key={m.id}>
                  <td className="px-5 py-5">
                    <p className="font-black">{m.user.displayName}</p>
                    <p className="text-xs text-ink-muted">{m.user.email}</p>
                  </td>
                  <td className="px-5 py-5">{roleLabel(m.role)}</td>
                  <td className="px-5 py-5 text-ink-muted">{branchNames}</td>
                  <td className="px-5 py-5">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black ${statusColor(m.status)}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-5 py-5">
                    {m.userId !== myUserId && (
                      <button
                        onClick={() => setEditing(m)}
                        className="font-black text-brand"
                      >
                        Manage
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditMemberDialog
          member={editing}
          branches={branches}
          accessToken={accessToken}
          csrfToken={csrfToken}
          tenantId={tenantId}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            onNotice('Member updated.');
            onInvalidate();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                             BranchesList                                   */
/* -------------------------------------------------------------------------- */

function BranchesList({
  branches,
  accessToken,
  csrfToken,
  tenantId,
  isOwner,
  onNotice,
  onInvalidate,
}: {
  branches: Branch[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  isOwner: boolean;
  onNotice: (msg: string | null) => void;
  onInvalidate: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  if (branches.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">No branches</p>
          <p className="mt-2 text-sm text-ink-muted">Create your first branch to organize tables and staff.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {branches.map((b) => (
          <div key={b.id} className="rounded-2xl border border-black/[.07] bg-white p-6 shadow-sm">
            <p className="text-xs font-black text-brand">BRANCH</p>
            <h2 className="mt-2 text-xl font-black">{b.name}</h2>
            <p className="mt-2 text-sm text-ink-muted">/{b.slug}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${
                b.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {b.isActive ? 'ACTIVE' : 'INACTIVE'}
              </span>
              {isOwner && (
                <button
                  onClick={() => setEditing(b)}
                  className="text-sm font-black text-brand"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <CreateBranchDialog
          accessToken={accessToken}
          csrfToken={csrfToken}
          tenantId={tenantId}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await onInvalidate();
            onNotice('Branch created.');
          }}
        />
      )}
      {editing && (
        <EditBranchDialog
          branch={editing}
          accessToken={accessToken}
          csrfToken={csrfToken}
          tenantId={tenantId}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            onInvalidate();
            onNotice('Branch updated.');
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                             InviteDialog                                   */
/* -------------------------------------------------------------------------- */

function InviteDialog({
  branches,
  accessToken,
  csrfToken,
  tenantId,
  callerRole,
  onClose,
  onCreated,
}: {
  branches: Branch[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  callerRole: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('CASHIER');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableRoles = callerRole === 'OWNER'
    ? [...ROLES]
    : ROLES.filter((r) => r !== 'OWNER');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return setError('Enter an email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/memberships/invitations', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          email: trimmed,
          role,
          branchIds: selectedBranches.length > 0 ? selectedBranches : undefined,
        },
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send invitation.');
    } finally {
      setBusy(false);
    }
  }

  function toggleBranch(branchId: string) {
    setSelectedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" aria-label="Invite team member">
        <DialogTitle>Invite team member</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Email address
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="colleague@example.com"
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          <label className="text-sm font-black">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 font-normal"
            >
              {availableRoles.map((r) => (
                <option value={r} key={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </label>
          {branches.length > 0 && (
            <div>
              <p className="text-sm font-black mb-2">Branch access</p>
              <p className="text-xs text-ink-muted mb-3">Leave unchecked for all-branch access.</p>
              <div className="space-y-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={selectedBranches.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="size-4 accent-brand"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              Cancel
            </button>
            <button disabled={busy || !email.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                            EditMemberDialog                                */
/* -------------------------------------------------------------------------- */

function EditMemberDialog({
  member,
  branches,
  accessToken,
  csrfToken,
  tenantId,
  onClose,
  onSaved,
}: {
  member: Member;
  branches: Branch[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [role, setRole] = useState(member.role);
  const [status, setStatus] = useState(member.status);
  const [selectedBranches, setSelectedBranches] = useState<string[]>(
    member.branchAssignments.map((a) => a.branchId)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/memberships/${member.id}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { role, status },
      });
      await apiRequest(`/memberships/${member.id}/branches`, {
        method: 'PUT',
        accessToken,
        csrfToken,
        tenantId,
        body: { branchIds: selectedBranches },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update member.');
    } finally {
      setBusy(false);
    }
  }

  function toggleBranch(branchId: string) {
    setSelectedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg" aria-label={`Manage ${member.user.displayName}`}>
        <DialogTitle>Manage {member.user.displayName}</DialogTitle>
        <p className="text-sm text-ink-muted">{member.user.email}</p>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-black">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 font-normal"
              >
                {ROLES.map((r) => (
                  <option value={r} key={r}>{roleLabel(r)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-black">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-3 font-normal"
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="REVOKED">Revoked</option>
              </select>
            </label>
          </div>
          {branches.length > 0 && (
            <div>
              <p className="text-sm font-black mb-2">Branch assignments</p>
              <div className="space-y-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={selectedBranches.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                      className="size-4 accent-brand"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              Cancel
            </button>
            <button disabled={busy} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                            CreateBranchDialog                              */
/* -------------------------------------------------------------------------- */

function CreateBranchDialog({
  accessToken,
  csrfToken,
  tenantId,
  onClose,
  onCreated,
}: {
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function autoSlug(value: string) {
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName) return setError('Enter a branch name.');
    if (!trimmedSlug) return setError('Enter a URL slug.');
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) return setError('Slug must be lowercase alphanumeric with hyphens only.');
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/branches', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: trimmedName, slug: trimmedSlug },
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create branch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label="Create branch">
        <DialogTitle>Create branch</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Branch name
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); autoSlug(e.target.value); }}
              maxLength={200}
              placeholder="e.g. Bole Main"
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          <label className="text-sm font-black">
            URL slug
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={100}
              placeholder="bole-main"
              pattern="[a-z0-9-]+"
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              Cancel
            </button>
            <button disabled={busy || !name.trim() || !slug.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Creating…' : 'Create branch'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                            EditBranchDialog                                */
/* -------------------------------------------------------------------------- */

function EditBranchDialog({
  branch,
  accessToken,
  csrfToken,
  tenantId,
  onClose,
  onSaved,
}: {
  branch: Branch;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(branch.name);
  const [isActive, setIsActive] = useState(branch.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a branch name.');
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/branches/${branch.id}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: trimmed, isActive },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update branch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label={`Edit branch ${branch.name}`}>
        <DialogTitle>Edit branch</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            Branch name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-sm font-black">
            <span>
              <span className="block">Active</span>
              <span className="mt-1 block text-xs font-normal text-ink-muted">Inactive branches are hidden from POS.</span>
            </span>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-5 accent-brand"
            />
          </label>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold">
              Cancel
            </button>
            <button disabled={busy || !name.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
