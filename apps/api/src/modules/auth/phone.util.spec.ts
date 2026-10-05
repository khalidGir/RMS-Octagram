import { describe, it, expect } from 'vitest';
import {
  normalizeEthiopianPhone,
  isValidEthiopianPhone,
  maskEthiopianPhone,
} from '@rms/contracts';

describe('normalizeEthiopianPhone', () => {
  it('normalizes local format with trunk prefix', () => {
    expect(normalizeEthiopianPhone('0911234567')).toBe('+251911234567');
  });

  it('normalizes national format without trunk prefix', () => {
    expect(normalizeEthiopianPhone('911234567')).toBe('+251911234567');
  });

  it('normalizes E.164 format', () => {
    expect(normalizeEthiopianPhone('+251911234567')).toBe('+251911234567');
  });

  it('accepts spaces and hyphens', () => {
    expect(normalizeEthiopianPhone('0911 234 567')).toBe('+251911234567');
    expect(normalizeEthiopianPhone('0911-234-567')).toBe('+251911234567');
    expect(normalizeEthiopianPhone('+251 911 234 567')).toBe('+251911234567');
    expect(normalizeEthiopianPhone('  +251-911-234-567  ')).toBe('+251911234567');
  });

  it('all accepted formats resolve to the same canonical value', () => {
    const canonical = '+251911234567';
    expect(normalizeEthiopianPhone('0911234567')).toBe(canonical);
    expect(normalizeEthiopianPhone('911234567')).toBe(canonical);
    expect(normalizeEthiopianPhone(canonical)).toBe(canonical);
    expect(normalizeEthiopianPhone('0911 234 567')).toBe(canonical);
  });

  it('rejects incomplete numbers', () => {
    expect(normalizeEthiopianPhone('091123456')).toBeNull();
    expect(normalizeEthiopianPhone('91123456')).toBeNull();
    expect(normalizeEthiopianPhone('09')).toBeNull();
    expect(normalizeEthiopianPhone('')).toBeNull();
  });

  it('rejects too-long numbers', () => {
    expect(normalizeEthiopianPhone('09112345678')).toBeNull();
    expect(normalizeEthiopianPhone('+2519112345678')).toBeNull();
  });

  it('rejects landline numbers', () => {
    expect(normalizeEthiopianPhone('0111234567')).toBeNull();
    expect(normalizeEthiopianPhone('+251111234567')).toBeNull();
  });

  it('rejects non-Ethiopian country codes', () => {
    expect(normalizeEthiopianPhone('+14155552671')).toBeNull();
    expect(normalizeEthiopianPhone('+442071838750')).toBeNull();
  });

  it('rejects alphabetic and malformed input', () => {
    expect(normalizeEthiopianPhone('abcdefghij')).toBeNull();
    expect(normalizeEthiopianPhone('0911abc4567')).toBeNull();
    expect(normalizeEthiopianPhone('call-me')).toBeNull();
    expect(normalizeEthiopianPhone('0911234567; DROP TABLE')).toBeNull();
  });

  it('rejects bare international prefix without country code', () => {
    expect(normalizeEthiopianPhone('251911234567')).toBeNull();
    expect(normalizeEthiopianPhone('00251911234567')).toBeNull();
  });

  it('is idempotent on its own output', () => {
    const once = normalizeEthiopianPhone('0911234567')!;
    expect(normalizeEthiopianPhone(once)).toBe(once);
  });
});

describe('isValidEthiopianPhone', () => {
  it('accepts every documented format', () => {
    expect(isValidEthiopianPhone('0911234567')).toBe(true);
    expect(isValidEthiopianPhone('911234567')).toBe(true);
    expect(isValidEthiopianPhone('+251911234567')).toBe(true);
    expect(isValidEthiopianPhone('0911 234 567')).toBe(true);
  });

  it('rejects invalid input', () => {
    expect(isValidEthiopianPhone('0111234567')).toBe(false);
    expect(isValidEthiopianPhone('not-a-phone')).toBe(false);
    expect(isValidEthiopianPhone('')).toBe(false);
  });
});

describe('maskEthiopianPhone', () => {
  it('masks the middle of a normalized phone', () => {
    expect(maskEthiopianPhone('+251911234567')).toBe('+2519*****4567');
  });

  it('returns null for empty values', () => {
    expect(maskEthiopianPhone(null)).toBeNull();
    expect(maskEthiopianPhone(undefined)).toBeNull();
    expect(maskEthiopianPhone('')).toBeNull();
  });

  it('never exposes the full number', () => {
    const masked = maskEthiopianPhone('+251911234567')!;
    expect(masked).not.toBe('+251911234567');
    expect(masked).not.toContain('1234567');
  });
});
