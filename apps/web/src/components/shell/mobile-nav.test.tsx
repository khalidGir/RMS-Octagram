import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileNav } from './mobile-nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/pos',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('MobileNav', () => {
  it('renders primary nav items for cashier role', () => {
    render(<MobileNav role="CASHIER" onOpenMore={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Point of sale/ })).toBeDefined();
    expect(screen.getByRole('link', { name: /Orders/ })).toBeDefined();
  });

  it('shows More button when > 4 items', () => {
    render(<MobileNav role="OWNER" onOpenMore={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'More navigation options' })).toBeDefined();
  });

  it('hides More button when <= 4 items', () => {
    render(<MobileNav role="KITCHEN_STAFF" onOpenMore={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'More navigation options' })).toBeNull();
  });

  it('calls onOpenMore when More clicked', () => {
    const onMore = vi.fn();
    render(<MobileNav role="OWNER" onOpenMore={onMore} />);
    screen.getByRole('button', { name: 'More navigation options' }).click();
    expect(onMore).toHaveBeenCalledOnce();
  });

  it('marks active link', () => {
    render(<MobileNav role="CASHIER" onOpenMore={vi.fn()} />);
    const posLink = screen.getByRole('link', { name: /Point of sale/ });
    expect(posLink.className).toContain('text-brand');
  });
});
