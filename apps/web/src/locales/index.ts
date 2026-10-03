import { am } from './am';
import { ar } from './ar';
import { en } from './en';
import type { Bundle } from './types';

export const bundle: Bundle = { en, am, ar };

export { localeCodes, localeNames, isLocale } from './types';
export type { Bundle, LocaleCode, MessageKey, ResolvedMessage } from './types';
export { resolveMessage } from './resolve-message';
