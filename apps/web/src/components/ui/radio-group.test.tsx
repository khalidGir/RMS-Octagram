import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RadioGroup } from './radio-group';

describe('RadioGroup', () => {
  const options = [
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'Card' },
    { value: 'transfer', label: 'Transfer' },
  ];

  it('renders with label and options', () => {
    render(<RadioGroup label="Payment method" options={options} />);
    expect(screen.getByText('Payment method')).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Cash' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Card' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Transfer' })).toBeDefined();
  });

  it('selects an option', () => {
    const onValueChange = vi.fn();
    render(<RadioGroup label="Payment method" options={options} onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Card' }));
    expect(onValueChange).toHaveBeenCalledWith('card');
  });

  it('shows error', () => {
    render(<RadioGroup label="Payment method" options={options} error="Required" />);
    expect(screen.getByText('Required')).toBeDefined();
  });
});
