'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { useAuth } from './auth-provider';
import { useLocale } from '@/components/locale-provider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

interface Category {
  id: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}
interface Variant {
  id: string;
  name: string;
  basePriceMinor: string;
  isDefault: boolean;
  isActive?: boolean;
}
interface ModifierOption {
  id: string;
  name: string;
  priceDeltaMinor: string;
}
interface ModifierGroup {
  id: string;
  name: string;
  isRequired?: boolean;
  minSelections?: number;
  maxSelections?: number | null;
  options?: ModifierOption[];
}
interface BranchAvailability {
  branchId: string;
  isAvailable: boolean;
}
interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  category: Category | null;
  variants: Variant[];
  modifierGroups?: ModifierGroup[];
  branchAvailability?: BranchAvailability[];
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function priceToMinor(value: string): number | null {
  const normalized = value.trim().replace(/,/g, '');
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}

/* -------------------------------------------------------------------------- */
/*                            CategoryManager                                 */
/* -------------------------------------------------------------------------- */

function CategoryManager({
  categories,
  accessToken,
  csrfToken,
  tenantId,
}: {
  categories: Category[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
}) {
  const queryClient = useQueryClient();
  const { tr } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalog-categories', tenantId] });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest('/categories', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: newName.trim(), description: newDesc.trim() || undefined },
      }),
    onSuccess: async () => {
      setAdding(false);
      setNewName('');
      setNewDesc('');
      await invalidate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/categories/${id}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: editName.trim(), description: editDesc.trim() || undefined },
      }),
    onSuccess: async () => {
      setEditingId(null);
      await invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/categories/${id}`, { method: 'DELETE', accessToken, csrfToken, tenantId }),
    onSuccess: async () => {
      setDeleteId(null);
      await invalidate();
    },
  });

  return (
    <div className="rounded-2xl border border-black/[.07] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex min-h-14 w-full items-center justify-between px-5 text-start"
        aria-expanded={expanded}
      >
        <span className="text-sm font-black">{tr('menu.categoriesCount', { count: categories.length })}</span>
        <span className="text-xs font-bold text-ink-muted">{expanded ? tr('menu.hide') : tr('menu.show')}</span>
      </button>
      {expanded && (
        <div className="border-t border-line px-5 pb-5 pt-4">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
              {editingId === cat.id ? (
                <div className="flex flex-1 gap-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm font-bold"
                    aria-label={tr('menu.categoryNameAria')}
                  />
                  <input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder={tr('menu.descriptionPlaceholder')}
                    className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm"
                    aria-label={tr('menu.categoryDescAria')}
                  />
                  <button
                    onClick={() => updateMutation.mutate(cat.id)}
                    disabled={updateMutation.isPending || !editName.trim()}
                    className="min-h-10 rounded-lg bg-brand px-3 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {tr('menu.save')}
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="min-h-10 rounded-lg border border-line px-3 text-xs font-bold"
                  >
                    {tr('common.cancel')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <span className="text-sm font-bold">{cat.name}</span>
                    {cat.description && (
                      <span className="ms-2 text-xs text-ink-muted">{cat.description}</span>
                    )}
                  </div>
                  <span
                    className={`size-2 rounded-full ${cat.isActive !== false ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  />
                  <button
                    onClick={() => {
                      setEditingId(cat.id);
                      setEditName(cat.name);
                      setEditDesc(cat.description ?? '');
                    }}
                    className="min-h-9 rounded-lg border border-line px-2 text-xs font-bold"
                  >
                    {tr('menu.edit')}
                  </button>
                  <button
                    onClick={() => setDeleteId(cat.id)}
                    className="min-h-9 rounded-lg border border-red-200 px-2 text-xs font-bold text-red-700"
                  >
                    {tr('menu.delete')}
                  </button>
                </>
              )}
            </div>
          ))}
          {adding ? (
            <div className="mt-3 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={tr('menu.categoryNameAria')}
                className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm font-bold"
                autoFocus
                aria-label={tr('menu.newCategoryNameAria')}
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder={tr('menu.descriptionOptional')}
                className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm"
                aria-label={tr('menu.newCategoryDescAria')}
              />
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !newName.trim()}
                className="min-h-10 rounded-lg bg-brand px-3 text-xs font-bold text-white disabled:opacity-50"
              >
                {tr('menu.add')}
              </button>
              <button
                onClick={() => { setAdding(false); setNewName(''); setNewDesc(''); }}
                className="min-h-10 rounded-lg border border-line px-3 text-xs font-bold"
              >
                {tr('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="mt-3 min-h-10 rounded-lg border border-dashed border-line px-4 text-xs font-bold text-ink-muted hover:border-brand hover:text-brand"
            >
              {tr('menu.addCategory')}
            </button>
          )}
        </div>
      )}
      {deleteId && (
        <Dialog open onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
          <DialogContent className="max-w-sm" aria-label={tr('menu.deleteCategory')}>
            <DialogTitle>{tr('menu.deleteCategory')}</DialogTitle>
            <p className="mt-2 text-sm text-ink-muted">
              {tr('menu.deleteCategoryBody')}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteId(null)}
                className="min-h-10 rounded-lg border border-line px-4 text-sm font-bold"
              >
                {tr('common.cancel')}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {deleteMutation.isPending ? tr('menu.deleting') : tr('menu.delete')}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          AvailabilityToggle                                */
/* -------------------------------------------------------------------------- */

function AvailabilityToggle({
  item,
  branchId,
  accessToken,
  csrfToken,
  tenantId,
}: {
  item: MenuItem;
  branchId: string;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
}) {
  const queryClient = useQueryClient();
  const { tr } = useLocale();
  const isAvailable = item.branchAvailability?.some(
    (b) => b.branchId === branchId && b.isAvailable,
  ) ?? false;

  const toggleMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/items/${item.id}/branches/${branchId}/availability`, {
        method: 'PUT',
        accessToken,
        csrfToken,
        tenantId,
        body: { isAvailable: !isAvailable },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-items', tenantId] });
    },
  });

  if (!branchId) return null;

  return (
    <button
      onClick={() => toggleMutation.mutate()}
      disabled={toggleMutation.isPending}
      role="switch"
      aria-checked={isAvailable}
      aria-label={isAvailable ? tr('menu.removeFromBranch') : tr('menu.addToBranch')}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        isAvailable ? 'bg-brand' : 'bg-slate-300'
      } disabled:opacity-50`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${
          isAvailable ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*                            CreateMenuItemDialog                            */
/* -------------------------------------------------------------------------- */

function CreateMenuItemDialog({
  categories,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
  onCreated,
}: {
  categories: Category[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
  onCreated: (name: string) => Promise<void>;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const basePriceMinor = priceToMinor(price);
    if (!trimmedName) return setError(tr('menu.enterName'));
    if (basePriceMinor === null)
      return setError(tr('menu.enterPrice'));
    setBusy(true);
    setError(null);
    try {
      const created = await apiRequest<ApiEnvelope<{ id: string }>>('/items', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          name: trimmedName,
          description: description.trim() || undefined,
          categoryId: categoryId || undefined,
          sku: sku.trim() || undefined,
        },
      });
      await apiRequest(`/items/${created.data.id}/variants`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: 'Regular', basePriceMinor, isDefault: true },
      });
      if (available && branchId)
        await apiRequest(`/items/${created.data.id}/branches/${branchId}/availability`, {
          method: 'PUT',
          accessToken,
          csrfToken,
          tenantId,
          body: { isAvailable: true },
        });
      await onCreated(trimmedName);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : tr('menu.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl" aria-label={tr('menu.addMenuItemAria')}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-brand">{tr('menu.catalogEyebrow')}</p>
          <DialogTitle className="mt-2 text-2xl font-black">{tr('menu.addMenuItem')}</DialogTitle>
          <p className="mt-1 text-sm text-ink-muted">{tr('menu.addMenuItemDesc')}</p>
        </div>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <label className="text-sm font-black">
            {tr('menu.itemName')}
            <input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              placeholder={tr('menu.itemNamePlaceholder')}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="text-sm font-black">
            {tr('menu.descriptionLabel')} <span className="font-normal text-ink-muted">{tr('menu.optionalSuffix')}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder={tr('menu.descPlaceholder')}
              className="mt-2 w-full rounded-xl border border-line bg-white p-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-black">
              {tr('menu.category')}
              <div className="mt-2"><Select value={categoryId || 'uncategorized'} onValueChange={(value) => setCategoryId(value === 'uncategorized' ? '' : value)}><SelectTrigger className="min-h-12 font-normal"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="uncategorized">{tr('menu.uncategorized')}</SelectItem>{categories.map((category) => <SelectItem value={category.id} key={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></div>
            </label>
            <label className="text-sm font-black">
              {tr('menu.priceEtb')}
              <input
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal tabular-nums outline-none focus:ring-2 focus:ring-brand/20"
              />
            </label>
          </div>
          <label className="text-sm font-black">
            {tr('menu.sku')} <span className="font-normal text-ink-muted">{tr('menu.optionalSuffix')}</span>
            <input
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder={tr('menu.skuPlaceholder')}
              className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <label className="flex min-h-14 cursor-pointer items-center justify-between rounded-xl border border-line bg-white px-4 text-sm font-black">
            <span>
              <span className="block">{tr('menu.availableAtBranch')}</span>
              <span className="mt-1 block text-xs font-normal text-ink-muted">
                {tr('menu.availableHint')}
              </span>
            </span>
            <input
              type="checkbox"
              checked={available}
              onChange={(event) => setAvailable(event.target.checked)}
              className="size-5 accent-brand"
            />
          </label>
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-3 border-t border-line pt-5">
            <button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-xl border border-line bg-white px-5 font-bold">
              {tr('common.cancel')}
            </button>
            <button disabled={busy} className="min-h-11 rounded-xl bg-dark px-6 font-black text-white disabled:opacity-50">
              {busy ? tr('menu.adding') : tr('menu.addMenuItem')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                            ItemDetailDialog                                */
/* -------------------------------------------------------------------------- */

function ItemDetailDialog({
  item,
  categories,
  accessToken,
  csrfToken,
  tenantId,
  branchId,
  onClose,
}: {
  item: MenuItem;
  categories: Category[];
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
  branchId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('details');
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [categoryId, setCategoryId] = useState(item.category?.id ?? '');
  const [sku, setSku] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { tr } = useLocale();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalog-items', tenantId] });

  const updateItemMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/items/${item.id}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          categoryId: categoryId || undefined,
          sku: sku.trim() || undefined,
        },
      }),
    onSuccess: async () => { await invalidate(); onClose(); },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : tr('menu.updateFailed')),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/items/${item.id}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { isActive: !item.isActive },
      }),
    onSuccess: () => invalidate(),
  });

  const deleteItemMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/items/${item.id}`, { method: 'DELETE', accessToken, csrfToken, tenantId }),
    onSuccess: async () => { await invalidate(); onClose(); },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-label={tr('menu.editItemAria', { name: item.name })}>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-brand">{tr('menu.catalogEyebrow')}</p>
          <DialogTitle className="mt-2 text-2xl font-black">{item.name}</DialogTitle>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-5">
          <TabsList>
            <TabsTrigger value="details">{tr('menu.detailsTab')}</TabsTrigger>
            <TabsTrigger value="variants">{tr('menu.variantsCount', { count: item.variants.length })}</TabsTrigger>
            <TabsTrigger value="modifiers">{tr('menu.modifiersCount', { count: item.modifierGroups?.length ?? 0 })}</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <div className="mt-4 grid gap-4">
              <label className="text-sm font-black">
                {tr('menu.itemName')}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <label className="text-sm font-black">
                {tr('menu.descriptionLabel')}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-line bg-white p-4 font-normal outline-none focus:ring-2 focus:ring-brand/20"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-black">
                  {tr('menu.category')}
                  <div className="mt-2"><Select value={categoryId || 'uncategorized'} onValueChange={(value) => setCategoryId(value === 'uncategorized' ? '' : value)}><SelectTrigger className="min-h-12 font-normal"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="uncategorized">{tr('menu.uncategorized')}</SelectItem>{categories.map((c) => <SelectItem value={c.id} key={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                </label>
                <label className="text-sm font-black">
                  {tr('menu.sku')}
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder={tr('menu.optional')}
                    className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-normal"
                  />
                </label>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-black">{item.isActive ? tr('status.active') : tr('status.inactive')}</p>
                  <p className="text-xs text-ink-muted">{tr('menu.inactiveHint')}</p>
                </div>
                <button
                  onClick={() => toggleActiveMutation.mutate()}
                  disabled={toggleActiveMutation.isPending}
                  role="switch"
                  aria-checked={item.isActive}
                  aria-label={tr('menu.toggleActiveAria')}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    item.isActive ? 'bg-brand' : 'bg-slate-300'
                  } disabled:opacity-50`}
                >
                  <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${
                    item.isActive ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
              {branchId && (
                <div className="flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-black">{tr('menu.availableAtBranch')}</p>
                    <p className="text-xs text-ink-muted">{tr('menu.branchVisibilityHint')}</p>
                  </div>
                  <AvailabilityToggle
                    item={item}
                    branchId={branchId}
                    accessToken={accessToken}
                    csrfToken={csrfToken}
                    tenantId={tenantId}
                  />
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="variants">
            <VariantsPanel
              item={item}
              accessToken={accessToken}
              csrfToken={csrfToken}
              tenantId={tenantId}
            />
          </TabsContent>

          <TabsContent value="modifiers">
            <ModifierGroupsPanel
              item={item}
              accessToken={accessToken}
              csrfToken={csrfToken}
              tenantId={tenantId}
            />
          </TabsContent>
        </Tabs>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
          <button
            onClick={() => { if (confirm(tr('menu.deleteItemConfirm'))) deleteItemMutation.mutate(); }}
            disabled={deleteItemMutation.isPending}
            className="min-h-10 rounded-lg border border-red-200 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {tr('menu.deleteItem')}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="min-h-11 rounded-xl border border-line bg-white px-5 font-bold">
              {tr('common.cancel')}
            </button>
            <button
              onClick={() => updateItemMutation.mutate()}
              disabled={updateItemMutation.isPending || !name.trim()}
              className="min-h-11 rounded-xl bg-dark px-6 font-black text-white disabled:opacity-50"
            >
              {updateItemMutation.isPending ? tr('menu.saving') : tr('menu.saveChanges')}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*                              VariantsPanel                                 */
/* -------------------------------------------------------------------------- */

function VariantsPanel({
  item,
  accessToken,
  csrfToken,
  tenantId,
}: {
  item: MenuItem;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
}) {
  const { formatCurrency, tr } = useLocale();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalog-items', tenantId] });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/items/${item.id}/variants`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: formName.trim(), basePriceMinor: priceToMinor(formPrice), isDefault: item.variants.length === 0 },
      }),
    onSuccess: async () => { setAdding(false); setFormName(''); setFormPrice(''); await invalidate(); },
  });

  const updateMutation = useMutation({
    mutationFn: (variantId: string) =>
      apiRequest(`/variants/${variantId}`, {
        method: 'PATCH',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: formName.trim(), basePriceMinor: priceToMinor(formPrice) },
      }),
    onSuccess: async () => { setEditId(null); setFormName(''); setFormPrice(''); await invalidate(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (variantId: string) =>
      apiRequest(`/variants/${variantId}`, { method: 'DELETE', accessToken, csrfToken, tenantId }),
    onSuccess: () => invalidate(),
  });

  return (
    <div className="mt-4 space-y-3">
      {item.variants.map((v) => (
        <div key={v.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3">
          {editId === v.id ? (
            <>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm font-bold"
                aria-label={tr('menu.variantNameAria')}
              />
              <input
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
                inputMode="decimal"
                placeholder="ETB"
                className="min-h-10 w-28 rounded-lg border border-line px-3 text-sm tabular-nums"
                aria-label={tr('menu.variantPriceAria')}
              />
              <button
                onClick={() => updateMutation.mutate(v.id)}
                disabled={updateMutation.isPending || !formName.trim()}
                className="min-h-10 rounded-lg bg-brand px-3 text-xs font-bold text-white disabled:opacity-50"
              >
                {tr('menu.save')}
              </button>
              <button onClick={() => setEditId(null)} className="min-h-10 rounded-lg border border-line px-3 text-xs font-bold">
                {tr('common.cancel')}
              </button>
            </>
          ) : (
            <>
              <div className="flex-1">
                <span className="text-sm font-bold">{v.name}</span>
                {v.isDefault && (
                  <span className="ms-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-black text-brand">
                    {tr('menu.defaultBadge')}
                  </span>
                )}
              </div>
              <span className="text-sm font-bold tabular-nums">{formatCurrency(v.basePriceMinor)}</span>
              <button
                onClick={() => { setEditId(v.id); setFormName(v.name); setFormPrice(''); }}
                className="min-h-9 rounded-lg border border-line px-2 text-xs font-bold"
              >
                {tr('menu.edit')}
              </button>
              {!v.isDefault && (
                <button
                  onClick={() => { if (confirm(tr('menu.deleteVariantConfirm'))) deleteMutation.mutate(v.id); }}
                  disabled={deleteMutation.isPending}
                  className="min-h-9 rounded-lg border border-red-200 px-2 text-xs font-bold text-red-700"
                >
                  {tr('menu.delete')}
                </button>
              )}
            </>
          )}
        </div>
      ))}
      {adding ? (
        <div className="flex gap-2">
          <input
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={tr('menu.newVariantNamePlaceholder')}
            className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm font-bold"
            autoFocus
            aria-label={tr('menu.newVariantNameAria')}
          />
          <input
            value={formPrice}
            onChange={(e) => setFormPrice(e.target.value)}
            inputMode="decimal"
            placeholder="ETB"
            className="min-h-10 w-28 rounded-lg border border-line px-3 text-sm tabular-nums"
            aria-label={tr('menu.newVariantPriceAria')}
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !formName.trim() || priceToMinor(formPrice) === null}
            className="min-h-10 rounded-lg bg-brand px-3 text-xs font-bold text-white disabled:opacity-50"
          >
            {tr('menu.add')}
          </button>
          <button
            onClick={() => { setAdding(false); setFormName(''); setFormPrice(''); }}
            className="min-h-10 rounded-lg border border-line px-3 text-xs font-bold"
          >
            {tr('common.cancel')}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="min-h-10 rounded-lg border border-dashed border-line px-4 text-xs font-bold text-ink-muted hover:border-brand hover:text-brand"
        >
          {tr('menu.addVariant')}
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          ModifierGroupsPanel                               */
/* -------------------------------------------------------------------------- */

function ModifierGroupsPanel({
  item,
  accessToken,
  csrfToken,
  tenantId,
}: {
  item: MenuItem;
  accessToken: string;
  csrfToken: string | null;
  tenantId: string;
}) {
  const { formatCurrency, tr } = useLocale();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [newOptionName, setNewOptionName] = useState('');
  const [newOptionPrice, setNewOptionPrice] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['catalog-items', tenantId] });

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const created = await apiRequest<ApiEnvelope<{ id: string }>>('/modifier-groups', {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { name: groupName.trim(), isRequired },
      });
      await apiRequest(`/items/${item.id}/modifier-groups`, {
        method: 'POST',
        accessToken,
        csrfToken,
        tenantId,
        body: { modifierGroupId: created.data.id },
      });
      if (newOptionName.trim()) {
        await apiRequest(`/modifier-groups/${created.data.id}/options`, {
          method: 'POST',
          accessToken,
          csrfToken,
          tenantId,
          body: { name: newOptionName.trim(), priceDeltaMinor: priceToMinor(newOptionPrice) ?? 0 },
        });
      }
    },
    onSuccess: async () => {
      setShowCreate(false);
      setGroupName('');
      setIsRequired(false);
      setNewOptionName('');
      setNewOptionPrice('');
      await invalidate();
    },
  });

  return (
    <div className="mt-4 space-y-3">
      {(item.modifierGroups ?? []).map((mg) => (
        <div key={mg.id} className="rounded-xl border border-line bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-bold">{mg.name}</span>
              {mg.isRequired && (
                <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">
                  {tr('menu.requiredBadge')}
                </span>
              )}
            </div>
            <span className="text-xs text-ink-muted">{tr('menu.optionsCount', { count: mg.options?.length ?? 0 })}</span>
          </div>
          {(mg.options ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(mg.options ?? []).map((opt) => (
                <span
                  key={opt.id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-bold"
                >
                  {opt.name}
                  {opt.priceDeltaMinor !== '0' && (
                    <span className="text-brand">+{formatCurrency(opt.priceDeltaMinor)}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      {showCreate ? (
        <div className="rounded-xl border border-line bg-white p-4 space-y-3">
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder={tr('menu.groupPlaceholder')}
            className="min-h-10 w-full rounded-lg border border-line px-3 text-sm font-bold"
            autoFocus
            aria-label={tr('menu.groupNameAria')}
          />
          <label className="flex items-center gap-2 text-sm font-bold">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="size-4 accent-brand"
            />
            {tr('menu.required')}
          </label>
          <div className="border-t border-line pt-3">
            <p className="text-xs font-bold text-ink-muted mb-2">{tr('menu.firstOption')}</p>
            <div className="flex gap-2">
              <input
                value={newOptionName}
                onChange={(e) => setNewOptionName(e.target.value)}
                placeholder={tr('menu.optionNamePlaceholder')}
                className="min-h-10 flex-1 rounded-lg border border-line px-3 text-sm"
                aria-label={tr('menu.firstOptionNameAria')}
              />
              <input
                value={newOptionPrice}
                onChange={(e) => setNewOptionPrice(e.target.value)}
                inputMode="decimal"
                placeholder={tr('menu.priceDeltaPlaceholder')}
                className="min-h-10 w-32 rounded-lg border border-line px-3 text-sm tabular-nums"
                aria-label={tr('menu.firstOptionPriceAria')}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowCreate(false); setGroupName(''); setIsRequired(false); setNewOptionName(''); setNewOptionPrice(''); }}
              className="min-h-10 rounded-lg border border-line px-3 text-xs font-bold"
            >
              {tr('common.cancel')}
            </button>
            <button
              onClick={() => createGroupMutation.mutate()}
              disabled={createGroupMutation.isPending || !groupName.trim()}
              className="min-h-10 rounded-lg bg-dark px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              {createGroupMutation.isPending ? tr('menu.creating') : tr('menu.createGroup')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="min-h-10 rounded-lg border border-dashed border-line px-4 text-xs font-bold text-ink-muted hover:border-brand hover:text-brand"
        >
          {tr('menu.addModifierGroup')}
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                          Main MenuManagement                               */
/* -------------------------------------------------------------------------- */

export function MenuManagement() {
  const { accessToken, csrfToken, profile } = useAuth();
  const { formatCurrency, tr } = useLocale();
  const membership = profile?.memberships[0];
  const tenantId = membership?.tenant.id ?? '';
  const branchId =
    typeof window === 'undefined'
      ? ''
      : (window.sessionStorage.getItem('rms-branch-id') ??
        membership?.branchAssignments[0]?.branchId ??
        '');
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  const categories = useQuery({
    queryKey: ['catalog-categories', tenantId],
    enabled: Boolean(accessToken && tenantId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<Category[]>>('/categories', { accessToken, tenantId })).data,
  });
  const items = useQuery({
    queryKey: ['catalog-items', tenantId],
    enabled: Boolean(accessToken && tenantId),
    queryFn: async () =>
      (await apiRequest<ApiEnvelope<MenuItem[]>>('/items', { accessToken, tenantId })).data,
  });

  if (!membership || !['OWNER', 'MANAGER'].includes(membership.role)) {
    return <p role="alert">{tr('menu.permissionDenied')}</p>;
  }

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-brand">{tr('menu.catalogEyebrow')}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{tr('menu.pageTitle')}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {tr('menu.pageDescription')}
          </p>
        </div>
        <button
          onClick={() => { setNotice(null); setShowCreate(true); }}
          className="min-h-11 rounded-xl bg-dark px-5 text-sm font-bold text-white shadow-sm transition hover:bg-dark-muted"
        >
          {tr('menu.addItemBtn')}
        </button>
      </div>

      {notice && (
        <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
          {notice}
        </div>
      )}
      {(items.isLoading || categories.isLoading) && (
        <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('menu.loadingCatalog')}</p>
      )}
      {(items.isError || categories.isError) && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          {tr('menu.catalogError')}
        </div>
      )}

      {!items.isLoading && !items.isError && (
        <>
          <CategoryManager
            categories={categories.data ?? []}
            accessToken={accessToken!}
            csrfToken={csrfToken}
            tenantId={tenantId}
          />

          {(items.data?.length ?? 0) === 0 ? (
            <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
              <div>
                <p className="text-lg font-black">{tr('menu.emptyTitle')}</p>
                <p className="mt-2 text-sm text-ink-muted">{tr('menu.emptyHint')}</p>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.data?.map((item) => {
                const variant = item.variants.find((entry) => entry.isDefault) ?? item.variants[0];
                const initials = item.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase();
                return (
                  <article
                    className="cursor-pointer rounded-2xl border border-black/[.07] bg-white p-5 shadow-sm transition hover:shadow-md"
                    key={item.id}
                    onClick={() => { setNotice(null); setSelectedItem(item); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedItem(item); } }}
                    aria-label={tr('menu.editItemAria', { name: item.name })}
                  >
                    <div className="mb-5 grid h-24 place-items-center rounded-xl bg-gradient-to-br from-brand to-dark text-2xl font-black text-white">
                      {initials}
                    </div>
                    <div className="flex items-start justify-between">
                      <h2 className="text-lg font-black">{item.name}</h2>
                      <AvailabilityToggle
                        item={item}
                        branchId={branchId}
                        accessToken={accessToken!}
                        csrfToken={csrfToken}
                        tenantId={tenantId}
                      />
                    </div>
                    <p className="mt-2 text-sm font-bold text-brand">
                      {variant ? formatCurrency(variant.basePriceMinor) : tr('menu.priceNotSet')}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {item.category?.name ?? tr('menu.uncategorized')}
                    </p>
                    <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs font-bold text-ink-muted">
                      <span>{item.isActive ? tr('status.active') : tr('status.inactive')}</span>
                      <span className={`size-2 rounded-full ${item.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateMenuItemDialog
          categories={categories.data ?? []}
          accessToken={accessToken!}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setShowCreate(false)}
          onCreated={async (name) => {
            setShowCreate(false);
            await items.refetch();
            setNotice(tr('menu.addedNotice', { name }));
          }}
        />
      )}
      {selectedItem && (
        <ItemDetailDialog
          item={selectedItem}
          categories={categories.data ?? []}
          accessToken={accessToken!}
          csrfToken={csrfToken}
          tenantId={tenantId}
          branchId={branchId}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </>
  );
}
