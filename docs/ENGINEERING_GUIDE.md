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

## Agent handoff

1. Read every file in `docs` and the root `AGENTS.md`.
2. Confirm the module you own and check the working tree for other Agents' changes.
3. Update the controlling specification with any contract or architecture change.
4. Implement the smallest coherent change inside the owned boundary.
5. Run focused checks, then `pnpm validate` before handoff.
6. Report changed files, validation results, deferred work, and risks.

## Branch and commit convention

Use short-lived topic branches when parallel Agent work begins. Prefer Conventional Commit prefixes documented in `TEAM_RULES.md`. Do not combine unrelated module changes in one commit.
