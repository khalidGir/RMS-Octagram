import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money, formatEtbMinor } from './money';

describe('Money', () => {
  it('formats minor units to ETB', () => {
    const result = formatEtbMinor(150000);
    expect(result).toMatch(/ETB[\s\u00A0\u202F]1[,.]500\.00/);
  });

  it('formats zero', () => {
    const result = formatEtbMinor(0);
    expect(result).toMatch(/ETB[\s\u00A0\u202F]0\.00/);
  });

  it('renders amount in a span', () => {
    render(<Money amount={150000} />);
    const el = screen.getByText(/1[,.]500\.00/);
    expect(el).toBeDefined();
  });

  it('applies custom className', () => {
    render(<Money amount={500} className="text-lg" />);
    const el = screen.getByText(/5\.00/);
    expect(el.className).toContain('text-lg');
  });
});
