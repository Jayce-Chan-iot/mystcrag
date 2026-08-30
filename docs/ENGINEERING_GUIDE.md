# Engineering Guide

## Prerequisites

- Node.js 22 or newer
- pnpm 11
- PostgreSQL for database-backed work

Copy `.env.example` to `.env` for local development. Never commit `.env`.

`pnpm install --frozen-lockfile` runs the root `postinstall` lifecycle and generates the
ignored Prisma Client in `packages/database/generated`. CI and local installs must not use
`--ignore-scripts`. The generated directory is disposable build output and is never committed.

## Commands

- `pnpm dev`: run application development processes.
- `pnpm lint`: run workspace static checks.
- `pnpm typecheck`: check strict TypeScript contracts.
- `pnpm test`: run architecture and module tests.
- `pnpm build`: produce application builds and validate packages.
- `pnpm validate`: run the complete handoff gate.

The root lint, typecheck, test, build, and validate commands run Prisma generation once before
starting Turborepo. Extra Turbo flags are forwarded to every selected task, so
`pnpm build --force` bypasses the build cache and `pnpm validate --force` bypasses the cache for
lint, typecheck, test, and build while keeping those gates sequential.

Database commands run from `packages/database`: `pnpm db:format`, `pnpm db:generate`, and `pnpm db:migrate`.

## FEAT-018 identity verification

- `pnpm exec playwright test --config tests/auth-e2e/playwright.config.mts` runs the 54-test isolated identity/session security and full-loop gate. It creates a run-scoped database, provider, ports, processes and build checkout; teardown must record `stoppedAt`, exit every owned process, release every owned port, drop and verify the database gone, and pass the artifact secret scan.
- A fresh persistence replay uses a uniquely named empty `mystcrag_*test*` database with `TEST_DATABASE_URL=... pnpm db:test`. Drop only that run-owned database after verification and confirm it no longer exists.
- Production builds must reject `signed-test`, missing Auth0 configuration, loopback/wildcard production values and weak session secrets. Browser clients use only same-origin `/api/**`; reusable Tokens must not appear in browser storage, HTML/RSC payloads, URLs or client bundles.
- The CI workflow runs the same isolated browser gate and may upload only sanitizer-approved failure evidence. Do not upload a raw run directory.

## Agent handoff

1. Read every file in `docs` and the root `AGENTS.md`.
2. Confirm the module you own and check the working tree for other Agents' changes.
3. Update the controlling specification with any contract or architecture change.
4. Implement the smallest coherent change inside the owned boundary.
5. Run focused checks, then `pnpm validate` before handoff.
6. Report changed files, validation results, deferred work, and risks.

## Branch and commit convention

Use short-lived topic branches when parallel Agent work begins. Prefer Conventional Commit prefixes documented in `TEAM_RULES.md`. Do not combine unrelated module changes in one commit.
