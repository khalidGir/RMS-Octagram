import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)} role="alert" aria-live="assertive">
      <AlertTriangle className="size-10 text-danger" aria-hidden="true" />
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <p className="max-w-xs text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-foreground transition hover:opacity-90"
        >
          Try again
        </button>
      )}
    </div>
  );
}
