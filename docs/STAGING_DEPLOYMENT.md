# RMS Lightsail Staging Deployment

## Purpose

This environment supports integration, demonstrations, and controlled pilot validation. It is not the production topology described by ADR-008 and must not be represented as highly available.

## Topology

- Vercel hosts the Next.js frontend.
- One Amazon Lightsail 2 GB Ubuntu instance runs Caddy, the NestJS API, PostgreSQL 16, and Redis 7.
- A private S3 bucket stores payment proofs and encrypted database backups.
- Only TCP 80, TCP 443, UDP 443, and restricted SSH are public.
- PostgreSQL and Redis are reachable only on an internal Docker network.

## First deployment

1. Create the AWS monthly budget before provisioning resources.
2. Launch a 2 GB Ubuntu Lightsail instance and attach a static IP.
3. Permit HTTP/HTTPS and restrict SSH in the Lightsail firewall.
4. Create a private, encrypted S3 bucket with public access blocked.
5. Create least-privilege credentials limited to proof and backup prefixes.
6. Install Docker Engine, the Compose plugin, AWS CLI, and unattended security updates.
7. Clone the repository to `/opt/rms` and check out the approved deployment commit.
8. Copy `deploy/lightsail/.env.example` to `deploy/lightsail/.env`, set mode `0600`, and populate secrets.
9. Run `docker compose --env-file .env build api`.
10. Run `docker compose --env-file .env --profile tools run --rm migrate`.
11. Run `docker compose --env-file .env run --rm -e NODE_ENV=development api pnpm --filter @rms/database seed` for demo data. Skip this step for a clean staging database; the seed script refuses to run while `NODE_ENV=production`.
12. Run `docker compose --env-file .env up -d postgres redis api caddy`.
13. Point the API DNS record at the static IP and verify Caddy obtains a certificate.

## Deployment update

1. Take and upload a database backup.
2. Fetch the approved commit.
3. Build the API image with a unique commit tag.
4. Run backward-compatible migrations.
5. Replace the API container.
6. Require `/api/v1/health/live` and `/api/v1/health/ready` to pass.
7. Run the smoke-test checklist.

Keep the previous image tag until verification is complete. Roll back the API image if health checks fail. Restore the database only for an explicitly identified incompatible migration.

## Backup and recovery

- Run `backup-postgres.sh` nightly from root's crontab after loading `.env`.
- Store backups under the S3 `database/` prefix with server-side encryption.
- Configure S3 lifecycle retention for seven daily and four weekly recovery points.
- Perform and document a restore rehearsal before using the environment for pilot data.

## Required validation

- Authentication, refresh, logout, and tenant context
- Cross-tenant and cross-branch denial
- POS order creation and cash shift flow
- Private payment-proof upload and owner review
- KDS WebSocket connection, reconnect, and authoritative refetch
- Expo and waiter workflow
- Restart persistence for PostgreSQL and Redis
- Backup upload and clean restore

## Phone-auth staging rollout (ADR-025)

### Deployment order

1. Record the currently deployed commit (`git rev-parse --short HEAD` on the server) and take a fresh PostgreSQL backup (see below). Do not reset, drop, or recreate the staging database.
2. Deploy the API first — it accepts both phone and the deprecated `email` property during the compatibility window.
3. Require `/api/v1/health/live` and `/api/v1/health/ready` to return 200.
4. Confirm the existing (email) frontend can still authenticate against the new API.
5. Backfill phones: run the idempotent seed — `docker compose --env-file .env run --rm -e NODE_ENV=development api pnpm --filter @rms/database seed`. It only fills missing `phoneE164` values; it never overwrites or creates users.
6. Verify backfill (see queries below): 6 users, 6 with phone, 0 without, no duplicates, memberships/branch assignments unchanged.
7. Test all six phone/password logins directly against the public API.
8. Deploy the frontend to Vercel with `NEXT_PUBLIC_API_URL=https://100.57.8.66.nip.io/api/v1`.
9. Verify CORS from the Vercel origin, then all six logins through the browser UI, role landing pages, and branch restrictions.
10. Confirm the login UI has no email field and no "Buna House" branding, and that WebSocket-authenticated KDS, Expo, and Waiter screens still connect.
11. After staging verification passes, remove the temporary `email` compatibility from `LoginDto`/`AuthService.login` in a follow-up commit.

### Verification queries

Run on the server (`docker compose --env-file .env exec postgres psql -U rms -d rms`):

```sql
SELECT count(*) AS total FROM "User";                          -- expect 6
SELECT count(*) AS with_phone FROM "User" WHERE "phoneE164" IS NOT NULL;  -- expect 6
SELECT count(*) AS without_phone FROM "User" WHERE "phoneE164" IS NULL;   -- expect 0
SELECT "phoneE164", count(*) FROM "User" GROUP BY "phoneE164" HAVING count(*) > 1;  -- expect 0 rows
SELECT u."email", m."role", count(a."branchId") AS branches
FROM "User" u JOIN "TenantMembership" m ON m."userId" = u."id"
LEFT JOIN "BranchAssignment" a ON a."membershipId" = m."id"
GROUP BY u."email", m."role";                                  -- unchanged from pre-backfill
```

### Rollback

- API: keep the previous image tag until verification completes; redeploy it if health checks or login smoke tests fail (`docker compose --env-file .env up -d api` with the prior tag).
- Frontend: `vercel rollback` or redeploy the previous Vercel deployment.
- Database: restore only from the pre-rollout S3 backup and only if the migration itself is incompatible; otherwise leave data alone — the rollout adds nullable `phoneE164` values and no destructive change.
- The email-compat window means either frontend generation works against either API generation during the rollout.

### Staging QA accounts

| Role | Phone | Password |
|---|---|---|
| Super Admin | `+251900000001` | `admin123` |
| Owner | `+251900000002` | `owner123` |
| Manager | `+251900000003` | `manager123` |
| Cashier | `+251900000004` | `cashier123` |
| Kitchen Staff | `+251900000005` | `kitchen123` |
| Waiter | `+251900000006` | `waiter123` |

These credentials are for staging only and **must be rotated before any external pilot**.

### Known tracked issues from the release gate

- `multi-kitchen-migration.e2e-spec.ts` moved to `test/migration/` and now runs via `pnpm --filter @rms/api test:migration` against a dedicated replay database (migrations 1–23 → pre-migration fixture → target migration). Root cause: global branch-invariant scans are state-dependent — production `createBranch`, `seed.ts`, and ~45 test fixtures create branches without a Main Kitchen/policy. Product fix (provision kitchen+policy on branch creation) is a tracked follow-up; see DECISIONS.md ADR-025 context and the release report.
- Full Playwright `desktop-chrome` run (144 tests) was interrupted by local Next.js dev-server memory exhaustion during the release window; server-side phone-auth coverage (627/627 API tests) and the dedicated `phone-login.spec.ts` UI checks are green. Re-run the full suite before the pilot.
- Browser session persistence: the boot-time `/auth/refresh` originally sent no `x-csrf-token`, so any hard navigation returned 403 and forced re-login (local e2e never caught this because `e2e/fixtures.ts` stubs `/auth/refresh`). Fixed by persisting the CSRF token in `localStorage` (`rms.csrfToken`) in `auth-provider.tsx`; logout clears it. Follow-up: replace the refresh stub in e2e fixtures with a real cookie+CSRF round trip.
- `/waiter` crashed with `useBranch must be used inside BranchProvider` because the page rendered `WaiterWorkspace` without `StaffShell`. Fixed by wrapping it like the other staff pages.
- CORS rejects disallowed origins by throwing from the origin callback, which surfaces as HTTP 500 + ERROR logs (secure, but noisy). Tracked cosmetic follow-up: return a non-allowed response without throwing.



## Production migration triggers

Move PostgreSQL to RDS and Redis to a managed service before real restaurant operations depend on the environment, before multiple API replicas, or whenever recovery/availability guarantees are required.
