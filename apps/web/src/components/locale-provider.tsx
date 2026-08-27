'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type LocaleCode = 'en' | 'am' | 'ar';

const messages = {
  en: { language: 'Language', offline: 'Offline', reconnecting: 'Reconnecting', unavailable: 'This ordering link is unavailable.' },
  am: { language: 'ቋንቋ', offline: 'ከመስመር ውጭ', reconnecting: 'እንደገና በመገናኘት ላይ', unavailable: 'ይህ የማዘዣ ማገናኛ አይገኝም።' },
  ar: { language: 'اللغة', offline: 'غير متصل', reconnecting: 'جارٍ إعادة الاتصال', unavailable: 'رابط الطلب هذا غير متاح.' },
} as const;

type Messages = { [K in keyof typeof messages.en]: string };

interface LocaleState {
  locale: LocaleCode;
  setLocale(locale: LocaleCode): void;
  t: Messages;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>('en');
  useEffect(() => {
    const stored = window.localStorage.getItem('rms-public-locale');
    if (stored === 'en' || stored === 'am' || stored === 'ar') setLocaleState(stored);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  const value = useMemo<LocaleState>(() => ({
    locale,
    setLocale(next) {
      setLocaleState(next);
      window.localStorage.setItem('rms-public-locale', next);
    },
    t: messages[locale],
  }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}
