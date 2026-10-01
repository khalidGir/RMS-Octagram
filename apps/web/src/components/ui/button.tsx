import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

const variants = {
  primary: 'bg-brand text-brand-foreground hover:bg-brand-600 shadow-sm active:scale-[.98]',
  secondary: 'border border-border bg-surface text-ink hover:bg-surface-subtle active:scale-[.98]',
  ghost: 'text-ink hover:bg-surface-subtle',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizes = {
  sm: 'min-h-11 px-3 text-xs gap-1.5',
  md: 'min-h-11 px-4 text-sm gap-2',
  lg: 'min-h-12 px-6 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, leadingIcon, trailingIcon, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-control font-semibold transition duration-normal focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin shrink-0" aria-hidden="true" /> : leadingIcon && <span className="shrink-0 [&>svg]:size-4">{leadingIcon}</span>}
      {children}
      {trailingIcon && <span className="shrink-0 [&>svg]:size-4">{trailingIcon}</span>}
    </button>
  ),
);
Button.displayName = 'Button';
