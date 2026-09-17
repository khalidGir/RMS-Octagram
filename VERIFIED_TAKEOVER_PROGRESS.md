# RMS verified takeover progress

## Scope and evidence rules

The active goal remains full-stack MVP integration, UI hardening, real database/browser journeys, and staging preparation or deployment. Earlier OpenCode completion claims are not accepted without current evidence. This document records partial progress, not release approval.

## Preserved baseline

- Backend checkout: `RMS`, inherited HEAD `64c03fe`, takeover branch `codex/rms-backend-integration`.
- Frontend checkout: `RMS-frontend`, inherited HEAD `f12ef5b`, takeover branch `codex/rms-frontend-integration`.
- Existing tracked and untracked OpenCode changes remain intact in both worktrees. Expo/waiter services were already untracked at takeover; they are not newly authored takeover deliverables.

## Confirmed findings

| Area | Evidence | Status |
| --- | --- | --- |
| Waiter DTO metadata | Controller imported query/body DTO classes with `import type` | Corrected to runtime imports; compiled metadata verification pending |
| Expo DTO metadata | Controller imported release/recall classes with `import type` | Corrected to runtime imports; compiled metadata verification pending |
| Pagination | Service-board DTO lacked explicit conversion for HTTP string `limit` | Added number transformation and boundary tests; targeted tests pass |
| Seed catalog | `prisma/seed.ts` contains no menu category/item/variant creation | Incomplete |
| Seed feature catalog | Seed includes HOLD_RELEASE, RESERVATIONS, PROMOS, EXPENSES, ADVANCE_ORDERS | Reconcile against platform catalog before editing |
| Seed reruns | Four Main Branch stations used `create`, not stable upserts | Changed to upserts keyed by branch/code; database rerun proof pending |
| Portable frontend | Web package Prisma schema points into sibling RMS checkout | Investigate and correct before deployment |

## Verification log

- Added `fulfillment-dto.spec.ts`: ValidationPipe coverage for scope, pagination conversion/bounds, unknown query fields, mutation versions, and recall reason.
- Initial targeted run: 7/8 passed; valid string pagination failed. Investigation located conversion on the other queue DTO; service-board conversion then added.
- Final `pnpm --filter @rms/api exec vitest run src/modules/kitchen/fulfillment-dto.spec.ts`: **8/8 pass**, exit 0. This proves DTO/ValidationPipe behavior, not full HTTP authorization or compiled controller metadata.
- `pnpm --filter @rms/api typecheck`: **pass**, exit 0.
- Initial `pnpm --filter @rms/api build`: **pass**, exit 0. Compiled waiter/Expo controller output contains the runtime DTO classes in `design:paramtypes`.
- Expanded boundary validation: added collection body and Expo query DTO classes, and array/nonempty/unique/string checks for partial-service line IDs.
- `pnpm --filter @rms/api exec vitest run src/modules/kitchen`: **143/143 pass**, 12 files, exit 0, including 16 DTO tests. This is unit-level evidence, not full lifecycle proof.
- Latest typecheck and build after expanded DTO changes: **pass**. Compiled collection bodies and Expo queries now reference `CollectOrderDto` and `ExpoOrdersQueryDto`.
- Lint initially reported 2 errors for runtime DTO imports and 359 warnings across the inherited/current tree. Added scoped metadata-required import exceptions, consistent with existing controller conventions. Targeted lint of the four changed kitchen files **passes**, exit 0. Broader warnings remain unresolved and are not described as a clean gate.
- `docker compose ps`: PostgreSQL and Redis healthy; no API/web listener on 3001/3000 at inspection.
- Current backend contains a catalog controller. Earlier report claiming no menu/catalog module is contradicted by current files; functionality still needs live verification.

## Remaining work checklist

- [ ] Establish full backend/frontend build, lint, typecheck, unit, migration, integration, and browser baselines.
- [ ] Validate compiled controller metadata and real scoped query requests.
- [ ] Deterministic rerunnable seed with menus, variants, routes, branches, policies, and effective entitlements.
- [ ] Audit and complete Expo/waiter/KDS authorization, isolation, quantities, transactions, idempotency, and concurrency.
- [ ] Complete real frontend adapters/auth/context/WebSockets/reconciliation; isolate mock profiles.
- [ ] Verify all required role workflows and eliminate dead required actions.
- [ ] Theme, branding, device breakpoints, accessibility, localization, and failure-state verification.
- [ ] Real restaurant lifecycle journeys, financial/inventory compensation, table/customer behavior, scope denial, retry/concurrency/reconnect tests.
- [ ] Current hosting compatibility/free-tier eligibility checks and background-processing/storage adapters.
- [ ] Portable deployment configuration, migrations, secure bootstrap, origins, health/logging, backup/restore, rollback, and staging smoke tests.

No staging URL or production-readiness claim is currently supported by evidence.

## Integration evidence update — 2026-09-17

This update supersedes the earlier seed and DTO pending findings above.

- Runtime DTO metadata verified in compiled controllers; expanded ValidationPipe coverage: 16 tests.
- Created isolated `rms_codex_integration_test` database. All 24 migrations applied from scratch.
- Seed now uses authoritative FeatureKey values, missing entitlement upserts, stable categories/items/variants, six Ethiopian menu items in two branches, and required preparation routes. Seed ran twice successfully; read-only seed verifier passed after each run. Additional representative table/inventory/Expo/second-tenant seed coverage remains required.
- Prisma generation remains unverified: Windows engine DLL rename failed with EPERM. Existing generated client supported the migration/seed/integration checks; this does not substitute for the generation gate.
- Expo collection now copies exact ready quantities instead of incrementing by 9999, uses scoped optimistic updates, and writes its outbox event transactionally. Concurrent HTTP collection test proves one success, one conflict, and one collection event.
- Removed the Expo test fixture's direct ticket-creation fallback. Tests now require actual confirmed-order outbox processing to produce routed tickets.
- Latest real DB gate: `phase6c-cashier-shifts`, `kitchen-ticket-lifecycle`, and `expo-waiter-fulfillment`: **80/80 passed**, three files, exit 0. Covers role/branch/cashier ownership denial and actual preparation/Expo/waiter progression; not a full MVP gate.
- Cash confirmation and shift open/current/close now restrict roles to Owner/Cashier. Shift controller has branch authorization; other cashiers cannot close or read a colleague's private shift report. Owner branch lookups were further scoped after this test run and still require fresh regression verification.
- Expo and service-notification targeted units: **20/20 passed**. The subsequent typecheck session handle was unavailable on resumption; do not count that invocation as verified.
- Frontend Expo contract hook tests: **3/3 passed**. POS hides Manager cash actions and shows the authorized handoff; latest frontend typecheck passed. Cash-shift workspace and navigation permission alignment remain unfinished.
- Critical remaining finding: the outbox logs unhandled order/payment/ticket/fulfillment event types. Reliable background delivery and live reconciliation are not yet proven; passing lifecycle tests do not close this requirement.

No deployment, full-browser acceptance, complete quality gate, or production readiness is claimed.

### Cash UI and outbox claim follow-up

- Cash-shift navigation now excludes Managers. Direct cash-shift page access denies Managers/Kitchen Staff/Waiters and disables financial data queries for those roles.
- New cash-shift role tests plus navigation regression suite: **12/12 passed**, exit 0. Frontend typecheck passed.
- Found outbox claim selection and status update were separate autocommit statements, invalidating the claimed SKIP LOCKED guarantee. Replaced with one candidate CTE + UPDATE RETURNING statement.
- Outbox unit suite: **9/9 passed**, including atomic-statement shape assertion. API typecheck passed. Real multi-connection DB contention evidence is still pending; unit SQL inspection alone is not sufficient.
- Outbox lease recovery, fencing, unknown event delivery handlers, and real-time end-to-end verification remain open.

### Real outbox concurrency and diagnostic isolation

- Added private-schema PostgreSQL integration tests using separate Prisma connections. Real atomic claims handled 20 unique events without duplicate claims while handlers were held behind a barrier. All events were then published. Temporary schema/tables were removed; unrelated queues were not modified.
- Discovered diagnostics were globally readable by tenant Owners/Managers and retries accepted client-provided actor identity. Diagnostics now filter authenticated tenant plus Manager branch assignments (empty assignments deny all). Retry uses authenticated user identity, scoped lookup, conditional DEAD_LETTER transition, and transactional audit.
- Real DB diagnostic test verifies foreign-tenant/unassigned-branch denial, scoped counts/lists, and concurrent retry: exactly one success, one conflict, one audit. **2/2 integration tests passed**.
- Outbox processor/controller units: **13/13 passed**. Targeted outbox/test lint and API typecheck passed. Latest API build is running and has not yet been counted as successful.
- Required delivery handlers and lease recovery are still absent. This work proves claim/scoping behavior, not complete event transport, full HTTP route security, or production readiness.

### Lease recovery follow-up

- The preceding API build completed successfully. Lease recovery is no longer absent: PROCESSING events with a lease older than 120 seconds (or missing lease time) can be reclaimed atomically, incrementing their recovery count. Exhausted stale claims become DEAD_LETTER.
- Every batch receives a fresh random claim token. Publish, retry, unknown-type, and dead-letter writes require matching PROCESSING ownership, preventing a stale handler from overwriting a newer claim.
- In-flight handlers renew leases every 20 seconds; timers are cleared on completion. Shutdown now races its actual drain against a 30-second deadline and exposes the lifecycle promise to Nest.
- Private-schema PostgreSQL suite: **4/4 passed**, including expired/live/exhausted leases and an old handler finishing after another connection reclaimed the event. Domain side-effect deduplication is a separate requirement; fencing acknowledgments does not provide exactly-once effects.
- Outbox units: **14/14 passed**, including heartbeat ownership and bounded shutdown under a held handler using fake time. Targeted lint, API typecheck, latest API build, and diff whitespace checks passed.
- Required event delivery handlers, malformed payload validation, real-time browser reconciliation, and complete lifecycle regression remain open. No production-readiness or full MVP claim.

### Socket room authorization hardening in progress

- Replaced the cached Owner branch bypass with a live active-branch lookup scoped by tenant, for every join. Current active membership/user/tenant, non-Owner branch assignments, branch-level entitlement, and requested station/kitchen scope are revalidated. Authenticated room leave remains safe without a new branch grant.
- Added guard unit coverage: **11/11 passed**. API typecheck completed successfully. Targeted lint/build commands are still running and have not been counted as passes.
- Added real-DB guard tests for foreign tenant denial, feature disable/re-enable, demotion/unassignment/reassignment, and suspended membership. First run failed during setup because localhost:5432 was unreachable: **zero assertions executed**, not a passing or intentionally skipped gate.
- Docker PostgreSQL inspection subsequently succeeded. Explicit IPv4 rerun: **4/4 real-DB guard tests passed**, exit 0. Fixture records were cleaned up. Host listener diagnostic confirmed port 5432. Initial targeted lint passed; lint/build handle 53455 is still pending its build result.
- Frontend socket now also handles Nest's `exception` event so guard denials do not remain invisible. This follow-up change is not yet retested.
- Joined-room revocation/expiry, gateway role and station/device access, exact-origin enforcement, actual Socket.IO handshake/namespace/room/broadcast tests, durable event handlers, and browser reconciliation remain open. Join validation alone does not prove long-lived subscription safety.

- Added room-type role checks matching preparation/Expo/service workflows, including denial of assigned Cashiers in preparation and Expo rooms. Updated guard unit/lint command remains active at handle 83875. Frontend Nest exception-event follow-up test/lint is active at handle 54403. These latest results must be inspected before claiming success or committing the slice.

### Continued socket verification

- Updated guard suite: **12/12 passed**, including room-type role denial. Its targeted lint command completed successfully (handle 83875 terminal exit 0).
- Adapter now requires a finite JWT expiration and schedules socket disconnection at that expiration, clearing the timer on early disconnect. Guard additionally rejects expired connection context. Added three controlled adapter authentication/lifetime tests; this is not a real signed-token/Socket.IO transport gate.
- Latest adapter/guard test, lint, and typecheck command is still active at handle 56638. Earlier build 53455 and frontend exception-follow-up test/lint 54403 remain active; preserve and poll those handles rather than restarting because observation yields no output.
- Latest expiry code is not yet counted as tested/built, and this security slice is not committed yet. Whole-system integration, long-lived revocation handling, reliable outbox delivery, UI acceptance, and staging remain incomplete.

### Socket check results and notification read implementation

- Latest adapter/guard suites: **15/15 passed**. Targeted lint and API typecheck completed successfully. Earlier API build completed successfully; compiled adapter contains the finite-expiry requirement and tokenExpiresAt assignment. Actual signed-token/Socket.IO transport and active revocation still require end-to-end tests.
- Frontend Nest `exception` handling follow-up: **4/4 socket hook tests passed**, targeted lint passed. This is mocked transport evidence, not an actual server denial journey.
- Added GET `/branches/:branchId/service-notifications`, protected by JWT, tenant role, branch scope, and KDS feature guards. Owner/Manager read scoped branch history; Waiter reads only authenticated recipient notifications. Client query identities cannot override the recipient filter.
- New notification-controller mapping unit/lint command is active at 37246. Full HTTP role/tenant/branch/entitlement denial and read-recipient integration tests are still required. New module wiring has not yet had a fresh API build.
