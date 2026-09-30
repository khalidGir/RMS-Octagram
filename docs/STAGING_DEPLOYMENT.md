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

## Production migration triggers

Move PostgreSQL to RDS and Redis to a managed service before real restaurant operations depend on the environment, before multiple API replicas, or whenever recovery/availability guarantees are required.
