import * as crypto from 'crypto';

/**
 * Payment token generation — same pattern as order tracking tokens.
 * Raw token goes to the client; hash is stored in the database.
 */
export function generatePaymentToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * Hash a payment token for database lookup.
 */
export function hashPaymentToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
