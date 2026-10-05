'use client';

import { forwardRef, useId } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  label: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ label, checked, onCheckedChange, disabled, className }, ref) => {
    const switchId = useId();

    return (
      <div className="flex items-center gap-3">
        <SwitchPrimitive.Root
          ref={ref}
          id={switchId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          className={cn(
            'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50',
            checked ? 'bg-brand' : 'bg-surface-sunken border-border',
            className,
          )}
        >
          <SwitchPrimitive.Thumb
            className={cn(
              'pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform',
              checked ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </SwitchPrimitive.Root>
        <label htmlFor={switchId} className="text-sm font-semibold text-ink cursor-pointer">
          {label}
        </label>
      </div>
    );
  },
);
Switch.displayName = 'Switch';
