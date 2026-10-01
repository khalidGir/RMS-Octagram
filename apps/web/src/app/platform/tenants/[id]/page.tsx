import { TenantDetail } from '@/components/tenant-detail';
import { StaffShell } from '@/components/staff-shell';

export default function TenantDetailPage() {
  return (
    <StaffShell initialRole="SUPER_ADMIN">
      <TenantDetail />
    </StaffShell>
  );
}
