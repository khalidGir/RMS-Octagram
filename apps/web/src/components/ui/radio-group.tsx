'use client';

import { forwardRef, useId } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Circle } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface RadioGroupProps {
  label: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  error?: string;
  className?: string;
}

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ label, value, onValueChange, options, error, className }, ref) => {
    const groupId = useId();
    const errorId = error ? `${groupId}-error` : undefined;

    return (
      <div className="flex flex-col gap-1.5">
        <p id={groupId} className="text-xs font-bold text-ink">
          {label}
        </p>
        <RadioGroupPrimitive.Root
          ref={ref}
          value={value}
          onValueChange={onValueChange}
          aria-labelledby={groupId}
          aria-invalid={!!error}
          aria-describedby={errorId}
          className={cn('flex flex-col gap-2', className)}
        >
          {options.map((option) => {
            const optionId = `${groupId}-${option.value}`;
            return (
              <label
                key={option.value}
                htmlFor={optionId}
                className={cn(
                  'flex items-center gap-3 rounded-control border bg-surface px-3 py-2.5 transition cursor-pointer',
                  value === option.value ? 'border-brand' : 'border-border hover:border-border-strong',
                  option.disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                <RadioGroupPrimitive.Item
                  id={optionId}
                  value={option.value}
                  disabled={option.disabled}
                  className="size-4 shrink-0 rounded-full border border-border text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand data-[state=checked]:border-brand"
                >
                  <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
                    <Circle size={8} fill="currentColor" className="text-brand" />
                  </RadioGroupPrimitive.Indicator>
                </RadioGroupPrimitive.Item>
                <span className="text-sm font-semibold text-ink">{option.label}</span>
              </label>
            );
          })}
        </RadioGroupPrimitive.Root>
        {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
      </div>
    );
  },
);
RadioGroup.displayName = 'RadioGroup';
