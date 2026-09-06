'use client';

import { useOnlineStatus } from '@/hooks';

export function ConnectivityIndicator() {
  const online = useOnlineStatus();
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
        online ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
      }`}
      role="status"
      aria-live="polite"
    >
      <span className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {online ? 'Systems online' : 'Offline'}
    </span>
  );
}
