'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeEthiopianPhone, isValidEthiopianPhone } from '@rms/contracts';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  user: { id: string; displayName: string; phone: string | null };
  branchAssignments: BranchAssignment[];
}

const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN_STAFF', 'WAITER'] as const;

function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const roleKeys: Record<string, MessageKey> = {
  OWNER: 'team.roleOwner',
  MANAGER: 'team.roleManager',
  CASHIER: 'team.roleCashier',
  KITCHEN_STAFF: 'team.roleKitchenStaff',
  WAITER: 'team.roleWaiter',
};

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
  const { tr } = useLocale();
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
    return <p role="alert">{tr('team.permissionDenied')}</p>;
  }

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">{tr('team.eyebrow')}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{tr('team.pageTitle')}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {tr('team.pageDescription')}
          </p>
        </div>
        <button
          onClick={() => { setNotice(null); setShowInvite(true); }}
          className="min-h-11 rounded-xl bg-dark px-5 text-sm font-bold text-white shadow-sm transition hover:bg-dark-muted"
        >
          {tr('team.inviteBtn')}
        </button>
      </div>

      {notice && (
        <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
          {notice}
        </div>
      )}

      {(members.isLoading || branches.isLoading) && (
        <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('team.loading')}</p>
      )}

      {(members.isError || branches.isError) && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          {tr('team.loadError')}
        </div>
      )}

      {!members.isLoading && !members.isError && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="team">{tr('team.teamTab', { count: members.data?.length ?? 0 })}</TabsTrigger>
            <TabsTrigger value="branches">{tr('team.branchesTab', { count: branches.data?.length ?? 0 })}</TabsTrigger>
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
            setNotice(tr('team.inviteSent'));
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
  const { tr } = useLocale();
  const [editing, setEditing] = useState<Member | null>(null);

  if (members.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">{tr('team.emptyTitle')}</p>
          <p className="mt-2 text-sm text-ink-muted">{tr('team.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-black/[.07] bg-white shadow-sm">
        <table className="w-full min-w-[700px] text-start">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-ink-muted">
              <th className="px-5 py-4">{tr('team.thMember')}</th>
              <th className="px-5 py-4">{tr('team.thRole')}</th>
              <th className="px-5 py-4">{tr('team.branchAccess')}</th>
              <th className="px-5 py-4">{tr('team.thStatus')}</th>
              <th className="px-5 py-4" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const branchNames = m.branchAssignments.map((a) => a.branch.name).join(', ') || tr('team.allBranches');
              return (
                <tr className="border-t border-line text-sm" key={m.id}>
                  <td className="px-5 py-5">
                    <p className="font-black">{m.user.displayName}</p>
                    <p className="text-xs text-ink-muted">{m.user.phone ?? '—'}</p>
                  </td>
                  <td className="px-5 py-5">{roleKeys[m.role] ? tr(roleKeys[m.role]) : roleLabel(m.role)}</td>
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
                        {tr('team.manageBtn')}
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
            onNotice(tr('team.memberUpdated'));
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
  const { tr } = useLocale();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);

  if (branches.length === 0) {
    return (
      <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <div>
          <p className="text-lg font-black">{tr('team.noBranchesTitle')}</p>
          <p className="mt-2 text-sm text-ink-muted">{tr('team.noBranchesHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {branches.map((b) => (
          <div key={b.id} className="rounded-2xl border border-black/[.07] bg-white p-6 shadow-sm">
            <p className="text-xs font-black text-brand">{tr('team.branchBadge')}</p>
            <h2 className="mt-2 text-xl font-black">{b.name}</h2>
            <p className="mt-2 text-sm text-ink-muted">/{b.slug}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className={`rounded-full px-2 py-1 text-[10px] font-black ${
                b.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {b.isActive ? tr('team.activeBadge') : tr('team.inactiveBadge')}
              </span>
              {isOwner && (
                <button
                  onClick={() => setEditing(b)}
                  className="text-sm font-black text-brand"
                >
                  {tr('team.editBtn')}
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
            onNotice(tr('team.branchCreated'));
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
            onNotice(tr('team.branchUpdated'));
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
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>('CASHIER');
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  const availableRoles = callerRole === 'OWNER'
    ? [...ROLES]
    : ROLES.filter((r) => r !== 'OWNER');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) return setError(tr('team.enterPhone'));
    if (!isValidEthiopianPhone(trimmed)) return setError(tr('team.invalidPhone'));
    const normalizedPhone = normalizeEthiopianPhone(trimmed);
    if (!normalizedPhone) return setError(tr('team.invalidPhone'));
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/memberships/invitations', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          phone: normalizedPhone,
          role,
          branchIds: selectedBranches.length > 0 ? selectedBranches : undefined,
        },
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('team.inviteError'));
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
      <DialogContent className="max-w-lg" aria-label={tr('team.inviteTitle')}>
        <DialogTitle>{tr('team.inviteTitle')}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('team.phoneLabel')}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0911 234 567"
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          <label className="text-sm font-black">
            {tr('team.thRole')}
            <div className="mt-2"><Select value={role} onValueChange={setRole}><SelectTrigger className="min-h-12 font-normal"><SelectValue /></SelectTrigger><SelectContent>{availableRoles.map((r) => <SelectItem value={r} key={r}>{roleKeys[r] ? tr(roleKeys[r]) : roleLabel(r)}</SelectItem>)}</SelectContent></Select></div>
          </label>
          {branches.length > 0 && (
            <div>
              <p className="text-sm font-black mb-2">{tr('team.branchAccess')}</p>
              <p className="text-xs text-ink-muted mb-3">{tr('team.allBranchHint')}</p>
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
              {tr('common.cancel')}
            </button>
            <button disabled={busy || !phone.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('team.sending') : tr('team.sendInvitation')}
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
  const { tr } = useLocale();

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
      setError(err instanceof ApiError ? err.message : tr('team.updateMemberError'));
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
      <DialogContent className="max-w-lg" aria-label={tr('team.manageMember', { name: member.user.displayName })}>
        <DialogTitle>{tr('team.manageMember', { name: member.user.displayName })}</DialogTitle>
        <p className="text-sm text-ink-muted">{member.user.phone ?? '—'}</p>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-black">
              {tr('team.thRole')}
              <div className="mt-2"><Select value={role} onValueChange={setRole}><SelectTrigger className="min-h-12 font-normal"><SelectValue /></SelectTrigger><SelectContent>{ROLES.map((r) => <SelectItem value={r} key={r}>{roleKeys[r] ? tr(roleKeys[r]) : roleLabel(r)}</SelectItem>)}</SelectContent></Select></div>
            </label>
            <label className="text-sm font-black">
              {tr('team.thStatus')}
              <div className="mt-2"><Select value={status} onValueChange={setStatus}><SelectTrigger className="min-h-12 font-normal"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ACTIVE">{tr('team.statusSelectActive')}</SelectItem><SelectItem value="SUSPENDED">{tr('team.statusSelectSuspended')}</SelectItem><SelectItem value="REVOKED">{tr('team.statusSelectRevoked')}</SelectItem></SelectContent></Select></div>
            </label>
          </div>
          {branches.length > 0 && (
            <div>
              <p className="text-sm font-black mb-2">{tr('team.branchAssignments')}</p>
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
              {tr('common.cancel')}
            </button>
            <button disabled={busy} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('team.saving') : tr('team.saveChanges')}
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
  const { tr } = useLocale();

  function autoSlug(value: string) {
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName) return setError(tr('team.enterBranchName'));
    if (!trimmedSlug) return setError(tr('team.enterSlug'));
    if (!/^[a-z0-9-]+$/.test(trimmedSlug)) return setError(tr('team.slugRule'));
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
      setError(err instanceof ApiError ? err.message : tr('team.createBranchError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label={tr('team.createBranch')}>
        <DialogTitle>{tr('team.createBranch')}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('team.branchNameLabel')}
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); autoSlug(e.target.value); }}
              maxLength={200}
              placeholder={tr('team.branchNamePlaceholder')}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
              autoFocus
            />
          </label>
          <label className="text-sm font-black">
            {tr('team.slugLabel')}
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
              {tr('common.cancel')}
            </button>
            <button disabled={busy || !name.trim() || !slug.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('team.creating') : tr('team.createBranch')}
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
  const { tr } = useLocale();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError(tr('team.enterBranchName'));
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
      setError(err instanceof ApiError ? err.message : tr('team.updateBranchError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" aria-label={tr('team.editBranchAria', { name: branch.name })}>
        <DialogTitle>{tr('team.editBranchTitle')}</DialogTitle>
        <form onSubmit={submit} className="mt-4 grid gap-4">
          <label className="text-sm font-black">
            {tr('team.branchNameLabel')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-sm font-black">
            <span>
              <span className="block">{tr('team.activeLabel')}</span>
              <span className="mt-1 block text-xs font-normal text-ink-muted">{tr('team.inactiveHint')}</span>
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
              {tr('common.cancel')}
            </button>
            <button disabled={busy || !name.trim()} className="min-h-10 rounded-lg bg-dark px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? tr('team.saving') : tr('team.saveBtn')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
