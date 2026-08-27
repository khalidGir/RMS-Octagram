/**
 * Shared time utilities for Prisma @db.Time fields.
 *
 * Prisma returns Date objects for PostgreSQL TIME columns (epoch 1970-01-01
 * with the actual time as hours/minutes/seconds). These helpers normalize
 * them to "HH:MM" strings and evaluate availability windows in branch timezone.
 */

/**
 * Normalize a Prisma @db.Time value to "HH:MM" string.
 * Handles both Date objects (from Prisma) and string values.
 */
export function normalizeTimeValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return value.slice(0, 5);
  }
  if (value instanceof Date) {
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return null;
}

/**
 * Get current time as "HH:MM" in the given IANA timezone.
 * Uses Intl.DateTimeFormat — no external dependencies.
 */
export function localTimeInTimezone(timezone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

/**
 * Check if a current time string (HH:MM) is within an availability window.
 * Handles same-day windows (09:00-21:00) and overnight windows (22:00-06:00).
 */
export function isWithinTimeWindow(
  currentTime: string,
  from: string,
  until: string,
): boolean {
  if (from <= until) {
    // Same-day window (e.g., 09:00 - 21:00)
    return currentTime >= from && currentTime <= until;
  }
  // Overnight window (e.g., 22:00 - 06:00)
  return currentTime >= from || currentTime <= until;
}
