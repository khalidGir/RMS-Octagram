'use client';

import { forwardRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

export const QuantityInput = forwardRef<HTMLDivElement, QuantityInputProps>(
  ({ value, onChange, min = 0, max = 999, disabled, className }, ref) => {
    const decrement = () => {
      if (value > min) onChange(value - 1);
    };
    const increment = () => {
      if (value < max) onChange(value + 1);
    };

    return (
      <div
        ref={ref}
        className={cn(
          'inline-flex items-center gap-0 rounded-control border border-border bg-surface',
          disabled && 'opacity-50 pointer-events-none',
          className,
        )}
      >
        <button
          type="button"
          onClick={decrement}
          disabled={disabled || value <= min}
          className="grid size-10 place-items-center text-ink transition hover:bg-surface-subtle disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Decrease quantity"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <span className="min-w-[2.5rem] text-center text-sm font-black tabular-nums text-ink" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          onClick={increment}
          disabled={disabled || value >= max}
          className="grid size-10 place-items-center text-ink transition hover:bg-surface-subtle disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Increase quantity"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    );
  },
);
QuantityInput.displayName = 'QuantityInput';
