'use client';

import { useState } from 'react';
import { useStations, useCreateStation, useUpdateStation, useDeleteStation } from '@/lib/use-kitchen-config';
import { Button, Dialog, DialogContent, DialogTitle, TextField, Switch } from '@/components/ui';
import { useLocale } from '@/components/locale-provider';
import type { KitchenStation } from '@/lib/fulfillment-types';

interface StationManagerProps {
  kitchenId: string;
  kitchenName: string;
}

export function StationManager({ kitchenId, kitchenName }: StationManagerProps) {
  const { data: stations = [], isLoading } = useStations(kitchenId);
  const { tr } = useLocale();
  const createStation = useCreateStation();
  const updateStation = useUpdateStation();
  const deleteStation = useDeleteStation();

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<KitchenStation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KitchenStation | null>(null);

  const [sName, setSName] = useState('');
  const [code, setCode] = useState('');
  const [prepMinutes, setPrepMinutes] = useState('10');
  const [isExpo, setIsExpo] = useState(false);
  const [collectionOverride, setCollectionOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setSName('');
    setCode('');
    setPrepMinutes('10');
    setIsExpo(false);
    setCollectionOverride('');
    setError(null);
    setBusy(false);
  }

  function openCreate() {
    resetForm();
    setShowCreate(true);
  }

  function openEdit(s: KitchenStation) {
    setEditing(s);
    setSName(s.name);
    setCode(s.code ?? '');
    setPrepMinutes(String(s.defaultPrepMinutes ?? 10));
    setIsExpo(s.isExpo);
    setCollectionOverride(s.collectionLabelOverride ?? '');
    setError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = sName.trim();
    const trimmedCode = code.trim();
    if (!trimmedName) return setError(tr('kitchen.enterStationName'));
    if (!trimmedCode) return setError(tr('kitchen.enterStationCode'));
    setBusy(true);
    setError(null);
    try {
      await createStation.mutateAsync({
        kitchenId,
        name: trimmedName,
        code: trimmedCode.toUpperCase(),
        defaultPrepMinutes: parseInt(prepMinutes, 10) || 10,
        isExpo,
        collectionLabelOverride: collectionOverride.trim() || undefined,
      });
      setShowCreate(false);
      resetForm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr('kitchen.createStationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const trimmedName = sName.trim();
    const trimmedCode = code.trim();
    if (!trimmedName) return setError(tr('kitchen.enterStationName'));
    if (!trimmedCode) return setError(tr('kitchen.enterStationCode'));
    setBusy(true);
    setError(null);
    try {
      await updateStation.mutateAsync({
        id: editing.id,
        name: trimmedName,
        code: trimmedCode.toUpperCase(),
        defaultPrepMinutes: parseInt(prepMinutes, 10) || 10,
        isExpo,
        collectionLabelOverride: collectionOverride.trim() || undefined,
      });
      setEditing(null);
      resetForm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr('kitchen.updateStationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteStation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr('kitchen.deleteStationFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return <p className="py-8 text-center text-sm font-bold text-ink-muted">{tr('kitchen.loadingStations')}</p>;
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          {tr('kitchen.stationsInKitchen', { count: stations.length, kitchen: kitchenName })}
        </p>
        <Button onClick={openCreate}>{tr('kitchen.addStation')}</Button>
      </div>

      {stations.length === 0 ? (
        <div className="mt-4 grid min-h-48 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
          <div>
            <p className="text-lg font-black">{tr('kitchen.noStations')}</p>
            <p className="mt-2 text-sm text-ink-muted">{tr('kitchen.noStationsHint')}</p>
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-black/[.07] bg-white shadow-sm">
          <table className="w-full min-w-[600px] text-start">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-ink-muted">
                <th className="px-5 py-4">{tr('kitchen.colName')}</th>
                <th className="px-5 py-4">{tr('kitchen.colCode')}</th>
                <th className="px-5 py-4">{tr('kitchen.colPrep')}</th>
                <th className="px-5 py-4">{tr('kitchen.colExpo')}</th>
                <th className="px-5 py-4">{tr('kitchen.colCollectionOverride')}</th>
                <th className="px-5 py-4 text-end">{tr('kitchen.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => (
                <tr className="border-t border-line text-sm" key={s.id}>
                  <td className="px-5 py-4 font-black">{s.name}</td>
                  <td className="px-5 py-4 font-mono text-xs">{s.code ?? '—'}</td>
                  <td className="px-5 py-4">{s.defaultPrepMinutes ?? '—'}</td>
                  <td className="px-5 py-4">{s.isExpo ? '✓' : '—'}</td>
                  <td className="px-5 py-4 text-ink-muted">{s.collectionLabelOverride ?? '—'}</td>
                  <td className="px-5 py-4 text-end">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => openEdit(s)}>{tr('kitchen.edit')}</Button>
                      <Button variant="danger" onClick={() => setDeleteTarget(s)}>{tr('kitchen.delete')}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Dialog open onOpenChange={(o) => { if (!o) { setShowCreate(false); resetForm(); } }}>
          <DialogContent className="max-w-lg" aria-label={tr('kitchen.addStation')}>
            <DialogTitle>{tr('kitchen.addStationTo', { kitchen: kitchenName })}</DialogTitle>
            <form onSubmit={handleCreate} className="mt-4 grid gap-4">
              <TextField label={tr('kitchen.stationName')} value={sName} onChange={(e) => setSName(e.target.value)} required />
              <TextField label={tr('kitchen.stationCode')} value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr('kitchen.stationCodePlaceholder')} required />
              <TextField label={tr('kitchen.prepTime')} value={prepMinutes} onChange={(e) => setPrepMinutes(e.target.value)} type="number" />
              <div className="flex items-center gap-3">
                <Switch label={tr('kitchen.expoStation')} checked={isExpo} onCheckedChange={setIsExpo} />
              </div>
              <TextField label={tr('kitchen.collectionOverride')} value={collectionOverride} onChange={(e) => setCollectionOverride(e.target.value)} placeholder={tr('kitchen.collectionOverridePlaceholder')} />
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setShowCreate(false); resetForm(); }}>{tr('kitchen.cancel')}</Button>
                <Button type="submit" disabled={busy}>{busy ? tr('kitchen.creating') : tr('kitchen.create')}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) { setEditing(null); resetForm(); } }}>
          <DialogContent className="max-w-lg" aria-label={tr('kitchen.editStation')}>
            <DialogTitle>{tr('kitchen.editStation')}</DialogTitle>
            <form onSubmit={handleUpdate} className="mt-4 grid gap-4">
              <TextField label={tr('kitchen.stationName')} value={sName} onChange={(e) => setSName(e.target.value)} required />
              <TextField label={tr('kitchen.stationCode')} value={code} onChange={(e) => setCode(e.target.value)} required />
              <TextField label={tr('kitchen.prepTime')} value={prepMinutes} onChange={(e) => setPrepMinutes(e.target.value)} type="number" />
              <div className="flex items-center gap-3">
                <Switch label={tr('kitchen.expoStation')} checked={isExpo} onCheckedChange={setIsExpo} />
              </div>
              <TextField label={tr('kitchen.collectionOverride')} value={collectionOverride} onChange={(e) => setCollectionOverride(e.target.value)} />
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setEditing(null); resetForm(); }}>{tr('kitchen.cancel')}</Button>
                <Button type="submit" disabled={busy}>{busy ? tr('kitchen.saving') : tr('kitchen.save')}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {deleteTarget && (
        <Dialog open onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <DialogContent className="max-w-md" aria-label={tr('kitchen.deleteStation')}>
            <DialogTitle>{tr('kitchen.deleteStation')}</DialogTitle>
            <p className="mt-2 text-sm text-ink-muted">
              {tr('kitchen.deleteConfirmPrefix')}<strong>{deleteTarget.name}</strong>{tr('kitchen.deleteStationConfirmSuffix')}
            </p>
            {error && <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>{tr('kitchen.cancel')}</Button>
              <Button variant="danger" onClick={handleDelete} disabled={busy}>{busy ? tr('kitchen.deleting') : tr('kitchen.delete')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
