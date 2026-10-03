'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, PageHeader, Switch, TextField } from '@/components/ui';
import { LanguagePicker } from '@/components/language-picker';
import { useLocale, type MessageKey } from '@/components/locale-provider';
import { roleKeys } from '@/components/shell/nav-config';

export function AccountManagement() {
  const { profile, loading } = useAuth();
  const { tr } = useLocale();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saved, setSaved] = useState(false);
  const [notifications, setNotifications] = useState({
    paymentProofs: true,
    lowStock: true,
    orderDelays: true,
    dailySummary: false,
  });

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const membership = profile?.memberships?.[0];

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setPhone(profile.phone ?? '');
  }, [profile]);

  if (loading) return (
    <div className="mx-auto max-w-[1500px] animate-pulse">
      <Skeleton className="h-10 w-64 rounded-xl" />
      <div className="mt-7 grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-panel" />
        <Skeleton className="h-64 rounded-panel" />
      </div>
    </div>
  );

  return (
    <div className="page-shell">
      <PageHeader eyebrow={tr('navigation.accountEyebrow')} title={tr('navigation.accountTitle')} description={tr('navigation.accountDescription')} />

      <section className="mt-7 grid gap-5 xl:grid-cols-2">
        <Card className="rounded-panel p-6 sm:p-7">
          <h2 className="text-lg font-semibold">{tr('navigation.profile')}</h2>
          <div className="mt-5 space-y-4">
            <TextField label={tr('navigation.displayName')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <TextField label={tr('authentication.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0911 234 567" />
            {membership && (
              <div className="rounded-card bg-surface-subtle p-4 text-sm">
                <p className="font-semibold">{tr(roleKeys[membership.role])}</p>
                <p className="mt-1 text-ink-muted">{tr('navigation.workspaceOf', { tenant: membership.tenant.name })}</p>
              </div>
            )}
            <div className="flex items-center justify-between rounded-card bg-surface-subtle p-4 text-sm">
              <span className="font-semibold">{tr('common.language')}</span>
              <LanguagePicker compact />
            </div>
            <Button onClick={handleSave}>{saved ? tr('navigation.saved') : tr('navigation.saveProfile')}</Button>
          </div>
        </Card>

        <Card className="rounded-panel p-6 sm:p-7">
          <h2 className="text-lg font-semibold">{tr('navigation.notifications')}</h2>
          <div className="mt-5 space-y-1">
            {([
              ['paymentProofs', 'navigation.notifPaymentProofs', 'navigation.notifPaymentProofsDesc'],
              ['lowStock', 'navigation.notifLowStock', 'navigation.notifLowStockDesc'],
              ['orderDelays', 'navigation.notifOrderDelays', 'navigation.notifOrderDelaysDesc'],
              ['dailySummary', 'navigation.notifDailySummary', 'navigation.notifDailySummaryDesc'],
            ] as const).map(([key, labelKey, descKey]) => (
              <div key={key} className="flex items-center justify-between gap-5 border-b border-border py-4 text-sm last:border-0">
                <div>
                  <p className="font-semibold">{tr(labelKey as MessageKey)}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{tr(descKey as MessageKey)}</p>
                </div>
                <Switch
                  label={tr('navigation.toggleNotification', { label: tr(labelKey as MessageKey) })}
                  checked={notifications[key]}
                  onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, [key]: checked }))}
                  className="[&+label]:sr-only"
                />
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}
