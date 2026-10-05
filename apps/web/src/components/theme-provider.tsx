import type { CSSProperties, ReactNode } from 'react';
import type { TenantTheme } from '@/lib/types';

const defaultTheme: TenantTheme = { primaryColor: '#B4532A', accentColor: '#C08A2E', storefrontMode: 'light', radius: 'soft', fontFamily: 'inter' };

function hexToRgb(hex: string): string | null {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) { return children; }

export function TenantThemeScope({ children, theme = defaultTheme, className }: { children: ReactNode; theme?: TenantTheme; className?: string }) {
  const style = {
    '--tenant-primary': hexToRgb(theme.primaryColor) ?? '180 83 42',
    '--tenant-accent': hexToRgb(theme.accentColor) ?? '192 138 46',
    '--tenant-radius': theme.radius === 'square' ? '0.25rem' : theme.radius === 'rounded' ? '1.25rem' : '0.875rem',
  } as CSSProperties;
  return <div data-tenant-theme="customer" className={className} style={style}>{children}</div>;
}
