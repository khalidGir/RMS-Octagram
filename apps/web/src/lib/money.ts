/**
 * Format integer minor units as ETB currency string.
 * Uses BigInt arithmetic — never JavaScript floating-point.
 */
export function formatEtbMinor(
  value: string | number | bigint,
  locale = 'en-ET',
): string {
  const minor = typeof value === 'bigint' ? value : BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat(locale).format(whole);
  const decimals =
    fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`;
  return `${negative ? '\u2212' : ''}ETB ${formattedWhole}${decimals}`;
}
