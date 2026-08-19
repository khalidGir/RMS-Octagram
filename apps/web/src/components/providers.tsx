'use client';

import { QueryProvider } from './query-provider';
import { ServiceWorkerRegistration } from './service-worker-registration';
import { ThemeProvider } from './theme-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider><QueryProvider>{children}</QueryProvider><ServiceWorkerRegistration /></ThemeProvider>;
}
