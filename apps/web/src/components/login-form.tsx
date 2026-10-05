'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { normalizeEthiopianPhone } from '@rms/contracts';
import { ApiError } from '@/lib/api-client';
import { useAuth, type StaffProfile } from './auth-provider';
import { Button, TextField } from '@/components/ui';
import { useLocale } from './locale-provider';

function landingPage(profile: StaffProfile): Route {
  if (profile.platformRole === 'SUPER_ADMIN') return '/platform';
  const role = profile.memberships[0]?.role;
  if (role === 'KITCHEN_STAFF') return '/kitchen';
  if (role === 'WAITER') return '/waiter' as Route;
  if (role === 'CASHIER') return '/pos';
  return '/dashboard';
}

export function LoginForm() {
  const { tr } = useLocale();
  const { login } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedPhone = normalizeEthiopianPhone(phone);
    if (!normalizedPhone) {
      setError(tr('validation.invalidPhone'));
      return;
    }
    setSubmitting(true);
    try {
      const profile = await login(normalizedPhone, password);
      const membership = profile.memberships[0];
      if (membership) {
        window.sessionStorage.setItem('rms-tenant-id', membership.tenant.id);
        const branch = membership.branchAssignments.find((item) => item.branch.isActive)?.branch;
        if (branch) window.sessionStorage.setItem('rms-branch-id', branch.id);
      }
      router.replace(landingPage(profile));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : tr('validation.signInFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
      {error && <div role="alert" className="rounded-card border border-danger/20 bg-danger-surface p-3 text-sm font-semibold text-danger">{error}</div>}
      <TextField required label={tr('authentication.phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="0911 234 567" value={phone} onChange={(event) => setPhone(event.target.value)} className="min-h-12" />
      <TextField required label={tr('authentication.password')} type="password" autoComplete="current-password" revealLabel={tr('authentication.showPassword')} hideLabel={tr('authentication.hidePassword')} value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-12" />
      <Button type="submit" size="lg" loading={submitting} disabled={!phone || !password} className="w-full">
        {tr('authentication.signIn')}
      </Button>
    </form>
  );
}
