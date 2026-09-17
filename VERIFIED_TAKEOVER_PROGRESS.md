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
