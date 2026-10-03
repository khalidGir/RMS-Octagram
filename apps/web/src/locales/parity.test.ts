import { describe, expect, it } from 'vitest';

import { am } from './am';
import { ar } from './ar';
import { en } from './en';
import type { Bundle, LocaleCode, Message, Namespace } from './types';
import { localeCodes, namespaces } from './types';

const bundles: Record<LocaleCode, Record<Namespace, Record<string, Message>>> = { en, am, ar };

const isPlural = (message: Message): message is Exclude<Message, string> =>
  typeof message !== 'string';

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function messagePlaceholders(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  return [...new Set(texts.flatMap(placeholders))].sort();
}

function flatEntries(catalog: Record<string, Message>): [string, Message][] {
  return Object.entries(catalog);
}

describe('locale catalogs', () => {
  it('exposes one catalog per supported locale', () => {
    expect(Object.keys(bundles).sort()).toEqual([...localeCodes].sort());
  });

  namespaces.forEach((namespace) => {
    const enCatalog = en[namespace];

    localeCodes.forEach((locale) => {
      const catalog = bundles[locale][namespace];

      it(`${locale}.${namespace} has exactly the English key set`, () => {
        expect(Object.keys(catalog).sort()).toEqual(Object.keys(enCatalog).sort());
      });

      it(`${locale}.${namespace} values are non-empty and match English message shape`, () => {
        flatEntries(enCatalog).forEach(([key, enMessage]) => {
          const value = catalog[key];
          expect(value, `${locale}.${namespace}.${key}`).toBeDefined();

          if (isPlural(enMessage)) {
            expect(isPlural(value), `${locale}.${namespace}.${key} must be a plural form`).toBe(true);
            if (isPlural(value)) {
              expect(Object.keys(value).length).toBeGreaterThan(0);
              expect(value.other, `${locale}.${namespace}.${key}.other`).toBeTruthy();
            }
          } else {
            expect(typeof value, `${locale}.${namespace}.${key}`).toBe('string');
            expect(String(value).length).toBeGreaterThan(0);
          }
        });
      });

      it(`${locale}.${namespace} uses the same placeholders as English`, () => {
        flatEntries(enCatalog).forEach(([key, enMessage]) => {
          const value = catalog[key];
          if (value === undefined) return;
          expect(messagePlaceholders(value), `${locale}.${namespace}.${key}`).toEqual(
            messagePlaceholders(enMessage),
          );
        });
      });
    });
  });

  it('every locale is a well-formed Bundle for the resolver', () => {
    const bundle: Bundle = bundles as unknown as Bundle;
    localeCodes.forEach((locale) => {
      expect(Object.keys(bundle[locale]).sort()).toEqual([...namespaces].sort());
    });
  });
});
