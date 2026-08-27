# MVP Implementation Plan

## 1. Delivery Strategy

Build vertical slices in dependency order. Each phase must leave the main branch deployable. Avoid implementing all database models before proving a complete order-to-kitchen path.

The 4-6 week target assumes a focused small team, rapid product feedback, and no fiscal-device or external payment-gateway integration in the MVP.

## 2. Definition of Done for Every Feature

- Acceptance criteria are met on desktop and common tablet widths.
- Authorization is enforced and tested on the API.
- Tenant and branch isolation tests pass.
- Validation and stable error codes exist.
- Critical mutations are transactional and idempotent.
- Audit events are emitted where specified.
- Loading, empty, error, disconnected, and conflict states are handled.
- Unit/integration tests and relevant Playwright flow pass.
- Documentation/OpenAPI is updated.
- Logs contain a correlation ID and no secrets or sensitive image URLs.

## 3. Phase 0 - Foundation (Days 1-3)

### Deliverables

- Initialize pnpm/Turborepo repository layout from `ARCHITECTURE.md`.
- Add strict TypeScript, ESLint, formatting, commit hooks, and environment validation.
- Scaffold Next.js web, NestJS API, worker, shared contracts, database, and UI packages.
- Add Docker Compose for PostgreSQL and optional Redis.
- Configure Prisma baseline and migration workflow.
- Add API health endpoints and structured logging/correlation IDs.
- Add GitHub Actions for install, lint, type-check, test, migration validation, and build.
- Scaffold AWS CDK and document environment variables.

### Exit criteria

- One command starts web/API/local dependencies.
- CI passes from a clean checkout.
- Staging skeleton deploys to Vercel/AWS.
- No business feature code is needed to prove the deployment path.

## 4. Phase 1 - Identity, Tenancy, and Branches (Days 4-7)

### Deliverables

- Users, sessions, tenants, memberships, branches, assignments, and feature settings.
- Password authentication, refresh rotation, logout, and session revocation.
- Tenant/branch request context and authorization guards.
- Owner and staff invitation flow sufficient for seeded/demo usage.
- Platform tenant provisioning and suspension.
- RLS policy proof for core scoped tables.
- Staff shell with branch selector and permission-aware navigation.

### Exit criteria

- Owner can access all tenant branches.
- Assigned staff can access only assigned branches.
- Automated tests demonstrate cross-tenant and cross-branch denial.
- Suspended membership/tenant loses access promptly.

## 5. Phase 2 - Catalog, Tables, and Public Menu (Days 8-12)

### Deliverables

- Categories, items, variants, modifiers, branch availability, and prices.
- Menu administration UI.
- Dining areas, tables, QR token generation/rotation.
- Public pickup menu and table-context resolution.
- Responsive customer cart with server price validation.
- Private media path ready for catalog images if schedule permits.

### Exit criteria

- Manager configures a branch menu and generates a QR code.
- Customer scans/opens a valid token and sees only branch-available items.
- Invalid/rotated token reveals no tenant data.

## 6. Phase 3 - Orders and POS (Days 13-18)

### Deliverables

- Order state machine, order/line snapshots, status history, and order numbering.
- Customer table and pickup submission.
- Cashier POS cart and order creation.
- Draft/unconfirmed edit rules.
- Customer tracking token and status page.
- Idempotency records and optimistic concurrency.
- Orders await payment (PENDING_PAYMENT) or staff confirmation (PENDING_CONFIRMATION).

### Exit criteria

- Customer and cashier can create valid orders without duplicate submissions.
- Server rejects stale prices and invalid modifiers safely.
- Orders reach PENDING_PAYMENT or PENDING_CONFIRMATION according to payment policy.
- Money invariants and order state transitions have integration tests.

## 7. Phase 4 - Manual Payment and KDS (Days 19-28)

### Phase 4A - Manual Transfer Payment Flow (Days 19-24)

- Branch payment instructions.
- Presigned private S3 upload/finalization.
- Owner review queue with proof viewer, approval, and rejection.
- Transactional payment approval and order confirmation.
- Kitchen stations, tickets, queue, bump/ready/complete/recall.
- WebSocket branch/station rooms and polling fallback.
- Transactional outbox publisher for order.confirmed and ticket events.

#### Exit criteria

- Customer uploads proof and sees pending review.
- Owner transfer approval confirms exactly once and creates KDS ticket(s).
- Unauthorized users cannot view proof.
- KDS reconnects and reconciles without losing or duplicating tickets.

## 8. Phase 5 - Inventory and Reporting (Days 25-29)

### Deliverables

- Inventory items, batches, portions, recipes, and ledger.
- Transactional deduction on order confirmation and compensation on void.
- Low-stock alerts.
- Revenue, best-seller, peak-hour, and inventory-consumption reports.
- Branch-local timezone date-range handling.

### Exit criteria

- A confirmed recipe-backed order creates reproducible ledger movements.
- Duplicate confirmation does not duplicate deductions.
- Reports reconcile to approved payments/orders for fixture datasets.

## 9. Product v0.2 Reconciliation Gate

The original Phase 0-5 backend baseline is implemented and verified at checkpoint `9b721e8` with 503 tests. The pilot-owner/cofounder v0.2 requirements add operational scope that must be completed before final frontend integration and launch hardening. Follow `PRODUCT_V0_2_RECONCILIATION.md` and `REQUIREMENTS_TRACEABILITY.md`; do not rebuild completed modules.

### Phase 6A - Contracts, VAT, localization, and permissions

- Add Waiter role and owner-only transfer-review policy.
- Add explicit bank transfer/Telebirr methods with backward-compatible migration.
- Add versioned tenant VAT configuration and immutable checkout/order snapshots.
- Fix service charge at zero and remove it from configuration/UI contracts.
- Add `en`, `am`, `ar` locale contracts and localized catalog fallback.

Exit: exact VAT fixtures, historical snapshot, role migration, RTL/locale contract and clean migration tests pass.

### Phase 6B - Public context and table sessions

- Add public restaurant slug resolver and pickup-only route rules.
- Enforce bank/Telebirr-only public pickup and configured table-QR choices.
- Open/join one active session on confirmed dine-in order.
- Add occupied projection and Waiter/Owner clear workflow.

Exit: crafted requests cannot bypass context; concurrency produces one session; premature/cross-scope clear is denied.

### Phase 6C - Cashier shifts

- Open/current/close shift endpoints and immutable report.
- Active shift required for cash confirmation.
- Exact expected/counted/variance calculation with reason policy.
- Cash payments snapshot shift attribution.

Exit: exact multi-shift fixture, no-shift denial, concurrency and immutable-report tests pass.

### Phase 6D - Business-day close

- Local business-day cutoff and preview.
- Blockers, close-with-exception, immutable snapshot and audited reopen.
- Printable/downloadable report contract.

Exit: multi-shift/method reconciliation, timezone boundary, concurrent close and historical immutability tests pass.

### Phase 6E - Super-admin menu support and tracking

- Explicit short-lived menu-only support context and persistent frontend banner contract.
- Owner-only transfer-proof visibility remains enforced.
- Token-scoped customer tracking invalidation/polling and reconnect metrics.

Exit: support escape matrix and customer/staff reconnect tests pass.

### Phase 6F - Product v0.2 frontend surfaces

- Customer, Cashier, Kitchen, Waiter, Owner and Super-admin route groups.
- English, Amharic and Arabic with RTL and native-copy approval gates.
- Implement `UX_ACCEPTANCE_CHECKLIST.md` states and Playwright journeys J-01 through J-10.

Exit: accessibility, role, responsive, localization and pilot task tests pass.

## 10. Phase 7 - PWA, Hardening, and Launch

### Deliverables

- Manifest, icons, install UX, service worker, cached shell, and safe read caching.
- Clear offline/reconnect UI; unsafe mutations disabled offline.
- Tablet accessibility and usability pass for POS/KDS.
- Rate limiting, CSRF, upload validation, security headers, and audit coverage.
- Load test critical read/write paths and WebSocket reconnect behavior.
- Backup/restore rehearsal, alerts, dashboards, and runbooks.
- Production seed/provisioning procedure and launch checklist.

### Exit criteria

- Playwright critical journeys pass in staging.
- Security/isolation checklist passes.
- Production rollback, backup, and incident contacts are documented.
- Owner can configure a new branch through the supported workflow.

## 11. Priority Backlog

### P0 - Launch blocking

- Identity, tenant isolation, branch access.
- Catalog and public menu.
- Customer/POS order creation.
- Cash and manual transfer workflows.
- KDS status workflow.
- Core inventory deduction.
- Basic reports and audit logs.
- PWA tablet usability and production operations.
- VAT/order snapshots, Waiter/table sessions, Cashier shifts, business-day close and menu-support mode.
- English, Amharic and Arabic critical-path UX.

### P1 - Include if capacity permits

- Unpaid/unconfirmed order split and merge.
- Catalog images.
- Customer status notifications beyond the tracking page.
- Optional catalog images and non-critical report refinements.

### P2 - Post-MVP

- Payment gateway adapters.
- Full offline order mutation/synchronization.
- Hardware/fiscal integrations.
- Refund automation and accounting integration.
- Loyalty, reservations, delivery, procurement, and stock transfers.

## 12. Testing Plan

### Unit tests

- Money/tax/discount calculations.
- Order, payment, and ticket transitions.
- Permission and feature-resolution logic.
- Inventory allocation and compensation.

### Integration tests

- PostgreSQL repositories with RLS enabled.
- Transactional payment approval to order/KDS/inventory/outbox (Phase 4B).
- Idempotency replay and conflicting payload (Phase 4A: manual-transfer creation and proof finalize).
- Optimistic concurrency conflicts (Phase 4A: concurrent finalization produces one current proof).
- S3 upload authorization metadata using a local/fake adapter (Phase 4A: presigned POST policies).
- Upload intent lifecycle: PENDING_UPLOAD → PENDING_SCAN → CLEAN (Phase 4A).
- Payment token expiry and terminal-state invalidation (Phase 4A).

### End-to-end tests

1. Owner creates branch/menu/table and invites staff.
2. Customer scans QR, orders, uploads proof, Owner approves, kitchen completes.
3. Cashier creates cash POS order and kitchen completes.
4. Payment rejection and customer resubmission.
5. Network interruption and KDS recovery.
6. Cross-tenant/cross-branch access attempts.
7. Confirmed order void and inventory compensation.
8. Branch-local report reconciliation.
9. Table cash order through active shift, KDS, served and explicit table clear.
10. Public-slug bank/Telebirr pickup with owner-only verification.
11. Multi-shift close and owner business-day close/exception/reopen.
12. Super-admin menu support allowlist and escape attempts.
13. English, Amharic and Arabic critical paths including RTL and reconnecting state.

## 13. Data and Security Review Gates

Before Phase 3 merge:

- Confirm ETB minor-unit display behavior.
- Confirm tax/service-charge configuration and receipt wording.
- Confirm dine-in pay-before-kitchen policy.

Before Phase 4 merge:

- Payment instructions use structured fields (label, method, accountHolder, accountIdentifier, instructions).
- Proof images are not automatically deleted during MVP; retention is configurable.
- Payment tokens expire after 24 hours and are invalidated on terminal payment state.
- One current proof per payment enforced by partial unique index.
- Upload intent lifecycle prevents unsafe proof viewing (CLEAN-only read URLs).
- Presigned POST with exact key binding, 5 MB limit, accepted MIME types, and checksum.

Before production:

- Threat-model tenant escape, QR enumeration, tracking-token guessing, file upload abuse, payment double approval, and staff privilege escalation.
- Review AWS IAM for least privilege.
- Verify staging and production separation.
- Perform a restore test from RDS backup.
- Obtain accountant confirmation for VAT applicability/rate/receipt wording.
- Approve proof retention/deletion and hosting/privacy operations.
- Obtain native-speaker approval for English, Amharic and Arabic production copy.

## 14. Implementation Order Rules

- Do not begin payment UI before order/payment state contracts exist.
- Do not build KDS solely around WebSocket messages; implement authoritative queue reads first.
- Do not add Redis until a measured or deployment requirement exists.
- Do not introduce microservices or GraphQL during the MVP without an accepted ADR.
- Do not integrate a payment provider until manual transfer is stable and provider requirements are confirmed.
- Do not implement offline financial mutations as an incidental service-worker feature.
- Do not resume final frontend/API integration until Product v0.2 contracts are frozen in OpenAPI.
- Do not activate loyalty-phone collection without a later accepted privacy decision.
- Do not allow Manager/Cashier/Super Admin transfer verification in the pilot.

