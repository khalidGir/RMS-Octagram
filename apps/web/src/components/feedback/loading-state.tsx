import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = 'Loading\u2026', className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16', className)} role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-brand" aria-hidden="true" />
      <p className="text-sm font-semibold text-ink-muted">
        <span className="sr-only">{message}</span>
        <span aria-hidden="true">{message}</span>
      </p>
    </div>
  );
}
