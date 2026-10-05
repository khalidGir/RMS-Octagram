import { CreateTenantForm } from '@/components/create-tenant-form';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return (
    <StaffShell initialRole="SUPER_ADMIN">
      <CreateTenantForm />
    </StaffShell>
  );
}
