# Concurrent Development Ownership

This repository is being developed concurrently by a backend agent (OpenCode) and a frontend agent (Codex). Follow these boundaries to prevent overlapping edits and difficult merges.

## Backend Agent: OpenCode

OpenCode owns:

- `apps/api/**`
- `apps/worker/**`
- `packages/database/**`
- `packages/config/**`
- `packages/observability/**`
- `infrastructure/**`
- Backend integration and security tests
- Database migrations and seed data

OpenCode must not edit frontend-owned paths unless the user explicitly reassigns the work.

## Frontend Agent: Codex

Codex owns:

- `apps/web/**`
- `packages/ui/**`
- `apps/web-e2e/**` if created
- `assets/**` when assets are exclusively for the frontend
- Frontend component, accessibility, visual, and Playwright tests

Codex must not edit backend-owned paths to make frontend code pass. Backend defects or missing contracts must be reported through an agreed contract change.

## Shared Paths Requiring Coordination

Neither agent should change these casually:

- `packages/contracts/**`
- Root workspace configuration such as `package.json`, `pnpm-lock.yaml`, `turbo.json`, and `tsconfig.base.json`
- `.github/workflows/**`
- Architecture and product Markdown files

For a shared-path change:

1. State the required contract or configuration change.
2. Keep the change minimal and backward compatible where practical.
3. Notify the other agent before it rebases or merges.
4. Regenerate and commit the lockfile when dependency declarations change.

## Branch and Worktree Rules

- Backend work continues on feature branches created from `main`; do not develop directly on `main` after the baseline commit.
- Frontend work uses `codex/frontend` in a separate worktree.
- Each branch commits only its owned files plus explicitly coordinated shared changes.
- Rebase or merge from `main` before opening a pull request.
- Never use destructive resets to resolve concurrent work.
- Do not commit `.env`, credentials, generated build output, logs, or `node_modules`.

## Frontend Contract Strategy

Until backend endpoints stabilize, frontend work should use:

- A typed API client boundary in `apps/web`.
- Mock fixtures/adapters that implement the same frontend-facing interfaces.
- Centralized route and DTO mapping rather than fetch calls scattered through components.
- Explicit loading, empty, error, unauthorized, conflict, and disconnected states.

Changes required in `packages/contracts` should be proposed as small, isolated commits so OpenCode can review and consume them safely.
