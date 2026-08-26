# Product v0.2 Pilot Decisions

**Status:** Accepted baseline  
**Effective date:** 2026-08-26  
**Authority:** Product owner direction, informed by the cofounder product brief, PRD, research plan, and UX specification v0.2

## Purpose

This record locks the operational and UX rules for the Addis Ababa pilot before the canonical PRD, RBAC, workflows, API specification, and implementation plan are reconciled. When older product documentation conflicts with this record, this record takes precedence unless a later accepted decision explicitly replaces it.

## Accepted pilot decisions

### Ordering contexts

- A valid table QR opens a server-verified physical table context.
- A table-QR customer may choose dine-in or takeaway and may use cash, bank transfer, or Telebirr when enabled for the restaurant.
- A public restaurant link is pickup pre-order only. It never offers table selection, dine-in, delivery, or reservations.
- Public-link pickup requires bank transfer or Telebirr proof. Cash is unavailable because preparation must not begin before payment is verified.
- Customers order without an account or password.

### Payments and kitchen release

- Cash is confirmed by an authorized cashier operating an active shift, or by the owner when operating an owner shift.
- Bank-transfer and Telebirr proofs are verified or rejected by the owner only for the pilot.
- Managers, cashiers, super admins, and support staff cannot verify transfer proofs.
- A screenshot is evidence for manual review and never confirms payment by itself.
- Only a successfully confirmed payment releases an order to the kitchen.
- Confirmation remains idempotent and transactional with order state, inventory, audit, and outbox records.

### Roles and staff workflow

- The pilot roles are Super Admin, Owner, Manager, Cashier, Kitchen Staff, Waiter, and Customer.
- Manager remains a supported role, but cannot verify transfer proofs or exercise owner-only financial close authority.
- Kitchen Staff may move confirmed orders to Preparing and Ready.
- Waiter may view tables and ready orders, complete/serve ready orders, and clear eligible table sessions.
- Cashier may complete a ready order but cannot clear a dine-in table.
- Controls unavailable to a role must be hidden in the UI and rejected by the server.

### Table sessions

- The first confirmed dine-in order opens or joins the active session for its physical table.
- Completing an order does not make a table available.
- A waiter or owner explicitly uses `Clear table` after guests leave.
- Clearing is allowed only after every order linked to the session is completed or cancelled.
- Occupancy is staff-managed operational state, not sensor-derived presence.

### Pricing and tax

- Currency is Ethiopian birr (ETB), stored in integer minor units.
- Menu prices are treated as net/pre-VAT for the pilot product model.
- VAT applicability and rate are tenant-configurable and must be confirmed during onboarding; no rate is hard-coded.
- Checkout and immutable order snapshots contain Subtotal, VAT, and Total payable.
- Service charge is fixed at zero and is not configured, calculated, or displayed.
- Production activation of VAT behavior remains subject to accountant/tax-adviser confirmation.

### Shifts and business-day close

- A cashier must have one active shift to confirm cash.
- A shift records optional opening cash, expected cash, counted cash, variance, and a mandatory reason for non-zero variance.
- Closing a shift creates an immutable report.
- The owner closes the configured local business day after reviewing shifts, verified payments, pending items, exceptions, and inventory issues.
- Normal close is blocked by open shifts or pending payment orders.
- Close-with-exception and reopening require reasons and audit records.

### Inventory

- Recipe-based deduction remains synchronous and transactional with confirmation.
- The default and pilot policy prohibits inventory from falling below zero.
- Negative-stock override is deferred until pilot evidence proves it is operationally necessary.
- Historical recipe and movement records remain immutable and auditable.

### Public identity and real-time behavior

- `/o/{token}` is the table-QR entry and `/r/{public-slug}` is the public pickup entry.
- Internal tenant and branch identifiers are not exposed as customer navigation concepts.
- Staff channels are authenticated and tenant/branch scoped.
- Customer tracking uses an opaque order token with scoped updates or polling.
- Disconnected clients show persistent stale/reconnecting state, refetch authoritative state after reconnect, and never silently queue staff mutations offline.

### Super-admin support

- Super-admin entitlements remain platform controls.
- Tenant menu assistance requires explicit menu-support mode, selected tenant, and a reason.
- Support mode is menu-only and shows a persistent target-tenant banner.
- Super admins cannot access or act on tenant payments, proofs, customers, inventory, orders, or staff through support mode.
- Every support edit records actor, tenant, reason, timestamp, and before/after values.

### Privacy and loyalty

- Loyalty points, rewards, marketing, CRM, and customer accounts are outside the pilot MVP.
- Optional phone-based loyalty identification is deferred until the privacy notice, retention policy, withdrawal process, and Ethiopia compliance review are approved.
- The frontend may reserve a future integration boundary but must not collect or persist loyalty phone data during the pilot.
- Payment proofs remain private, scanned, access-audited, and subject to an approved retention policy before production data is collected.

### Explicit exclusions

- No payment gateway, bank/Telebirr API, OCR, or automatic payment verification.
- No delivery, reservation, discount/coupon system, fiscal printing, accounting integration, procurement, or offline mutation queue.
- No new advanced features are added before the pilot validates the accepted operational workflow.

## Pilot interface languages

- The pilot supports **English, Amharic, and Arabic** in one application.
- English is the fallback locale when a translation key is unavailable.
- English and Amharic use left-to-right layouts; Arabic uses right-to-left layouts.
- All interface copy, validation messages, statuses, accessibility labels, and printable reports use localization keys rather than embedded strings.
- Language selection is available on customer entry screens and authenticated user preferences, and persists without requiring an account for public customers.
- Restaurant-provided content such as menu names and descriptions may define per-language values with a documented fallback order.
- Dates, numerals, currency, and pluralization use locale-aware formatting while monetary values remain ETB and server calculations remain locale-independent.
- Production translations require native-speaker review. Automated or placeholder translations do not satisfy release approval.
- UX verification covers long Amharic content, Arabic RTL mirroring, mixed-direction account numbers and phone numbers, touch targets, truncation, and screen-reader labels.

## Decision consequences

- Production hardening pauses after its safe current checkpoint while Product v0.2 functional gaps are reconciled.
- Existing completed functionality is preserved, but affected permissions and workflows must be revised.
- Cashier shifts, business-day close, table sessions, waiter authorization, VAT snapshots, public slugs, explicit Telebirr/bank methods, customer tracking, and menu-support mode become required pilot work.
- The canonical PRD, RBAC matrix, workflows, data model, API specification, implementation plan, UX acceptance checklist, and requirement-to-test matrix must be updated before those slices are assigned.
