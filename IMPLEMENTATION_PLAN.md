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

#### Deliverables

- Branch payment instruction CRUD (staff management and public read).
- Presigned private S3 upload with upload-intent lifecycle (PENDING_UPLOAD → PENDING_SCAN → CLEAN).
- Customer payment submission with server-derived context from opaque tokens.
- Payment token with 24-hour expiry, terminal-state invalidation, and one-active-per-order constraint.
- Cashier review queue with protected proof access (CLEAN-only read URLs).
- Payment finalize atomically: claim upload intent, create proof, retire previous, transition status, audit, outbox.

#### Exit criteria

- Customer creates order, retrieves payment instructions, uploads proof, and sees PENDING_VERIFICATION.
- Cashier sees pending review queue with order summary.
- Unauthorized users cannot view proof images.
- Expired payment tokens and upload intents are rejected.
- Concurrent proof finalization produces exactly one current proof.
- Cross-tenant and cross-branch access is denied.
- Unit and E2E tests cover all 12 security/consistency scenarios.

### Phase 4B - Payment Approval and KDS (Days 25-28)

#### Deliverables

- Cashier/Manager payment approval and rejection with idempotency.
- Transactional order confirmation on payment approval.
- Kitchen stations, tickets, queue, bump/ready/complete/recall.
- WebSocket branch/station rooms and polling fallback.
- Transactional outbox publisher for order.confirmed and ticket events.

#### Exit criteria

- Cashier approval confirms exactly once and creates KDS ticket(s).
- Rejection notifies customer and allows resubmission.
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

## 9. Phase 6 - PWA, Hardening, and Launch (Days 30-35)

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

## 10. Priority Backlog

### P0 - Launch blocking

- Identity, tenant isolation, branch access.
- Catalog and public menu.
- Customer/POS order creation.
- Cash and manual transfer workflows.
- KDS status workflow.
- Core inventory deduction.
- Basic reports and audit logs.
- PWA tablet usability and production operations.

### P1 - Include if capacity permits

- Unpaid/unconfirmed order split and merge.
- Catalog images.
- More detailed shift-level cashier reports.
- Customer status notifications beyond the tracking page.
- Amharic UI after approved translations.

### P2 - Post-MVP

- Payment gateway adapters.
- Full offline order mutation/synchronization.
- Hardware/fiscal integrations.
- Refund automation and accounting integration.
- Loyalty, reservations, delivery, procurement, and stock transfers.

## 11. Testing Plan

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
2. Customer scans QR, orders, uploads proof, cashier approves, kitchen completes.
3. Cashier creates cash POS order and kitchen completes.
4. Payment rejection and customer resubmission.
5. Network interruption and KDS recovery.
6. Cross-tenant/cross-branch access attempts.
7. Confirmed order void and inventory compensation.
8. Branch-local report reconciliation.

## 12. Data and Security Review Gates

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

## 13. Implementation Order Rules

- Do not begin payment UI before order/payment state contracts exist.
- Do not build KDS solely around WebSocket messages; implement authoritative queue reads first.
- Do not add Redis until a measured or deployment requirement exists.
- Do not introduce microservices or GraphQL during the MVP without an accepted ADR.
- Do not integrate a payment provider until manual transfer is stable and provider requirements are confirmed.
- Do not implement offline financial mutations as an incidental service-worker feature.

