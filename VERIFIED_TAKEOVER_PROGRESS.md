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

### Notification HTTP verification follow-up

- Notification mapping unit suite **3/3 passed**, targeted lint passed. Fresh API typecheck and build (91403) completed successfully with controller/module wiring.
- Added real HTTP tests to the full Expo/waiter suite: Owner/Manager history reads, Waiter authenticated recipient isolation despite spoofed query recipient, anonymous/forbidden-role/cross-tenant/cross-branch denials, and branch feature disable.
- First expanded gate: **28/29 passed, one failed**. Feature denial returned expected 403; test incorrectly assumed a nested error envelope. Current Nest response has top-level `code`; assertion corrected to that actual contract. Error-envelope standardization remains a separate full-stack requirement.
- Full 29-test rerun has been started; inspect its actual terminal result before claiming pass. Existing fixture cleanup still swallows errors and clears all unpublished events in this isolated DB at setup; scope-safe strict fixture cleanup remains required and is not treated as solved.
- Missing durable event handlers are still evidenced by lifecycle logs. Passing HTTP reads do not close reliable notification creation/delivery or WebSocket requirements.

### Strict lifecycle fixture cleanup

- Corrected HTTP assertion rerun: **29/29 passed**, exit 0 (68818). This result still used inherited permissive cleanup.
- Removed the global unpublished-outbox deletion at setup and now await processor shutdown. Cleanup uses explicit fresh tenant IDs and exact fixture user emails, deletes notifications before referenced tickets, handles cash shifts and auth sessions, and runs in a transaction without swallowing errors. It asserts fixture tenants/users are gone.
- First strict rerun: **29/29 workflow assertions passed but suite failed** on BranchOrderCounter foreign key during cleanup (27151). Transaction rolled back; no false green claim. Added scoped BranchOrderCounter cleanup. Corrected full suite is running at 94057; result remains unverified.
- Durable event handlers, full signed-token Socket.IO and live browser journeys, complete MVP gates, and staging remain open.

### Cleanup proof and notification atomicity follow-up

- Corrected strict fixture suite **29/29 passed**, exit 0 (29659), including transaction cleanup and explicit zero remaining fixture tenant/user assertions. Run used `--hookTimeout 120000` after previous terminal run 94057 failed setup's 30-second timeout with zero workflow assertions executed. No test was intentionally skipped.
- Notification creation now holds a PostgreSQL transaction-scoped dedupe-key advisory lock, then writes the notification and its audit record in the same transaction. Concurrent creators serialize; audit failure propagates for rollback. Unit suite **11/11 passed**; lint command 53336 remains active, and real-DB concurrency proof is newly added but not yet executed to completion.
- New 30-test full suite includes five simultaneous notification creates, asserting one notification ID, one stored notification, and one audit record. Inspect its terminal output before counting this concurrency behavior as verified. No full MVP or staging completion claim.

- Full follow-up suite **30/30 passed**, exit 0 (96061), including the real PostgreSQL concurrent dedupe/audit assertions and strict fixture cleanup. Advisory-lock query casts PostgreSQL's void result to text for Prisma deserialization. Earlier notification lint completed with 0 errors/4 warnings; removed serializer `any`, unused suppression/import, and test constructor `any`. Latest typecheck/lint for these typing changes is active at 61685. Rollback is unit-tested but still needs explicit real-database fault injection; event creation remains post-order-transaction in some callers and requires durable recovery integration.

### Notification rollback and reference scope verification

- Typecheck/targeted lint command 61685 completed with exit 0 after serializer typing cleanup.
- Added a real database rollback/retry test: nonexistent audit actor causes AuditLog FK failure after notification insertion; zero notification must persist, and valid-actor retry must create one notification and one audit. Full 31-test suite is active at 92165; not counted as passing yet.
- Notification creation now checks its order by tenant/branch and optional ticket by tenant/branch/order before insertion. Added two unit denial tests; latest 13-test unit suite is active at 62911. The 31-test run started before this latest scope-validation edit and cannot alone prove its integration behavior.
- Required durable after-commit event delivery, signed-token Socket.IO/live browser workflows, UI/device gates, and temporary staging remain incomplete.

- Latest scoped-reference notification unit suite **13/13 passed**, exit 0 (62911), including foreign order/ticket denials. Real-DB 31-test result remains pending at 92165; subsequent latest-code integration rerun is still required for the reference-validation addition.

- Rollback/concurrency full lifecycle suite **31/31 passed**, exit 0 (92165). Actual AuditLog FK failure rolled back notification creation and valid retry succeeded. This run loaded before latest reference-validation edit; latest-code full integration rerun remains required.

### After-commit fulfillment invalidation delivery

- Latest reference-validation integration suite **31/31 passed**, exit 0 (8384).
- Added explicit outbox handler registration with duplicate-registration rejection, and FulfillmentEventDelivery module wiring for five ticket lifecycle events and six fulfillment/Expo/waiter order events. Handler checks structured payload, aggregate identity, scoped order/ticket existence, and emits only event IDs, scoped IDs, and current versions. It never forwards arbitrary payloads, money, or proof metadata. Invalid events fail for outbox retry/dead-letter behavior rather than being silently acknowledged.
- These handlers deliver actual socket invalidations after commit; duplicates trigger authoritative HTTP reconciliation, not replayed state patches. They do not yet guarantee durable notification creation or cure absent order/payment/other event handlers. Socket transport delivery and active room revocation remain separate requirements.
- First handler/outbox unit gate **19/19 passed**, API typecheck and targeted lint completed exit 0 (24381). Subsequently corrected ticket contract to separate `ticket:invalidated`, because existing KDS `ticket:updated` merges full projections. Gateway sends a union of branch/station rooms; frontend forwards invalidations and KDS refetches rather than applying partial objects.
- Latest handler tests/type/lint and frontend hook/type/lint commands are pending; full 31-test regression with new module handlers is active at 1791. Do not infer full live Socket.IO delivery from unit mocks or database lifecycle tests alone.

### Fulfillment delivery boundary proof

- Latest handler unit suite **9/9 passed**, typecheck and targeted lint passed (82620). Full new-module lifecycle regression **31/31 passed** (1791).
- Strengthened actual HTTP-to-outbox lifecycle test: committed IN_PROGRESS/READY ticket events must both be PUBLISHED with publication timestamps after real processor polling, and gateway invalidation must contain the expected scoped ticket/order and current version. Full strengthened suite **31/31 passed**, exit 0 (86645). Gateway spy observes the actual handler call but does not substitute for signed-token Socket.IO transport testing.
- Frontend invalidation/reconciliation hook suites **6/6 passed** (3827); subsequent frontend type/lint steps remain active. Heavy jsdom setup caused long elapsed time; no restart or test skip was used.
- New fulfillment invalidation handlers resolve those event types; logs still evidence missing order.created/payment.approved handlers. Notification durability/recovery, full live transport/browser checks, broader MVP requirements and staging remain open.

### Actual signed-token Socket.IO verification and namespace repair

- Added socket.io-client as an API dev dependency using offline pnpm resolution (40245 exit 0), preserving existing workspace/lock changes. New transport tests run a real Nest gateway/adapter, signed JWTs, PostgreSQL users/memberships/branches/stations, and native Socket.IO clients on an ephemeral localhost port with strict targeted fixture cleanup.
- First five-test transport gate **5/5 failed**, exit 1 (17836): missing-token connect_error absent, authorized joins timed out, another-waiter denial absent, token expiry disconnect absent. No skips or passing transport claim.
- Inspected installed primary Nest IoAdapter implementation: createIOServer returns root server; create separately selects/reuses the gateway namespace. Existing authentication server.use attached only to root and did not authenticate /kds. Adapter now overrides create and attaches middleware to each actual returned server/namespace rather than only createIOServer. Full six-test transport rerun is active at 75041.
- Added shared exact-origin comparison to HTTP CORS and socket adapter; no implicit subdomains, scheme changes, or alternate ports. Engine allowRequest also rejects unauthorized WebSocket upgrade Origins (CORS alone is insufficient). Origin-less native/server callers still require auth. Added live allowed/denied Origin test.
- Exact-origin plus adapter lifetime unit gate **16/16 passed**, typecheck/lint completed exit 0 (20494) before namespace repair. Fresh latest-code type/lint command is active. Test follow-up adds a genuinely signed JWT using the wrong signing key, in addition to malformed/missing/expired-token and foreign-membership cases; latest transport rerun after that addition remains required.
- Already-joined access revocation, outbox notification recovery, complete live browser/MVP gates, UI acceptance and staging remain incomplete.

- First namespace-repair six-test gate **1 passed/5 failed** (75041): handshake rejection passed, valid connections timed out. Changed diagnostic connection helper to surface connect_error immediately; one-test filtered investigation failed with `Invalid or expired token` (6577). Filtered diagnostic is not counted as a full gate. Installed ConfigService implementation prioritizes environment over fixture internal values; isolated test now pins/restores JWT secret and origin to the real signer/config fixture. Full six-test run active at 45484 includes wrong-key signed-token coverage.
- Fresh typecheck exposed incompatible create signature and installed Nest Socket.IO 4.8.1 versus direct SDK 4.8.3 nominal types (26102 exit 1). Adapter now uses base create parameter/return types and derives its socket type from the actual Nest middleware boundary. Latest typecheck is running; prior combined tsc/lint command's final exit 0 did not prove typecheck success because intermediate tsc failed. Do not claim this slice complete until current independent gates pass.

- Actual full signed-token transport gate **6/6 passed**, exit 0 (45484): missing/malformed/wrong-key/expired token and foreign-membership handshake rejection; exact Origin enforcement on upgrades; authorized branch/station subscription with one delivery for overlapping rooms; foreign tenant/unassigned branch/preparation/Expo/personal-room denial; live feature/membership changes on new joins; real expiry disconnect. Strict fixture cleanup completed. Latest edit after this run is erased socket typing only; independent typecheck/lint/build results remain to inspect. Already-joined access revocation and actual browser workflows are still not proven by this transport gate.

### Bounded already-joined subscription revocation

- API build completed successfully (73560). Whole backend unit gate **424/424 passed across 38 files**, exit 0 (69714), before latest revocation changes; this is not a whole MVP integration gate.
- Adapter revalidates active user/membership/tenant and each subscribed room every 10 seconds, with shared join-role allowlists, active/scoped branch and station checks, branch assignments, and branch KDS entitlement. Inactive account/membership disconnects; revoked room access removes rooms and emits the existing exception event for visible frontend recovery.
- Actual transport suite **9/9 passed**, exit 0 (79406), including already-joined membership suspension disconnection, branch unassignment removing branch/personal rooms, and KDS disable removing branch/station rooms. Tests inspect real server-side room membership and reject subsequent unauthorized joins; no arbitrary short sleep or fake socket substitutes for this proof.
- Added a 3-second per-cycle authorization deadline with fail-closed disconnect so a hung DB call cannot leave trust unbounded. This bounds normal revocation checks to the 10-second interval plus query deadline, not immediate push revocation. Disconnect clears expiry, interval, and deadline timers. New fake-time hung-query test and latest type/lint pipeline active at 88299; fresh nine-test deadline-code transport run just started. Earlier 9-test pass predates this deadline refinement.
- Account status/role/station and DB failure variants still need broader coverage. Real browser UI reconciliation, durable notification recovery, remaining event handlers, full MVP/migration/frontend gates, and staging remain open.

- Latest deadline/guard unit suite **16/16 passed**, typecheck and targeted lint passed, exit 0 (88299). Pre-deadline unit/type/lint pipeline also completed exit 0 (74819). Latest deadline-code actual transport run remains active at 28368 and must be inspected, not assumed green.
