import { describe, it, expect, vi } from 'vitest';
import { render as baseRender, screen } from '@testing-library/react';
import { LocaleProvider } from '@/components/locale-provider';
import { NavRail } from './nav-rail';

const render = (ui: React.ReactElement) => baseRender(<LocaleProvider>{ui}</LocaleProvider>);

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

  it('renders group headers for owner', () => {
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={vi.fn()} />);
    expect(screen.getByText('Serve')).toBeDefined();
    expect(screen.getByText('Kitchen')).toBeDefined();
    expect(screen.getByText('Money')).toBeDefined();
    expect(screen.getByText('Manage')).toBeDefined();
  });

  it('hides group headers when collapsed', () => {
    render(<NavRail role="OWNER" collapsed={true} onToggleCollapse={vi.fn()} />);
    expect(screen.queryByText('Serve')).toBeNull();
    expect(screen.queryByText('Money')).toBeNull();
    expect(screen.queryByText('Manage')).toBeNull();
  });

  it('keeps Kitchen config inside Manage, away from daily kitchen work', () => {
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={vi.fn()} />);
    const kitchenConfig = screen.getByText('Kitchen config');
    const manage = screen.getByText('Manage');
    const kitchen = screen.getByText('Kitchen');
    // Both group headers appear before Kitchen config in document order
    expect(kitchenConfig.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(kitchenConfig.compareDocumentPosition(kitchen) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
