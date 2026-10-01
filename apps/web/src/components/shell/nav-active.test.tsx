import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavRail } from './nav-rail';
import { MobileNav } from './mobile-nav';

const state = vi.hoisted(() => ({ pathname: '/kitchen/config' }));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
}));

vi.mock('@/components/brand-mark', () => ({
  BrandMark: ({ compact }: { compact: boolean }) => (
    <span data-testid="brand-mark" data-compact={compact} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function activeRailLinks(): string[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.className.includes('shadow-sm'))
    .map((link) => link.textContent || '');
}

describe('nav active state', () => {
  it('rail highlights only Kitchen config on /kitchen/config', () => {
    state.pathname = '/kitchen/config';
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={vi.fn()} />);
    const active = activeRailLinks();
    expect(active).toHaveLength(1);
    expect(active[0]).toContain('Kitchen config');
    expect(active[0]).not.toContain('Kitchen display');
  });

  it('rail highlights only Kitchen display on /kitchen', () => {
    state.pathname = '/kitchen';
    render(<NavRail role="OWNER" collapsed={false} onToggleCollapse={vi.fn()} />);
    const active = activeRailLinks();
    expect(active).toHaveLength(1);
    expect(active[0]).toContain('Kitchen display');
  });

  it('rail highlights only Feature control on /platform/features', () => {
    state.pathname = '/platform/features';
    render(<NavRail role="SUPER_ADMIN" collapsed={false} onToggleCollapse={vi.fn()} />);
    const active = activeRailLinks();
    expect(active).toHaveLength(1);
    expect(active[0]).toContain('Feature control');
  });

  it('mobile primary bar highlights the parent when the exact page is in More', () => {
    state.pathname = '/kitchen/config';
    render(<MobileNav role="OWNER" onOpenMore={vi.fn()} />);
    const active = screen
      .getAllByRole('link')
      .filter((link) => link.className.includes('text-brand'));
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('Kitchen display');
  });
});
