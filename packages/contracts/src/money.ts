/**
 * Money serialization utilities.
 *
 * All API responses serialize BigInt money values as decimal strings.
 * Client code parses strings back to BigInt for calculations.
 *
 * Convention:
 * - Money is stored as BigInt minor units (e.g., 15000 = 150.00 ETB)
 * - Currency is ISO 4217 code (default: ETB)
 * - All server calculations use BigInt; never floating-point
 */

export function serializeBigInt(
  value: bigint | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  return BigInt(value).toString();
}

export function parseBigInt(value: string): bigint {
  return BigInt(value);
}

/**
 * Canonical JSON serializer that handles BigInt and Date normalization.
 * Keys are sorted recursively for deterministic hashing (idempotency).
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, bigintDateReplacer);
}

function bigintDateReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (value as Record<string, unknown>)[k];
        return sorted;
      }, {});
  }
  return value;
}
