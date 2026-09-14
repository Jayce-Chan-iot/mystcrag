# Authing OIDC Migration Implementation Plan

**Task:** TASK-AUTH-011
**Spec:** `docs/superpowers/specs/2026-09-15-authing-oidc-migration-design.md`
**Owner:** SOL (registry) / executor MIMO
**Branch:** `task/auth-011-authing-oidc-migration`

## Global constraints

- No Prisma/schema/migration change.
- No browser token custody.
- Remove `@auth0/nextjs-auth0` direct dependency and unreachable Auth0 runtime.
- Keep `signed-test` desktop path behaviorally intact.
- TDD: RED confirmed → minimal GREEN → REFACTOR.
- No push/merge/deploy.
- Live Authing tenant smoke is BLOCKED without credentials.

## Phase 0 — Register and documents

- [ ] Register TASK-AUTH-011 IN_PROGRESS in `docs/tasks/TASK_REGISTRY.md`
- [ ] Land design + this plan
- [ ] Update controlling auth docs in the same change set as runtime code

## Phase 1 — Backend OIDC verifier

**Files:**
- Rename/replace `apps/backend/src/auth/auth0-access-token-verifier.ts` → `oidc-access-token-verifier.ts`
- Modify `apps/backend/src/auth/auth-provider.factory.ts`
- Add `apps/backend/src/auth/oidc-discovery.ts`
- Update `apps/backend/src/auth/index.ts` and factory/verifier tests

**Steps:**
1. RED: factory rejects `authing`; issuer with `/oidc` rejected; discovery jwks unused.
2. GREEN: `authing` builds OIDC verifier; discovery caches `jwks_uri`; issuer allows `/oidc`.
3. Remove `auth0` provider branch; keep signed-test gates.

## Phase 2 — Frontend OIDC BFF

**Files (new):**
- `apps/frontend/src/features/auth/server/oidc-discovery.ts`
- `apps/frontend/src/features/auth/server/oidc-session-crypto.ts`
- `apps/frontend/src/features/auth/server/oidc-session-store.ts`
- `apps/frontend/src/features/auth/server/oidc-transaction.ts`
- `apps/frontend/src/features/auth/server/oidc-client.ts`
- `apps/frontend/src/features/auth/server/oidc-server.ts` (replaces auth0-server)

**Files (modify):**
- `auth-config.ts` provider `authing`
- `login.ts`, `callback.ts`, `logout.ts`, `session.ts`, `bff.ts`, `proxy.ts`, `runtime-auth.ts`, `session-cookies.ts`
- Route adapters under `apps/frontend/app/auth/**` and `apps/frontend/app/api/[...path]/route.ts`
- `apps/frontend/package.json` (remove `@auth0/nextjs-auth0`, add `jose`/`openid-client` if not transitive-only)

**Cookie/session rules:**
- Encrypt session and transaction with JWE Compact (A256GCM) derived via HKDF from `MYSTCRAG_AUTH_SESSION_SECRET`.
- Session stores user projection, access/refresh token server-side only, createdAt, idle expiry.
- Rolling reissues cookie without extending absolute expiry.
- Refresh failure with invalid_grant/access_denied → clear session + 401 class.

## Phase 3 — Synthetic OIDC tests

Backend:
- discovery issuer/jwks_uri
- RS256 matrix, kid rotation, outage/timeout
- provider gates

Frontend:
- login authorize URL + transaction cookie
- callback success/denial/replay
- session projection/rolling
- logout 405/Origin/303
- secret scan (no token in client bundle strings)

## Phase 4 — Docs, acceptance, validation

- `docs/qa/AUTHING_CONSUMER_ACCESS_ACCEPTANCE.md`
- Update `AUTH_SESSION_CONTRACT.md`, `SECURITY_AND_PRIVACY.md`, `DEPENDENCY_DECISIONS.md`, `DEPLOYMENT_GUIDE.md`, `.env.example`, canonical components note as needed
- Run: focused tests, typecheck, lint, build, architecture tests, `git diff --check`, `pnpm validate`
- Registry status → `REVIEW`
- Conventional Commits; clean worktree

## Handoff evidence columns

base commit, commits, branch/worktree, files, dependency choice, RED/GREEN commands, Auth0 dependency zeroed, signed-test status, DB migration=0, live Authing VERIFIED/BLOCKED, not pushed/merged/deployed.
