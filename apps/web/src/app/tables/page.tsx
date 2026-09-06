import { TablesManagement } from '@/components/tables-management';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return (
    <StaffShell>
      <TablesManagement />
    </StaffShell>
  );
}
