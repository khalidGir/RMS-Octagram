import { AccountManagement } from '@/components/account-management';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return <StaffShell><AccountManagement /></StaffShell>;
}
