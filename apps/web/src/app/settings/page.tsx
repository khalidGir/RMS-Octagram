import { SettingsManagement } from '@/components/settings-management';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return (
    <StaffShell>
      <SettingsManagement />
    </StaffShell>
  );
}
