/**
 * Format integer minor units as ETB currency string.
 * Uses BigInt arithmetic — never JavaScript floating-point.
 * Non-integer numeric input is rounded to the nearest minor unit so a
 * server-side fraction renders instead of crashing the page.
 */
export function formatEtbMinor(
  value: string | number | bigint,
  locale = 'en-ET',
): string {
  const minor = toMinorUnits(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat(locale).format(whole);
  const decimals =
    fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`;
  return `${negative ? '\u2212' : ''}ETB ${formattedWhole}${decimals}`;
}

function toMinorUnits(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.round(value));
  return /^-?\d+$/.test(value)
    ? BigInt(value)
    : BigInt(Math.round(Number(value)));
}
