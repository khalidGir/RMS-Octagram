'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { ApiError } from '@/lib/api-client';
import { useAuth, type StaffProfile } from './auth-provider';

function landingPage(profile: StaffProfile): Route {
  if (profile.platformRole === 'SUPER_ADMIN') return '/platform';
  const role = profile.memberships[0]?.role;
  if (role === 'KITCHEN_STAFF') return '/kitchen';
  if (role === 'WAITER') return '/waiter' as Route;
  if (role === 'CASHIER') return '/pos';
  return '/';
}

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const profile = await login(email.trim(), password);
      const membership = profile.memberships[0];
      if (membership) {
        window.sessionStorage.setItem('rms-tenant-id', membership.tenant.id);
        const branch = membership.branchAssignments.find((item) => item.branch.isActive)?.branch;
        if (branch) window.sessionStorage.setItem('rms-branch-id', branch.id);
      }
      router.replace(landingPage(profile));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Sign-in failed. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}
      <label className="block">
        <span className="mb-2 block text-sm font-extrabold">Email address</span>
        <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-12 w-full rounded-control border border-line bg-white px-4 text-sm outline-none transition focus:border-brand" />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-extrabold">Password</span>
        <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-12 w-full rounded-control border border-line bg-white px-4 text-sm outline-none transition focus:border-brand" />
      </label>
      <button disabled={submitting || !email || !password} className="flex min-h-12 w-full items-center justify-center rounded-control bg-brand px-5 text-sm font-black text-white shadow-lg shadow-brand/20 transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60">
        {submitting ? 'Signing in…' : 'Sign in to RMS'}
      </button>
    </form>
  );
}
