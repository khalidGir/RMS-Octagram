import React, { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id || React.useId();
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-xs font-bold text-ink">
          {label}
        </label>
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={errorId}
          className={cn(
            'min-h-20 rounded-control border bg-surface px-3 py-2 text-sm font-semibold text-ink placeholder:text-ink-faint focus:outline-2 focus:outline-offset-0 focus:outline-brand resize-y',
            error ? 'border-danger' : 'border-border',
            className,
          )}
          {...props}
        />
        {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
        {hint && !error && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
