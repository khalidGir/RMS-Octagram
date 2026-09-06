import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('renders with label', () => {
    render(<Checkbox label="Accept terms" />);
    expect(screen.getByRole('checkbox', { name: 'Accept terms' })).toBeDefined();
  });

  it('toggles on click', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Accept terms" onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Accept terms' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('shows error state', () => {
    render(<Checkbox label="Accept terms" error="Required" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeDefined();
  });

  it('can be disabled', () => {
    render(<Checkbox label="Accept terms" disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
