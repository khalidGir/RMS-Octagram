# RMS Development Guide

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker (for PostgreSQL)

### Setup

```bash
# Install dependencies
pnpm install

# Start local database
docker compose up -d

# Set up environment
cp .env.example .env.local
# Edit .env.local with your values

# Generate Prisma client
pnpm db:generate

# Run database migrations
pnpm db:migrate

# Seed demo data
pnpm db:seed

# Start development servers
pnpm dev
```

### Services

- **Web** (Next.js): http://localhost:3000
- **API** (NestJS): http://localhost:3001
- **API Docs**: http://localhost:3001/docs
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.

## Documentation

| Document | Purpose |
| :--- | :--- |
| [product-requirements-document.md](product-requirements-document.md) | Product scope and requirements |
| [DECISIONS.md](DECISIONS.md) | Architecture decisions |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Database schema |
| [RBAC.md](RBAC.md) | Role-based access control |
| [WORKFLOWS.md](WORKFLOWS.md) | Product workflows |
| [API_SPEC.md](API_SPEC.md) | REST API specification |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Delivery plan |

## Available Scripts

| Script | Description |
| :--- | :--- |
| `pnpm dev` | Start all dev servers (web + API) |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run all tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run Prisma migrations (dev) |
| `pnpm db:migrate:deploy` | Deploy Prisma migrations (production) |
| `pnpm db:seed` | Seed database |
| `pnpm db:studio` | Open Prisma Studio |
| `docker compose up -d` | Start PostgreSQL and Redis |
| `docker compose down` | Stop PostgreSQL and Redis |
