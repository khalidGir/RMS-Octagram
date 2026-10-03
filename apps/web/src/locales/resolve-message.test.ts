import { describe, expect, it } from 'vitest';

import { resolveMessage } from './resolve-message';
import type { Bundle, MessageKey } from './types';

const partial = {
  en: {
    common: { greeting: 'Hello', plural: { one: '{count} item', other: '{count} items' } },
    authentication: {},
    navigation: {},
    ordering: {},
    validation: {},
  },
  am: { common: { greeting: 'ሰላም' }, authentication: {}, navigation: {}, ordering: {}, validation: {} },
  ar: { common: { plural: { zero: 'صفر', one: 'عنصر واحد', two: 'عنصران', few: '{count} عناصر', many: '{count} عنصرًا', other: 'عناصر' } }, authentication: {}, navigation: {}, ordering: {}, validation: {} },
} as unknown as Bundle;

const key = (value: string) => value as MessageKey;

describe('resolveMessage', () => {
  it('resolves from the requested locale', () => {
    expect(resolveMessage(partial, 'am', key('common.greeting')).text).toBe('ሰላም');
  });

  it('falls back to English and flags the message as missing', () => {
    const resolved = resolveMessage(partial, 'am', key('common.plural'), { count: 2 });
    expect(resolved).toEqual({ text: '2 items', missing: true });
  });

  it('returns the key when no locale has the message', () => {
    expect(resolveMessage(partial, 'en', key('common.absent'))).toEqual({
      text: 'common.absent',
      missing: true,
    });
  });

  it('selects English plural categories', () => {
    expect(resolveMessage(partial, 'en', key('common.plural'), { count: 1 }).text).toBe('1 item');
    expect(resolveMessage(partial, 'en', key('common.plural'), { count: 5 }).text).toBe('5 items');
  });

  it('selects Arabic plural categories including zero', () => {
    expect(resolveMessage(partial, 'ar', key('common.plural'), { count: 0 }).text).toBe('صفر');
    expect(resolveMessage(partial, 'ar', key('common.plural'), { count: 2 }).text).toBe('عنصران');
    expect(resolveMessage(partial, 'ar', key('common.plural'), { count: 11 }).text).toBe('11 عنصرًا');
  });

  it('keeps unknown placeholders untouched', () => {
    expect(resolveMessage(partial, 'en', key('common.greeting'), { extra: 1 }).text).toBe('Hello');
  });
});
