# Restaurant Management System (RMS)

Architecture and implementation specifications for a multi-tenant, multi-branch restaurant management, POS, customer ordering, payment verification, kitchen, inventory, and reporting platform.

## Architecture Package

| Document | Purpose |
| :--- | :--- |
| [`product-requirements-document.md`](product-requirements-document.md) | Approved product scope and initial requirements. |
| [`DECISIONS.md`](DECISIONS.md) | Accepted architecture decisions and open product decisions. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Technology stack, system boundaries, deployment, security, and MVP scope. |
| [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) | PostgreSQL entities, constraints, indexes, isolation, and transaction boundaries. |
| [`RBAC.md`](RBAC.md) | Roles, permissions, branch scope, and authorization rules. |
| [`WORKFLOWS.md`](WORKFLOWS.md) | Order, payment, KDS, inventory, provisioning, and reporting workflows. |
| [`API_SPEC.md`](API_SPEC.md) | REST/WebSocket contract, endpoint inventory, errors, and API conventions. |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Phased 4-6 week delivery plan, testing, priorities, and launch gates. |
| [`AGENTS.md`](AGENTS.md) | Binding implementation instructions for coding agents. |

## Selected Stack

- Next.js TypeScript PWA deployed to Vercel.
- NestJS modular-monolith API and worker deployed to AWS ECS Fargate.
- Amazon RDS PostgreSQL, private S3 storage, and SQS.
- Prisma, pnpm workspaces, Turborepo, AWS CDK, and GitHub Actions.

## Implementation Start

An implementation agent must read `AGENTS.md` and the linked documents before changing code, then begin with Phase 0 in `IMPLEMENTATION_PLAN.md`.

The implementation must not assume final Ethiopian tax/receipt rules or a specific electronic payment provider. Bank/Telebirr proof with Owner approval and cash confirmation through an active Cashier/Owner shift are the pilot workflows; `ETB` is the default currency and `Africa/Addis_Ababa` is the default operational timezone.
