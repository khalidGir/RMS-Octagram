import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface BannerProps {
  variant: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const variantConfig = {
  info: {
    icon: Info,
    container: 'bg-info-surface border-info/20',
    title: 'text-info',
    text: 'text-ink',
  },
  success: {
    icon: CheckCircle2,
    container: 'bg-success-surface border-success/20',
    title: 'text-success',
    text: 'text-ink',
  },
  warning: {
    icon: AlertTriangle,
    container: 'bg-warning-surface border-warning/20',
    title: 'text-warning',
    text: 'text-ink',
  },
  danger: {
    icon: AlertCircle,
    container: 'bg-danger-surface border-danger/20',
    title: 'text-danger',
    text: 'text-ink',
  },
};

export function Banner({ variant, title, children, onDismiss, className }: BannerProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div
      role="status"
      className={cn(
        'flex gap-3 rounded-card border p-4',
        config.container,
        className,
      )}
    >
      <Icon size={18} className={cn('mt-0.5 shrink-0', config.title)} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {title && <p className={cn('text-sm font-bold', config.title)}>{title}</p>}
        <div className={cn('text-sm', config.text, title && 'mt-1')}>{children}</div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-lg p-1 text-ink-muted hover:text-ink transition"
          aria-label="Dismiss"
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
