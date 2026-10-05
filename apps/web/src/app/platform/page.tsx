import { PlatformAdmin } from '@/components/platform-admin';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return <StaffShell initialRole="SUPER_ADMIN"><PlatformAdmin /></StaffShell>;
}
