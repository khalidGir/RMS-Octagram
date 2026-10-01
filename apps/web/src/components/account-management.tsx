'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, PageHeader, Switch, TextField } from '@/components/ui';

export function AccountManagement() {
  const { profile, loading } = useAuth();
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
      <PageHeader eyebrow="Personal settings" title="Account & notifications" description="Manage your profile and choose which operational updates reach you." />

      <section className="mt-7 grid gap-5 xl:grid-cols-2">
        <Card className="rounded-panel p-6 sm:p-7">
          <h2 className="text-lg font-semibold">Profile</h2>
          <div className="mt-5 space-y-4">
            <TextField label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <TextField label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0911 234 567" />
            {membership && (
              <div className="rounded-card bg-surface-subtle p-4 text-sm">
                <p className="font-semibold">{membership.role.replaceAll('_', ' ')}</p>
                <p className="mt-1 text-ink-muted">{membership.tenant.name} workspace</p>
              </div>
            )}
            <Button onClick={handleSave}>{saved ? 'Saved!' : 'Save profile'}</Button>
          </div>
        </Card>

        <Card className="rounded-panel p-6 sm:p-7">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <div className="mt-5 space-y-1">
            {([
              ['paymentProofs', 'Payment proofs', 'Get notified when manual transfers need verification'],
              ['lowStock', 'Low stock alerts', 'Alert when inventory drops below threshold'],
              ['orderDelays', 'Order delays', 'Notification for orders exceeding prep time'],
              ['dailySummary', 'Daily summary', 'End-of-day revenue and order summary'],
            ] as const).map(([key, label, desc]) => (
              <div key={key} className="flex items-center justify-between gap-5 border-b border-border py-4 text-sm last:border-0">
                <div>
                  <p className="font-semibold">{label}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{desc}</p>
                </div>
                <Switch
                  label={`Toggle ${label}`}
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
