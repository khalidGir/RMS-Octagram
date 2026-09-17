import { InventoryManagement } from '@/components/inventory-management';
import { StaffShell } from '@/components/staff-shell';

export default function Page() {
  return <StaffShell><InventoryManagement /></StaffShell>;
}
