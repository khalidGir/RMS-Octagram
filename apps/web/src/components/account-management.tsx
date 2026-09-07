'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';

export function AccountManagement() {
  const { profile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [phone, setPhone] = useState('');
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

  return (
    <div className="mx-auto max-w-[1500px]">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Personal settings</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.045em] sm:text-4xl">Account & notifications</h1>
        <p className="mt-2 text-sm text-ink-muted">Manage your profile and notification preferences.</p>
      </header>

      <section className="mt-7 grid gap-5 xl:grid-cols-2">
        <article className="rounded-panel border border-line bg-white p-6 shadow-card">
          <h2 className="text-lg font-black">Profile</h2>
          <div className="mt-5 space-y-4">
            <label className="block text-xs font-black text-ink-muted">
              Display name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-2 w-full rounded-xl border border-line p-3 text-sm" />
            </label>
            <label className="block text-xs font-black text-ink-muted">
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" />
            </label>
            <label className="block text-xs font-black text-ink-muted">
              Phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+251 911 000 000" className="mt-2 w-full rounded-xl border border-line p-3 text-sm" />
            </label>
            {membership && (
              <div className="rounded-xl bg-muted p-4 text-sm">
                <p className="font-black">Role: {membership.role}</p>
                <p className="mt-1 text-ink-muted">Tenant: {membership.tenant.name}</p>
              </div>
            )}
            <Button onClick={handleSave}>{saved ? 'Saved!' : 'Save profile'}</Button>
          </div>
        </article>

        <article className="rounded-panel border border-line bg-white p-6 shadow-card">
          <h2 className="text-lg font-black">Notifications</h2>
          <div className="mt-5 space-y-1">
            {([
              ['paymentProofs', 'Payment proofs', 'Get notified when manual transfers need verification'],
              ['lowStock', 'Low stock alerts', 'Alert when inventory drops below threshold'],
              ['orderDelays', 'Order delays', 'Notification for orders exceeding prep time'],
              ['dailySummary', 'Daily summary', 'End-of-day revenue and order summary'],
            ] as const).map(([key, label, desc]) => (
              <label key={key} className="flex items-center justify-between border-b border-line py-4 text-sm">
                <div>
                  <p className="font-black">{label}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifications[key]}
                  onChange={(e) => setNotifications((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="size-5 accent-brand"
                />
              </label>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
