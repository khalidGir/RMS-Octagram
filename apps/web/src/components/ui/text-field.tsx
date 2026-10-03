'use client';

import React, { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Accessible label for the password reveal button (defaults to English). */
  revealLabel?: string;
  /** Accessible label for the password hide button (defaults to English). */
  hideLabel?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ className, label, error, hint, id, type, disabled, readOnly, revealLabel = 'Show password', hideLabel = 'Hide password', ...props }, ref) => {
    const inputId = id || React.useId();
    const errorId = error ? `${inputId}-error` : undefined;
    const [revealed, setRevealed] = useState(false);
    const isPassword = type === 'password';
    const toggleable = isPassword && !disabled && !readOnly;
    const inputType = isPassword ? (revealed ? 'text' : 'password') : type;

    const input = (
      <input
        ref={ref}
        id={inputId}
        type={inputType}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={!!error}
        aria-describedby={errorId}
        className={cn(
          'min-h-11 rounded-control border bg-surface text-sm text-ink shadow-sm placeholder:text-ink-faint transition focus:outline-2 focus:outline-offset-0 focus:outline-brand',
          toggleable ? 'w-full ps-3.5 pe-12' : 'px-3.5',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...props}
      />
    );

    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-xs font-semibold text-ink">
          {label}
        </label>
        {toggleable ? (
          <div className="relative">
            {input}
            <button
              type="button"
              onClick={() => setRevealed((value) => !value)}
              aria-label={revealed ? hideLabel : revealLabel}
              className="absolute end-0 top-0 grid size-11 place-items-center rounded-control text-ink-muted transition hover:text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-brand"
            >
              {revealed ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        ) : (
          input
        )}
        {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
        {hint && !error && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
    );
  },
);
TextField.displayName = 'TextField';
