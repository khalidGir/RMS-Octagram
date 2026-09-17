'use client';

import { useState } from 'react';
import { useKitchens, useCreateKitchen, useUpdateKitchen, useDeleteKitchen, useStations } from '@/lib/use-kitchen-config';
import { Button, Dialog, DialogContent, DialogTitle, TextField } from '@/components/ui';
import type { Kitchen } from '@/lib/fulfillment-types';

export function KitchenList() {
  const { data: kitchens = [], isLoading } = useKitchens();
  const createKitchen = useCreateKitchen();
  const updateKitchen = useUpdateKitchen();
  const deleteKitchen = useDeleteKitchen();

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Kitchen | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Kitchen | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [collectionLabel, setCollectionLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setName('');
    setDescription('');
    setCollectionLabel('');
    setError(null);
    setBusy(false);
  }

  function openCreate() {
    resetForm();
    setShowCreate(true);
  }

  function openEdit(k: Kitchen) {
    setEditing(k);
    setName(k.name);
    setDescription(k.description ?? '');
    setCollectionLabel(k.collectionLabel ?? '');
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a kitchen name.');
    setBusy(true);
    setError(null);
    try {
      await createKitchen.mutateAsync({ name: trimmed, description: description.trim() || undefined, collectionLabel: collectionLabel.trim() || undefined });
      setShowCreate(false);
      resetForm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create kitchen.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a kitchen name.');
    setBusy(true);
    setError(null);
    try {
      await updateKitchen.mutateAsync({ kitchenId: editing.id, name: trimmed, description: description.trim() || undefined, collectionLabel: collectionLabel.trim() || undefined });
      setEditing(null);
      resetForm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update kitchen.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteKitchen.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not delete kitchen.');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading kitchens...</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">{kitchens.length} kitchen{kitchens.length !== 1 ? 's' : ''}</p>
        <Button onClick={openCreate}>Add kitchen</Button>
      </div>

      {kitchens.length === 0 ? (
        <div className="mt-4 grid min-h-72 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
          <div>
            <p className="text-lg font-black">No kitchens yet</p>
            <p className="mt-2 text-sm text-ink-muted">Create your first kitchen to configure stations and routing.</p>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {kitchens.map((k) => (
            <KitchenCard
              key={k.id}
              kitchen={k}
              onEdit={() => openEdit(k)}
              onDelete={() => setDeleteTarget(k)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <Dialog open onOpenChange={(o) => { if (!o) { setShowCreate(false); resetForm(); } }}>
          <DialogContent className="max-w-lg" aria-label="Create kitchen">
            <DialogTitle>Create kitchen</DialogTitle>
            <form onSubmit={handleCreate} className="mt-4 grid gap-4">
              <TextField label="Kitchen name" value={name} onChange={(e) => setName(e.target.value)} required />
              <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
              <TextField label="Collection label (optional)" value={collectionLabel} onChange={(e) => setCollectionLabel(e.target.value)} placeholder="e.g. Main pass" />
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setShowCreate(false); resetForm(); }}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) { setEditing(null); resetForm(); } }}>
          <DialogContent className="max-w-lg" aria-label="Edit kitchen">
            <DialogTitle>Edit kitchen</DialogTitle>
            <form onSubmit={handleUpdate} className="mt-4 grid gap-4">
              <TextField label="Kitchen name" value={name} onChange={(e) => setName(e.target.value)} required />
              <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
              <TextField label="Collection label (optional)" value={collectionLabel} onChange={(e) => setCollectionLabel(e.target.value)} placeholder="e.g. Main pass" />
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setEditing(null); resetForm(); }}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog open onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <DialogContent className="max-w-md" aria-label="Delete kitchen">
            <DialogTitle>Delete kitchen</DialogTitle>
            <p className="mt-2 text-sm text-ink-muted">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? All stations and routes in this kitchen will be removed.
            </p>
            {error && <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleDelete} disabled={busy}>{busy ? 'Deleting...' : 'Delete'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function KitchenCard({ kitchen, onEdit, onDelete }: { kitchen: Kitchen; onEdit: () => void; onDelete: () => void }) {
  const { data: stations = [] } = useStations(kitchen.id);

  return (
    <article className="rounded-2xl border border-black/[.07] bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-black">{kitchen.name}</h3>
          {kitchen.description && <p className="mt-1 text-sm text-ink-muted">{kitchen.description}</p>}
          {kitchen.collectionLabel && (
            <p className="mt-1 text-xs text-ink-muted">
              Collection: <span className="font-bold text-ink">{kitchen.collectionLabel}</span>
            </p>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            {stations.length} station{stations.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit}>Edit</Button>
          <Button variant="danger" onClick={onDelete}>Delete</Button>
        </div>
      </div>
    </article>
  );
}
