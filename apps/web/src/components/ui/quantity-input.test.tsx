import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuantityInput } from './quantity-input';

describe('QuantityInput', () => {
  it('renders with value', () => {
    render(<QuantityInput value={3} onChange={vi.fn()} />);
    expect(screen.getByText('3')).toBeDefined();
  });

  it('increments on plus click', () => {
    const onChange = vi.fn();
    render(<QuantityInput value={2} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('decrements on minus click', () => {
    const onChange = vi.fn();
    render(<QuantityInput value={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('disables minus at min', () => {
    render(<QuantityInput value={0} onChange={vi.fn()} min={0} />);
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
  });

  it('disables plus at max', () => {
    render(<QuantityInput value={10} onChange={vi.fn()} max={10} />);
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
  });
});
