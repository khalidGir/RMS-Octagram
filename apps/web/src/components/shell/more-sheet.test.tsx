import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoreSheet } from './more-sheet';

vi.mock('next/navigation', () => ({
  usePathname: () => '/tables',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('MoreSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<MoreSheet role="OWNER" open={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when open', () => {
    render(<MoreSheet role="OWNER" open={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'More navigation' })).toBeDefined();
  });

  it('shows nav items beyond the first 4', () => {
    render(<MoreSheet role="OWNER" open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Tables & QR')).toBeDefined();
    expect(screen.getByText('Menu')).toBeDefined();
    expect(screen.getByText('Team & branches')).toBeDefined();
  });

  it('does not show first 4 items (those are in primary nav)', () => {
    render(<MoreSheet role="OWNER" open={true} onClose={vi.fn()} />);
    expect(screen.queryByText('Overview')).toBeNull();
    expect(screen.queryByText('Point of sale')).toBeNull();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<MoreSheet role="OWNER" open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when link clicked', () => {
    const onClose = vi.fn();
    render(<MoreSheet role="OWNER" open={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Menu'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
