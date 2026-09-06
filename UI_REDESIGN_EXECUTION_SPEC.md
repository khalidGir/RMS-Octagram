# RestaurantMS UI Redesign Execution Specification

**Status:** Approved execution brief  
**Audience:** OpenCode and implementation agents  
**Scope:** `apps/web` only, except narrowly required API-contract fixes  
**Product:** Multi-tenant restaurant management and POS platform  
**Primary market:** Ethiopia  
**Currency:** ETB  
**Target devices:** Desktop, iPad/tablet, touch POS, and mobile PWA

---

## 1. Mission

Redesign RestaurantMS so it feels as coherent, restrained, fast, and carefully engineered as a flagship Google product designed by an elite product-design and frontend-engineering team.

This is a quality target, not permission to copy Google branding, layouts, icons, illustrations, or proprietary components. The result must remain recognizably RestaurantMS and appropriate for Ethiopian hospitality businesses.

The experience must communicate:

- calm operational control;
- obvious hierarchy and next actions;
- high information density without visual noise;
- excellent touch ergonomics;
- dependable financial and workflow states;
- configurable restaurant identity within a stable product shell.

The redesign is not complete if it is only attractive. Every visible action must work, every page must have real states, and existing backend-integrated workflows must remain functional.

---

## 2. Authority and Precedence

Before implementation, read these files in order:

1. `AGENTS.md`
2. `product-requirements-document.md`
3. `DECISIONS.md`
4. `ARCHITECTURE.md`
5. `RBAC.md`
6. `WORKFLOWS.md`
7. `UX_ACCEPTANCE_CHECKLIST.md`
8. this document

When requirements conflict, follow the precedence defined in `AGENTS.md`. This document controls visual language, frontend architecture, interaction behavior, and the UI delivery sequence. It does not override security, tenancy, money, payment, inventory, or state-machine invariants.

---

## 3. Non-Negotiable Product Principles

### 3.1 Clarity before decoration

Every screen must answer within three seconds:

1. Where am I?
2. Which restaurant and branch am I operating?
3. What needs my attention?
4. What is the primary action?
5. What happened after I acted?

### 3.2 One source of truth

- Do not show static placeholder records on backend-connected pages.
- Do not keep a second frontend-only version of server state.
- React Query owns remote server state.
- Local state owns only drafts, open/closed UI, selection, and optimistic presentation.
- After mutations, update or invalidate the relevant queries deliberately.

### 3.3 Progressive disclosure

Keep routine tasks obvious and fast. Move advanced fields, audit detail, configuration, and destructive actions behind secondary sections, drawers, or explicit menus.

### 3.4 Touch first, keyboard complete

- Primary touch targets: minimum 44 by 44 CSS pixels.
- High-frequency POS and KDS controls: target 48–56 pixels.
- All workflows must remain keyboard operable.
- Focus must be visible and correctly restored after dialogs.

### 3.5 Trustworthy operations

- Never imply success before the server confirms it.
- Show actionable error messages and correlation IDs where useful.
- Disable duplicate submission while a mutation is pending.
- Preserve entered form data after recoverable errors.
- Make offline, stale, reconnecting, permission-denied, and conflict states explicit.

---

## 4. Visual Direction

### 4.1 Design character

Use a warm, modern, editorial interpretation of a highly disciplined productivity product:

- neutral surfaces with a subtle Ethiopian hospitality warmth;
- generous whitespace around decisions, compact spacing inside data groups;
- strong typographic hierarchy;
- restrained elevation;
- rounded geometry used consistently, not everywhere;
- color reserved for meaning, identity, focus, and primary actions;
- motion that explains state changes rather than decorates them.

Avoid:

- excessive gradients;
- glassmorphism or translucent content panels;
- generic admin-template visuals;
- oversized headings that reduce operational density;
- emoji as product icons;
- decorative charts without decisions attached;
- inconsistent radii, shadows, or control heights;
- copying Material Design components verbatim.

### 4.2 Base color system

Create semantic tokens instead of scattering literal colors through components.

```css
:root {
  --color-brand-50: #fff7ed;
  --color-brand-100: #ffedd5;
  --color-brand-500: #c75b2a;
  --color-brand-600: #ab4720;
  --color-brand-700: #89391d;

  --color-ink: #17211d;
  --color-ink-muted: #66716c;
  --color-canvas: #f7f7f4;
  --color-surface: #ffffff;
  --color-surface-subtle: #f0f2ef;
  --color-border: #dde2de;
  --color-border-strong: #c7cec9;

  --color-success: #137a52;
  --color-warning: #a75a00;
  --color-danger: #b3261e;
  --color-info: #2864dc;
}
```

The exact palette may be refined for WCAG contrast, but semantic roles must remain stable.

### 4.3 Restaurant customization

Tenant customization may alter:

- logo;
- restaurant name;
- primary brand color;
- accent color;
- customer-menu hero image;
- customer-menu typography pairing from an approved list;
- card radius preset: compact, balanced, or soft.

Tenant customization must not alter:

- success, warning, danger, or information colors;
- financial-state colors;
- accessibility contrast;
- staff application information architecture;
- core control shapes or behavior;
- permission and offline indicators.

Apply branding using validated CSS custom properties at the tenant shell. Always provide safe fallbacks.

### 4.4 Typography

- Use one high-quality variable sans-serif family for staff applications.
- Use tabular numerals for ETB, order numbers, elapsed time, quantities, and reports.
- Use no more than five text styles on one screen.
- Body copy must remain at least 14px on operational tablet screens.
- Avoid all-uppercase text except short overlines and compact status labels.
- Use sentence case for buttons, navigation, headings, labels, and messages.

Suggested scale:

| Token | Size / line height | Use |
|---|---:|---|
| Display | 40 / 48 | Marketing only |
| Page title | 28 / 36 | Staff page title |
| Section title | 20 / 28 | Major content group |
| Card title | 16 / 24 | Cards and dialogs |
| Body | 14 / 21 | Default operational text |
| Supporting | 12 / 18 | Metadata and hints |
| Label | 12 / 16 | Compact labels and statuses |

### 4.5 Spacing and geometry

- Base spacing unit: 4px.
- Common gaps: 8, 12, 16, 24, 32, 48.
- Default control height: 44px.
- Dense table control height: 36px.
- POS/KDS primary action height: 52px.
- Default card radius: 16px.
- Control radius: 10–12px.
- Dialog radius: 20–24px.
- Use one-pixel neutral borders for structure.
- Use shadows only for floating layers, dialogs, menus, and selected drag surfaces.

### 4.6 Elevation

Define four elevation tokens:

1. `surface`: no shadow;
2. `raised`: subtle card shadow;
3. `floating`: menus, popovers, sticky action bars;
4. `modal`: dialogs and blocking workflows.

Dialogs must use an opaque surface. Never apply opacity to a dialog container. The overlay may be darkened, but content must remain fully opaque.

### 4.7 Iconography

- Adopt one open-source outline icon family, preferably Lucide React.
- Default sizes: 16, 20, and 24.
- Icons supplement labels; they do not replace unfamiliar actions.
- Give destructive actions a label, not only a trash icon.
- Remove the current two-letter pseudo-icons from primary navigation.

---

## 5. Foundation Architecture

Create or normalize the following frontend structure:

```text
apps/web/src/
├── app/
│   ├── (marketing)/
│   ├── (auth)/
│   ├── (staff)/
│   └── (customer)/
├── components/
│   ├── ui/                 # Primitive, reusable, presentation-only components
│   ├── shell/              # Navigation, app bar, branch picker, account menu
│   ├── feedback/           # Empty, error, offline, loading, conflict states
│   └── domain/             # Shared domain presentation components
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── orders/
│   ├── pos/
│   ├── payments/
│   ├── kitchen/
│   ├── tables/
│   ├── catalog/
│   ├── inventory/
│   ├── reports/
│   ├── team/
│   ├── settings/
│   └── platform/
├── hooks/
├── lib/
├── styles/
└── types/
```

Do not perform a destructive big-bang move. Migrate one vertical slice at a time and keep routes operational throughout.

### 5.1 Required primitives

Implement a consistent primitive layer before redesigning feature pages:

- `Button`
- `IconButton`
- `TextField`
- `TextArea`
- `Select`
- `Combobox`
- `Checkbox`
- `RadioGroup`
- `Switch`
- `Dialog`
- `Drawer`
- `Popover`
- `DropdownMenu`
- `Tabs`
- `StatusChip`
- `Tooltip`
- `Toast`
- `Banner`
- `Card`
- `DataTable`
- `Pagination`
- `Skeleton`
- `EmptyState`
- `ErrorState`
- `ConfirmDialog`
- `Money`
- `QuantityInput`

Primitive requirements:

- typed props;
- forwarded refs when appropriate;
- visible focus styles;
- disabled, loading, error, and read-only states;
- no domain-specific API calls;
- no duplicated one-off visual variants;
- tested keyboard behavior for overlays and composite controls.

Prefer Radix primitives only if adding the dependency materially improves accessibility and delivery speed. Wrap third-party primitives behind local components so the product is not coupled to their styling API.

### 5.2 Form architecture

- Use React Hook Form and Zod for complex forms.
- Validate on blur and on submission; avoid hostile validation on every keystroke.
- Put field errors directly below the relevant field.
- Put server errors in a form-level alert.
- Focus the first invalid field after submission.
- Preserve values after server errors.
- Convert ETB to integer minor units only at the boundary.

### 5.3 Remote state

Centralize query keys by feature. Every mutation must document its cache behavior.

```ts
catalogKeys.all(tenantId)
catalogKeys.items(tenantId, filters)
catalogKeys.item(tenantId, itemId)
catalogKeys.branchMenu(tenantId, branchId)
```

Do not use `window.location.reload()` for routine state synchronization. Branch changes should update a shared branch context, reset branch-scoped caches, update session storage, and navigate or refetch without a full reload.

---

## 6. Global Application Shell

### 6.1 Desktop and tablet shell

- Collapsible navigation rail: 256px expanded, 72px collapsed.
- Persistent top app bar with branch context, connectivity, urgent alerts, and account menu.
- Main content width responds to operational use; do not constrain POS or KDS to marketing-page widths.
- Navigation order and visibility derive from role and enabled modules.
- Active state uses surface contrast and a small brand indicator, not a large filled pill on every item.
- Show tooltips in collapsed navigation.

### 6.2 Mobile shell

- Use a bottom navigation bar for three to five role-critical destinations.
- Put remaining destinations in a “More” sheet.
- Branch selection remains visible near the page title or app bar.
- Do not place desktop sidebar content in a tiny off-canvas clone without prioritization.

### 6.3 Branch picker

- Fully styled, keyboard-accessible listbox or menu.
- Show branch name, location/subtitle if available, and selected check mark.
- Search when the tenant has more than seven branches.
- Changing branch updates the interface without full-page reload.
- Pending mutations must block or explicitly confirm branch switching.
- Empty branches must produce a clear administrative empty state.

### 6.4 Global feedback

Provide consistent global states for:

- online;
- reconnecting;
- offline/read-only;
- synchronization delayed;
- session expiring;
- session expired;
- permission changed;
- tenant suspended;
- feature disabled.

---

## 7. Page-by-Page Requirements

### 7.1 Marketing landing page

- Keep the page fast, credible, and specific to restaurant operations.
- Present product value through workflows, not vague SaaS claims.
- Include staff POS, KDS, QR ordering, inventory, reporting, and multi-branch sections.
- Use real interface compositions rather than unrelated stock photography.
- Include pricing/contact CTA only when product policy is known.
- Retain Terms, Privacy, Cookies, copyright, and company-contact placeholders marked for legal review.
- Lighthouse targets: Performance 90+, Accessibility 95+, Best Practices 95+, SEO 95+.

### 7.2 Authentication

- Clean two-panel desktop layout and single-panel mobile layout.
- Password visibility control, caps-lock warning, loading state, and actionable error message.
- Do not expose demo credentials in production builds.
- Restore intended destination after authentication.
- Treat refresh failure on an unauthenticated page as normal, not as a disruptive error.

### 7.3 Owner and manager overview

- Top summary: revenue, active orders, payment reviews, stock alerts, and average preparation time.
- Every metric states its time window and branch scope.
- Use sparklines only where comparison data exists.
- “Attention needed” must precede low-value analytics.
- Live orders must link to order detail.
- Empty datasets must look intentional, not broken.

### 7.4 Point of sale

- Optimize for landscape tablet and touch.
- Fixed category/navigation area, searchable item grid, persistent order panel.
- Large item cards with name, price, availability, and short modifier signal.
- Fast quantity changes, notes, variants, modifiers, and removal.
- Keep totals and primary submit action visible.
- Show active shift status prominently.
- Prevent cash confirmation without an open shift and explain the resolution.
- Support keyboard shortcuts only as enhancements.
- Never hide stale-price or server-total conflicts.

### 7.5 Orders

- Real API-backed list with search, filters, status, channel, time, customer/table, and total.
- Responsive table on desktop and structured cards on mobile.
- Order detail drawer or page with immutable line snapshots and event history.
- Edit, cancel, confirm, complete, split, and merge actions appear only when valid and authorized.
- Destructive actions require confirmation and reason where required.

### 7.6 Payment review

- Queue-first layout: pending proofs on the left, evidence and order context on the right.
- Show amount expected, amount submitted, provider/instructions, timestamp, submitter, and proof.
- Proof image must be private, zoomable, and time-limited.
- Approve and reject are visually distinct and require explicit confirmation.
- Rejection requires a reason.
- Concurrency conflicts must refresh authoritative state.

### 7.7 Kitchen display

- Full-screen, glanceable, touch-friendly ticket board.
- Columns or tabs for queued, in progress, and ready.
- Ticket urgency uses elapsed time and restrained semantic color.
- Show order number, source, items, modifiers, notes, and station.
- Bump, complete, and recall controls must be immediate but reversible where workflow allows.
- WebSocket reconnect triggers authoritative refetch.
- Include sound and high-contrast preferences without forcing them globally.

### 7.8 Tables and QR

- Visual floor/area groups plus a searchable table list.
- Clearly show available, occupied, bill pending, and inactive states.
- QR preview, download, print, rotate, and history actions.
- Rotating a token requires confirmation and explains that old QR codes stop working.
- Session detail supports merge/split only according to backend workflow rules.

### 7.9 Menu management

- API-backed categories and items; no hard-coded records.
- Search, category filter, active state, branch availability, and price visibility.
- Add/edit experience supports item identity, category, variants, modifiers, image, and branch availability.
- Use a dedicated page or large drawer once the form includes variants and modifiers; do not overload a small modal.
- Opaque dialogs with strong surface separation.
- Availability is branch-scoped; item active state is tenant-scoped. Do not conflate them.
- Newly created records appear after confirmed success without a full reload.

### 7.10 Inventory and batches

- Emphasize current usable quantity, threshold, unit, batch age, and risk.
- Receive batch, adjust, and waste workflows must show unit conversion clearly.
- Require reasons for adjustments and waste.
- Show append-only movement history.
- Never allow silent balance edits.
- Low-stock and expiring-batch alerts must link directly to the affected item.

### 7.11 Cash shifts

- Opening cash form states selected branch and signed-in operator.
- Current shift shows opening cash, approved cash, expected drawer, elapsed time, and payment count.
- Closing flow compares counted and expected cash before confirmation.
- Non-zero variance requires a reason.
- Closed report is printable and downloadable.
- Prevent ambiguous branchless actions.

### 7.12 Reports

- Date range and branch scope remain visible.
- Use charts only for time, composition, ranking, or correlation.
- Provide accessible tabular equivalents.
- Show revenue, payment methods, order volume, best sellers, peak hours, and inventory consumption.
- ETB formatting and local business-day boundaries must be consistent.
- Export states must show preparation, completion, and failure.

### 7.13 Team and branches

- Separate People and Branches tabs.
- Staff list shows role, status, branch scope, and last activity where available.
- Invitations clearly show pending and expired states.
- Role changes explain permission impact.
- Managers cannot visually access owner/manager mutation controls they cannot execute.
- Branch creation and assignment honor feature entitlements.

### 7.14 Settings and branding

- Organize into Restaurant, Appearance, Modules, Payments, Ordering, Notifications, and Account.
- Provide live branding preview for staff shell and customer menu.
- Validate contrast before saving tenant colors.
- Payment instructions support owner phone/account details and optional provider configuration.
- Mark unsaved changes and protect accidental navigation.

### 7.15 Super admin

- Visually distinct platform context to prevent confusion with a tenant workspace.
- Tenant list, status, plan/entitlements, enabled modules, branches, and support access.
- Dangerous platform actions require strong confirmation.
- Support-session entry must show target tenant, reason, start time, and persistent banner.
- Never reuse tenant-level navigation while silently operating as platform admin.

### 7.16 Customer ordering

- Restaurant-customizable storefront inside a stable accessible ordering system.
- Menu browsing, search, categories, item customization, cart, checkout, payment instructions, proof submission, and tracking.
- Make pickup time, phone number, order total, and payment state explicit.
- Optimize for unreliable networks and low-cost Android devices.
- Preserve cart drafts locally, but always revalidate prices and availability before submission.

---

## 8. Responsive Breakpoints

Design and test these canonical viewports:

| Name | Viewport | Primary concern |
|---|---:|---|
| Small phone | 360 × 800 | Customer ordering and staff essentials |
| Large phone | 430 × 932 | Mobile PWA |
| Small tablet portrait | 768 × 1024 | Manager workflows |
| POS tablet landscape | 1024 × 768 | POS and KDS |
| Laptop | 1366 × 768 | Common staff workstation |
| Desktop | 1440 × 900 | Owner and admin productivity |
| Wide display | 1920 × 1080 | KDS and dense operations |

Do not treat responsive work as shrinking desktop. Recompose information according to task priority.

---

## 9. Accessibility Requirements

Target WCAG 2.2 AA.

- Contrast: 4.5:1 for normal text and 3:1 for large text and meaningful UI graphics.
- Visible focus on every interactive control.
- Logical headings and landmarks.
- Inputs always have programmatic labels.
- Errors are associated with fields and announced.
- Dialogs trap focus, close with Escape when safe, and restore focus.
- Menus/listboxes implement correct keyboard behavior.
- Status is never communicated by color alone.
- Respect reduced motion.
- Charts have text/table equivalents.
- KDS urgency remains legible for common color-vision deficiencies.

Add automated accessibility checks to critical Playwright journeys, but do not treat automation as a substitute for keyboard and screen-reader review.

---

## 10. Motion and Interaction

- Standard transition: 140–180ms.
- Large surface transition: up to 240ms.
- Use ease-out for entrances and ease-in for exits.
- Avoid spring/bounce motion in financial and kitchen workflows.
- Animate list changes only when the animation clarifies what moved or changed.
- Use skeletons for initial structured loads, inline progress for mutations, and spinners only for indeterminate compact actions.
- Never delay a workflow to showcase animation.

---

## 11. Content and Microcopy

- Use direct, concrete language.
- Button labels describe the result: “Open cash shift,” not “Submit.”
- Error messages describe what failed and what the user can do.
- Avoid blaming the user.
- Confirmations name the record and consequence.
- Use “ETB 1,250” consistently.
- Use Africa/Addis_Ababa branch-local time for display.
- Prepare components for Amharic text expansion and future localization.
- Avoid embedding role, tenant, branch, or currency names in component code.

---

## 12. Implementation Sequence

OpenCode must execute the redesign in the following phases. Do not redesign all pages simultaneously.

### Phase UI-0 — Audit and baseline

1. Inventory every route and shared component.
2. Identify static placeholders, dead controls, duplicate components, literal colors, full reloads, and accessibility failures.
3. Capture screenshots at all canonical viewports.
4. Record existing functional tests and backend-connected journeys.
5. Create `UI_REDESIGN_PROGRESS.md` with route status and known defects.

**Exit gate:** every route classified as real, partial, placeholder, or broken.

### Phase UI-1 — Tokens and primitives

1. Introduce semantic color, spacing, typography, radius, elevation, and motion tokens.
2. Build the required primitive layer.
3. Add Storybook only if it does not materially disrupt the existing toolchain; otherwise create an internal `/design-system` development route excluded from production navigation.
4. Test keyboard and focus behavior.

**Exit gate:** new feature UI can be built without one-off buttons, inputs, dialogs, dropdowns, cards, or status styles.

### Phase UI-2 — Shell, navigation, and branch context

1. Rebuild desktop, tablet, and mobile shells.
2. Implement role- and feature-aware navigation.
3. Replace full-page branch reloads with shared context and cache invalidation.
4. Add connectivity and session feedback.

**Exit gate:** every role reaches every authorized destination; branch changes update all branch-scoped screens correctly.

### Phase UI-3 — Revenue-critical operations

Implement and verify in this order:

1. authentication;
2. cash shifts;
3. POS;
4. orders;
5. payment review;
6. KDS.

**Exit gate:** a seeded cashier can open a shift, create an order, confirm eligible payment, release it to KDS, advance it, and close the shift.

### Phase UI-4 — Catalog and restaurant setup

Implement:

1. menu/categories/items/variants/modifiers;
2. branch availability;
3. tables and QR;
4. team and branches;
5. settings and restaurant branding.

**Exit gate:** a new tenant can configure enough real data to accept a test order without direct database manipulation.

### Phase UI-5 — Inventory and reporting

Implement:

1. inventory overview;
2. batch receiving;
3. adjustment/waste;
4. recipes and deduction visibility;
5. reports and exports;
6. owner dashboard synthesis.

**Exit gate:** inventory and reports display authoritative API data and all money/quantity states pass integration tests.

### Phase UI-6 — Customer and platform experiences

Implement:

1. public restaurant menu;
2. cart and checkout;
3. payment proof;
4. order tracking;
5. super-admin tenant and feature controls;
6. support-session presentation.

**Exit gate:** complete customer and platform-admin Playwright journeys pass.

### Phase UI-7 — Polish and release hardening

1. Responsive review at every canonical viewport.
2. Keyboard-only review.
3. Screen-reader smoke review.
4. Contrast and reduced-motion review.
5. Performance profiling and bundle review.
6. Empty/error/offline/loading/permission/conflict state review.
7. Cross-browser check: Chromium, WebKit, and Firefox for critical journeys.

**Exit gate:** all acceptance criteria in this document and `UX_ACCEPTANCE_CHECKLIST.md` pass.

---

## 13. Engineering Rules for OpenCode

For every phase:

1. State the exact routes and components being changed.
2. Inspect the current API contract before writing UI.
3. Preserve working backend integration.
4. Replace placeholders only with real data or an honest empty state.
5. Use `apply_patch` for edits and preserve unrelated work.
6. Add tests with the behavior.
7. Run targeted checks first, then the full web quality gate.
8. Capture before/after screenshots at relevant viewports.
9. Update `UI_REDESIGN_PROGRESS.md`.
10. Report remaining functional or visual debt explicitly.

Do not:

- rewrite backend contracts for visual convenience;
- invent financial or legal behavior;
- hide unavailable features behind fake success;
- introduce a second design system;
- add a dependency for a component that can be implemented safely with existing tools;
- leave clickable controls without handlers;
- use hard-coded demonstration records on operational pages;
- claim completion based only on TypeScript compilation.

---

## 14. Required Test Matrix

Each redesigned feature must cover:

### Functional

- successful load;
- empty data;
- loading;
- API error;
- offline/reconnecting;
- successful mutation;
- validation failure;
- authorization failure;
- duplicate submission protection;
- server conflict/stale version where applicable.

### Responsive

- 360 × 800;
- 768 × 1024;
- 1024 × 768;
- 1366 × 768;
- 1440 × 900.

### Interaction

- pointer/touch;
- keyboard navigation;
- visible focus;
- dialog focus trap and restoration;
- menu/listbox keyboard operation;
- destructive confirmation;
- browser back/forward behavior.

### Roles

- owner;
- manager;
- cashier;
- kitchen staff;
- waiter;
- customer;
- super admin.

---

## 15. Quality Gates

Run at minimum:

```bash
pnpm --filter @rms/web typecheck
pnpm --filter @rms/web lint
pnpm --filter @rms/web build
pnpm --filter @rms/web test:e2e
```

Also run affected API tests whenever UI work reveals or requires an API correction.

No phase is complete when:

- a primary action does nothing;
- a route contains static operational records;
- an overlay is visually transparent or lacks focus management;
- a form loses data after a recoverable error;
- branch or tenant context is ambiguous;
- mobile layout horizontally clips;
- keyboard navigation is broken;
- permissions are represented only by frontend hiding;
- critical Playwright journeys fail;
- console errors occur during the tested happy path.

---

## 16. Definition of Done

The redesign is complete only when:

1. every product role has a coherent, role-appropriate application shell;
2. every documented route has a real implementation or an explicitly approved out-of-scope state;
3. every visible primary action is functional;
4. operational pages use live API data;
5. branch, tenant, role, connectivity, and workflow state are always understandable;
6. the UI behaves correctly across the canonical device matrix;
7. critical workflows are keyboard accessible and pass automated accessibility checks;
8. customer-facing branding is configurable without compromising staff usability;
9. no security, tenancy, money, payment, inventory, or audit invariant is weakened;
10. builds, lint, type checks, and critical end-to-end tests pass;
11. before/after screenshots and the completed progress checklist are included in the handoff;
12. the product feels designed as one system rather than assembled page by page.

---

## 17. First OpenCode Instruction

Use the following as the first execution request after this document is committed:

> Read `AGENTS.md` and `UI_REDESIGN_EXECUTION_SPEC.md` completely. Execute only Phase UI-0. Audit every web route and shared component, create `UI_REDESIGN_PROGRESS.md`, capture the required baseline screenshots, and report the prioritized defects. Do not redesign components during the audit phase. Preserve all current user changes and do not modify backend behavior.

