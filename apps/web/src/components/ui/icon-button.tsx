import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon: React.ReactNode;
  'aria-label': string;
}

const variants = {
  primary: 'bg-brand text-brand-foreground hover:opacity-90',
  secondary: 'border border-border bg-surface text-ink hover:bg-surface-subtle',
  ghost: 'text-ink hover:bg-surface-subtle',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizes = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = 'ghost', size = 'md', loading, icon, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-control transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <span className="[&>svg]:size-4">{icon}</span>}
    </button>
  ),
);
IconButton.displayName = 'IconButton';
