'use client';

import { useEffect } from 'react';
import type { TenantTheme } from '@/lib/types';

const defaultTheme: TenantTheme = { primaryColor: '#B4532A', accentColor: '#C08A2E', storefrontMode: 'light', radius: 'soft', fontFamily: 'inter' };

function hexToRgb(hex: string): string | null {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

export function ThemeProvider({ children, theme = defaultTheme }: { children: React.ReactNode; theme?: TenantTheme }) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', hexToRgb(theme.primaryColor) ?? '180 83 42');
    root.style.setProperty('--brand-accent', hexToRgb(theme.accentColor) ?? '192 138 46');
    root.style.setProperty('--radius-card', theme.radius === 'square' ? '0.25rem' : theme.radius === 'rounded' ? '1.25rem' : '0.875rem');
  }, [theme]);
  return children;
}
