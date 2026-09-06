# Phase UI-1 Execution Plan — Tokens and Prerequisites

**Phase:** UI-1 — Tokens and Prerequisites
**Status:** Approved with mandatory corrections (16 amendments applied)
**Prerequisites:** UI-0 audit complete (`UI_REDESIGN_PROGRESS.md` exists)
**Baseline screenshots:** Captured at `RMS-frontend/baseline-screenshots/`
**E2E baseline:** 11/19 KDS pass, 8/19 fail (all pre-existing — see Classification section)

---

## Scope

Build the semantic token layer and reusable UI primitives without redesigning feature pages. Migrate primitives and foundational shell-independent components first. Do not perform bulk page redesigns or replace every literal color during this phase.

---

## Baseline E2E Classification

All 8 failures are **pre-existing** (not caused by UI-1):

| Test | Root Cause | Classification |
|------|-----------|----------------|
| KDS shows three columns | Columns only render when `tickets.length > 0`; test asserts text that doesn't exist in empty state | PRE_EXISTING — assertion mismatch |
| KDS columns show empty state | "Empty" text only appears in columns with 0 tickets; test runs with no tickets | PRE_EXISTING — assertion mismatch |
| KDS shows ticket with bump | `POST /pos/orders` returns 404; actual route is `POST /branches/:branchId/orders` | PRE_EXISTING — wrong endpoint |
| KDS bump moves ticket | Same 404 endpoint issue | PRE_EXISTING — same root cause |
| KDS complete moves ticket | Same 404 endpoint issue | PRE_EXISTING — same root cause |
| KDS recall moves ticket | Same 404 endpoint issue | PRE_EXISTING — same root cause |
| KDS shows elapsed time | Same 404 endpoint issue | PRE_EXISTING — same root cause |
| KDS shows order number | Same 404 endpoint issue | PRE_EXISTING — same root cause |

**Baseline:** 11 pass, 8 fail. UI-1 must introduce 0 new failures.

---

## Mandatory Corrections Applied

1. **No emoji in feedback components.** Use Lucide icons with `aria-hidden="true"` and retain visible text labels.
2. **Radix owns focus trapping.** Do not build custom `use-focus-trap` for dialogs migrated to Radix. Custom hook only for documented non-dialog interactions.
3. **StaffShell `<main>` correction.** StaffShell does NOT render `<main>` around children (only in loading state). The audit finding is accurate — a `<main>` wrapper around `{children}` is needed in the shell, not per-route fixes.
4. **Baseline screenshots captured.** Done before foundation changes. Locations recorded in `UI_REDESIGN_PROGRESS.md`.
5. **`/design-system` must return `notFound()` in production.** Not merely hidden from navigation.
6. **No duplicate feedback components.** `EmptyState` and `ErrorState` live ONLY in `components/feedback`, never in `components/ui`.
7. **`aria-live` on feedback.** Loading indicators include screen-reader text. Respects `prefers-reduced-motion`.
8. **Button icon API.** Use `leadingIcon` and `trailingIcon` (normalized dimensions), not generic `icon: ReactNode`. `IconButton` restricted to Lucide-compatible icons.
9. **Primitive backlog tracked.** UI-1 implements a subset. Full backlog: Button, IconButton, TextField, Textarea, Select, Checkbox, RadioGroup, Switch, Dialog, Drawer, Popover, DropdownMenu, Tabs, StatusChip, Tooltip, Toast, Banner, Card, DataTable, Pagination, Skeleton, EmptyState, ErrorState, ConfirmDialog, Money, QuantityInput.
10. **Automated accessibility checks.** Use `@axe-core/playwright` for critical journeys. Primitive tests alone do not satisfy the requirement.
11. **`formatEtbMinor` in `lib/money.ts`.** Not generic utils. Retain integer-minor-unit handling. Avoid floating-point.
12. **Preserve all uncommitted files.** Working tree has 12 modified + 13 untracked files. Do not overwrite, revert, or reformat unrelated changes.
13. **No repo-wide formatting.** Format only files changed during UI-1.
14. **Bundle impact measured.** After installing Radix + Lucide, compare build size. Import Lucide icons directly (tree-shakeable), not the full namespace.
15. **E2E baseline classified.** 8 pre-existing failures documented above. UI-1 must not add failures.
16. **Exact primitive list.** Exit gate lists implemented primitives and explicit remaining backlog.

---

## Step 1: Install Dependencies

### 1a. Lucide React

**Justification:** Current navigation uses two-letter pseudo-icons (OV, PS, OR) that are not recognizable, not accessible, and not scalable. Lucide provides 1500+ consistent outline icons, tree-shakeable, accessible SVG. Materially improves navigation accessibility.

```bash
pnpm --filter @rms/web add lucide-react
```

### 1b. Radix UI Primitives

**Justification:** 3 identical focus-trap implementations (~30 lines each) in `pos-workspace.tsx` and `owner-payment-review.tsx`. Branch picker lacks proper listbox keyboard navigation. Radix provides accessible Dialog, DropdownMenu, Select, Tabs, Tooltip, Popover with proper focus management, keyboard navigation, ARIA attributes.

```bash
pnpm --filter @rms/web add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-popover
```

### 1c. Hook Form Resolvers

**Justification:** `react-hook-form` and `zod` already installed but not connected. `@hookform/resolvers` is <1KB, bridges them via `zodResolver`.

```bash
pnpm --filter @rms/web add @hookform/resolvers
```

### 1d. Dev Dependencies

```bash
pnpm --filter @rms/web add -D vitest @testing-library/react @testing-library/jest-dom jsdom @axe-core/playwright @vitejs/plugin-react vite-tsconfig-paths
```

---

## Step 2: Capture Baseline Bundle Size

Before installing dependencies, record current build size:

```bash
pnpm --filter @rms/web build
# Record .next/static size
```

After installing Radix + Lucide, rebuild and compare.

---

## Step 3: Expand Semantic Token Layer

### 3a. Extend `globals.css` CSS Variables

**File:** `apps/web/src/app/globals.css`

Add new semantic tokens while preserving existing variable names:

```css
:root {
  /* ─── Brand (extended) ─── */
  --brand-50: 255 247 237;
  --brand-100: 255 237 213;
  --brand-500: 199 91 42;
  --brand-600: 171 71 32;
  --brand-700: 137 57 29;

  /* ─── Ink / Text ─── */
  --ink: 23 33 29;
  --ink-muted: 102 113 108;
  --ink-faint: 150 158 154;

  /* ─── Canvas / Surface ─── */
  --canvas: 247 247 244;
  --surface: 255 255 255;
  --surface-subtle: 240 242 239;
  --surface-sunken: 235 237 234;

  /* ─── Border ─── */
  --border: 221 226 222;
  --border-strong: 199 206 201;

  /* ─── Status ─── */
  --success: 19 122 82;
  --success-surface: 230 247 240;
  --warning: 167 90 0;
  --warning-surface: 255 243 220;
  --danger: 179 38 30;
  --danger-surface: 254 235 233;
  --info: 40 100 220;
  --info-surface: 234 242 255;

  /* ─── Elevation ─── */
  --shadow-raised: 0 12px 40px rgb(37 27 20 / 0.07);
  --shadow-floating: 0 20px 60px rgb(37 27 20 / 0.14);
  --shadow-modal: 0 24px 80px rgb(37 27 20 / 0.22);

  /* ─── Focus ─── */
  --focus-ring: 3px solid rgb(var(--brand-accent));
  --focus-offset: 3px;

  /* ─── Motion ─── */
  --duration-fast: 140ms;
  --duration-normal: 180ms;
  --duration-slow: 240ms;
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
  --ease-in: cubic-bezier(0.32, 0, 0.67, 0);

  /* ─── Existing (preserved) ─── */
  --brand-primary: 180 83 42;
  --brand-primary-foreground: 255 255 255;
  --brand-accent: 192 138 46;
  --surface-customer: 255 250 243;
  --surface-card: 255 255 255;
  --surface-muted: 245 240 233;
  --text-primary: 32 26 23;
  --text-secondary: 107 98 92;
  --border-default: 224 216 207;
  --radius-control: 0.625rem;
  --radius-card: 0.875rem;
  --radius-panel: 1rem;
}
```

### 3b. Fix `.staff-grid` and `.control-select`

Replace hardcoded hex in utility classes with CSS variable tokens. Wrap in `@layer components`.

### 3c. Extend `tailwind.config.ts`

Add semantic color tokens mapping to CSS variables. Add shadow and motion tokens.

---

## Step 4: Create Shared Modules

### 4a. `src/lib/cn.ts`

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

### 4b. `src/lib/money.ts`

NOT a generic utils file. Domain-specific money module:

```ts
/**
 * Format integer minor units as ETB currency string.
 * Uses BigInt arithmetic — never JavaScript floating-point.
 */
export function formatEtbMinor(value: string | number | bigint, locale = 'en-ET'): string {
  const minor = typeof value === 'bigint' ? value : BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat(locale).format(whole);
  const decimals = fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`;
  return `${negative ? '−' : ''}ETB ${formattedWhole}${decimals}`;
}
```

Remove duplicate `formatEtb` from `mock-api.ts`. Import from `money.ts` in `api-client.ts`.

### 4c. `src/lib/config.ts`

```ts
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');
export const WS_URL = API_BASE_URL.replace(/\/api\/v1$/, '').replace(/\/api$/, '');
```

### 4d. `src/lib/kds-types.ts`

Consolidated KDS types with proper status union type. Import from here in `use-kds-socket.ts` and `use-kds-tickets.ts`.

---

## Step 5: Build Shared Feedback Components

**Location:** `src/components/feedback/` ONLY (not in `components/ui`).

All feedback components:
- Use Lucide icons with `aria-hidden="true"` (correction #1)
- Include `aria-live="polite"` for loading/mutation states (correction #7)
- Include screen-reader text via `sr-only` spans (correction #7)
- Respect `prefers-reduced-motion` (correction #7)
- No emoji anywhere (correction #1)

### Components to build:

| Component | Icon (Lucide, aria-hidden) | aria-live |
|-----------|---------------------------|-----------|
| `LoadingState` | `Loader2` with `animate-spin` | `aria-live="polite"` |
| `EmptyState` | `Inbox` | none (static) |
| `ErrorState` | `AlertTriangle` | `aria-live="assertive"` |
| `PermissionState` | `Lock` | none (static) |
| `OfflineState` | `WifiOff` | `aria-live="polite"` |

---

## Step 6: Build UI Primitives

**Location:** `src/components/ui/`.

### Primitives implemented in UI-1 (13):

| # | Component | Radix? | Notes |
|---|-----------|--------|-------|
| 1 | `Button` | No | `leadingIcon`/`trailingIcon` (not generic `icon: ReactNode`), normalized icon dimensions |
| 2 | `IconButton` | No | Lucide-compatible only, always has `aria-label` |
| 3 | `Dialog` | Yes | Radix owns focus trapping and restoration |
| 4 | `TextField` | No | Always has programmatic `<label>` |
| 5 | `Select` | Yes | Radix, keyboard accessible |
| 6 | `StatusChip` | No | Semantic status colors |
| 7 | `Card` | No | Variants: default, elevated, outlined |
| 8 | `Tabs` | Yes | Radix, keyboard arrow navigation |
| 9 | `DropdownMenu` | Yes | Radix |
| 10 | `Tooltip` | Yes | Radix, respects reduced motion |
| 11 | `Skeleton` | No | Respects reduced motion |
| 12 | `ConfirmDialog` | Yes | Uses Radix Dialog |
| 13 | `Popover` | Yes | Radix |

### Remaining primitive backlog (13):

| # | Component | Priority | Target Phase |
|---|-----------|----------|-------------|
| 14 | `Textarea` | High | UI-2 |
| 15 | `Checkbox` | High | UI-2 |
| 16 | `Switch` | High | UI-2 |
| 17 | `RadioGroup` | High | UI-2 |
| 18 | `Banner` | Medium | UI-3 |
| 19 | `Toast` | Medium | UI-3 |
| 20 | `Drawer` | Medium | UI-3 |
| 21 | `DataTable` | Medium | UI-4 |
| 22 | `Pagination` | Medium | UI-4 |
| 23 | `Money` | Medium | UI-4 |
| 24 | `QuantityInput` | Medium | UI-4 |

---

## Step 7: Fix StaffShell `<main>` Landmark

StaffShell renders `<main>` only during the loading state (line 93). The actual shell content (aside + header + children) does NOT have a `<main>` wrapper. Fix:

```tsx
// In StaffShell return, wrap the content area:
<div className="min-w-0">
  <header>...</header>
  <main className="p-4 lg:p-6">{children}</main>
</div>
```

---

## Step 8: Replace Nav Icons with Lucide

Replace two-letter pseudo-icons in `staff-shell.tsx` with Lucide icons. Import directly (tree-shakeable). Replace `☰`/`✕` hamburger glyphs with Lucide `Menu`/`X`.

---

## Step 9: Create `/design-system` Route

Must return `notFound()` in production (correction #5):

```tsx
// apps/web/src/app/design-system/page.tsx
import { notFound } from 'next/navigation';

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  // ... showcase content
}
```

---

## Step 10: Add Tests

### 10a. Vitest primitive tests

- `button.test.tsx` — renders, click, disabled, loading, focus ring
- `dialog.test.tsx` — Radix handles focus; test open/close/escape
- `text-field.test.tsx` — label association, error, required
- `status-chip.test.tsx` — correct color per status

### 10b. Axe-core accessibility checks

Add `@axe-core/playwright` to critical E2E journeys:

```ts
import AxeBuilder from '@axe-core/playwright';

test('kitchen display has no accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

Test on: login, kitchen display, POS, payment review.

### 10c. Run existing E2E suites

```bash
pnpm --filter @rms/web test:e2e
```

Report: baseline failures (8 pre-existing) vs regressions (must be 0).

---

## Step 11: Measure Bundle Impact

After all changes:

```bash
pnpm --filter @rms/web build
# Compare .next/static size vs baseline from Step 2
```

---

## Step 12: Update Progress Document

Update `UI_REDESIGN_PROGRESS.md` with:
- Files changed (every new and modified file)
- Dependency decisions with justification
- Literal-color count before vs after
- Tests added
- Bundle size comparison
- Remaining risks

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/cn.ts` | `cn()` utility |
| `src/lib/config.ts` | `API_BASE_URL`, `WS_URL` |
| `src/lib/money.ts` | `formatEtbMinor` (domain-specific) |
| `src/lib/kds-types.ts` | Consolidated KDS types |
| `src/components/feedback/loading-state.tsx` | Loading state |
| `src/components/feedback/empty-state.tsx` | Empty state |
| `src/components/feedback/error-state.tsx` | Error state |
| `src/components/feedback/permission-state.tsx` | Permission state |
| `src/components/feedback/offline-state.tsx` | Offline state |
| `src/components/feedback/index.ts` | Barrel export |
| `src/components/ui/button.tsx` | Button primitive |
| `src/components/ui/icon-button.tsx` | Icon button |
| `src/components/ui/dialog.tsx` | Dialog (Radix) |
| `src/components/ui/text-field.tsx` | Text field |
| `src/components/ui/select.tsx` | Select (Radix) |
| `src/components/ui/status-chip.tsx` | Status chip |
| `src/components/ui/card.tsx` | Card |
| `src/components/ui/tabs.tsx` | Tabs (Radix) |
| `src/components/ui/dropdown-menu.tsx` | Dropdown menu (Radix) |
| `src/components/ui/tooltip.tsx` | Tooltip (Radix) |
| `src/components/ui/skeleton.tsx` | Skeleton |
| `src/components/ui/confirm-dialog.tsx` | Confirm dialog |
| `src/components/ui/popover.tsx` | Popover (Radix) |
| `src/components/ui/index.ts` | Barrel export |
| `src/app/design-system/page.tsx` | Design system showcase |
| `vitest.config.ts` | Vitest configuration |
| `src/test/setup.ts` | Test setup |
| `src/components/ui/button.test.tsx` | Button tests |
| `src/components/ui/dialog.test.tsx` | Dialog tests |
| `src/components/ui/text-field.test.tsx` | Text field tests |
| `src/components/ui/status-chip.test.tsx` | Status chip tests |
| `src/e2e/accessibility.spec.ts` | Axe-core accessibility tests |

## Files to Modify

| File | Changes |
|------|---------|
| `src/app/globals.css` | Expand CSS variables, fix hardcoded colors, add `@layer` |
| `tailwind.config.ts` | Add semantic tokens, shadow, motion |
| `package.json` | Add dependencies |
| `src/components/staff-shell.tsx` | Replace pseudo-icons with Lucide, add `<main>` wrapper |
| `src/components/brand-mark.tsx` | Make dynamic |
| `src/lib/use-kds-socket.ts` | Import from kds-types.ts, config.ts |
| `src/lib/use-kds-tickets.ts` | Import from kds-types.ts |
| `src/lib/api-client.ts` | Import from config.ts, money.ts |
| `src/lib/mock-api.ts` | Remove duplicate formatEtb |
| `src/components/owner-payment-review.tsx` | Replace local State with shared feedback |
| `src/components/cash-shift-workspace.tsx` | Replace local State with shared feedback |
| `src/components/customer-menu.tsx` | Replace local StateScreen with shared feedback |
| `src/components/public-order-menu.tsx` | Replace local PublicState with shared feedback |
| `src/components/waiter-workspace.tsx` | Replace local WaiterState with shared feedback |
| `src/components/order-tracking.tsx` | Replace local State with shared feedback |

---

## Exit Criteria

1. ✅ All CSS variables defined and accessible via Tailwind tokens
2. ✅ Existing visual identity preserved (no visual regression)
3. ✅ Tenant branding possible through CSS custom properties
4. ✅ 13 primitives built with consistent API (leadingIcon/trailingIcon, typed props, refs, focus, disabled/loading/error)
5. ✅ Radix used for Dialog, DropdownMenu, Select, Tabs, Tooltip, Popover — wrapped behind local APIs
6. ✅ Lucide icons replace pseudo-icons in navigation
7. ✅ StaffShell `<main>` wrapper around children
8. ✅ KDS types consolidated
9. ✅ `API_BASE_URL` consolidated
10. ✅ `formatEtbMinor` in `lib/money.ts` (domain-specific)
11. ✅ 5 feedback components in `components/feedback/` (not duplicated in `ui/`)
12. ✅ `/design-system` returns `notFound()` in production
13. ✅ Primitive tests pass (vitest)
14. ✅ Axe-core accessibility checks on critical journeys
15. ✅ Bundle impact measured
16. ✅ `pnpm --filter @rms/web typecheck` passes
17. ✅ `pnpm --filter @rms/web lint` passes
18. ✅ `pnpm --filter @rms/web build` passes
19. ✅ `pnpm --filter @rms/web test:e2e` — 0 new regressions (8 pre-existing remain)
20. ✅ `UI_REDESIGN_PROGRESS.md` updated

---

*Corrections applied per user amendments. Ready for execution.*
