import { cn } from '@/lib/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined';
}

const variants = {
  default: 'bg-surface border border-border shadow-card',
  elevated: 'bg-surface shadow-float',
  outlined: 'bg-surface border border-border-strong',
};

export function Card({ className, variant = 'default', ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-card', variants[variant], className)}
      {...props}
    />
  );
}
