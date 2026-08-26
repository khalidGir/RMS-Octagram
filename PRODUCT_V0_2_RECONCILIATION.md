# Product v0.2 Reconciliation

**Status:** Approved implementation baseline  
**Decision source:** `PRODUCT_V0_2_DECISIONS.md`  
**Compared against:** Product brief, PRD, user-research plan, UX specification v0.2, canonical RMS architecture documents, and backend checkpoint `9b721e8`

## 1. Objective

Reconcile the pilot restaurant's operational and UX requirements with the implemented RMS backend without discarding completed, tested foundations. This document identifies what is retained, modified, added, deferred, or blocked by external approval.

## 2. Authority and conflict order

1. Latest explicit product-owner instruction.
2. `PRODUCT_V0_2_DECISIONS.md` and later accepted ADRs.
3. Tenant isolation, payment, money, and inventory integrity invariants.
4. Product v0.2 PRD and UX acceptance requirements.
5. Older RMS documents where v0.2 is silent.
6. Implementation convenience.

UX wording, navigation, role surfaces, responsive behavior, and visible recovery states follow the cofounder UX specification unless doing so would weaken security, privacy, or financial integrity.

## 3. Scope reconciliation

| Requirement | Existing implementation | Decision | Required delta |
| :--- | :--- | :--- | :--- |
| REQ-001 Tenant isolation | Auth, tenancy, roles, branch guards, entitlements, audit and extensive isolation tests exist | Retain and extend | Add Waiter; owner-only transfer permission; support-mode boundary; denied privileged-attempt audit policy |
| REQ-002 QR/public entry and table sessions | Tables, QR rotation and token resolution exist; `DiningSession` schema exists | Modify | Add public restaurant slug route; open/join session only on confirmed dine-in; occupied state; waiter/owner `Clear table`; terminal-order eligibility |
| REQ-003 Menu, VAT and support editing | Catalog, variants, modifiers, branch availability and price snapshots exist | Modify | Add localized menu fields/fallback; tenant VAT version/configuration; immutable tax snapshot; remove service-charge behavior; audited menu-only support mode |
| REQ-004 Guest ordering and loyalty | Guest order and tracking tokens exist | Retain with deferment | Keep accountless ordering; defer loyalty-phone persistence; add bounded notes and route-specific order choices |
| REQ-005 Duplicate-safe orders | Database idempotency, canonical hashing, counters and concurrency E2E exist | Retain | Frontend must persist/reuse UUID key and display authoritative retry state |
| REQ-006 Manual payment and proof | Private proof upload, scan states, instruction CRUD and manual transfer exist | Modify | Distinguish `BANK_TRANSFER` and `TELEBIRR`; immutable instruction/VAT/total snapshot; public pickup prohibits cash; table QR permits configured methods |
| REQ-007 Payment review | Atomic approval, inventory deduction, audit/outbox and concurrency tests exist | Modify | Transfer review becomes Owner-only; cashier cash confirmation requires active shift; safe customer rejection copy |
| REQ-008 Kitchen and waiter | KDS tickets, state machine, real-time gateway and outbox exist | Modify | Add Waiter role and ready/table surface; waiter/cashier/owner completion permissions; pickup-pre-order labelling |
| REQ-009 Cashier shifts | Not implemented | Add P0 | Open shift, opening cash, one active shift, cash attribution, expected/counted/variance, immutable close report, printable representation |
| REQ-010 Business-day close | Analytics exist but no operational close ledger | Add P0 | Tenant-local boundary, blockers, immutable snapshot, close-with-exception, audited reopen, underlying drill-down |
| REQ-011 Inventory | Items, batches, recipes, FIFO deduction, exact restoration, alerts and critical E2E exist | Retain | Keep strict non-negative pilot policy; expose inventory exceptions to day close; localized display only |
| REQ-012 Real-time and interruption | KDS WebSocket exists; authentication hardening is in progress; tracking polling exists | Modify | Order-token-scoped customer updates/polling contract; reconnect/stale UX; authoritative refetch; no offline mutation queue; 3-second pilot telemetry |
| REQ-013 Owner/platform management | Tenant provisioning, entitlements, branches, staff and audit exist | Modify | Owner business-day/VAT/language settings; explicit menu-support session; prohibit super-admin operational-data access through support mode |
| NFR Localization | English-ready UI only | Add P0 | English, Amharic and Arabic; locale keys; Arabic RTL; localized catalog values; native-speaker approval |
| NFR Privacy | Private proof controls exist | Modify | Approved proof retention/deletion policy before production; no loyalty collection until compliance decisions are accepted |

## 4. Existing capabilities that must not be rebuilt

- Authentication, rotating refresh sessions, tenant membership, branch assignment, and role guards.
- Super-admin tenant entitlements and feature resolution.
- Catalog, table and QR CRUD.
- Server-authoritative price and modifier validation.
- Table/POS/pickup order creation, order numbering, tracking, idempotency, and optimistic concurrency.
- Manual proof upload/finalization, payment approval/rejection, private storage boundary, and payment instructions.
- KDS stations, tickets, status pipeline, recall and outbox-based creation.
- Inventory items, batches, recipes, FIFO deduction, exact void restoration, adjustments, waste and low-stock alerts.
- Revenue, payment, order, best-seller, peak-hour and inventory reporting.
- Existing security and production-hardening work that does not conflict with v0.2.

## 5. Required implementation slices

### Slice A: Contracts, localization and VAT foundation

- Add Waiter role and revised role-grant hierarchy.
- Add explicit `BANK_TRANSFER` and `TELEBIRR` methods while preserving migration compatibility with historical manual-transfer rows.
- Add tenant VAT configuration versions with applicability, rate basis points/decimal representation, effective time and actor.
- Add immutable order VAT configuration/rate/amount snapshot; service-charge amount remains zero and is not exposed as a configurable product feature.
- Add locale codes `en`, `am`, `ar`, user preference and tenant defaults.
- Add localized catalog values using translation rows or validated JSON with deterministic fallback.

Exit: price calculations reproduce subtotal + VAT = total using integer/decimal-safe arithmetic; old orders remain unchanged; all role and locale contracts compile.

### Slice B: Public entry and payment-policy enforcement

- Resolve `/r/{publicSlug}` to an active tenant/branch without exposing internal IDs.
- Resolve `/o/{token}` to table context.
- Public slug permits pickup pre-order with bank/Telebirr only.
- Table QR permits dine-in or takeaway and configured cash/bank/Telebirr methods.
- Snapshot displayed payment instructions and tax totals on submission/payment creation.

Exit: direct API calls cannot bypass route-context rules; cross-tenant slug/token tests pass; historical instruction snapshots survive configuration changes.

### Slice C: Waiter and table-session lifecycle

- Add Waiter membership and branch assignment support.
- On first confirmed dine-in order, atomically open or join the table's active session.
- Mark table occupied while the session is open.
- Allow Waiter/Owner to clear only when all linked orders are terminal.
- Completing food does not clear occupancy.
- Emit scoped invalidation events and audit manual clear.

Exit: concurrent confirmations produce one active session; premature/cross-branch clear is denied; exact table state appears after reconnect.

### Slice D: Cashier shifts

- Open one active shift per cashier and branch.
- Store optional opening cash and immutable cash-confirmation attribution.
- Block cash confirmation without an active shift.
- Calculate expected drawer cash from approved cash payments assigned to the shift.
- Close with counted cash and mandatory variance reason when non-zero.
- Produce immutable, browser-printable report data.

Exit: concurrent shift open/close is safe; payments cannot move between closed shifts; totals reconcile exactly in ETB minor units.

### Slice E: Business-day close

- Configure tenant/branch local business-day boundary.
- Aggregate shifts, approved bank/Telebirr totals, recognized sales, rejected/cancelled/pending orders, variance and inventory exceptions.
- Block normal close for open shifts or pending payment orders.
- Support close-with-exception and audited reopen with mandatory reasons.
- Persist an immutable snapshot; later operational changes do not rewrite it.

Exit: exact fixture reconciliation, timezone-boundary, concurrent close, reopen and exception tests pass.

### Slice F: Menu-support mode

- Create explicit, short-lived support context with selected tenant and reason.
- Limit the context to catalog/category/modifier operations.
- Reject payments, proofs, customers, orders, inventory, staff and reports through support mode.
- Require persistent UI banner and before/after audit evidence.

Exit: support actions cannot cross the selected tenant or escape the menu allowlist.

### Slice G: Customer tracking and interruption contract

- Provide token-scoped customer tracking events or 20-30 second scoped polling fallback.
- Keep staff WebSockets authenticated, entitlement-aware and tenant/branch scoped.
- Define invalidation payloads; clients refetch authoritative state.
- Record delivery latency and reconnect metrics without personal/payment-proof data.

Exit: 95% of normal pilot events are observable within three seconds; disconnect tests show no silent mutation queue or false success.

### Slice H: Product v0.2 frontend surfaces

- Customer mobile ordering and tracking.
- Cashier landscape orders/shift workflow.
- Kitchen landscape queue.
- Waiter ready/table workflow.
- Owner mobile PWA for payments, configuration, shifts, day close, inventory and reports.
- Super-admin desktop tenant/entitlement and menu-support surfaces.
- English/Amharic/Arabic localization with RTL and accessibility acceptance.

## 6. Deferred or conditional scope

- Loyalty phone storage is deferred pending approved privacy notice, retention, withdrawal and Ethiopia compliance decisions.
- Negative inventory override is deferred; strict non-negative remains the pilot rule.
- Payment gateways, OCR, automatic payment matching, delivery, reservation, discounts, fiscal devices, accounting integration, procurement, offline mutations and advanced loyalty remain out of scope.
- Native translations require human approval; architecture may ship before final copy approval, production may not.

## 7. External approval gates

- Pilot accountant/tax adviser confirms VAT applicability, rate and receipt wording.
- Product/legal confirms proof retention, deletion, hosting and authorized-access policy.
- Native reviewers approve English, Amharic and Arabic production copy.
- Pilot owner confirms bank and Telebirr instruction fields, local day boundary and shift practice.

## 8. Completion gate

Product v0.2 reconciliation is implementation-complete only when:

- Every P0 slice has requirement-linked unit, PostgreSQL E2E and Playwright coverage.
- Existing 503-test baseline remains green or is intentionally migrated with documented expectation changes.
- No skipped tests or weakened concurrency assertions exist.
- Fresh and populated migrations pass in Docker.
- OpenAPI and generated frontend contracts represent the accepted routes and roles.
- English, Amharic and Arabic layouts pass the UX acceptance checklist.
- Production hardening resumes and passes after the functional deltas are complete.
