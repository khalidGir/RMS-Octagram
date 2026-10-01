import { CashShiftWorkspace } from '@/components/cash-shift-workspace';
import { ShiftHistory } from '@/components/shift-history';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return (
    <StaffShell>
      <CashShiftWorkspace />
      <ShiftHistory />
    </StaffShell>
  );
}
