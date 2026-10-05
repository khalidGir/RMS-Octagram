import { cn } from '@/lib/cn';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

const prefersReducedMotion = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

export function Skeleton({ className, variant = 'text', width, height, style, ...props }: SkeletonProps) {
  const shapeClass = {
    text: 'rounded-lg',
    circular: 'rounded-full',
    rectangular: 'rounded-card',
  }[variant];

  return (
    <div
      className={cn(
        'bg-surface-subtle',
        shapeClass,
        !prefersReducedMotion && 'animate-pulse',
        className,
      )}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...props}
    />
  );
}
