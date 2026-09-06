import { cn } from '@/lib/cn';

const ETB_FORMATTER = new Intl.NumberFormat('en-ET', {
  style: 'currency',
  currency: 'ETB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface MoneyProps {
  /** Amount in minor units (cents) */
  amount: number;
  className?: string;
}

export function formatEtbMinor(amount: number): string {
  return ETB_FORMATTER.format(amount / 100);
}

export function Money({ amount, className }: MoneyProps) {
  return (
    <span className={cn('tabular-nums font-black', className)}>
      {formatEtbMinor(amount)}
    </span>
  );
}
