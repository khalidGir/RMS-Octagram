/**
 * Log redaction layer for sensitive values.
 * Redacts passwords, tokens, hashes, authorization headers, and S3 signatures.
 */

// Patterns that indicate sensitive values
const SENSITIVE_PATTERNS = [
  /password/i,
  /passwordHash/i,
  /token/i,
  /secret/i,
  /hash/i,
  /authorization/i,
  /cookie/i,
  /signature/i,
  /presigned/i,
  /accessToken/i,
  /refreshToken/i,
  /paymentToken/i,
  /trackingToken/i,
  /qrToken/i,
  /invitationToken/i,
  /selectorHash/i,
  /secretHash/i,
];

// Paths to redact in nested objects
const SENSITIVE_PATHS = [
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'paymentToken',
  'trackingToken',
  'qrToken',
  'invitationToken',
  'authorization',
  'cookie',
  'signature',
  'secret',
  'secretHash',
  'selectorHash',
  'token',
];

const REDACTED = '[REDACTED]';

/**
 * Redact sensitive values from an object.
 * Handles nested objects and arrays.
 */
export function redactSensitive(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (typeof value === 'object') return redactObject(value as Record<string, unknown>);
  return value;
}

function redactString(value: string): string {
  // Don't redact very short strings (likely not sensitive)
  if (value.length < 4) return value;

  // Check if the string looks like a token/secret (high entropy, long)
  if (value.length > 32 && /^[a-zA-Z0-9+/=_-]+$/.test(value)) {
    return REDACTED;
  }

  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Check if key matches sensitive patterns
    const isSensitiveKey = SENSITIVE_PATHS.some(
      (p) => key.toLowerCase() === p.toLowerCase() || key.toLowerCase().includes(p.toLowerCase()),
    );

    if (isSensitiveKey) {
      result[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Create a redacting serializer for Pino.
 */
export function createRedactingSerializer() {
  return (obj: Record<string, unknown>) => {
    return redactObject(obj);
  };
}
