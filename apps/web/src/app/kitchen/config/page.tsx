import type { Metadata } from 'next';
import { StaffShell } from '@/components/staff-shell';
import { KitchenConfigView } from '@/components/kitchen-config/kitchen-config-view';

export const metadata: Metadata = { title: 'Kitchen Configuration' };

export default function KitchenConfigPage() {
  return (
    <StaffShell>
      <div className="p-4 lg:p-6">
        <KitchenConfigView />
      </div>
    </StaffShell>
  );
}
