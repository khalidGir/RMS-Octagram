'use client';

import { useState } from 'react';
import { useFulfillmentPolicy, useUpdateFulfillmentPolicy } from '@/lib/use-kitchen-config';
import { Button, TextField, Select, SelectTrigger, SelectContent, SelectItem, SelectValue, Switch, Card } from '@/components/ui';
import type { ServiceMode, ExpoMode } from '@/lib/fulfillment-types';

export function FulfillmentPolicyEditor() {
  const { data: policy, isLoading } = useFulfillmentPolicy();
  const updatePolicy = useUpdateFulfillmentPolicy();

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
    return <p className="py-16 text-center text-sm font-bold text-ink-muted">Loading policy...</p>;
  }

  if (!policy) {
    return (
      <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-center">
        <p className="text-sm text-ink-muted">No fulfillment policy found for this branch.</p>
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
      setError(err instanceof Error ? err.message : 'Could not update policy.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card className="p-6">
        <h3 className="text-sm font-black">Service mode</h3>
        <p className="mt-1 text-xs text-ink-muted">Control how orders are fulfilled across stations.</p>
        <div className="mt-4">
          <label className="text-sm font-black">Mode</label>
          <Select value={serviceMode} onValueChange={(v) => setServiceMode(v as ServiceMode)}>
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL_AT_ONCE">All at once — all station tickets created when order is confirmed</SelectItem>
              <SelectItem value="STAGED">Staged — tickets created in sequence based on routing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-black">Expo mode</h3>
        <p className="mt-1 text-xs text-ink-muted">Control whether orders require expo release before service.</p>
        <div className="mt-4">
          <label className="text-sm font-black">Mode</label>
          <Select value={expoMode} onValueChange={(v) => setExpoMode(v as ExpoMode)}>
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">None — orders go directly to waiters when ready</SelectItem>
              <SelectItem value="MANDATORY">Mandatory — all orders must be released by expo</SelectItem>
              <SelectItem value="OPTIONAL">Optional — expo can release, but not required</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-black">Waiter settings</h3>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black">Allow waiter self-claim</p>
              <p className="text-xs text-ink-muted">Waiters can claim unassigned ready orders</p>
            </div>
            <Switch label="Allow waiter self-claim" checked={allowSelfClaim} onCheckedChange={setAllowSelfClaim} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black">Show unassigned orders</p>
              <p className="text-xs text-ink-muted">Display unassigned ready orders to all waiters</p>
            </div>
            <Switch label="Show unassigned orders" checked={showUnassigned} onCheckedChange={setShowUnassigned} />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-black">Timing</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label="Ready reminder (seconds)"
            value={reminderSec}
            onChange={(e) => setReminderSec(e.target.value)}
            type="number"
          />
          <TextField
            label="Ready escalation (seconds)"
            value={escalationSec}
            onChange={(e) => setEscalationSec(e.target.value)}
            type="number"
          />
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black">Auto-complete on collect</p>
            <p className="text-xs text-ink-muted">Automatically mark kitchen ticket as completed when all lines are collected</p>
          </div>
          <Switch label="Auto-complete on collect" checked={autoComplete} onCheckedChange={setAutoComplete} />
        </div>
      </Card>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
      {success && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800">Policy updated successfully.</div>}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save policy'}</Button>
      </div>
    </form>
  );
}
