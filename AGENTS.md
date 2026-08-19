# Implementation Agent Instructions

## Mission

Implement the RMS MVP described by `product-requirements-document.md` using the contracts and sequencing in the architecture package. Treat these documents as implementation requirements, not loose inspiration.

## Read Before Coding

Read these files in order:

1. `product-requirements-document.md`
2. `DECISIONS.md`
3. `ARCHITECTURE.md`
4. `DATABASE_SCHEMA.md`
5. `RBAC.md`
6. `WORKFLOWS.md`
7. `API_SPEC.md`
8. `IMPLEMENTATION_PLAN.md`

If documents conflict, use this precedence:

1. Latest explicit user instruction.
2. Accepted decision in `DECISIONS.md`.
3. Security, isolation, and financial invariants in the architecture documents.
4. Product requirements.
5. Implementation convenience.

Do not silently resolve a conflict that changes money, permissions, tenant isolation, payment confirmation, inventory timing, or MVP scope. Record a proposed ADR or ask for direction.

## Required Stack

- TypeScript throughout application and infrastructure code.
- pnpm workspaces and Turborepo.
- Next.js PWA in `apps/web`.
- NestJS modular-monolith API in `apps/api`.
- NestJS background worker in `apps/worker`.
- Prisma and PostgreSQL in `packages/database`.
- AWS CDK in `infrastructure/cdk`.
- Vercel frontend deployment and AWS ECS/RDS/S3/SQS backend deployment.

Do not replace core stack choices without adding an accepted architecture decision.

## Implementation Rules

- Use 2-space indentation unless generated tooling has a fixed convention.
- Enable strict TypeScript and avoid `any`; isolate unavoidable unsafe boundaries.
- Keep domain logic outside controllers, React components, and Prisma model wrappers.
- Keep modules independent: another module may call a public service/port, not its repositories.
- Validate environment variables at process startup.
- Validate all external input and serialize all API output.
- Generate OpenAPI from the API implementation and keep examples current.
- Use migrations for schema changes; never use destructive schema synchronization in shared environments.
- Keep secrets and credentials out of source control and client bundles.
- Store all times in UTC and use branch timezone for display/report boundaries.
- Store money as integer minor units with ISO currency codes.
- Never trust client-submitted prices, totals, tenant IDs, roles, or status values.
- Add correlation IDs and structured logs to HTTP, WebSocket, and job paths.

## Non-Negotiable Invariants

1. Every tenant-owned query is tenant scoped.
2. Every branch-owned query is tenant and branch scoped.
3. Branch access is verified from server-side membership assignments.
4. Customer QR/tracking tokens are opaque, high-entropy, revocable, and never logged in full.
5. Payment proof remains private and does not itself confirm payment.
6. Only an authorized cashier/manager/owner or verified future provider webhook can approve payment.
7. Payment approval and order confirmation are idempotent and transactional.
8. KDS receives only confirmed orders.
9. Inventory movements are append-only and balances update in the same transaction.
10. Historical order names and prices come from immutable snapshots.
11. External events/jobs are published through an outbox after commit.
12. Full offline financial/order mutations are not part of the MVP.

## Work Protocol

For each implementation phase:

1. Restate the phase scope and acceptance criteria.
2. Inspect existing code and migrations before editing.
3. Implement the smallest complete vertical slice.
4. Add or update authorization and isolation tests with the feature.
5. Run lint, type checks, tests, migration validation, and builds.
6. Update OpenAPI and relevant documentation.
7. Report completed criteria, commands run, failures, assumptions, and remaining risks.

Do not claim a phase complete while tests are failing or required behavior is represented only by placeholders.

## Change Control

- Add new architectural decisions to `DECISIONS.md` with status, decision, reason, and consequences.
- Keep edits to architecture documents deliberate; do not rewrite them merely to match accidental implementation choices.
- A scope-saving simplification must preserve security and data integrity and be documented.
- Preserve backward compatibility during deployed database migrations using expand/migrate/contract sequencing.

## Testing Requirements

- Every protected endpoint: allowed role, denied role, cross-branch denial, and cross-tenant denial.
- Every state machine: valid transitions, invalid transitions, duplicate request, and stale version.
- Every money flow: server calculation and integer invariants.
- Payment approval: concurrent/double approval and failure rollback.
- Inventory: duplicate event and compensating void movement.
- Real-time screens: reconnect and authoritative refetch.
- Critical user journeys: Playwright tests listed in `IMPLEMENTATION_PLAN.md`.

## Pause Conditions

Stop and request a product decision before finalizing a feature when required behavior depends on:

- Tax/VAT/service-charge law or receipt compliance.
- Whether dine-in orders may enter the kitchen before payment.
- A specific payment provider's API or webhook contract.
- Fiscal printer or cash-register hardware.
- Refund/discount authorization thresholds.
- Payment-proof retention requirements.

You may scaffold interfaces and adapters around an unresolved decision, but do not invent legally or financially significant rules.

## Initial Task

Start with Phase 0 in `IMPLEMENTATION_PLAN.md`. Do not build feature screens until the workspace, CI, local dependencies, health checks, environment validation, and staging deployment skeleton are sound.
