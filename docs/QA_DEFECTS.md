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
