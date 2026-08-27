'use client';

import { QueryProvider } from './query-provider';
import { ServiceWorkerRegistration } from './service-worker-registration';
import { ThemeProvider } from './theme-provider';
import { AuthProvider } from './auth-provider';
import { LocaleProvider } from './locale-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
        <ServiceWorkerRegistration />
      </ThemeProvider>
    </LocaleProvider>
  );
}
