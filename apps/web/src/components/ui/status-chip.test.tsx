import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusChip } from './status-chip';

describe('StatusChip', () => {
  it('renders with correct text', () => {
    render(<StatusChip status="active">Active</StatusChip>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies correct status class', () => {
    const { container } = render(<StatusChip status="success">Done</StatusChip>);
    expect(container.firstChild).toHaveClass('bg-success/10', 'text-success');
  });

  it('renders status dot', () => {
    const { container } = render(<StatusChip status="warning">Warning</StatusChip>);
    const dot = container.querySelector('.bg-current');
    expect(dot).toBeInTheDocument();
  });
});
