/**
 * The public menu endpoints (`/public/restaurants/:slug/menu` and
 * `/public/tenants/:id/branches/:id/menu`) serialize branch-aware display
 * prices as `priceMinor`. Staff and customer screens predate that contract
 * and read `basePriceMinor` on every variant; normalize once at the fetch
 * boundary so both fields are present on each consumer's variant objects.
 */
export function normalizePublicMenu<T>(menu: T): T {
  const shaped = menu as {
    categories?: Array<{ items?: Array<{ variants?: Array<Record<string, unknown>> }> }>;
  };
  for (const category of shaped.categories ?? []) {
    for (const item of category.items ?? []) {
      for (const variant of item.variants ?? []) {
        if (variant.basePriceMinor === undefined) {
          variant.basePriceMinor = typeof variant.priceMinor === 'string' ? variant.priceMinor : '0';
        }
      }
    }
  }
  return menu;
}
