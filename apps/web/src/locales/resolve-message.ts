import type { Bundle, LocaleCode, Message, MessageKey, Namespace, PluralForms, ResolvedMessage } from './types';

const pluralRules = new Map<LocaleCode, Intl.PluralRules>();

function pluralCategory(locale: LocaleCode, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

function countFrom(variables?: Record<string, string | number>): number {
  const raw = variables?.count;
  if (typeof raw === 'number') return raw;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function selectForm(locale: LocaleCode, forms: PluralForms, variables?: Record<string, string | number>): string | undefined {
  return forms[pluralCategory(locale, countFrom(variables))] ?? forms.other;
}

function interpolate(text: string, variables?: Record<string, string | number>): string {
  if (!variables) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : placeholder,
  );
}

function lookup(bundle: Bundle, locale: LocaleCode, key: MessageKey): Message | undefined {
  const separator = key.indexOf('.');
  if (separator < 1) return undefined;
  const namespace = key.slice(0, separator) as Namespace;
  const name = key.slice(separator + 1);
  return bundle[locale]?.[namespace]?.[name];
}

/**
 * Resolves a message for the requested locale. When the locale has no value
 * for the key, falls back to the English catalog; when English is also
 * missing, the key itself is returned so the gap is visible instead of blank.
 */
export function resolveMessage(
  bundle: Bundle,
  locale: LocaleCode,
  key: MessageKey,
  variables?: Record<string, string | number>,
): ResolvedMessage {
  const primary = lookup(bundle, locale, key);
  let text: string | undefined;
  if (typeof primary === 'string') text = primary;
  else if (primary) text = selectForm(locale, primary, variables);

  if (text !== undefined) return { text: interpolate(text, variables), missing: false };

  const fallback = lookup(bundle, 'en', key);
  let fallbackText: string | undefined;
  if (typeof fallback === 'string') fallbackText = fallback;
  else if (fallback) fallbackText = selectForm('en', fallback, variables);

  if (fallbackText !== undefined) return { text: interpolate(fallbackText, variables), missing: true };
  return { text: key, missing: true };
}
