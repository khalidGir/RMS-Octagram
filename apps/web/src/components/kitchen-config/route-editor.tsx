'use client';

import { useState } from 'react';
import { useKitchens, useStations, useAllStationRoutes, useReplaceRoutes } from '@/lib/use-kitchen-config';
import { Button, Dialog, DialogContent, DialogTitle, Select, SelectTrigger, SelectContent, SelectItem, SelectValue, Switch } from '@/components/ui';
import { useLocale } from '@/components/locale-provider';
import type { StationRoute, RouteType } from '@/lib/fulfillment-types';

export function RouteEditor() {
  const { data: kitchens = [] } = useKitchens();
  const { data: allRoutes = [], isLoading } = useAllStationRoutes();
  const replaceRoutes = useReplaceRoutes();
  const { tr } = useLocale();

  const [selectedMenuItemId, setSelectedMenuItemId] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [assignKitchenId, setAssignKitchenId] = useState('');
  const [assignStationId, setAssignStationId] = useState('');
  const [assignRequired, setAssignRequired] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const uniqueMenuItems = Array.from(
    new Map(allRoutes.map((r) => [r.menuItemId, r.menuItemName])).entries()
  );

  const selectedRoutes = selectedMenuItemId
    ? allRoutes.filter((r) => r.menuItemId === selectedMenuItemId)
    : [];

  const selectedMenuItemName = selectedMenuItemId
    ? allRoutes.find((r) => r.menuItemId === selectedMenuItemId)?.menuItemName ?? selectedMenuItemId
    : null;

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMenuItemId || !assignStationId) return;
    setBusy(true);
    setError(null);
    try {
      const updatedRoutes = [
        ...selectedRoutes.map((r) => ({
          stationId: r.stationId,
          routeType: r.routeType as RouteType,
          isRequired: r.isRequired,
          sortOrder: r.sortOrder,
        })),
        { stationId: assignStationId, routeType: 'PREPARE' as RouteType, isRequired: assignRequired, sortOrder: selectedRoutes.length },
      ];
      await replaceRoutes.mutateAsync({ menuItemId: selectedMenuItemId, routes: updatedRoutes });
      setShowAssign(false);
      setAssignKitchenId('');
      setAssignStationId('');
      setAssignRequired(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr('kitchen.assignRouteFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveRoute(stationId: string) {
    if (!selectedMenuItemId) return;
    setBusy(true);
    try {
      const updatedRoutes = selectedRoutes
        .filter((r) => r.stationId !== stationId)
        .map((r, i) => ({ stationId: r.stationId, routeType: r.routeType as RouteType, isRequired: r.isRequired, sortOrder: i }));
      await replaceRoutes.mutateAsync({ menuItemId: selectedMenuItemId, routes: updatedRoutes });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr('kitchen.removeRouteFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleRequired(route: StationRoute) {
    if (!selectedMenuItemId) return;
    setBusy(true);
    try {
      const updatedRoutes = selectedRoutes.map((r) =>
        r.stationId === route.stationId ? { ...r, isRequired: !r.isRequired } : r
      ).map((r, i) => ({ stationId: r.stationId, routeType: r.routeType as RouteType, isRequired: r.isRequired, sortOrder: i }));
      await replaceRoutes.mutateAsync({ menuItemId: selectedMenuItemId, routes: updatedRoutes });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr('kitchen.updateRouteFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('kitchen.loadingRoutes')}</p>;
  }

  return (
    <>
      <p className="text-sm text-ink-muted">
        {tr('kitchen.menuItemRoutes', { count: uniqueMenuItems.length })}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="overflow-x-auto rounded-2xl border border-black/[.07] bg-white shadow-sm">
          <div className="p-4">
            <p className="text-xs font-black uppercase tracking-wider text-ink-muted">{tr('kitchen.menuItems')}</p>
          </div>
          {uniqueMenuItems.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-ink-muted">{tr('kitchen.noRoutesYet')}</div>
          ) : (
            <ul className="max-h-[400px] overflow-y-auto">
              {uniqueMenuItems.map(([id, name]) => (
                <li key={id}>
                  <button
                    className={`w-full px-4 py-3 text-start text-sm font-bold transition hover:bg-surface ${selectedMenuItemId === id ? 'bg-surface text-brand' : ''}`}
                    onClick={() => setSelectedMenuItemId(id)}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-black/[.07] bg-white p-5 shadow-sm">
          {!selectedMenuItemId ? (
            <div className="grid min-h-48 place-items-center text-center">
              <div>
                <p className="text-lg font-black">{tr('kitchen.selectMenuItem')}</p>
                <p className="mt-2 text-sm text-ink-muted">{tr('kitchen.selectMenuItemHint')}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black">{selectedMenuItemName}</h3>
                  <p className="text-xs text-ink-muted">{tr('kitchen.routeCount', { count: selectedRoutes.length })}</p>
                </div>
                <Button onClick={() => setShowAssign(true)}>{tr('kitchen.addRoute')}</Button>
              </div>

              {error && (
                <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>
              )}

              {selectedRoutes.length === 0 ? (
                <div className="mt-4 grid min-h-32 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
                  <p className="text-sm text-ink-muted">{tr('kitchen.noRoutesAssigned')}</p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {selectedRoutes.map((r) => (
                    <div key={r.stationId} className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-black">{r.stationName}</span>
                        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-black uppercase">{r.stationCode ?? '—'}</span>
                        <span className="text-xs text-ink-muted">{kitchens.find((k) => k.id === r.kitchenId)?.name ?? ''}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase transition ${r.isRequired ? 'bg-brand text-white' : 'bg-surface text-ink-muted'}`}
                          onClick={() => handleToggleRequired(r)}
                          disabled={busy}
                        >
                          {r.isRequired ? tr('kitchen.required') : tr('kitchen.optional')}
                        </button>
                        <Button variant="danger" onClick={() => handleRemoveRoute(r.stationId)} disabled={busy}>
                          {tr('pos.remove')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showAssign && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowAssign(false); }}>
          <DialogContent className="max-w-lg" aria-label={tr('kitchen.addRoute')}>
            <DialogTitle>{tr('kitchen.addRouteTitle', { name: selectedMenuItemName ?? '' })}</DialogTitle>
            <form onSubmit={handleAssign} className="mt-4 grid gap-4">
              <div>
                <label className="text-sm font-black">{tr('kitchen.kitchenLabel')}</label>
                <Select value={assignKitchenId} onValueChange={(v) => { setAssignKitchenId(v); setAssignStationId(''); }}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder={tr('kitchen.selectKitchen')} />
                  </SelectTrigger>
                  <SelectContent>
                    {kitchens.map((k) => (
                      <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {assignKitchenId && (
                <StationSelectInline kitchenId={assignKitchenId} value={assignStationId} onChange={setAssignStationId} />
              )}
              <div className="flex items-center gap-3">
                <Switch label={tr('kitchen.requiredForCompletion')} checked={assignRequired} onCheckedChange={setAssignRequired} />
              </div>
              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowAssign(false)}>{tr('kitchen.cancel')}</Button>
                <Button type="submit" disabled={busy || !assignStationId}>{busy ? tr('kitchen.adding') : tr('kitchen.add')}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function StationSelectInline({ kitchenId, value, onChange }: { kitchenId: string; value: string; onChange: (v: string) => void }) {
  const { data: stations = [] } = useStations(kitchenId);
  const { tr } = useLocale();

  return (
    <div>
      <label className="text-sm font-black">{tr('kitchen.stationLabel')}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-2">
          <SelectValue placeholder={tr('kitchen.selectStation')} />
        </SelectTrigger>
        <SelectContent>
          {stations.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name} ({s.code ?? '—'})</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
