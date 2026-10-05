'use client';

import { useEffect, useState } from 'react';
import { KitchenDisplay } from '@/components/kitchen-display';
import { useLocale } from '@/components/locale-provider';

export function KitchenPageClient() {
  const [branchId, setBranchId] = useState<string>('');
  const { tr } = useLocale();

  useEffect(() => {
    const id = window.sessionStorage.getItem('rms-branch-id') ?? '';
    setBranchId(id);
  }, []);

  if (!branchId) {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas">
        <p className="font-bold text-ink-muted">{tr('kitchen.selectBranch')}</p>
      </div>
    );
  }

  return <KitchenDisplay branchId={branchId} />;
}
