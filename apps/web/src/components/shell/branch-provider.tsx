'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth-provider';

export type BranchOption = { id: string; name: string; slug: string; isActive: boolean };

interface BranchState {
  branchId: string;
  branches: BranchOption[];
  setBranchId: (id: string) => void;
}

const BranchContext = createContext<BranchState | null>(null);

const STORAGE_KEY = 'rms-branch-id';

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuth();
  const [branchId, setBranchIdState] = useState('');

  const branches = useMemo(() => {
    const membership = profile?.memberships?.[0];
    return membership?.branchAssignments
      ?.filter((a) => a.branch.isActive)
      .map((a) => a.branch) ?? [];
  }, [profile]);

  useEffect(() => {
    if (loading) return;
    if (branches.length === 0) return;
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    const match = branches.find((b) => b.id === saved);
    const next = match?.id ?? branches[0]?.id ?? '';
    setBranchIdState(next);
    if (next) window.sessionStorage.setItem(STORAGE_KEY, next);
  }, [loading, branches]);

  const setBranchId = useCallback((id: string) => {
    setBranchIdState(id);
    window.sessionStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo(() => ({ branchId, branches, setBranchId }), [branchId, branches, setBranchId]);

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchState {
  const context = useContext(BranchContext);
  if (!context) throw new Error('useBranch must be used inside BranchProvider');
  return context;
}
