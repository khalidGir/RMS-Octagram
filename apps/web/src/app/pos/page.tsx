import { PosWorkspace } from '@/components/pos-workspace';
import { StaffShell } from '@/components/staff-shell';

export const metadata = { title: 'Point of sale' };

export default function PosPage() { return <StaffShell><PosWorkspace /></StaffShell>; }
