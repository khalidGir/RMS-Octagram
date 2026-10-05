import { Suspense } from 'react';
import { FeatureControlPanel } from '@/components/feature-control-panel';
import { StaffShell } from '@/components/staff-shell';

export default function FeatureControlPage() {
  return (
    <StaffShell initialRole="SUPER_ADMIN">
      <Suspense fallback={null}>
        <FeatureControlPanel />
      </Suspense>
    </StaffShell>
  );
}
