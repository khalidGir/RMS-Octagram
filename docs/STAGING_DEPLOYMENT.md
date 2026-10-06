# RMS Lightsail Staging Deployment

## Purpose

This environment supports integration, demonstrations, and controlled pilot validation. It is not the production topology described by ADR-008 and must not be represented as highly available.

## Topology

- Vercel hosts the Next.js frontend.
- One Amazon Lightsail 2 GB Ubuntu instance runs Caddy, the NestJS API, the menu-image worker (ADR-027), PostgreSQL 16, and Redis 7.
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

## Deployment update (automated)

Backend deployments run through `.github/workflows/deploy.yml` (ADR-028):

1. **Trigger:** a merge to `main` touching `apps/api`, `apps/worker`, `packages`, `deploy/`, a `Dockerfile`, or the workflow itself — or a manual _Run workflow_ (Actions → _Deploy staging_). Frontend-only merges do not redeploy the backend.
2. **Runner:** the self-hosted runner `rms-staging-1` on this host (`/opt/actions-runner`, systemd unit `actions.runner.khalidGir-RMS-Octagram.rms-staging-1.service`, enabled at boot, labels `self-hosted,staging`). The host has no public SSH endpoint, so jobs execute on the host itself — which is why the workflow uses no `actions/checkout` and works against the long-lived `/opt/rms` tree (it holds the server-only `.env`).
3. **Sequence:** record the running image tags → `git fetch --prune` + `checkout --detach` of the target SHA in `/opt/rms` (aborts if the tree is not clean) → `backup-postgres.sh` (pg_dump → S3) → `docker compose build api worker` tagged with the short SHA → `prisma migrate deploy` → `up -d api worker` → health gate: container health + `/health/ready` inside the container + worker running without the `SQS_QUEUE_URL is not set` idle warning + an edge request through Caddy.
4. **Automatic rollback:** any failure at or after rollout re-ups the previous image tags and re-runs the health gate. Migrations are expand-only, so the database is never rolled back automatically; restore the database only for an explicitly identified incompatible migration.
5. **Manual deploy/rollback:** _Run workflow_ with `mode=deploy` (builds and rolls out the selected ref) or `mode=rollback` + `tag=<short-sha>` (switches to an image that still exists on the host — no rebuild, no migrations). Every run writes a job summary with mode, target, previous images, and both gate outcomes.
6. **Branch protection:** `main` requires a pull request and a green `build` check from `ci.yml`; force-pushes and deletions are blocked.

Operational notes:

- The checkout step runs `git fetch --prune origin`, so `remote.origin.fetch` in `/opt/rms` must be the default `+refs/heads/*:refs/remotes/origin/*` refspec. A narrowed refspec (e.g. tracking a single old branch) silently never updates `main` and the deploy fails with `reference is not a tree`. Check with `git -C /opt/rms config --get-all remote.origin.fetch`.
- The runner user must own the backup directory: `chown ubuntu:ubuntu /var/backups/rms && chmod 700 /var/backups/rms` (`backup-postgres.sh` writes there from the job; root's cron keeps working because it bypasses permissions).
- `/opt/rms` must stay clean — the job aborts on unexpected local changes. Server-side `.env` backups live outside the tree in `/var/backups/rms/env/` (mode `0600`), never next to repository files.
- `core.filemode=false` is set for `/opt/rms`; script executability comes from the committed mode, not from local `chmod`.
- Runner maintenance: `sudo systemctl restart actions.runner.khalidGir-RMS-Octagram.rms-staging-1.service`; the runner auto-updates between jobs, and a fresh registration token is needed after a host rebuild (Actions → Settings → Runners).
- Run the smoke-test checklist after unusual changes (schema, auth, payments) even when the health gate is green.

### Deployment source and image pinning

Deployments always come from a merged commit on `main`, never from a feature branch: the workflow checks out the pushed SHA and tags images with its short SHA (verify with `git rev-parse --short HEAD` on the server). The workflow passes `IMAGE_TAG` per run and overrides any persisted value; for manual `docker compose up -d api` restarts, pin `IMAGE_TAG=<commit>` in `deploy/lightsail/.env` (back it up first: `cp -p .env .env.<previous-tag>`, mode `0600`) so restarts keep serving the reviewed build, and roll back by restoring the previous tag.

The frontend deploys from `main` too: the Vercel project `rms-staging` is connected to this repository with production branch `main`, so merges trigger deployments — verify `vercel ls` shows a deployment newer than the merge.

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
- Menu photo upload: intent → direct S3 upload → finalize → worker → `READY` in the UI; DLQ stays empty
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

| Role          | Phone           | Password     |
| ------------- | --------------- | ------------ |
| Super Admin   | `+251900000001` | `admin123`   |
| Owner         | `+251900000002` | `owner123`   |
| Manager       | `+251900000003` | `manager123` |
| Cashier       | `+251900000004` | `cashier123` |
| Kitchen Staff | `+251900000005` | `kitchen123` |
| Waiter        | `+251900000006` | `waiter123`  |

These credentials are for staging only and **must be rotated before any external pilot**.

### Known tracked issues from the release gate

- `multi-kitchen-migration.e2e-spec.ts` moved to `test/migration/` and now runs via `pnpm --filter @rms/api test:migration` against a dedicated replay database (migrations 1–23 → pre-migration fixture → target migration). Root cause: global branch-invariant scans are state-dependent — production `createBranch`, `seed.ts`, and ~45 test fixtures create branches without a Main Kitchen/policy. Product fix (provision kitchen+policy on branch creation) is a tracked follow-up; see DECISIONS.md ADR-025 context and the release report.
- Full Playwright `desktop-chrome` run (144 tests) was interrupted by local Next.js dev-server memory exhaustion during the release window; server-side phone-auth coverage (627/627 API tests) and the dedicated `phone-login.spec.ts` UI checks are green. Re-run the full suite before the pilot.
- Browser session persistence: the boot-time `/auth/refresh` originally sent no `x-csrf-token`, so any hard navigation returned 403 and forced re-login (local e2e never caught this because `e2e/fixtures.ts` stubs `/auth/refresh`). Fixed by persisting the CSRF token in `localStorage` (`rms.csrfToken`) in `auth-provider.tsx`; logout clears it. Follow-up: replace the refresh stub in e2e fixtures with a real cookie+CSRF round trip.
- `/waiter` crashed with `useBranch must be used inside BranchProvider` because the page rendered `WaiterWorkspace` without `StaffShell`. Fixed by wrapping it like the other staff pages.
- CORS rejects disallowed origins by throwing from the origin callback, which surfaces as HTTP 500 + ERROR logs (secure, but noisy). Tracked cosmetic follow-up: return a non-allowed response without throwing.
- Public menu price contract: both public menu endpoints serialize display prices as `priceMinor`, but the POS, public pickup menu, and customer menu read `basePriceMinor`, which crashed every menu with `Cannot convert undefined to a BigInt`. Fixed in `ffa295f` by mapping `priceMinor` → `basePriceMinor` once at the fetch boundary (`src/lib/public-menu.ts` `normalizePublicMenu`).
- Customer ordering links were unresolvable on staging: seed branches had `publicSlug = NULL` and `PublicContextService.ensurePublicSlug` has no callers. `main-branch` was assigned to Main Branch so `/r/main-branch` and `/order/main-branch` resolve. Follow-up: wire slug generation into the share-link flow or seed slugs.
- Anonymous boot-time `POST /auth/refresh` (no refresh cookie yet) returns HTTP 400 and is caught client-side — harmless log noise. Follow-up: answer a missing session with 204/401 instead of 400.
- Live verification on 2026-10-01 (frontend `https://rms-staging-chi.vercel.app`, API image `rms-api:e03c49b`): all six staging phone accounts log in and land on their role pages with reload persistence; cashier POS renders prices (6 on load and after reload, no page errors); customer and pickup menus render prices and add-to-cart subtotals; Kitchen Display, Expo, and Waiter pages render; WebSocket connects (`engine.io` handshake → `kds` namespace → `branch:` room join); login throttle returned 401 ×10 then 429 on attempt 11.

## Menu item photo pipeline (ADR-027)

Menu photos flow through finalize (outbox) → SQS → the `worker` service. Complete these steps before enabling photo upload.

### One-time AWS setup

1. Create the queue and its dead-letter queue. No static AWS credentials live in the repository; they are stored only in the server's `.env` (see below) or replaced by a least-privilege host credential:

   ```sh
   aws sqs create-queue --queue-name rms-staging-dlq \
     --attributes '{"MessageRetentionPeriod":"1209600"}'
   DLQ_ARN=$(aws sqs get-queue-arn --queue-name rms-staging-dlq)
   aws sqs create-queue --queue-name rms-staging \
     --attributes "{\"RedrivePolicy\":{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"},\"VisibilityTimeout\":\"300\"}"
   ```

2. Create the private media bucket and allow browser direct uploads from the frontend origins only:

   ```sh
   aws s3api create-bucket --bucket "$S3_MEDIA_BUCKET" --region "$S3_REGION" \
     --create-bucket-configuration LocationConstraint="$S3_REGION"
   aws s3api put-bucket-cors --bucket "$S3_MEDIA_BUCKET" --cors-configuration '{
    "CORSRules": [{
      "AllowedMethods": ["POST", "PUT"],
      "AllowedOrigins": ["https://rms-staging-chi.vercel.app", "https://100.57.8.66.nip.io"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag", "x-amz-request-id"],
      "MaxAgeSeconds": 3600
    }]
   }'
   ```

3. Point `MEDIA_CDN_URL` at a CloudFront distribution (or equivalent) whose origin is the media bucket. The API exposes image URLs of the shape `<MEDIA_CDN_URL>/menu-items/<itemId>/<token>-<contentHash>/<width>x<height>.webp`, while the worker stores those objects under the bucket's `public/` prefix — the distribution must map that path onto `public/...` (for example with origin path `/public`). The CDN serves them, the bucket stays private, and neither tenant nor media object IDs appear in URLs.

### Server configuration

- Populate `deploy/lightsail/.env` on the host only (mode `0600`, mechanism from step 8 of _First deployment_). It is never committed and never rendered into images; `deploy/lightsail/.env.example` carries placeholder names only.
- Media/SQS variables: `S3_MEDIA_BUCKET`, `MEDIA_CDN_URL` (API and worker), `SQS_QUEUE_URL`, `SQS_REGION` (API outbox dispatcher and worker), plus `S3_ENDPOINT`/`SQS_ENDPOINT` for non-AWS local services (omit on real AWS). `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in that `.env` must stay least-privilege (media bucket prefixes plus SQS send/receive on the two queues) — or be replaced by a secured host-level credential mechanism; neither option puts keys in version control.
- Blank values are treated as unset (Docker Compose renders unset variables as empty strings), so these keys may be omitted entirely until the pipeline is provisioned: the API and worker boot cleanly, and upload intents return `503` until `S3_MEDIA_BUCKET` is configured. Menu images never fall back to the payment-proof bucket.

### Bring-up and update

1. Create the queue, DLQ, bucket, and CORS rules (above).
2. `docker compose --env-file .env build api worker`
3. Run backward-compatible migrations (`--profile tools run --rm migrate`) when the release contains schema changes.
4. `docker compose --env-file .env up -d postgres redis api worker caddy`
5. Require `/api/v1/health/live` and `/api/v1/health/ready` to pass, then confirm the worker log reports its SQS consumer started (a missing `SQS_QUEUE_URL` logs a warning and leaves jobs safely pending).

### Validation

- Owner/Manager uploads a JPEG ≤ 10 MB on `/menu`; the item card shows the photo once status reaches `READY`.
- A GIF or oversized file is rejected client-side; forcing the request returns `400`.
- `aws sqs get-queue-attributes --queue-name rms-staging --attribute-names ApproximateNumberOfMessages` stays near zero after uploads, and the DLQ stays empty.
- Restart the worker mid-upload: the row's 240 s lease expires, the janitor reclaims it, and the photo still completes.

## Production migration triggers

Move PostgreSQL to RDS and Redis to a managed service before real restaurant operations depend on the environment, before multiple API replicas, or whenever recovery/availability guarantees are required.
