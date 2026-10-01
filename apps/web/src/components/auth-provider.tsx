'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest, type ApiEnvelope } from '@/lib/api-client';
import { normalizeEthiopianPhone } from '@rms/contracts';

export type StaffRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN_STAFF' | 'WAITER';

export interface StaffProfile {
  id: string;
  phone: string | null;
  displayName: string;
  platformRole: 'SUPER_ADMIN' | null;
  memberships: Array<{
    id: string;
    role: StaffRole;
    tenant: { id: string; name: string; slug: string; status: string };
    branchAssignments: Array<{ branchId: string; branch: { id: string; name: string; slug: string; isActive: boolean } }>;
  }>;
}

interface AuthState {
  accessToken: string | null;
  csrfToken: string | null;
  profile: StaffProfile | null;
  loading: boolean;
  login(phone: string, password: string): Promise<StaffProfile>;
  logout(): Promise<void>;
  refreshProfile(): Promise<StaffProfile | null>;
}

const AuthContext = createContext<AuthState | null>(null);

const CSRF_STORAGE_KEY = 'rms.csrfToken';

function readStoredCsrf(): string | null {
  try {
    return globalThis.localStorage?.getItem(CSRF_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function persistCsrf(token: string | null): void {
  try {
    if (token) globalThis.localStorage?.setItem(CSRF_STORAGE_KEY, token);
    else globalThis.localStorage?.removeItem(CSRF_STORAGE_KEY);
  } catch {
    // Storage unavailable — the session then degrades to re-login after reload.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (token: string) => {
    const response = await apiRequest<ApiEnvelope<StaffProfile>>('/auth/me', { accessToken: token });
    setProfile(response.data);
    return response.data;
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await apiRequest<ApiEnvelope<{ accessToken: string; csrfToken: string }>>('/auth/refresh', {
        method: 'POST',
        csrfToken: readStoredCsrf(),
      });
      setAccessToken(response.data.accessToken);
      setCsrfToken(response.data.csrfToken);
      persistCsrf(response.data.csrfToken);
      await loadProfile(response.data.accessToken);
    } catch {
      setAccessToken(null);
      setCsrfToken(null);
      setProfile(null);
      persistCsrf(null);
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  useEffect(() => { void refreshSession(); }, [refreshSession]);

  const value = useMemo<AuthState>(() => ({
    accessToken,
    csrfToken,
    profile,
    loading,
    async login(phone, password) {
      const normalizedPhone = normalizeEthiopianPhone(phone);
      if (!normalizedPhone) {
        throw new Error('Enter a valid Ethiopian mobile number (e.g. 0911 234 567).');
      }
      const response = await apiRequest<ApiEnvelope<{ accessToken: string; csrfToken: string }>>('/auth/login', {
        method: 'POST',
        body: { phone: normalizedPhone, password },
      });
      setAccessToken(response.data.accessToken);
      setCsrfToken(response.data.csrfToken);
      persistCsrf(response.data.csrfToken);
      return loadProfile(response.data.accessToken);
    },
    async logout() {
      await apiRequest('/auth/logout', { method: 'POST', csrfToken }).catch(() => undefined);
      setAccessToken(null);
      setCsrfToken(null);
      setProfile(null);
      persistCsrf(null);
    },
    async refreshProfile() {
      if (!accessToken) return null;
      return loadProfile(accessToken);
    },
  }), [accessToken, csrfToken, loadProfile, loading, profile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
