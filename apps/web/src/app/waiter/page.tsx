export const dynamic = 'force-dynamic';

import { StaffShell } from '@/components/staff-shell';
import { WaiterWorkspace } from '@/components/waiter-workspace';

export default function WaiterPage() {
  return (
    <StaffShell>
      <WaiterWorkspace />
    </StaffShell>
  );
}
