# Architecture Decision Log

This file records decisions that implementation agents must follow unless a later accepted decision supersedes them.

## ADR-001: Use a TypeScript monorepo

- **Status:** Accepted
- **Decision:** Use pnpm workspaces and Turborepo with Next.js, NestJS, shared packages, and AWS CDK.
- **Reason:** One language and repository reduce coordination and contract drift during a short MVP schedule.
- **Consequence:** Package boundaries and dependency direction must be enforced to prevent a monorepo from becoming tightly coupled.

## ADR-002: Build a modular monolith

- **Status:** Accepted
- **Decision:** Deploy one API and one background worker while keeping explicit domain modules.
- **Reason:** Microservices would add deployment, tracing, transaction, and testing overhead before usage patterns are known.
- **Consequence:** Modules may share PostgreSQL but must not bypass each other's service boundaries.

## ADR-003: Use shared-schema multi-tenancy

- **Status:** Accepted
- **Decision:** Store all tenants in one PostgreSQL schema with mandatory `tenant_id` and branch scoping, backed by application guards and PostgreSQL Row-Level Security.
- **Reason:** This is operationally simpler and more economical for an MVP than one database per tenant.
- **Consequence:** Every repository, unique constraint, test fixture, and index must account for tenant scope.

## ADR-004: Treat a restaurant business as a tenant

- **Status:** Accepted
- **Decision:** A tenant owns one or more branches. Staff membership belongs to the tenant and branch access is assigned separately.
- **Reason:** Owners need a consolidated view while operational data remains branch-specific.
- **Consequence:** Reporting must distinguish branch reports from tenant-wide aggregates.

## ADR-005: Use ETB as the default currency

- **Status:** Accepted
- **Decision:** Use ISO 4217 code `ETB` and integer minor-unit amounts.
- **Reason:** `ETB` is the standard code for Ethiopian birr. The user's “ETP” wording is interpreted as ETB.
- **Consequence:** Currency remains stored on monetary records so future currencies do not require a schema redesign.

## ADR-006: Make manual transfer a first-class payment method

- **Status:** Accepted
- **Decision:** Show tenant/branch payment instructions, accept private proof images, and require cashier or manager approval before confirming the order.
- **Reason:** The MVP must work without depending on a specific Ethiopian payment-provider API.
- **Consequence:** Proof upload never implies successful payment; approval and rejection are audited business actions.

## ADR-007: Use a payment adapter boundary

- **Status:** Accepted
- **Decision:** Implement cash and manual-transfer adapters now and define a provider interface for future gateways and webhook verification.
- **Reason:** Gateway availability is optional and may vary by provider or restaurant.
- **Consequence:** Provider-specific fields must stay out of the core order state machine.

## ADR-008: Deploy frontend to Vercel and backend to AWS

- **Status:** Accepted
- **Decision:** Deploy Next.js on Vercel and run containerized NestJS services on AWS ECS Fargate with RDS, S3, and SQS.
- **Reason:** Vercel provides the simplest Next.js workflow; AWS provides durable transactional and background infrastructure.
- **Consequence:** CORS, cookies, domains, tracing, and environment configuration must be designed across both platforms.

## ADR-009: Do not promise full offline POS in the MVP

- **Status:** Accepted
- **Decision:** Cache the PWA shell and recent safe reads, expose connectivity state, and use reconnect/refetch behavior. Do not queue financial or inventory mutations offline.
- **Reason:** Correct offline conflict resolution for orders, payments, and stock is a separate product capability.
- **Consequence:** Staff require a network connection for order confirmation and payment decisions.

## ADR-010: Use one responsive frontend application

- **Status:** Accepted
- **Decision:** Place public ordering, POS, KDS, management, and platform administration in separate route groups within one Next.js application.
- **Reason:** Shared design and deployment reduce MVP implementation time.
- **Consequence:** Route-level authorization, loading boundaries, and bundle separation must prevent privileged data or code paths from leaking into public pages.

## ADR-011: Confirm payments and orders transactionally

- **Status:** Accepted
- **Decision:** Payment approval, order confirmation, inventory reservation/deduction decision, audit record, and outbox event occur in a controlled transaction or explicitly designed saga where a transaction cannot apply.
- **Reason:** A paid order must not disappear between POS and KDS.
- **Consequence:** Event consumers must be idempotent, and external side effects occur only after commit.

## ADR-012: Use server-authoritative prices and snapshots

- **Status:** Accepted
- **Decision:** The server resolves current item availability and calculates totals, then stores immutable order-line snapshots.
- **Reason:** Client totals can be stale or manipulated, while historical receipts must not change when menu data changes.
- **Consequence:** Every order creation and edit command performs catalog revalidation.

## ADR-013: Default operational timezone

- **Status:** Accepted
- **Decision:** Store timestamps in UTC and default branch display/reporting timezone to `Africa/Addis_Ababa`.
- **Reason:** This supports Ethiopian operations while preserving correct storage and future expansion.
- **Consequence:** Reporting boundaries must convert branch-local dates to UTC ranges explicitly.

## ADR-014: Adopt the Product v0.2 pilot operating model

- **Status:** Accepted
- **Decision:** `PRODUCT_V0_2_DECISIONS.md` governs ordering contexts, payment authority, shifts, business-day close, table occupancy, localization and support mode.
- **Reason:** The pilot-owner/cofounder documents define real role workflows and recovery states more precisely than the original feature outline.
- **Consequence:** Functional v0.2 gaps are implemented before final hardening and frontend integration.

## ADR-015: Separate table QR and public pickup contexts

- **Status:** Accepted
- **Decision:** `/o/{token}` permits configured table-context dine-in/takeaway choices; `/r/{publicSlug}` permits transfer-paid pickup pre-order only.
- **Reason:** A public link cannot establish physical table presence, and remote preparation must not begin for unpaid cash orders.
- **Consequence:** The server enforces permitted order/payment types from verified entry context rather than client choice alone.

## ADR-016: Restrict transfer verification to Owner for the pilot

- **Status:** Accepted; supersedes ADR-006 approver wording and older RBAC rows
- **Decision:** Only Owner verifies/rejects bank-transfer or Telebirr proof. Cashier confirms cash during an active shift. Manager and Super Admin cannot verify transfers.
- **Reason:** The pilot owner controls the destination accounts and carries verification risk.
- **Consequence:** Existing broader approval permissions and tests must be migrated without weakening transactional/idempotency guarantees.

## ADR-017: Add Waiter as a least-privilege role

- **Status:** Accepted
- **Decision:** Waiter sees assigned-branch ready orders and table state, may complete/serve Ready orders and clear eligible table sessions, and has no payment/configuration/inventory authority.
- **Reason:** Serving and physical table clearance are separate from kitchen and cashier responsibilities.
- **Consequence:** Contracts, migrations, role grants, guards, seeds and UI navigation include Waiter.

## ADR-018: Use explicit staff-managed table sessions

- **Status:** Accepted
- **Decision:** Confirmation of the first dine-in order opens or joins one active table session. Completion does not clear occupancy; Waiter or Owner clears after all linked orders are terminal and guests leave.
- **Reason:** Food completion is not reliable evidence that the physical table is available.
- **Consequence:** Session open/join/clear is concurrency safe, auditable and reflected through authoritative reads/events.

## ADR-019: Use configurable VAT and zero service charge

- **Status:** Accepted subject to onboarding tax approval
- **Decision:** Prices are modeled net/pre-VAT; tenant VAT applicability/rate is versioned and snapshotted. Service charge is always zero and absent from product configuration and UI.
- **Reason:** Pilot checkout and reconciliation require explicit subtotal, VAT and total without an invented tax rate.
- **Consequence:** Money calculations remain server-authoritative and decimal/integer safe; activation waits for accountant confirmation.

## ADR-020: Require cashier shifts and immutable day close

- **Status:** Accepted
- **Decision:** Cash confirmation requires an active shift. Shift close records expected/counted cash and variance. Owner business-day close creates an immutable local-day snapshot with blocker and exception workflows.
- **Reason:** Operational reconciliation is a primary pilot value, not optional reporting polish.
- **Consequence:** New Shifts and Business Day modules precede final integration.

## ADR-021: Support English, Amharic and Arabic

- **Status:** Accepted
- **Decision:** One application supports `en`, `am` and `ar`; English is fallback, Arabic is RTL, and production translations require native review.
- **Reason:** The pilot must serve the approved language audiences without separate deployments.
- **Consequence:** UI copy is externalized, localized content has fallback rules, and RTL/long-text/accessibility testing is launch blocking.

## ADR-022: Defer loyalty phone collection

- **Status:** Accepted
- **Decision:** Do not collect or persist loyalty-identification phone data during the pilot until privacy notice, retention, withdrawal and Ethiopia compliance decisions are approved.
- **Reason:** Accountless ordering does not require this additional personal-data risk.
- **Consequence:** Loyalty architecture may expose a future boundary but no active field, API or analytics event ships.

## ADR-023: Limit Super Admin support mode to menu operations

- **Status:** Accepted
- **Decision:** Support requires explicit tenant selection and reason and permits only catalog/category/variant/modifier operations. It cannot access payments, proofs, customers, orders, inventory, reports or staff.
- **Reason:** Restaurants may need onboarding help without granting uncontrolled operational impersonation.
- **Consequence:** Support context is short-lived, allowlisted, visibly bannered and fully audited.

## Open Product Decisions

These do not block architecture or initial scaffolding, but must be confirmed before their feature is finalized:

1. Exact manual payment instructions and supported external payment apps.
2. Whether payment proof requires a transaction/reference number in addition to an image.
3. Accountant confirmation of each pilot tenant's VAT applicability/rate and receipt wording. Service charge is fixed at zero.
4. Dine-in orders are not sent to kitchen before the accepted payment/confirmation rule succeeds for the pilot.
5. Rules for voids, refunds, discounts, and manager approval thresholds.
6. Inventory deducts on confirmation with exact compensating restoration on approved void.
7. English, Amharic and Arabic are required; final production copy requires native-speaker approval.
8. Required receipt printers or fiscal-device integrations, if any.
