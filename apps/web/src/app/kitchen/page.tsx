import { KitchenPageClient } from '@/components/kitchen-page-client';
import { StaffShell } from '@/components/staff-shell';

export const metadata = { title: 'Kitchen display' };

export default function KitchenPage() {
  return (
    <StaffShell>
      <KitchenPageClient />
    </StaffShell>
  );
}
