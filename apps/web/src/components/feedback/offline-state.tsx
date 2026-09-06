import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';

interface OfflineStateProps {
  message?: string;
  onReconnect?: () => void;
  className?: string;
}

export function OfflineState({
  message = 'You\u2019re offline. Check your connection.',
  onReconnect,
  className,
}: OfflineStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)} role="status" aria-live="polite">
      <WifiOff className="size-10 text-ink-faint" aria-hidden="true" />
      <p className="max-w-xs text-sm font-semibold text-ink-muted">{message}</p>
      {onReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          className="mt-2 rounded-lg border border-border px-4 py-2 text-sm font-bold text-ink transition hover:bg-surface-subtle"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
