import { Lock } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PermissionStateProps {
  title?: string;
  message?: string;
  className?: string;
}

export function PermissionState({
  title = 'Access restricted',
  message = 'You don\u2019t have permission to view this page.',
  className,
}: PermissionStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-center', className)}>
      <Lock className="size-10 text-ink-faint" aria-hidden="true" />
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <p className="max-w-xs text-sm text-ink-muted">{message}</p>
    </div>
  );
}
