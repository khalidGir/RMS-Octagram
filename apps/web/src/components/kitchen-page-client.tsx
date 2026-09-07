'use client';

import { useEffect, useState } from 'react';
import { KitchenDisplay } from '@/components/kitchen-display';

export function KitchenPageClient() {
  const [branchId, setBranchId] = useState<string>('');

  useEffect(() => {
    const id = window.sessionStorage.getItem('rms-branch-id') ?? '';
    setBranchId(id);
  }, []);

  if (!branchId) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas">
        <p className="font-bold text-ink-muted">Select a branch…</p>
      </div>
    );
  }

  return <KitchenDisplay branchId={branchId} />;
}
