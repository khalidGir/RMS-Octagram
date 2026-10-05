import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="page-header">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('glass-surface flex min-h-14 flex-wrap items-center gap-3 rounded-card p-2.5 shadow-card', className)}>{children}</div>;
}
