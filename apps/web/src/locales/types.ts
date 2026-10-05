export const localeCodes = ['en', 'am', 'ar'] as const;
export type LocaleCode = (typeof localeCodes)[number];

export const localeNames: Record<LocaleCode, string> = {
  en: 'English',
  am: 'አማርኛ',
  ar: 'العربية',
};

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralForms;

export const namespaces = [
  'common',
  'authentication',
  'navigation',
  'ordering',
  'validation',
  'status',
  'dashboard',
  'pos',
  'orders',
  'kitchen',
  'waiter',
  'menu',
  'inventory',
  'tables',
  'payments',
  'team',
  'settings',
  'shifts',
  'reports',
  'platform',
  'marketing',
  'legal',
  'feedback',
  'showcase',
] as const;
export type Namespace = (typeof namespaces)[number];

import type { en } from './en';

export type EnBundle = typeof en;
export type CatalogShape = { [N in Namespace]: Record<keyof EnBundle[N], Message> };
export type Bundle = Record<LocaleCode, Record<Namespace, Record<string, Message>>>;

export type MessageKey = {
  [N in Namespace]: `${N}.${Extract<keyof EnBundle[N], string>}`;
}[Namespace];

export interface ResolvedMessage {
  text: string;
  missing: boolean;
}

export const isLocale = (value: string | null | undefined): value is LocaleCode =>
  localeCodes.includes(value as LocaleCode);
