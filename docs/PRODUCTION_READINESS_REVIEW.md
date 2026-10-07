# Production Readiness Review — RMS MVP

|                          |                                                                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Review date**          | 2026-10-07                                                                                                                                                                                                                              |
| **Code under review**    | `main` @ `c8da1cd` (PR #11 merged)                                                                                                                                                                                                      |
| **Environment reviewed** | Staging (`rms-staging-chi.vercel.app`, API `https://100.57.8.66.nip.io`, Lightsail host `rms-staging`)                                                                                                                                  |
| **Method**               | 4 stages: (0) infrastructure/CDK assessment, (1) evidence matrix, (2) hands-on drills on staging, (3) remediation plan + verdict                                                                                                        |
| **Overall verdict**      | **NO-GO for production today.** Staging is functionally healthy and well-tested at the unit/e2e layer, but launch-blocking gaps remain in infrastructure bring-up, monitoring/alerting, web security headers, and human sign-off gates. |

---

## 1. Executive summary

**What is strong**

- Backend test depth is high: unit suite 472/472, database/API e2e 712/712 across 30 specs in CI on every push to `main`.
- Security-critical behaviors verified live on staging: tenant isolation, branch scoping, RBAC, upload validation, login rate limiting, optimistic locking — all passed adversarial probes (Section 4, Drill 2).
- Backups run nightly and a full restore rehearsal succeeded in **2 seconds with byte-identical row counts** across all 57 tables (Drill 1).
- Deployment rollback was exercised end-to-end: image rollback in **16 s**, roll-forward in **15 s**, both health-gated (Drill 5).
- Accessibility: 11/11 pages pass axe critical-violation scans (Section 3).

**What blocks launch**

1. **Infrastructure cannot deploy as designed.** The CDK stack (ADR-008 AWS) does not synthesize (Dockerfile asset path bug), has no Redis, no alarms, no PITR, a placeholder certificate, and wires `DATABASE_URL` from a password-only secret. `REDIS_HOST` defaults to `localhost`, so the readiness gate would fail in Fargate. Either bring AWS up properly or record an ADR to keep Lightsail and harden it — this is a product/architecture decision (Section 6).
2. **No alerting anywhere.** No CloudWatch alarms, no notification channels, no worker healthcheck. Unknown outbox event types accumulate as `UNKNOWN_TYPE` (23 rows and counting) with only a log line (Drill 6).
3. **Web app ships without CSP, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, or `Referrer-Policy`** (Drill 4).
4. **Human gates untouched:** `UX_ACCEPTANCE_CHECKLIST.md` is 0/99 checked; `REQUIREMENTS_TRACEABILITY.md` still shows Partial rows (REQ-001…007, NFR-004 in progress); external sign-offs (VAT/accountant, proof retention/privacy, native-copy) not obtained.
5. **Critical Playwright journeys are not in CI** — they pass locally but PRD §15 requires them as a release gate; only the API e2e suite runs in CI.
6. **Runtime out of support:** containers run Node v20.20.2 (EOL), with an explicit upstream security-update notice in the logs (Drill 6).

---

## 2. Scope and method

- **Stage 0 — infrastructure assessment:** static review of `infrastructure/cdk`, `packages/config/src/env.ts`, Dockerfiles, `deploy.yml`, host layout.
- **Stage 1 — evidence matrix inputs:** PRD §15 gates, `IMPLEMENTATION_PLAN.md` "Before production" list (L290–298), P0 backlog, `REQUIREMENTS_TRACEABILITY.md`, `UX_ACCEPTANCE_CHECKLIST.md`, `PROJECT_PROGRESS_REPORT.md`, DECISIONS open items, AGENTS invariants.
- **Stage 2 — drills executed on staging** (Section 4), read-only except one staged order cancellation (noted in Drill 6) and two image-tag switches (Drill 5).
- **Stage 3 — this report + remediation plan, sign-off table, staged rollout plan.**

Review constraints: no production environment exists yet; all live results are from staging. Staging is a 2 GB Lightsail host, so load numbers are indicative, not a production capacity certificate.

---

## 3. Test results by category

Reported separately as required by `REQUIREMENTS_TRACEABILITY.md`.

| Category                 | Command / source                            | Result                                                      | Notes                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**                 | `pnpm test` (workspace)                     | **472/472 passed**                                          | At `f25ae8b` (same tree as merge `c8da1cd`); lint 10/10, strict typecheck clean                                                                                                          |
| **Database/API e2e**     | CI `CI` run `37677172002` on `main`         | **712/712 passed, 30 specs, 5 m 36 s**                      | Runs on every push to `main`; includes isolation, RBAC, money, idempotency, state-machine suites                                                                                         |
| **Playwright (web e2e)** | Local, `desktop-chrome`, retries=0          | **customer-ordering 18/18 passed**                          | Full suite (1 304 tests) **not executed in this review and not wired into CI**; firefox/webkit projects unavailable in this environment; `menu-images` requires worker+S3 (staging-only) |
| **Accessibility (axe)**  | `playwright test e2e/accessibility.spec.ts` | **11/11 passed (2 m 24 s)**                                 | No critical violations on login, landing, menu, POS, orders, dashboard, KDS, settings, team, inventory, reports                                                                          |
| **Migrations**           | Deploy workflow run `37677171986`           | **Applied + health gate green**                             | Expand-only policy (ADR-028); migrations run pre-rollout; DB is never rolled back — rollback switch is image-only                                                                        |
| **Load (Drill 3)**       | `load/menu-read.mjs` ramp vs staging        | **0 non-200 over 3 921 requests**                           | p95 by concurrency: **316 ms @10 VU, 432 ms @25 VU, 755 ms @50 VU, 1 366 ms @100 VU**; throughput saturates ≈83 rps on the 2 GB host                                                     |
| **Restore (Drill 1)**    | Restore of nightly dump into scratch DB     | **PASS — 2 s, 0 errors, 57/57 tables identical row counts** | Live vs restored `diff` empty (2 tenants, 50 orders at review time)                                                                                                                      |

OpenAPI: Swagger is generated from the code (`/@nestjs/swagger`), but **no OpenAPI freeze/versioning has been declared** (PRD §15 gate item).

---

## 4. Drills executed (Stage 2)

| #   | Drill                                                                                                          | Result                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Restore rehearsal**                                                                                          | ✅ PASS                       | `/var/backups/rms/rms-20261007T211501Z.sql.gz` → scratch DB `rms_restore_rehearsal`: restore 2 s, 0 errors, per-table count diff empty (57 tables)                                                                                                                                                                                                                                                                                                                                |
| 2   | **Threat probes** (tenant escape, QR enumeration, tracking-token guessing, upload abuse, privilege escalation) | ✅ **12/12 PASS** + extras    | Unauth read 401; cross-branch read 404 (non-disclosing); cross-tenant `x-tenant-id` → 403 "Not a member"; bogus tenant → 403; kitchen→owner endpoints → 403 with explicit role message; bad-MIME → 400; 95 MB → 400 (limit 10 485 760 B + sha256 regex); QR resolve garbage ×3 → uniform 404, no data leak; tracking-token guess → 404, no leak; login flood → 401×10 then **429**; cancel without `expectedVersion` → 400 (stale-version protection), valid cancel → version 1→2 |
| 3   | **Load ramp (public menu read)**                                                                               | ⚠️ PASS with capacity warning | 0 errors; p95 ≤500 ms up to ~25 VU; degrades past 50 VU (see Section 3)                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | **Header/TLS matrix**                                                                                          | ⚠️ PARTIAL                    | API (Caddy+helmet): HSTS, XCTO, XFO, Referrer-Policy, COOP/CORP, correlation-id ✅. Web (Vercel): **HSTS only** (platform-level) — missing CSP, XCTO, XFO/frame-ancestors, Referrer-Policy; pages return `Access-Control-Allow-Origin: *` (needs review). TLS valid on both endpoints                                                                                                                                                                                             |
| 5   | **Rollback**                                                                                                   | ✅ PASS                       | `deploy.yml mode=rollback tag=d43cbe1`: run **16 s** (backup/build/migrate correctly skipped), health gate green, containers verified on `d43cbe1`, API ready + web 200 within **~37 s** of trigger; roll-forward to `c8da1cd`: **15 s**, healthy                                                                                                                                                                                                                                 |
| 6   | **Alerting gap / worker outage**                                                                               | ❌ GAP DEMONSTRATED           | Worker stopped 21:29:34Z, restarted cleanly (policy `unless-stopped`), but **no healthcheck, no alarm, no notification channel exists anywhere** (zero matches in CDK/docs). Order cancel enqueued `order.cancelled` → marked `UNKNOWN_TYPE` by the API outbox processor with a log line only (now 23 `UNKNOWN_TYPE` rows vs 16 `PUBLISHED`; `order.created` has been in this state since 2026-10-05). Worker logs show **Node v20.20.2 EOL notice**                              |
| 7   | **Backup freshness**                                                                                           | ✅ PASS (one check blocked)   | Root crontab `15 21 * * *` → `backup-postgres.sh`; nightly dumps present 2026-10-02 → 2026-10-07 uploaded to `s3://rms-staging-774493573289/database/`; local retention enforced. S3 lifecycle rule **unverified** — ubuntu role gets `AccessDenied` on `GetBucketLifecycleConfiguration`                                                                                                                                                                                         |

Notes:

- Drill 6's staged cancel affected one seeded staging order (`#14`, Downtown, `40915597…`, PENDING_PAYMENT → CANCELLED, reason "Production readiness alerting drill"). A side observation: the API accepted `reason` but persisted `cancellationReason: null` — suspected data-capture gap (Finding P2-2).
- Tenant context is resolved from a **client-supplied `x-tenant-id` header, always verified against an ACTIVE server-side membership** (`tenant-context.middleware.ts:55–97`). This is correct per AGENTS invariants (server-side membership check); the header is a selector, not a trust anchor.

---

## 5. Production readiness matrix

Status legend: ✅ pass · ⚠️ partial · ❌ fail/not started · ⏸ external/awaiting decision.

### 5.1 PRD §15 success and release gates

| Gate                                                                                               | Status | Evidence                                                                                                                                | Gap / next step                                                  |
| -------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ≥95% confirmed orders visible to kitchen ≤3 s (pilot connectivity)                                 | ⚠️     | Realtime WS path covered by automated e2e; no pilot-scale observation yet                                                               | Measure during pilot alpha with KDS device                       |
| Duplicate orders/payments/inventory from retry: zero                                               | ⚠️     | Idempotency-Key flows + concurrent-approval tests in e2e; sequential double-approval not re-run live                                    | Covered by automation; re-run on prod-like env                   |
| Cross-tenant incidents: zero                                                                       | ✅     | Live probes (Drill 2) + isolation e2e suites; no incidents observed                                                                     | Keep zero-tolerance regression gate in CI                        |
| Cash shifts close with immutable report                                                            | ⏸      | Implemented + unit/e2e coverage                                                                                                         | Confirm during pilot operations                                  |
| Day-close totals reconcile to fixtures/ground truth                                                | ⏸      | Automated fixture reconciliation exists                                                                                                 | Confirm with pilot ground truth                                  |
| Backup/restore, clean migrations, security hardening, OpenAPI freeze, critical Playwright journeys | ⚠️     | Backup ✅ restore ✅ migrations ✅; accessibility ✅; **headers ❌; Playwright not in CI ⚠️; no OpenAPI freeze ⚠️**                     | P0-2, P0-3, P0-6, P1-4                                           |
| UX checklist + traceability have no unresolved launch-blocking item                                | ❌     | `UX_ACCEPTANCE_CHECKLIST.md` **0/99 checked**; traceability rows REQ-001…007 Partial, NFR-004 "Hardening in progress", NFR-005 external | Product owner runs full checklist; resolve/annotate traceability |

### 5.2 IMPLEMENTATION_PLAN "Before production" (L290–298)

| Item                                                                                                                      | Status | Evidence / owner                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threat model: tenant escape, QR enumeration, tracking-token guessing, upload abuse, double approval, privilege escalation | ⚠️     | Five of six probed live and passing (Drill 2); double-approval concurrency covered by automated tests only; a **written threat-model artifact** still owed (P1-1). Owner: security-minded dev + user review |
| Review AWS IAM for least privilege                                                                                        | ⏸      | Current IAM review done for Lightsail (worker correctly denied proof-bucket access). Full AWS review only meaningful once ADR-008 stack exists. Owner: infra                                                |
| Verify staging/production separation                                                                                      | ⚠️     | One Vercel project + one host today; **no production environment exists**. Must be re-verified at AWS bring-up. Owner: infra                                                                                |
| Restore test from RDS backup                                                                                              | ⏸      | ✅ equivalent rehearsal on staging Postgres (Drill 1). RDS PITR/restore drill required after AWS bring-up. Owner: infra                                                                                     |
| Accountant confirmation for VAT/rate/receipt wording                                                                      | ⏸      | **External gate.** Owner: user + accountant. AGENTS pause condition — not decidable by the agent                                                                                                            |
| Approve proof retention/deletion + privacy operations                                                                     | ⏸      | **External gate.** Owner: user/legal. AGENTS pause condition                                                                                                                                                |
| Native-speaker approval of EN/AM/AR production copy                                                                       | ⏸      | **External gate.** Owner: user + native reviewers                                                                                                                                                           |

### 5.3 AGENTS non-negotiable invariants (spot verification)

| Invariant                                        | Status     | Evidence                                                                                |
| ------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| Tenant-scoped queries                            | ✅         | Cross-tenant probe 403 + isolation e2e                                                  |
| Branch-scoped queries                            | ✅         | Cross-branch probe 404 (non-disclosing) + branch tests                                  |
| Server-side membership check                     | ✅         | `tenant-context.middleware.ts` verified in code + live                                  |
| Opaque QR/tracking tokens                        | ✅         | Uniform 404s, no enumeration signal, token hash stored (`trackingTokenHash`)            |
| Payment proof ≠ payment confirmation             | ✅         | Approval probe: only OWNER role may approve transfers; cash-confirm paths role-gated    |
| Idempotent/transactional approval & confirmation | ✅ (tests) | Concurrent-approval e2e/unit; not re-probed live this review                            |
| KDS receives only confirmed orders               | ✅         | Outbox `order.confirmed` → ticket creation with feature-gate skip audit                 |
| Append-only inventory + same-tx balances         | ✅         | Inventory suites in CI e2e                                                              |
| Immutable snapshots for history                  | ✅         | Snapshotted prices/tax on receipt/order reads (PRD §…, tests)                           |
| Outbox after commit                              | ⚠️         | Mechanism correct, but **unhandled event types stall as `UNKNOWN_TYPE`** (Finding P1-2) |
| No full offline financial mutations              | ✅         | Not implemented (per scope)                                                             |

---

## 6. Infrastructure assessment (Stage 0 — ADR-008 AWS)

Findings against `infrastructure/cdk`:

| #    | Finding                                                                                                                                                                                                                                                                                          | Severity                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| I-1  | `cdk synth` fails: `Cannot find file …\apps\api\Dockerfile` — `fromAsset('..', { file: 'apps/api/Dockerfile' })` in `rms-stack.ts:164` resolves paths incorrectly                                                                                                                                | P0 (stack cannot deploy at all) |
| I-2  | No Redis/ElastiCache construct; no `REDIS_HOST`/`REDIS_PORT` in task env. `env.ts` defaults `REDIS_HOST=localhost` → `/health/ready` fails in Fargate → ALB health gate fails. (Rate limiter silently degrades without Redis — same silent-fallback pattern already flagged in review comments.) | P0                              |
| I-3  | `DATABASE_URL` secret wired as `fromSecretsManager(database.secret!, 'password')` — returns the password, not a URL; process-start env validation would reject it                                                                                                                                | P0                              |
| I-4  | No CloudWatch alarms, log metric filters, SNS topics, or dashboards                                                                                                                                                                                                                              | P0                              |
| I-5  | RDS: `backupRetention=7d` but **no PITR** (`backupRetention>0`, `removalPolicy`, point-in-time recovery unconfigured)                                                                                                                                                                            | P1 (production RPO decision)    |
| I-6  | Placeholder certificate ARN (`rms-stack.ts:264–268`); no Route53/ACM wiring; no WAF                                                                                                                                                                                                              | P1                              |
| I-7  | No `aws-cdk` CLI in devDependencies (synth was run via `pnpm exec` and failed anyway); no CI/CD path deploys the CDK stack                                                                                                                                                                       | P1                              |
| I-8  | `bin/cdk.ts` defaults to `environment='staging'`, region `af-south-1`; no prod guard rails / account separation                                                                                                                                                                                  | P1                              |
| I-9  | No migration runner task in the stack (deploy currently relies on host-side `deploy.yml`)                                                                                                                                                                                                        | P1                              |
| I-10 | Worker image runs **Node 20 (EOL)** — same base as API; upstream security notices in logs                                                                                                                                                                                                        | P0 (security)                   |

**Decision needed (user):** either (a) fund/execute an AWS bring-up workstream to make ADR-008 real (fix I-1…I-9, then re-run this review's drills against a staging ECS/RDS environment), or (b) record an accepted ADR to keep the current Lightsail topology for MVP and harden it (alerts, PITR-equivalent, node upgrade, separation). The review does not decide this — it changes architecture commitments in `DECISIONS.md`.

---

## 7. Findings and remediation plan

### P0 — launch blocking

| ID   | Finding                                                                                                                         | Evidence  | Fix                                                                                                                                                                 | Owner                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P0-1 | AWS stack undeployable (I-1…I-3, I-9) + no production environment                                                               | Stage 0   | Fix asset path, add Redis + env, correct secret wiring, migration task — **or** record ADR to stay on Lightsail + hardening list                                    | Infra + user decision               |
| P0-2 | Zero alerting/monitoring; no worker healthcheck; `UNKNOWN_TYPE`/`DEAD_LETTER` invisible                                         | Drill 6   | CloudWatch alarms (ALB 5xx, CPU, RDS, queue age, disk), SNS → on-call channel; worker HEALTHCHECK; alarm on `UNKNOWN_TYPE`/`DEAD_LETTER` growth and backup failures | Infra                               |
| P0-3 | Web security headers missing (CSP, XCTO, XFO/frame-ancestors, Referrer-Policy); review `Access-Control-Allow-Origin: *` on HTML | Drill 4   | Vercel `headers()` config in `next.config.js` (+ middleware CSP report-only first)                                                                                  | Web                                 |
| P0-4 | Node 20 EOL runtime                                                                                                             | Drill 6   | Move API/worker base images to supported LTS (Node 22+), rebuild, redeploy                                                                                          | Infra                               |
| P0-5 | Human gates: UX checklist 0/99; traceability Partial rows                                                                       | Stage 1   | Execute `UX_ACCEPTANCE_CHECKLIST.md` on staging devices; resolve/annotate traceability; record sign-offs                                                            | Product owner + user                |
| P0-6 | Critical Playwright journeys not in CI; full web suite unexecuted in this review                                                | Section 3 | Add Playwright (chrome project) job to CI; run full suite on staging pre-release; record firefox/webkit results on a machine with browsers                          | Dev/QA                              |
| P0-7 | External gates: VAT/accountant, proof retention/privacy, native-copy approval                                                   | §5.2      | Schedule sign-offs — **AGENTS pause conditions, not agent-decidable**                                                                                               | User (+ accountant/legal/reviewers) |

### P1 — before pilot scale

| ID   | Finding                                                                                                                                                                          | Evidence    | Fix                                                                                                                        | Owner             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| P1-1 | Written threat-model artifact missing (probes exist only in this report)                                                                                                         | §5.2        | Publish `docs/THREAT_MODEL.md` with the six vectors, mitigations, residual risks                                           | Dev + user review |
| P1-2 | Unhandled outbox types (`order.created`, `order.cancelled`, …) permanently `UNKNOWN_TYPE` — clarify intended consumers (real-time path) or register handlers; at minimum monitor | Drill 6     | Decide design intent (ADR note), add handlers or an explicit "no-op by design" registry + alarm                            | Dev               |
| P1-3 | Capacity: p95 >500 ms at ≥50 concurrent public-menu readers on 2 GB host                                                                                                         | Drill 3     | Size production ≥2 API instances / larger instance; re-run `load/menu-read.mjs` against prod; set pilot concurrency target | Infra             |
| P1-4 | No OpenAPI freeze/versioning; API_SPEC path imprecisions (approve route is `branches/:branchId/payments/:paymentId/approve`)                                                     | §3, Drill 2 | Publish versioned OpenAPI artifact in CI; fix API_SPEC                                                                     | Dev               |
| P1-5 | S3 backup lifecycle rule unverified (AccessDenied for reviewer role)                                                                                                             | Drill 7     | Verify via owner credentials; document retention (ties to P0-7 retention decision)                                         | Infra + user      |
| P1-6 | Production RPO/RTO targets undefined; no PITR                                                                                                                                    | I-5         | Decide RPO (e.g., PITR ≤5 min) in ADR; rehearse RDS restore post-bring-up                                                  | Infra + user      |

### P2 — fix opportunistically

| ID   | Finding                                                                                                | Evidence | Fix                                            |
| ---- | ------------------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------- |
| P2-1 | 403 messages distinguish "tenant not found" vs "not a member" (UUID-existence oracle; negligible risk) | Drill 2  | Optionally unify message                       |
| P2-2 | Order cancel accepted `reason` but persisted `cancellationReason: null`                                | Drill 6  | Check `CancelOrderDto` field mapping; add test |
| P2-3 | `PROJECT_PROGRESS_REPORT.md` claims final browser tests incomplete and contains encoding mojibake      | Stage 1  | Refresh report after P0-6                      |

### Accepted risks (documented, not blocking)

- Login rate limit is per IP+tenant+user (10/min); acceptable for MVP; revisit under real traffic.
- Payment-proof files private (pre-signed, CLEAN-only reads) — no change.
- Full offline financial mutations remain out of scope (ADR scope cut).

---

## 8. Staged rollout plan

| Stage                         | Entry criteria                                            | Scope                                                                                                          | Abort criteria                                       |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **R0 — Harden staging**       | P0-1 topology decision recorded; P0-2…P0-4 merged         | Re-run drills 2/4/6 on staging until green                                                                     | Alerting or headers regress                          |
| **R1 — Sign-offs**            | P0-5 checklist executed; P0-7 external approvals recorded | Freeze EN/AM/AR copy, VAT wording, retention policy                                                            | Any launch-blocking checklist item open              |
| **R2 — Production bring-up**  | R0+R1; ADR executed (AWS or Lightsail-hardened)           | Restore drill on production-grade backup; load test (P1-3); CI Playwright gate (P0-6)                          | Restore or load gate fails                           |
| **R3 — Internal alpha**       | R2 green                                                  | Staff devices only, one branch, real menu, daily debrief; verify kitchen ≤3 s gate                             | Data incident, duplicate money events, >1 h downtime |
| **R4 — Pilot (1 restaurant)** | ≥3 stable alpha days                                      | Cash + manual transfer only (provider integration later), pilot KDS gate measurement, day-close reconciliation | Any PRD §15 zero-tolerance violation                 |
| **R5 — Expand**               | Pilot week signed by user                                 | Additional branches/tenants                                                                                    | —                                                    |

---

## 9. Sign-off

| Role          | Name | Scope                                      | Date | Signature |
| ------------- | ---- | ------------------------------------------ | ---- | --------- |
| Product owner |      | UX checklist, traceability, native copy    |      |           |
| Founder/CEO   |      | This report + rollout plan                 |      |           |
| Accountant    |      | VAT applicability/rate/receipt wording     |      |           |
| Legal/privacy |      | Proof retention/deletion, privacy ops      |      |           |
| Infra owner   |      | P0-1 topology, P0-2 alerting, P0-4 runtime |      |           |

---

## Appendix A — Evidence index

- Merge/CI: PR #11 → `c8da1cd`; CI run `37677172002` (success, 5 m 36 s); deploy run `37677171986` (17 m 27 s, migrations + health gate green).
- Rollback drill: run `37690466532` (`tag=d43cbe1`, 16 s); roll-forward run `37690567821` (`tag=c8da1cd`, 15 s).
- Backups: crontab `15 21 * * * /opt/rms/deploy/lightsail/backup-postgres.sh`; S3 `s3://rms-staging-774493573289/database/` (dumps `rms-2026100{2..7}T2115*.sql.gz`).
- Restore: scratch DB `rms_restore_rehearsal`, counts diff empty (57 tables).
- Probes: results table in Section 4 (12/12 + rate-limit 429 + optimistic-lock checks); role accounts from `docs/STAGING_DEPLOYMENT.md`.
- Load: `load/menu-read.mjs` (committed with this report).
- Outbox: `apps/api/src/modules/outbox/outbox.processor.ts` (handlers: `order.confirmed`, `menu.image.process_requested` only); `UNKNOWN_TYPE` rows = 23 at 2026-10-07T21:30Z.
- Accessibility: `apps/web/e2e/accessibility.spec.ts` — 11 passed.

## Appendix B — Environment facts discovered

- Staging DB: database `rms`, role `rms_app` (role `rms` does not exist); PascalCase Prisma tables; tenants `Demo Coffee House` (`8964dd21…`, branches `main`→`main-branch` public slug, `downtown`) and `QA Cross Tenant` (`9120a260…`, no branch).
- Staff accounts: six phone accounts `+251900000001…06` (see `docs/STAGING_DEPLOYMENT.md` L116–123); memberships ACTIVE as expected.
- Worker/API restart policy: `unless-stopped`; only api/postgres/redis have Docker healthchecks.
- CI runs API e2e only (`ci.yml` comment at L86–88); web Playwright is manual.
