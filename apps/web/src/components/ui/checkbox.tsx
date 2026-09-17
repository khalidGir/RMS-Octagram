'use client';

import { forwardRef, useId } from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps {
  label: string;
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  error?: string;
  className?: string;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ label, checked, onCheckedChange, disabled, error, className }, ref) => {
    const checkboxId = useId();
    const errorId = error ? `${checkboxId}-error` : undefined;

    return (
      <div className="flex items-start gap-2.5">
        <CheckboxPrimitive.Root
          ref={ref}
          id={checkboxId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={errorId}
          className={cn(
            'size-5 shrink-0 rounded-[4px] border bg-surface transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 disabled:pointer-events-none',
            error ? 'border-danger' : 'border-border',
            'data-[state=checked]:bg-brand data-[state=checked]:border-brand data-[state=checked]:text-white',
            'data-[state=indeterminate]:bg-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:text-white',
            className,
          )}
        >
          <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
            <Check size={14} strokeWidth={3} />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        <label htmlFor={checkboxId} className="text-sm font-semibold text-ink leading-tight pt-0.5 cursor-pointer">
          {label}
        </label>
        {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
      </div>
    );
  },
);
Checkbox.displayName = 'Checkbox';
