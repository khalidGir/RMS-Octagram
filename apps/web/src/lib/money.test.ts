import { describe, it, expect } from 'vitest';
import { formatEtbMinor } from './money';

describe('formatEtbMinor', () => {
  it('formats an integer minor string without decimals', () => {
    expect(formatEtbMinor('150000')).toBe('ETB 1,500');
  });

  it('formats bigint minor units', () => {
    expect(formatEtbMinor(150000n)).toBe('ETB 1,500');
    expect(formatEtbMinor(123n)).toBe('ETB 1.23');
  });

  it('formats a negative amount with a true minus sign', () => {
    expect(formatEtbMinor(-2000)).toBe('\u2212ETB 20');
    expect(formatEtbMinor('-2000')).toBe('\u2212ETB 20');
  });

  it('rounds a fractional number instead of throwing', () => {
    expect(formatEtbMinor(48333.333333333336)).toBe('ETB 483.33');
  });

  it('rounds a fractional numeric string instead of throwing', () => {
    expect(formatEtbMinor('62500.5')).toBe('ETB 625.01');
  });
});
