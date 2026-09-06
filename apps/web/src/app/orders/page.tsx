import { StaffShell } from '@/components/staff-shell';
import { OrdersList } from '@/components/orders-list';

export default function Page() {
  return (
    <StaffShell>
      <OrdersList />
    </StaffShell>
  );
}
