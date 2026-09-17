import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavRail } from './nav-rail';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('@/components/brand-mark', () => ({
  BrandMark: ({ compact }: { compact: boolean }) => (
    <span data-testid="brand-mark" data-compact={compact} />
  ),
}));

describe('NavRail', () => {
  it('renders navigation items for owner role', () => {
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Point of sale')).toBeDefined();
    expect(screen.getByText('Payment review')).toBeDefined();
  });

  it('hides items not matching role', () => {
    render(<NavRail role="CASHIER" collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText('Point of sale')).toBeDefined();
    expect(screen.queryByText('Payment review')).toBeNull();
    expect(screen.queryByText('Overview')).toBeNull();
  });

  it('shows collapse button on desktop', () => {
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeDefined();
  });

  it('shows expand button when collapsed', () => {
    render(<NavRail role="OWNER" collapsed={true} onToggleCollapse={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeDefined();
  });

  it('calls onToggleCollapse when collapse button clicked', () => {
    const onToggle = vi.fn();
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={onToggle} />);
    onToggle.mockClear();
    screen.getByRole('button', { name: 'Collapse navigation' }).click();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows role label', () => {
    render(<NavRail role="MANAGER" collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText('Manager')).toBeDefined();
  });

  it('marks active link based on pathname', () => {
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={vi.fn()} />);
    const overviewLink = screen.getByRole('link', { name: /Overview/ });
    expect(overviewLink.className).toContain('bg-white');
  });
});
