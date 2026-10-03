'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { bundle, isLocale, localeCodes, localeNames, resolveMessage } from '@/locales';
import type { LocaleCode, MessageKey } from '@/locales';
import { formatEtbMinor } from '@/lib/money';

export { localeCodes, localeNames };
export type { LocaleCode, MessageKey };

type Direction = 'ltr' | 'rtl';

const intlLocales: Record<LocaleCode, string> = {
  en: 'en-ET',
  am: 'am-ET',
  ar: 'ar-ET-u-nu-latn',
};

const directions: Record<LocaleCode, Direction> = { en: 'ltr', am: 'ltr', ar: 'rtl' };

const storageKey = 'rms-locale';
const legacyStorageKey = 'rms-public-locale';
const localeCookie = 'rms-locale';

interface LocaleState {
  locale: LocaleCode;
  direction: Direction;
  setLocale(locale: LocaleCode): void;
  tr(key: MessageKey, variables?: Record<string, string | number>): string;
  formatCurrency(valueMinor: bigint | number | string): string;
  formatNumber(value: number): string;
  formatDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
  formatTime(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
}

const LocaleContext = createContext<LocaleState | null>(null);

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match?.[1] ?? null;
}

function detectLocale(): LocaleCode {
  const stored = localStorage.getItem(storageKey);
  if (isLocale(stored)) return stored;

  const legacy = localStorage.getItem(legacyStorageKey);
  if (isLocale(legacy)) {
    localStorage.setItem(storageKey, legacy);
    localStorage.removeItem(legacyStorageKey);
    return legacy;
  }

  const cookie = readCookie(localeCookie);
  if (isLocale(cookie)) return cookie;

  const preferred = navigator.languages ?? [navigator.language];
  for (const candidate of preferred) {
    const short = candidate.toLowerCase().split('-')[0];
    if (isLocale(short)) return short;
  }
  return 'en';
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>('en');
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    setLocaleState(detectLocale());
    setDetected(true);
  }, []);

  useEffect(() => {
    if (!detected) return;
    document.documentElement.lang = locale;
    document.documentElement.dir = directions[locale];
    document.cookie = `${localeCookie}=${locale}; path=/; max-age=31536000; samesite=lax`;
  }, [locale, detected]);

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    localStorage.setItem(storageKey, next);
    localStorage.removeItem(legacyStorageKey);
  }, []);

  const value = useMemo<LocaleState>(() => {
    const intlLocale = intlLocales[locale];
    const tr = (key: MessageKey, variables?: Record<string, string | number>) => {
      const resolved = resolveMessage(bundle, locale, key, variables);
      if (resolved.missing && process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] Missing message for "${key}" in locale "${locale}"`);
      }
      return resolved.text;
    };
    return {
      locale,
      direction: directions[locale],
      setLocale,
      tr,
      formatCurrency: (valueMinor) => formatEtbMinor(valueMinor, intlLocale),
      formatNumber: (value) => new Intl.NumberFormat(intlLocale).format(value),
      formatDate: (value, options) =>
        new Intl.DateTimeFormat(intlLocale, { timeZone: 'Africa/Addis_Ababa', ...options }).format(
          new Date(value),
        ),
      formatTime: (value, options) =>
        new Intl.DateTimeFormat(intlLocale, {
          timeZone: 'Africa/Addis_Ababa',
          hour: '2-digit',
          minute: '2-digit',
          ...options,
        }).format(new Date(value)),
    };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}
