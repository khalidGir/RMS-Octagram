'use client';

import { useState } from 'react';
import { useFulfillmentPolicy, useUpdateFulfillmentPolicy } from '@/lib/use-kitchen-config';
import { Button, TextField, Select, SelectTrigger, SelectContent, SelectItem, SelectValue, Switch, Card } from '@/components/ui';
import { useLocale } from '@/components/locale-provider';
import type { ServiceMode, ExpoMode } from '@/lib/fulfillment-types';

export function FulfillmentPolicyEditor() {
  const { data: policy, isLoading } = useFulfillmentPolicy();
  const updatePolicy = useUpdateFulfillmentPolicy();
  const { tr } = useLocale();

  const [serviceMode, setServiceMode] = useState(policy?.serviceMode ?? 'ALL_AT_ONCE');
  const [expoMode, setExpoMode] = useState(policy?.expoMode ?? 'NONE');
  const [allowSelfClaim, setAllowSelfClaim] = useState(policy?.allowWaiterSelfClaim ?? true);
  const [showUnassigned, setShowUnassigned] = useState(policy?.showUnassignedReadyOrdersToWaiters ?? true);
  const [reminderSec, setReminderSec] = useState(String(policy?.readyReminderSeconds ?? 300));
  const [escalationSec, setEscalationSec] = useState(String(policy?.readyEscalationSeconds ?? 600));
  const [autoComplete, setAutoComplete] = useState(policy?.autoCompleteKitchenTicketOnCollected ?? false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isLoading) {
    return <p className="py-16 text-center text-sm font-bold text-ink-muted">{tr('kitchen.loadingPolicy')}</p>;
  }

  if (!policy) {
    return (
      <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <p className="text-sm text-ink-muted">{tr('kitchen.noPolicy')}</p>
      </div>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await updatePolicy.mutateAsync({
        serviceMode: serviceMode as ServiceMode,
        expoMode: expoMode as ExpoMode,
        allowWaiterSelfClaim: allowSelfClaim,
        showUnassignedReadyOrdersToWaiters: showUnassigned,
        readyReminderSeconds: parseInt(reminderSec, 10) || 300,
        readyEscalationSeconds: parseInt(escalationSec, 10) || 600,
      });
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tr('kitchen.updatePolicyFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card className="p-6">
        <h3 className="text-sm font-black">{tr('kitchen.serviceMode')}</h3>
        <p className="mt-1 text-xs text-ink-muted">{tr('kitchen.serviceModeHint')}</p>
        <div className="mt-4">
          <label className="text-sm font-black">{tr('kitchen.mode')}</label>
          <Select value={serviceMode} onValueChange={(v) => setServiceMode(v as ServiceMode)}>
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL_AT_ONCE">{tr('kitchen.serviceAllAtOnce')}</SelectItem>
              <SelectItem value="STAGED">{tr('kitchen.serviceStaged')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-black">{tr('kitchen.expoMode')}</h3>
        <p className="mt-1 text-xs text-ink-muted">{tr('kitchen.expoModeHint')}</p>
        <div className="mt-4">
          <label className="text-sm font-black">{tr('kitchen.mode')}</label>
          <Select value={expoMode} onValueChange={(v) => setExpoMode(v as ExpoMode)}>
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">{tr('kitchen.expoNone')}</SelectItem>
              <SelectItem value="MANDATORY">{tr('kitchen.expoMandatory')}</SelectItem>
              <SelectItem value="OPTIONAL">{tr('kitchen.expoOptional')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-black">{tr('kitchen.waiterSettings')}</h3>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black">{tr('kitchen.allowSelfClaim')}</p>
              <p className="text-xs text-ink-muted">{tr('kitchen.allowSelfClaimHint')}</p>
            </div>
            <Switch label={tr('kitchen.allowSelfClaim')} checked={allowSelfClaim} onCheckedChange={setAllowSelfClaim} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black">{tr('kitchen.showUnassigned')}</p>
              <p className="text-xs text-ink-muted">{tr('kitchen.showUnassignedHint')}</p>
            </div>
            <Switch label={tr('kitchen.showUnassigned')} checked={showUnassigned} onCheckedChange={setShowUnassigned} />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-black">{tr('kitchen.timing')}</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label={tr('kitchen.readyReminder')}
            value={reminderSec}
            onChange={(e) => setReminderSec(e.target.value)}
            type="number"
          />
          <TextField
            label={tr('kitchen.readyEscalation')}
            value={escalationSec}
            onChange={(e) => setEscalationSec(e.target.value)}
            type="number"
          />
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black">{tr('kitchen.autoComplete')}</p>
            <p className="text-xs text-ink-muted">{tr('kitchen.autoCompleteHint')}</p>
          </div>
          <Switch label={tr('kitchen.autoComplete')} checked={autoComplete} onCheckedChange={setAutoComplete} />
        </div>
      </Card>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
      {success && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">{tr('kitchen.policySaved')}</div>}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? tr('kitchen.saving') : tr('kitchen.savePolicy')}</Button>
      </div>
    </form>
  );
}
