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

## ADR-024: Use a single Lightsail host for temporary staging

- **Status:** Accepted for staging only; ADR-008 remains the production target
- **Decision:** Run the NestJS API, PostgreSQL 16, and Redis 7 as isolated Docker containers on one 2 GB Amazon Lightsail instance. Store payment proofs and encrypted database backups in a private S3 bucket. Keep the Next.js frontend on Vercel.
- **Reason:** The current environment is for integration and pilot validation. A single fixed-price host minimizes cost and operational complexity while preserving the application's PostgreSQL, Redis, S3, HTTPS, and WebSocket behavior.
- **Consequence:** This environment is not approved for business-critical production data. PostgreSQL and Redis are never exposed publicly, nightly off-host backups are mandatory, and the deployment must move to managed RDS/Redis and redundant compute before production availability or recovery guarantees are promised.

## ADR-017: Multi-kitchen fulfillment architecture

- **Status:** Accepted
- **Decision:** Extend the existing kitchen-ticket system with a physical `Kitchen` entity above `KitchenStation`, add `Order.fulfillmentStatus` as a derived/persisted summary, add expo and waiter-fulfillment workflows, and use transactional outbox events for all real-time coordination.
- **Reason:** The current system assumes one kitchen per branch. Real restaurants have multiple production areas (main kitchen, bar, bakery, coffee counter). The existing ticket/station foundation is solid but lacks physical-kitchen grouping, fulfillment-status tracking, expo coordination, waiter assignment, and durable service notifications.
- **Consequence:** Every order confirmation must validate routes across all stations in all kitchens, create one ticket per station, and derive a fulfillment summary. KDS displays must be scoped to kitchen and/or station. The migration must backfill a default "Main Kitchen" for every branch with existing stations.

## ADR-025: Phone-first staff authentication

- **Status:** Accepted for the staging rollout; email-compat removal tracked below
- **Decision:** Staff sign in with phone number + password. Ethiopian numbers are stored canonically in E.164 (`User.phoneE164`, unique) and accepted from local (`0911 234 567`), national (`911234567`), and full (`+251911234567`) formats via `@rms/contracts` `normalizeEthiopianPhone`. Email is retained only as optional compatibility/recovery data and is no longer collected by the UI. No SMS OTP in this phase — password only. Rate limiting keys on the normalized identity (`phone:<e164>`), so format games cannot dodge the limit. During the staged rollout the API temporarily also accepts the deprecated `email` login property so the old frontend keeps working while phones are backfilled; the window closes after staging verification (remove in a follow-up once: new API deployed, phones backfilled, phone login verified, new frontend deployed).
- **Reason:** Every target user already has a phone number; email is unreliable for Ethiopian restaurant staff. E.164 storage makes identity comparison exact, enables future SMS/OTP work without schema change, and local-format equivalence (`0911…` ≡ `+251911…`) avoids duplicate accounts.
- **Consequence:** Invitations, JWT claims, audit payloads, and staff screens carry phone instead of email; passwords remain the only factor, so phone-account takeover resistance equals password strength until OTP ships. The deprecated email path must not outlive the rollout window, and the login route throttle (10 req/min) is keyed by client IP (`login:<ip>`), so many staff behind one NAT share the login budget.

## ADR-026: Add table assistance service requests

- **Status:** Accepted
- **Decision:** Dine-in customers raise short-lived assistance requests (`CALL_WAITER`, `REQUEST_BILL`, `OTHER_ASSISTANCE`) from their table-QR session. A request requires an OPEN `DiningSession` (opened only by a confirmed dine-in order); otherwise the API rejects with a clear conflict. At creation the request inherits the session's `assignedWaiterUserId` when present, otherwise it enters the unassigned pool. Waiters claim and resolve requests on a branch-scoped board; managers/owners see and may act on all. Unclaimed (`OPEN`) requests escalate to `ESCALATED` after the branch's `assistanceEscalationSeconds` (default 180), evaluated by the existing in-process escalation poll. At most one non-terminal request of a type per session is allowed, enforced by a partial unique index; idempotency keys make customer retries safe.
- **Reason:** Call-waiter and request-bill are table-service basics that fit the waiter least-privilege role and the existing dining-session model. Requiring an open session preserves the PRD rule that scanning or drafting never occupies a table. Claim/resolve with optimistic `version` locking matches the order/ticket state-machine conventions and keeps requests append-friendly and auditable.
- **Consequence:** Waiter workspace gains a Requests tab and the customer table menu gains assistance actions. Escalation timing depends on the API process poll (same limitation as ready-order escalation), so restarts delay escalation until the next tick. Customers cannot cancel their own requests in this phase; waiters resolve them. Order-acceptance policy enforcement (`WAITER_APPROVAL` etc.) is deliberately NOT activated by this ADR — dine-in kitchen release timing stays under the pilot rule (pending item 4 below).

## ADR-027: Process menu item photos through an outbox → SQS → worker pipeline

- **Status:** Accepted
- **Decision:** Menu photo processing runs decoupled from the request path. The client obtains an upload intent, uploads bytes directly to S3, and calls `finalize`; finalize verifies the object and, in the same transaction, flips the media object to `PENDING_PROCESSING` and appends an outbox event (`menu.image.process_requested`) whose payload is only `{ mediaObjectId }`. An outbox dispatcher publishes the pointer to SQS (`SQS_QUEUE_URL`) after commit; the worker long-polls the queue (visibility 300 s), derives tenant/item ownership from the database — never from message contents — and processes under a 240 s database lease (`processingStartedAt`, `processingLeaseExpiresAt`, `processingAttempt`). Only terminal outcomes (`COMPLETED`, `REJECTED`, `SKIPPED`) delete the SQS message; transient failures reset the row to `PENDING_PROCESSING` before rethrowing, and a message is never deleted merely because the database says `PROCESSING`. An hourly janitor reclaims rows whose lease expired. Outbox publish failures retry with exponential backoff up to five attempts and then dead-letter the row, which stays recoverable through the existing outbox manual-retry endpoint — without `SQS_QUEUE_URL` (local/dev), publishing fails fast this same way instead of silently dropping the job. Public CDN keys combine the menu item ID, a crypto-random token, and the content hash — never tenant or media object IDs.
- **Reason:** The user-approved design keeps the API stateless and lets the ECS worker scale independently. The pointer-only payload means a forged or replayed message grants no scope (ownership is re-derived per job); the lease plus janitor guards crash recovery; delete-only-on-terminal prevents lost images; and the outbox preserves the atomicity invariant between finalize and job publication. Requirements 4 and 5 of the approved plan also forbid committed AWS credentials and browser-level fakes in Playwright, so the queue contract is exercised with local ElasticMQ and `page.route` stubs instead.
- **Consequence:** Staging/production need a queue and DLQ created manually (`aws sqs create-queue`, documented in `docs/STAGING_DEPLOYMENT.md`), plus `SQS_*`, `S3_MEDIA_BUCKET`, and `MEDIA_CDN_URL` worker/API environment; local development uses the `sqs` Compose profile with ElasticMQ. Until a queue exists, photos remain `PENDING_PROCESSING` with no data loss, and clients poll `status` until the worker reports `READY` or `REJECTED`. The worker image requires `sharp`, increasing image size and build time.

## ADR-028: Automate staging deploys with a self-hosted GitHub runner

- **Status:** Accepted
- **Decision:** Staging backend deployments run through `.github/workflows/deploy.yml` on a self-hosted GitHub Actions runner installed on the Lightsail host itself (`/opt/actions-runner`, labels `self-hosted,staging`), triggered by merges to `main` that touch backend paths, with manual `workflow_dispatch` for deploys and image-tag rollbacks. Each job records the running image tags, checks out the pushed SHA into the long-lived `/opt/rms` tree (which holds the server-only `.env`), takes an S3 PostgreSQL backup, builds SHA-tagged images, migrates, rolls out, and gates on container health plus an edge request through Caddy; any failure at or after rollout automatically re-ups the previous image tags. `main` is branch-protected: pull request required, green `build` check from `ci.yml`, no force-pushes or deletions.
- **Reason:** The host has no publicly routable address (CGNAT egress `100.57.8.66`, no public IPv4, SSH over IPv6 unreachable), so GitHub-hosted runners cannot SSH in — a runner on the host needs only outbound HTTPS. Running on the host reuses the warm Docker build cache on a 2 GB box and keeps deploy credentials (`.env`, AWS keys) entirely off the CI side. Branch protection makes the required CI check real instead of advisory.
- **Consequence:** The runner executes with the privileges of the deploy host, so the workflow deliberately has no `pull_request` trigger, is repository-guarded, and serializes jobs through a concurrency group; exposure on the public repo is limited to merges on protected `main` and manual dispatch. The runner is a staging single point of failure — systemd restarts it at boot, and re-registration after a host rebuild is documented in `docs/STAGING_DEPLOYMENT.md`. Rollback is image-only: database changes stay expand-only because migrations are never rolled back automatically. The target ECS/CDK topology (ADR-008) replaces this runner when infrastructure moves off the single host.

## ADR-029: Install customer-branded restaurant PWAs with read-only offline menu caching

- **Status:** Accepted
- **Decision:** Customer menu routes (`/r/[publicSlug]`, `/o/[token]`) are installable per restaurant. An owner-only branding pipeline (`POST /tenants/current/logo/upload-intent` → direct-to-S3 upload → `POST /tenants/current/logo/finalize`) stores the logo as `Tenant.logoMediaId` under a `Tenant.version` compare-and-set slot; the menu-image outbox/SQS/worker pipeline (ADR-027) renders 192/512/maskable/apple/thumbnail derivatives under a public-token CDN key and attaches them transactionally, bumping `Tenant.version`. Each customer route serves its own web app manifest (`/r/{slug}/manifest.webmanifest`) whose `start_url`, `id`, and `scope` are always `/r/{slug}` — never a table session token; the table page's metadata points at the branch manifest when the branch has a `publicSlug`, else at a token-scoped manifest route whose content is still token-free. Icons come from the tenant logo when present, otherwise the default RMS icons; manifest responses cache for five minutes. An install affordance appears on the customer menu only when a logo exists (Chromium `beforeinstallprompt`; iOS gets Share → Add to Home Screen instructions). The service worker (`rms-shell-v4`) caches only read-only data: menu-serving public GETs (restaurant and branch menu endpoints; order tracking, receipts, and payment responses are never cached) and customer page navigations (network-first), immutable assets and unsigned CDN images (cache-first; presigned URLs are never stored), and the read-only table-context resolve keyed by its opaque token; every other request — orders, payments, auth, staff API — stays network-only.
- **Reason:** The PRD asks for an installable customer web presence while MVP invariant #12 forbids offline financial/order mutations; per-tenant manifests give each restaurant a branded home-screen entry without native distribution (no TWA/APK, per scope decision D1). Read-only caching keeps menus available in low-connectivity venues without ever queueing money-bearing writes (D2). Keeping the table token out of `start_url`/`id`/`scope` keeps session tokens out of installed-app identity, shortcut labels, and update-detection keys. The logo flow reuses the audited menu-photo pipeline rather than inventing a second media path (D3).
- **Consequence:** The surfaces section of `ARCHITECTURE.md` is amended: customer routes are now installable, superseding "customer routes do not require installation." Logos reach `READY` only where the worker and queue run (ADR-027 staging requirements); until then menus keep default icons and the install button stays hidden. Manifest freshness is five minutes; iOS home-screen icons may show the default artwork until Safari's icon cache expires (out of scope). Playwright runs the web app in dev mode, where the service worker is deliberately not registered, so SW offline behavior is verified manually on staging; automated coverage is limited to manifest content, the offline banner, install-button gating, and a source-level service worker caching-policy test.

These do not block architecture or initial scaffolding, but must be confirmed before their feature is finalized:

1. Exact manual payment instructions and supported external payment apps.
2. Whether payment proof requires a transaction/reference number in addition to an image.
3. Accountant confirmation of each pilot tenant's VAT applicability/rate and receipt wording. Service charge is fixed at zero.
4. Dine-in orders are not sent to kitchen before the accepted payment/confirmation rule succeeds for the pilot.
5. Rules for voids, refunds, discounts, and manager approval thresholds.
6. Inventory deducts on confirmation with exact compensating restoration on approved void.
7. English, Amharic and Arabic are required; final production copy requires native-speaker approval.
8. Required receipt printers or fiscal-device integrations, if any.
