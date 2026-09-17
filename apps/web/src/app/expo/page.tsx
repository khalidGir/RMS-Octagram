import type { Metadata } from 'next';
import { StaffShell } from '@/components/staff-shell';
import { ExpoBoard } from '@/components/expo/expo-board';

export const metadata: Metadata = { title: 'Expo Display' };

export default function ExpoPage() {
  return (
    <StaffShell>
      <div className="p-4 lg:p-6">
        <ExpoBoard />
      </div>
    </StaffShell>
  );
}
