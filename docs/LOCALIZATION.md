# Localization (en / am / ar)

The web app ships three locales: English (`en`), Amharic (`am`), and Arabic (`ar`). All scoped user-facing copy — staff app, marketing, legal, and public customer pages — runs through a single locale provider.

> **Before production:** the Amharic and Arabic wording (especially `legal`, `marketing`, `platform`) is machine-assisted draft quality and needs a native-speaker/legal review. A Playwright localization suite (27 checks) passes locally against the full stack.

## Coverage status

Localization phases L0–L7 are complete: every page in the scope inventory (`docs/LOCALIZATION_INVENTORY.md`) renders through `tr()` in all three locales, including staff workspaces (POS, orders, kitchen, waiter, inventory, menu, tables, team, shifts, reports, settings, payments, day-close), platform admin, marketing site, and the legal pages.

### Intentionally left untranslated (by decision)

- **Static English `metadata`** on `src/app/page.tsx` and the three legal pages (browser-tab titles are server-rendered without locale context).
- **`ProductPreview`** (aria-hidden mock UI in the marketing hero) and the **`featureCatalog`** data source.
- **Design-system demo data** (`src/app/design-system/page.tsx`): token names (`brand`, `accent`, `success`, `warning`, `danger`), demo branch names (`Bole Main`, `Downtown`), placeholder `0911 234 567`, brand strings (`RestaurantMS`, `Buna House`).
- **Shared primitive chrome**: `ui/money.tsx` labels, `ui/dialog.tsx` sr-only `Close`, `TextField` reveal labels default to English and are translated at call sites.
- **`src/components/feedback/*`** — still unused by any screen; translate when adopted.
- **Server-returned API messages** (`ApiError.message` / `reason.message`) pass through untranslated until an API-side localization decision exists (policy L1). Client-side fallback strings are translated per module. Known client-handled conditions map to shared `validation.*` keys.
- **Tenant-authored content** (menu items, categories, tenant/branch/customer names). Known user-visible enum/status values are localized through `status-labels.ts`; unknown future values fall back to a readable form of the raw token.
- **Brand/technical tokens**: phone placeholders, `ETB`, `SKU`, `M-PESA`, `CBE Birr`, `POS`/`KDS`, `PWA`, `API`, `QR`, `FAQ`, `VAT`, elapsed-time template `'{h}h {m}m'`, em-dash `'—'` loading placeholder, data-level fallbacks.
- **`/expo`** routes — blocked feature, out of scope.

### Known deviations

- Waiter dine-in label is `'DINE IN'` (kept verbatim from original copy).
- Components that previously called `toLocaleDateString`-style helpers now use the provider's `formatDate`, whose default locale profile is `en-ET`/`am-ET`/`ar-ET` — English date rendering may differ slightly from the old `en-GB` output (affects waiters, inventory, payments, settings, shift history, tenant detail).
- `day-close` keeps its own `formatInTz` helper (report-boundary logic).
- `e2e/kds.spec.ts` still contains 158/173 raw text assertions from before localization; the localization-sensitive screens it covers are exercised by the green unit suite. Updating that spec is follow-up.
- Amharic and Arabic legal wording is an unreviewed draft. Legal pages display a prominent warning, identify English as authoritative, and allow temporary English viewing without changing the global locale. Qualified Ethiopian legal counsel and native Amharic/Arabic reviewers must approve it before production.

## Architecture

| Concern | Location |
| --- | --- |
| Message catalogs (24 namespaces incl. `platform`, `marketing`, `legal`, `showcase`, `status`) | `src/locales/{en,am,ar}/` |
| Locale codes, locale names, shared types | `src/locales/types.ts` |
| Message resolution: English fallback, `{var}` interpolation, plural selection | `src/locales/resolve-message.ts` |
| Typed `MessageKey` and combined bundle | `src/locales/index.ts` |
| Provider: locale state, persistence, `tr`, formatters, `dir` | `src/components/locale-provider.tsx` |
| Shared language picker | `src/components/language-picker.tsx` |
| Status/role label helpers (key maps, raw-value fallbacks) | `src/lib/status-labels.ts` |
| Legal document renderer (client) | `src/components/legal-site.tsx` |
| Unlayered RTL and typography overrides | `src/app/globals.css` (end of file) |

There is exactly one provider instance (`LocaleProvider` inside `src/components/providers.tsx`, mounted by `app/layout.tsx`), so staff screens and customer pages share the same locale state.

## Persistence and detection order

1. `localStorage['rms-locale']` (the legacy customer-only key `rms-public-locale` is migrated on read)
2. Cookie `rms-locale` (1 year, `SameSite=Lax`)
3. `navigator.languages` / `navigator.language`
4. English (`en`)

Switching locale writes storage and cookie and updates `<html lang>` / `<html dir>` **without a page reload**. Only Arabic sets `dir="rtl"`; English and Amharic stay `ltr`.

A synchronous **pre-paint boot script** in `app/layout.tsx` runs while the HTML is still parsing, so returning users get the right `lang`/`dir` (and fonts) on the first paint instead of an English LTR flash. The script strictly validates every candidate value against the allow-list `en|am|ar` — it never writes an arbitrary stored value to `lang`, and it derives `dir` only as `ar → rtl`, everything else `ltr`, with `en` as the final fallback. The remaining (brief) switch is the text itself, which changes when React hydrates.

Customer menu → checkout must navigate with Next.js `router.push` (never `window.location`), otherwise the document is replaced, the locale re-initializes, and in-memory state such as the language marker is lost.

## Adding or changing a string

1. Add the key to **all three** catalogs for the right namespace (`src/locales/en|am|ar/<namespace>.ts`). The parity test fails when any locale misses the key.
2. Reference it with the namespaced key: `tr('ordering.reviewAndPay')`.
3. Never build sentences by concatenation. One key per sentence, with `{placeholder}` interpolation:

   ```ts
   tr('ordering.table', { table: '12' }) // "Table {table}"
   ```

4. For counts, use a plural message object; the provider picks the form with `Intl.PluralRules`:

   ```ts
   reviewOrderCount: {
     one: 'Review order · {count} item',
     other: 'Review order · {count} items',
   }
   ```

5. A missing key falls back to the English string; in development a `console.warn` is emitted.

Never translate tenant-authored content (menu items, categories, tenant/branch names, customer names) or server-generated strings.

## Formatting rules

All locale-sensitive formatting is centralized on the provider (`useLocale()`):

- `formatCurrency(valueMinor)` — integer minor units via `formatEtbMinor`, `ETB` output; money spans are marked `dir="ltr"` so amounts stay readable in RTL.
- `formatNumber(value)` — `Intl.NumberFormat`.
- `formatDate(value, options?)` / `formatTime(value, options?)` — `Intl` with `en-ET`, `am-ET`, `ar-ET-u-nu-latn`; always `timeZone: 'Africa/Addis_Ababa'`. The options argument is spread after `timeZone`, so a caller may override it (used by tenant detail's timezone column).
- Times are stored in UTC; display and report boundaries use `Africa/Addis_Ababa`.
- Arabic uses Latin digits (`ar-ET-u-nu-latn`) so numerals match receipts and the English UI.

Do not call `toLocale*String` ad hoc in components; add a formatter to the provider instead. Customer-facing screens must use `formatCurrency` from `useLocale()` — calling the raw `formatEtbMinor` helper bypasses the locale.

## RTL and typography

- `src/app/globals.css` ends with **unlayered** rules; they must stay outside `@layer` or Tailwind v3 utility layers win:
  - letter-spacing reset for `html[lang="am"]` / `html[lang="ar"]` headings, `.page-eyebrow`, and `.uppercase`;
  - RTL flip of the off-canvas nav rail below 1024px.
- Directional layout uses logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`). Physical→logical conversion was applied in every file touched by the localization batches; `ui/text-field.tsx` positions the password reveal control with `end-0` / `pe-*` so it sits on the correct side in RTL.
- Direction-neutral centering and full-width placement may continue to use both physical edges (for example `left-1/2` centering or `left-0 right-0` sheets).
- Shared primitives that cannot call `useLocale()` (they render fine outside a provider in unit tests) accept their strings as props: `TextField` takes `revealLabel` / `hideLabel`, defaulting to the English text. `login-form` passes the localized keys `authentication.showPassword` / `hidePassword`.
- No runtime font CDN: Inter is self-hosted by `next/font` (latin subset). Ethiopic and Arabic glyphs come from operating-system fonts.

## Language picker placements

One shared `<LanguagePicker />` (Radix Select, accessible name from `common.language`) appears on: marketing header, login page, staff account menu and account preferences, public menu header, checkout, payment proof, and order tracking. KDS, Expo, and Waiter reach it through the account menu.

## Testing

Unit and integration (Vitest, run from `apps/web`):

```bash
npx vitest run
```

- `src/locales/parity.test.ts` — key parity, plural shapes, and placeholder unions across en/am/ar for **all** namespaces (218 assertions).
- `src/locales/resolve-message.test.ts` — fallback, interpolation, plurals.
- `src/components/locale-provider.test.tsx` — detection order, persistence, `lang`/`dir`, formatters.
- `src/components/language-picker.test.tsx` — picker labels, options, selection.
- `login-localization`, `public-order-menu-localization` — localized screens.
- Shell and navigation tests wrap their renders in `LocaleProvider`.

End-to-end (Playwright, live app; API rate limit ~6 logins/min — wait ≥3 min between runs):

```bash
npx playwright test e2e/localization.spec.ts e2e/phone-login.spec.ts e2e/customer-ordering.spec.ts e2e/staff-locale.spec.ts --project=desktop-chrome
```

Covers Amharic and Arabic switching with reload persistence, locale surviving sign-in, menu-to-checkout locale and cart persistence without a full page reload, staff account-menu switching (dashboard shell + reload), axe checks for the Arabic login page, the Amharic menu, and the open picker, and the English login labels.

### jsdom workarounds (`src/test/setup.ts`)

- `scrollIntoView` stub — jsdom does not implement it and Radix Select calls it while focusing the selected item.
- Persistent focus sink — jsdom remembers the document as the last focused element after a focused node unmounts, so the next `element.focus()` fires a synthetic `blur` on `window`. Radix Select closes on window blur; focusing a tiny inert `div[tabindex="-1"]` at the start of each test keeps the last focused target an element, so the blur is dispatched at the sink instead.
