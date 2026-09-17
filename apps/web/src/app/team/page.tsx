import { TeamManagement } from '@/components/team-management';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return (
    <StaffShell>
      <TeamManagement />
    </StaffShell>
  );
}
