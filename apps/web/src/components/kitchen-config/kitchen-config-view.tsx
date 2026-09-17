'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useBranch } from '@/components/shell/branch-provider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { KitchenList } from '@/components/kitchen-config/kitchen-list';
import { StationManager } from '@/components/kitchen-config/station-manager';
import { RouteEditor } from '@/components/kitchen-config/route-editor';
import { FulfillmentPolicyEditor } from '@/components/kitchen-config/fulfillment-policy-editor';
import { useKitchens } from '@/lib/use-kitchen-config';

export function KitchenConfigView() {
  const { profile } = useAuth();
  const { branchId } = useBranch();
  const [tab, setTab] = useState('kitchens');
  const [selectedKitchenId, setSelectedKitchenId] = useState<string | null>(null);
  const { data: kitchens = [] } = useKitchens();

  const membership = profile?.memberships?.find(
    (m) => m.branchAssignments.some((a) => a.branchId === branchId)
  );
  const role = membership?.role;
  const allowedRoles = ['OWNER', 'MANAGER'];
  if (!role || !allowedRoles.includes(role)) {
    return <p role="alert" className="p-8 text-center text-sm font-bold text-red-700">Permission denied.</p>;
  }

  const selectedKitchen = kitchens.find((k) => k.id === selectedKitchenId);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-black uppercase tracking-[.18em] text-brand">Kitchen</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">Configuration</h1>
        <p className="mt-1 text-sm text-ink-muted">Manage kitchens, stations, menu routing, and fulfillment policy.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="kitchens">Kitchens</TabsTrigger>
          <TabsTrigger value="stations">Stations</TabsTrigger>
          <TabsTrigger value="routing">Routing</TabsTrigger>
          <TabsTrigger value="policy">Fulfillment Policy</TabsTrigger>
        </TabsList>

        <TabsContent value="kitchens">
          <KitchenList />
        </TabsContent>

        <TabsContent value="stations">
          {kitchens.length === 0 ? (
            <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
              <p className="text-sm text-ink-muted">Create a kitchen first before managing stations.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-black">Select kitchen</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {kitchens.map((k) => (
                    <button
                      key={k.id}
                      className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${selectedKitchenId === k.id ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:bg-surface'}`}
                      onClick={() => setSelectedKitchenId(k.id)}
                    >
                      {k.name}
                    </button>
                  ))}
                </div>
              </div>
              {selectedKitchen && (
                <StationManager kitchenId={selectedKitchen.id} kitchenName={selectedKitchen.name} />
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="routing">
          <RouteEditor />
        </TabsContent>

        <TabsContent value="policy">
          <FulfillmentPolicyEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
