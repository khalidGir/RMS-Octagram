# UI QA Defects

Log of defects found during UI/UX review of the staging build.

---

## QA-001 — Branch view dropdown uses native select (inconsistent styling)

- **Status:** Open
- **Reported:** 2026-10-01 — UI QA review
- **Severity:** Medium (brand consistency + accessibility)
- **Area:** Web app — branch view selectors (Super Admin support views first, then every staff page)

### Description

The "Branch view" dropdown renders as a browser-native `<select>`, so it ignores the RestaurantMS design system. It must be replaced with the shared `Select` component everywhere a branch view is chosen, including Super Admin support/branch views.

### Expected behavior

Use the shared `Select` (`apps/web/src/components/ui/select.tsx`) with:

- RestaurantMS border radius, typography, and colors
- Branch icon and current branch name in the trigger
- Clear hover, focus, open, and selected states
- Styled dropdown panel and checkmark
- Minimum 44px touch target
- Responsive width on tablet and mobile
- Keyboard navigation and an accessible label (`aria-label`)

### Evidence

- `apps/web/src/components/feature-control-panel.tsx:145` — native `<select>` labeled "Branch view"
- Same file `:33` — default state hardcodes `'Bole Main'`; options are hardcoded `Bole Main / Downtown / Airport`, which do not match the real branches (`Main Branch`, `Downtown Branch`)
- Shared, design-system `Select` already exists and is used in `kitchen-config` editors — this defect is about consistency, not a missing component
- Staff pages currently show the branch as plain text (e.g. `dashboard.tsx:118-121`); any branch selector added there must use the same component

### Acceptance criteria

- [ ] Branch view uses the shared `Select`, not a native `<select>`
- [ ] RestaurantMS border radius, typography, and colors applied
- [ ] Trigger shows a branch icon and the current branch name
- [ ] Hover, focus, open, and selected states clearly styled
- [ ] Dropdown panel and checkmark styled per design system
- [ ] Minimum 44px touch target
- [ ] Responsive width on tablet/mobile
- [ ] Keyboard navigation works; accessible label present
- [ ] Replaced consistently on every staff page, including Super Admin support/branch views
- [ ] Branch options come from real branch data (no hardcoded names)


---

## QA-002 - Mobile "More" sheet shows the wrong items (Orders unreachable for Owner)

- **Status:** Fixed (this release)
- **Reported:** 2026-10-01 - owner dashboard nav review
- **Severity:** High (an Owner on mobile could not reach Orders at all)
- **Area:** Web app - mobile bottom bar and "More" sheet

### Description

`MoreSheet` sliced the navigation array at raw index 4 while `MobileNav` sorts by `mobileOrder` before taking the first four. The two lists were not complements: for the Owner role, **Orders appeared in neither place** (raw index 2, mobile rank 5) and **Expo was listed twice** (bottom bar and More sheet).

### Expected behavior

The More sheet must show exactly the items that are not in the bottom bar.

### Evidence

- `apps/web/src/components/shell/more-sheet.tsx` used `fullVisible.slice(4)`
- `apps/web/src/components/shell/mobile-nav.tsx` sorted by `mobileOrder` then sliced

### Acceptance criteria

- [x] Shared `primaryMobileNav` / `moreMobileNav` helpers in `nav-config.ts` guarantee exact complements
- [x] Owner More sheet contains Orders
- [x] Kitchen display and Expo are not duplicated in the More sheet
- [x] Regression test in `more-sheet.test.tsx`

---

## QA-003 - Business day close has no screen (Owner cannot close the day)

- **Status:** Fixed (this release)
- **Reported:** 2026-10-01 - owner dashboard nav review
- **Severity:** High (PRD section 7 Owner duty unusable in the UI)
- **Area:** Web app - missing `/day-close` screen

### Description

The API exposes preview/close/reopen/report/current for business-day reconciliation (16 e2e tests), but no frontend page or nav item existed, so an Owner could not close a business day from the product.

### Acceptance criteria

- [x] `/day-close` screen with preview status, blockers, payment/order totals and shift table
- [x] Owner-only close (normal and close-with-exception with mandatory reason) and reopen with mandatory reason
- [x] Manager sees read-only review (matches API roles)
- [x] Closed-day snapshot with print/download
- [x] Nav item "Day close" in the Money group

---

## QA-004 - Past shift reports unreachable from the UI

- **Status:** Fixed (this release)
- **Reported:** 2026-10-01 - owner dashboard nav review
- **Severity:** Medium (closed shift reports could not be reviewed after closing)
- **Area:** Web app - "My cash shift"

### Description

`GET /branches/:branchId/shifts/reports` (Owner/Manager) exists, but the frontend only fetched the current shift, so past shift reports and variances disappeared from reach after closure.

### Acceptance criteria

- [x] "Past shifts" section lists closed shifts (date, opening, expected, counted, variance, reason)
- [x] Owner and Manager only
- [x] Empty and error states covered by tests

---

## QA-005 — Owner dashboard crashed on load (fractional avg order value)

- **Status:** Fixed (this release)
- **Reported:** 2026-10-02 - live staging verification of the day-close release
- **Severity:** High (whole dashboard fell back to the Next.js error screen)
- **Area:** API analytics + web money formatting

### Description

`GET /reports/orders` returned `avgOrderMinor: "48333.333333333336"` because the
query used raw `AVG(o."totalMinor")`, violating the integer-minor-units money
invariant. `formatEtbMinor` then called `BigInt(48333.33…)` and threw, taking
down the entire owner dashboard (and the Reports page, which uses the same
value). `GET /reports/revenue-by-method` had the same fractional `avgMinor`
pattern. This was data-dependent, so it only surfaced once seeded totals were
no longer evenly divisible.

### Acceptance criteria

- [x] `avgOrderMinor` and revenue-by-method `avgMinor` are rounded to integer minor units in SQL
- [x] e2e regression guards: fractional seeded averages must serialize as `/^\d+$/`
- [x] `formatEtbMinor` rounds fractional input instead of crashing the page
- [x] Unit tests cover fractional number and fractional string inputs
- [x] Dashboard and Reports render normally on staging again

---

## QA-006 — No way to reveal a typed password

- **Status:** Fixed (this release)
- **Reported:** 2026-10-02 - staging login review
- **Severity:** Medium (typing errors on touch devices go unnoticed until submit fails)
- **Area:** Web app - shared `TextField` (login, create-tenant password fields)

### Description

Password fields rendered as a plain masked input with no visibility toggle, so
users could not check what they typed before submitting. The fix lives in the
shared `TextField`: any field with `type="password"` now shows an eye toggle
inside the input (login, Owner password and Confirm password get it
automatically, as will any future password field).

### Acceptance criteria

- [x] Eye toggle inside the password input (44px touch target)
- [x] Toggles between masked and plain text, button label flips Show/Hide password
- [x] No toggle for non-password fields, disabled or read-only fields
- [x] Does not submit the form (`type="button"`)
- [x] Unit tests cover presence, toggle and absence cases
