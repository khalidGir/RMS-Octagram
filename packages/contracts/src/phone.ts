/**
 * Ethiopian phone number utilities (E.164).
 *
 * Shared by the API and the web app so that validation, normalization,
 * rate-limit keys, and database lookups always agree.
 *
 * Accepted inputs (spaces/hyphens allowed):
 * - 0911234567        (local with trunk prefix)
 * - 911234567         (national without trunk prefix)
 * - +251911234567     (E.164)
 *
 * Canonical output: +2519XXXXXXXX (Ethiopian mobile numbers only).
 * Rejects landlines, non-Ethiopian country codes, alphabetic input,
 * and incomplete numbers.
 */

const MAX_INPUT_LENGTH = 32;
const ET_MOBILE_NATIONAL = /^9\d{8}$/;

/**
 * Normalizes an Ethiopian mobile number to canonical E.164 (+2519XXXXXXXX).
 * Returns null when the input is not a valid Ethiopian mobile number.
 */
export function normalizeEthiopianPhone(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) return null;

  // Digits, an optional leading '+', spaces and hyphens only — no letters.
  if (!/^\+?[\d\s-]+$/.test(trimmed)) return null;
  const compact = trimmed.replace(/[\s-]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;

  let national: string;
  if (compact.startsWith('+251')) {
    national = compact.slice(4);
  } else if (compact.startsWith('+')) {
    return null; // other country codes are rejected
  } else if (compact.startsWith('0')) {
    national = compact.slice(1);
  } else {
    national = compact;
  }

  // After prefix handling the number must be a 9-digit Ethiopian mobile
  // number (starts with 9). This rejects landlines (e.g. 011...),
  // short codes, and incomplete numbers.
  if (!ET_MOBILE_NATIONAL.test(national)) return null;

  return `+251${national}`;
}

/** True when the input normalizes to a valid Ethiopian mobile number. */
export function isValidEthiopianPhone(input: string): boolean {
  return normalizeEthiopianPhone(input) !== null;
}

/**
 * Masks a normalized phone for logs and audit records:
 * +251911234567 -> +2519*****4567.
 * Never log or audit the full number.
 */
export function maskEthiopianPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  if (e164.length <= 6) return '*****';
  return `${e164.slice(0, 5)}*****${e164.slice(-4)}`;
}
