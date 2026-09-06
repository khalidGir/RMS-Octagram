import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from './switch';

describe('Switch', () => {
  it('renders with label', () => {
    render(<Switch label="Dark mode" />);
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeDefined();
  });

  it('toggles on click', () => {
    const onCheckedChange = vi.fn();
    render(<Switch label="Dark mode" onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Dark mode' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('can be disabled', () => {
    render(<Switch label="Dark mode" disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
