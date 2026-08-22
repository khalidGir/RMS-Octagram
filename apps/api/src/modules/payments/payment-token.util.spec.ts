import { describe, it, expect } from 'vitest';
import { generatePaymentToken, hashPaymentToken } from './payment-token.util';

describe('payment-token.util', () => {
  describe('generatePaymentToken', () => {
    it('returns raw and hash pair', () => {
      const { raw, hash } = generatePaymentToken();

      expect(raw).toBeTruthy();
      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('generates unique tokens each time', () => {
      const t1 = generatePaymentToken();
      const t2 = generatePaymentToken();

      expect(t1.raw).not.toBe(t2.raw);
      expect(t1.hash).not.toBe(t2.hash);
    });

    it('hash is consistent with hashPaymentToken', () => {
      const { raw, hash } = generatePaymentToken();

      expect(hashPaymentToken(raw)).toBe(hash);
    });
  });

  describe('hashPaymentToken', () => {
    it('produces a 64-char hex string', () => {
      const hash = hashPaymentToken('test-token-raw');

      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    it('is deterministic', () => {
      const h1 = hashPaymentToken('same-input');
      const h2 = hashPaymentToken('same-input');

      expect(h1).toBe(h2);
    });
  });
});
