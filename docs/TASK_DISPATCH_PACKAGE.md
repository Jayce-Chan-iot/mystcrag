# FEAT-018 Human Dispatch Package

**Feature:** FEAT-018 Production Identity & Session<br>
**Prepared by:** SOL / TASK-AUDIT-001<br>
**Package state:** AUTH-001 through AUTH-006 and AUTH-008 are integrated; AUTH-006 final candidate `1412d657236ade40872d71d4468df3d66391040c` is `DONE`; AUTH-007 is `IN_PROGRESS` under SOL<br>
**Blocking gates:** AUTH-007 remains the only final Feature acceptance gate; it may reconcile only its registered controlling documents and must not start a new Feature, redesign authentication, perform P1/P2 work or weaken AUTH-006<br>
**Contract marker:** `IMPLEMENTATION_COMPLETE_ACCEPTANCE_PENDING`

Product Owner approved Auth0, environment-isolated exact allowlists, and the Next.js BFF secure-cookie topology on 2026-08-25. SOL accepted AUTH-002 at `fbd7a540776c447289a05aeb20e50deefd8ea21a`, AUTH-003 at `ab54703fba59173ab9197aaae82215d93abf4f86`, AUTH-004 at `14cb9ef3d1c37113bf2d07df72044023c440137f`, integrated AUTH-005 final candidate `071c1700328de3551976eaa42ea361e5028028a2`, integrated AUTH-008 final candidate `8b1edacb2df7041e39b39547bf4c37f3eaad936f`, and integrated AUTH-006 final candidate `1412d657236ade40872d71d4468df3d66391040c`. The final post-integration AUTH-006 run `rmtf8gu2csc2y1frhp4` passed 54/54 with complete resource cleanup and artifact secret scan; AUTH-007 now performs final reconciliation and acceptance.

## Task DAG

```text
Baseline P0 DONE + Product Owner inputs
                    |
                    v
              TASK-AUTH-001
          SOL contract and decision
                    |
                    v
              TASK-AUTH-002
       SOL dependency/config lock task
                    |
          +---------+----------+
          |                    |
          v                    v
    TASK-AUTH-003        TASK-AUTH-005
    identity mapping      frontend session UX
          |
          v
    TASK-AUTH-004
    backend verifier
          |                    |
          +---------+----------+
                    v
         TASK-AUTH-006 red gate
          30/32; defect found
                    |
                    v
              TASK-AUTH-008
       BFF mutation rolling repair
                    |
                    v
         TASK-AUTH-006 rebase/rerun
          accepted 54-test gate
                    |
                    v
              TASK-AUTH-007
          SOL review/integration
```

Contract freeze and dependency setup are serial. TASK-AUTH-003 and TASK-AUTH-005 may run in parallel. TASK-AUTH-004 may continue while TASK-AUTH-005 runs because their writable paths are disjoint. TASK-AUTH-006 waits for backend and frontend. The red AUTH-006 gate discovered TASK-AUTH-008, which now lands before AUTH-006 rebases and reruns. TASK-AUTH-007 is always last.

## Assignment summary

| Task | Owner type | Recommended agent | Execution |
| --- | --- | --- | --- |
| TASK-AUTH-001 | SOL | SOL | SERIAL; first |
| TASK-AUTH-002 | SOL | SOL | SERIAL; after contract |
| TASK-AUTH-003 | DATABASE | GLM | Parallel lane A |
| TASK-AUTH-004 | BACKEND | GLM | Lane A; after database mapping |
| TASK-AUTH-005 | FRONTEND | Qwen | Parallel lane B |
| TASK-AUTH-006 | QA | GLM | SERIAL after lanes A+B |
| TASK-AUTH-008 | FRONTEND | Qwen | SERIAL repair discovered by AUTH-006; lands before AUTH-006 rebase |
| TASK-AUTH-007 | SOL | SOL | SERIAL final review/integration |

## TASK-AUTH-001

- **TASK ID:** TASK-AUTH-001
- **TITLE:** Freeze production identity and session contract
- **FEATURE:** FEAT-018
- **OWNER TYPE:** SOL
- **RECOMMENDED AGENT:** SOL
- **BRANCH:** `task/auth-001-identity-contract`
- **OBJECTIVE:** select and document the provider/session topology and freeze every cross-module contract required by implementation.
- **BACKGROUND:** backend supports only fail-closed signed test tokens; frontend exposes a fixed build-time token; no identity mapping/provisioning exists.
- **DEPENDENCIES:** baseline P0 tasks `DONE`; Product Owner approval recorded 2026-08-25; exact staging/production domains remain deployment inputs with owner and pass/fail checks in the frozen contract.
- **ALLOWED FILES:** `docs/AUTH_SESSION_CONTRACT.md`, `docs/API_SPECIFICATION.md`, `docs/DATABASE_SCHEMA.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEPLOYMENT_GUIDE.md`, `docs/DECISION_LOG.md`, exact FEAT-018 registry/task rows.
- **FORBIDDEN FILES:** `apps/**`, `packages/**`, Prisma schema/migrations, root/package configuration, tests, CI, unrelated docs.
- **CANONICAL REFERENCES:** `apps/backend/src/auth/auth-provider.ts`, Prisma `User`, Design Contract API error envelope, `FEATURE-018_PLAN.md`, `SECURITY_AND_PRIVACY.md`.
- **ARCHITECTURE CONSTRAINTS:** `(issuer, subject)` is the immutable external key; internal `User.id` remains business actor id; no client-stored reusable token; provider-specific code stays behind the canonical boundary.
- **FUNCTIONAL REQUIREMENTS:** decide login/callback/session/logout flows, verified claim projection, provisioning/linking, expiry/revocation and anonymous/protected route behavior.
- **NON-FUNCTIONAL REQUIREMENTS:** threat model, CSRF/state/nonce/PKCE decision, key rotation/cache, clock skew, log redaction, configuration validation, recovery and rollback.
- **OUT OF SCOPE:** implementation, provider account creation, custom passwords, RBAC/tenants, commerce and profile migration.
- **ACCEPTANCE CRITERIA:** Product Owner approval is recorded; every endpoint/type/state/persistence invariant has one authority; open items are zero or explicitly implementation-validation probes with owner and pass/fail rule; no runtime diff.
- **REQUIRED TESTS:** internal doc links; architecture tests; decision-table walkthrough for new login, returning session, logout, expiry, revocation, provider outage and concurrent first login.
- **DELIVERABLES:** `AUTH_SESSION_CONTRACT.md` at `CONTRACT_FROZEN_IMPLEMENTATION_PENDING`, synchronized controlling docs/registries, official Auth0 basis, implementation probes, and SOL handoff.

## TASK-AUTH-002

- **TASK ID:** TASK-AUTH-002
- **TITLE:** Freeze authentication dependencies and runtime configuration surface
- **FEATURE:** FEAT-018
- **OWNER TYPE:** SOL
- **RECOMMENDED AGENT:** SOL
- **BRANCH:** `task/auth-002-dependency-baseline`
- **OBJECTIVE:** add only the approved provider/session/test dependencies and exact environment contract so workers do not race on shared manifests or lockfiles.
- **BACKGROUND:** backend/frontend currently have no production identity SDK or browser E2E dependency.
- **DEPENDENCIES:** TASK-AUTH-001 `DONE`; exact packages/versions approved after current provider documentation validation.
- **ALLOWED FILES:** root `package.json`, `pnpm-lock.yaml`, `apps/backend/package.json`, `apps/frontend/package.json`, workspace config only if the frozen contract requires it, `.env.example`/deployment environment template, one dependency decision record.
- **FORBIDDEN FILES:** application source, Prisma, migrations, feature UI, business tests, CI, unrelated upgrades.
- **CANONICAL REFERENCES:** approved `AUTH_SESSION_CONTRACT.md`, `DEPENDENCY_DECISIONS.md`, current workspace/CI configuration.
- **ARCHITECTURE CONSTRAINTS:** one version per dependency; no duplicate auth SDK; no global state library unless contract proves necessity; secrets never receive `NEXT_PUBLIC_` prefix.
- **FUNCTIONAL REQUIREMENTS:** verify and pin an Auth0 Next.js SDK version compatible with the repository's security-patched Next.js `16.2.12`, install only approved runtime/test packages, expose fail-closed named environment variables and keep workspace scripts deterministic.
- **NON-FUNCTIONAL REQUIREMENTS:** frozen lockfile, documented Auth0 SDK/Next.js 16.2.12 compatibility evidence, supported Node/pnpm versions, license/security review and minimal dependency footprint.
- **OUT OF SCOPE:** provider/verifier/UI implementation, schema changes and broad dependency updates.
- **ACCEPTANCE CRITERIA:** frozen install succeeds; the selected Auth0 SDK version is verified against Next.js 16.2.12 before AUTH-005; dependency tree contains only approved additions and none of the Next.js High advisories patched by `>=16.2.11`; missing production configuration has a defined fail-closed validation path; no source code changed.
- **REQUIRED TESTS:** `pnpm install --frozen-lockfile`, dependency/version inspection, `pnpm lint`, `pnpm typecheck`.
- **DELIVERABLES:** manifests/lockfile, environment template and dependency decision with exact versions. AUTH-002 review candidate freezes security-patched Next `16.2.12` with matching `eslint-config-next@16.2.12`, Auth0 SDK `4.27.0`, Backend `jose` `6.2.10`, root Playwright `1.62.1`, and a pnpm 11 `jose: 6.2.10` single-version override; official peer metadata covers Next `16.2.12` and React `19.2.7`.

## TASK-AUTH-003

- **TASK ID:** TASK-AUTH-003
- **TITLE:** Implement external identity mapping and idempotent user provisioning
- **FEATURE:** FEAT-018
- **OWNER TYPE:** DATABASE
- **RECOMMENDED AGENT:** GLM
- **BRANCH:** `task/auth-003-identity-persistence`
- **OBJECTIVE:** persist a collision-safe provider identity and map it atomically to the canonical internal `User`.
- **BACKGROUND:** current tests pre-create `User.id == token subject`; production issuers can reuse subject values and first login must not fail foreign keys.
- **DEPENDENCIES:** TASK-AUTH-002 `DONE` and frozen persistence contract from TASK-AUTH-001.
- **ALLOWED FILES:** `packages/database/prisma/schema.prisma`, one new timestamped migration, identity/user repository files and their unit/integration tests under `packages/database/src/**`, `packages/database/src/index.ts`, `docs/DATABASE_SCHEMA.md`.
- **FORBIDDEN FILES:** backend/frontend, Design/Order/Tarot repository behavior, existing migrations, generated Prisma client, root lockfile, API/security docs, CI.
- **CANONICAL REFERENCES:** Prisma `User`, repository transaction conventions, migration rules, approved identity persistence contract.
- **ARCHITECTURE CONSTRAINTS:** unique `(issuer, subject)` mapping; mutable email is not identity or authorization; migrations are additive/reversible by documented rollback; business resources continue referencing internal `User.id`.
- **FUNCTIONAL REQUIREMENTS:** find-or-provision mapping, return internal actor id, safely update permitted profile claims and reject conflicting/invalid link attempts.
- **NON-FUNCTIONAL REQUIREMENTS:** concurrent idempotency, transaction safety, least PII, indexed lookup, deterministic errors and no token storage.
- **OUT OF SCOPE:** token verification, browser session, account merge UI, roles, tenant models and profile preferences.
- **ACCEPTANCE CRITERIA:** 20 concurrent first-login calls for one `(issuer, subject)` yield exactly one mapping and one User; identical subject under two issuers does not collide; email changes do not change actor id; rollback procedure is documented.
- **REQUIRED TESTS:** Prisma validate/generate, migration on empty DB and current-schema fixture, repository unit tests, real PostgreSQL concurrency/FK tests, `pnpm --filter @mystcrag/database test`.
- **DELIVERABLES:** schema/migration, repository/API export, tests and synchronized database documentation.

## TASK-AUTH-004

- **TASK ID:** TASK-AUTH-004
- **TITLE:** Implement production verifier and authenticated actor composition
- **FEATURE:** FEAT-018
- **OWNER TYPE:** BACKEND
- **RECOMMENDED AGENT:** GLM
- **BRANCH:** `task/auth-004-backend-provider`
- **OBJECTIVE:** verify production identity/session credentials, provision/map the actor and protect existing APIs without changing business authorization semantics.
- **BACKGROUND:** canonical pre-handler exists but its factory recognizes only `signed-test`; actor subject currently bypasses durable identity mapping.
- **DEPENDENCIES:** TASK-AUTH-003 `DONE`; TASK-AUTH-002 dependencies; frozen API/security contract.
- **ALLOWED FILES:** `apps/backend/src/auth/**`, exact backend composition files `apps/backend/src/app.ts` and `apps/backend/src/index.ts`, new auth/session routes only if frozen contract requires them, co-located backend tests, `docs/API_SPECIFICATION.md`.
- **FORBIDDEN FILES:** frontend, Prisma/schema/migrations, business repository query semantics, Design Contract unless separately re-scoped by SOL, package manifests/lockfile, CI.
- **CANONICAL REFERENCES:** `AuthProvider`, auth pre-handler, API error envelope, identity repository from TASK-AUTH-003, approved contract/provider guidance.
- **ARCHITECTURE CONSTRAINTS:** signature/issuer/audience/expiry validated before provisioning; internal `User.id` becomes actor id; production cannot select signed-test provider; route-level owner filters remain unchanged.
- **FUNCTIONAL REQUIREMENTS:** production provider factory, verification, mapping/provisioning, session/logout endpoints if approved, consistent 401/403 and health/startup configuration behavior.
- **NON-FUNCTIONAL REQUIREMENTS:** bounded JWKS/provider calls, rotation-aware cache, timeouts, redacted structured logs, rate/abuse boundary, fail-closed errors and no sensitive claim propagation.
- **OUT OF SCOPE:** UI, custom password auth, payment, account linking workflow, role/tenant authorization and unrelated backend refactors.
- **ACCEPTANCE CRITERIA:** valid credential maps to internal actor and can access owned data; expired/wrong issuer/wrong audience/bad signature/revoked state return stable unauthorized envelope; user B cannot read/write user A resources; production signed-test startup fails.
- **REQUIRED TESTS:** provider/factory unit tests, route tests, identity integration tests, two-user authorization matrix, provider timeout/rotation tests, production-start smoke, backend lint/typecheck/test/build.
- **DELIVERABLES:** production adapter/composition, tests, API documentation and configuration error catalog.

## TASK-AUTH-005

- **TASK ID:** TASK-AUTH-005
- **TITLE:** Implement frontend sign-in, session lifecycle and sign-out UX
- **FEATURE:** FEAT-018
- **OWNER TYPE:** FRONTEND
- **RECOMMENDED AGENT:** Qwen
- **BRANCH:** `task/auth-005-frontend-session`
- **OBJECTIVE:** provide accessible desktop/mobile authentication UX and remove production dependence on the public fixed-token variable.
- **BACKGROUND:** frontend has no login/session provider and API runtime reads `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`.
- **DEPENDENCIES:** TASK-AUTH-002 `DONE`; frozen state/API contract from TASK-AUTH-001. TASK-AUTH-003 and TASK-AUTH-004 are also integrated on the dispatch baseline, so the frontend BFF must target the accepted production actor boundary rather than a subject/fixed-token compatibility path.
- **ALLOWED FILES:** new auth endpoints under `apps/frontend/app/auth/**`; new same-origin Backend BFF handlers under `apps/frontend/app/api/**`; new auth components/model/server adapters under `apps/frontend/src/features/auth/**`; exact `apps/frontend/proxy.ts`; exact `apps/frontend/next.config.ts` only to remove or replace the legacy `/api/:path*` direct-to-Fastify rewrite so the registered same-origin BFF route is reachable; exact API runtime/client files `apps/frontend/src/lib/api/api-runtime.ts`, `apps/frontend/src/lib/api/design-api.ts`, `apps/frontend/src/lib/api/design-api.test.tsx`, `apps/frontend/src/lib/api/tarot-api.ts`, and `apps/frontend/src/lib/api/tarot-api.test.tsx`; exact non-auth browser-state file `apps/frontend/src/lib/api/design-session.ts` only for credential-storage regression protection; exact shared-shell files `apps/frontend/app/layout.tsx` and `apps/frontend/components/mobile-bottom-nav.tsx`; co-located tests within those owned paths; `docs/INTERACTION_TEST_PLAN.md`. `apps/frontend/proxy.ts` is writable only for the Next.js 16 Auth0 network boundary, rolling Cookie Session handling, and auth-route interception; this does not grant write access to the rest of the `apps/frontend` root. `apps/frontend/next.config.ts` retains its unrelated React/transpile configuration and may not be used to bypass validation. The two existing API clients are explicitly writable because both currently attach `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`; AUTH-005 cannot satisfy token custody by changing `api-runtime.ts` alone.
- **FORBIDDEN FILES:** backend, packages/database, shared Design/Bracelet/Three contracts, package manifests/lockfile, unrelated page redesigns, CI.
- **CANONICAL REFERENCES:** approved session state/API contract, current typed API client/error envelope, UI design system, existing responsive navigation.
- **ARCHITECTURE CONSTRAINTS:** the Auth0 Next.js SDK authenticated-encrypted, HttpOnly, host-only Cookie Session is the sole session mode; browser JavaScript never reads Tokens; no Redis/persistent SessionStore/session database/AuthSession Prisma model; protected navigation preserves intended return path without open redirects. The public contract remains `POST /auth/logout` with exact Origin validation: an SDK default route or method must not silently replace it.
- **FUNCTIONAL REQUIREMENTS:** sign-in initiation, callback/loading/error state, session restoration, authenticated identity affordance, logout, expiry recovery and protected-route prompts.
- **NON-FUNCTIONAL REQUIREMENTS:** 375×812 and 1440×900 responsive behavior, keyboard/focus management, WCAG labels/status announcements, no hydration secret leakage and bounded loading state.
- **OUT OF SCOPE:** profile redesign, address/favorites migration, payment/community/3D, provider account settings and unrelated component refactors.
- **ACCEPTANCE CRITERIA:** clean user can sign in/out using contract fixtures; refresh restores session without token in HTML/client storage; expiry presents one actionable state; return path is same-origin; at 375px no horizontal scroll and primary auth action remains reachable.
- **REQUIRED TESTS:** session state unit tests, callback/open-redirect tests, API runtime tests, component interaction/accessibility tests, responsive browser screenshots/smoke, frontend lint/typecheck/test/build.
- **DELIVERABLES:** auth routes/components/state boundary, updated API runtime, tests and interaction documentation.

## TASK-AUTH-006

- **TASK ID:** TASK-AUTH-006
- **TITLE:** Add isolated authentication security and full-loop E2E gate
- **FEATURE:** FEAT-018
- **OWNER TYPE:** QA
- **RECOMMENDED AGENT:** GLM
- **BRANCH:** `task/auth-006-security-e2e`
- **OBJECTIVE:** prove the integrated business, security, responsive and regression acceptance on an isolated stack and make it repeatable in CI.
- **BACKGROUND:** current CI has no browser E2E and the audit browser run was partial because a user-owned dev server shared `.next` output.
- **DEPENDENCIES:** TASK-AUTH-004 and TASK-AUTH-005 `DONE`; integrated test candidate available.
- **ALLOWED FILES:** exact `tests/auth-e2e/**` for the suite, configuration, fixtures, runbook and test-only scripts; exact `.github/workflows/ci.yml`; exact `.gitignore` only for AUTH-006 generated-artifact policy; exact `docs/AUTH_006_SECURITY_E2E_REPORT.md`; no production source except a separately approved testability seam registered before editing.
- **FORBIDDEN FILES:** business behavior, Prisma schema/migrations, app package manifests/lockfile, production provider configuration/secrets, unrelated CI jobs.
- **CANONICAL REFERENCES:** FEAT-018 final acceptance, Interaction Test Plan, Security/Privacy contract, current PostgreSQL test wrapper.
- **ARCHITECTURE CONSTRAINTS:** isolated database and build/runtime output; synthetic provider/test tenant only; no production credentials; deterministic cleanup limited to explicit test resources.
- **FUNCTIONAL REQUIREMENTS:** new/returning login, save/return/design ownership, order/Tarot protected smoke, logout, expiry/revocation, provider outage and two-user isolation.
- **NON-FUNCTIONAL REQUIREMENTS:** desktop/mobile viewports, keyboard path, bounded runtime, retry-free deterministic assertions, secret/redaction check and retained evidence policy.
- **OUT OF SCOPE:** feature fixes, visual redesign, load testing beyond agreed session budget and external production-provider mutation.
- **ACCEPTANCE CRITERIA:** all scenarios pass from a clean checkout twice; user B receives no data or mutation success for user A ids; logout/expiry invalidate protected navigation; CI stores only approved failure artifacts; no shared `.next` or persistent developer DB dependency.
- **REQUIRED TESTS:** full install/lint/typecheck/test/build, fresh PostgreSQL migrations/constraints, browser suite at 1440×900 and 375×812, production-start/config-negative smoke.
- **DELIVERABLES:** deterministic E2E/security suite, CI gate, fixture/runbook and concise evidence report.

## TASK-AUTH-008

- **TASK ID:** TASK-AUTH-008
- **TITLE:** Repair production BFF mutation session rolling
- **FEATURE:** FEAT-018
- **OWNER TYPE:** FRONTEND
- **RECOMMENDED AGENT:** Qwen
- **BRANCH:** `task/auth-008-bff-mutation-session-repair`
- **OBJECTIVE:** preserve authenticated mutation bodies across real Auth0 SDK passive session rolling in the Next.js production build.
- **BACKGROUND:** AUTH-006 candidate `3bbf8058d6a236064567ed9f0e9b3bd74597ac42` and an independent SOL replay both produce 30/32: D1 and E1 receive a stable 500 at the first body-bearing authenticated mutation because `request.text()` consumes the stream before the SDK may reconstruct the `NextRequest` across Turbopack chunks.
- **DEPENDENCIES:** TASK-AUTH-005 `DONE`; TASK-AUTH-006 red-gate evidence available; this repair lands before TASK-AUTH-006 rebases.
- **ALLOWED FILES:** exact `apps/frontend/src/features/auth/server/bff.ts`, exact `apps/frontend/src/features/auth/server/auth0-server.ts`, exact `apps/frontend/src/features/auth/server/bff.test.tsx`, exact `apps/frontend/src/features/auth/server/auth0-server.test.tsx`.
- **FORBIDDEN FILES:** every other frontend file; AUTH-006 `tests/auth-e2e/**`, CI and evidence; manifests/lockfile; backend/database/Prisma; provider production configuration/secrets; governance and unrelated docs.
- **CANONICAL REFERENCES:** frozen Auth Session Contract; accepted AUTH-005 BFF/session behavior; AUTH-006 D1/E1 failure evidence; Auth0 SDK 4.27 middleware semantics.
- **ARCHITECTURE CONSTRAINTS:** Origin validation remains before session/token side effects; the real SDK continues passive rolling; browser JavaScript never receives reusable tokens; no second session implementation, bundler bypass, retry or weakened failure semantics.
- **FUNCTIONAL REQUIREMENTS:** a body-bearing authenticated mutation rolls the session and forwards the original payload; response rolling cookies propagate; GET/HEAD, missing/expired/revoked sessions and Backend 401/403 behavior remain unchanged.
- **NON-FUNCTIONAL REQUIREMENTS:** fail closed with privacy-safe no-store envelopes; no token/cookie/error-detail logging; production build compatibility; minimal diff in the four locked files.
- **OUT OF SCOPE:** AUTH-006 harness repair, Auth0/provider configuration, dependency upgrades, broad auth refactors, backend/database changes and AUTH-007.
- **ACCEPTANCE CRITERIA:** a regression fails on baseline `4cac24cb1ebf29bc96bc4ab24c3b7a0fd6593fd1` and passes on the candidate using production request types; body fidelity, rolling cookie propagation and Origin-before-side-effect order are asserted; all existing auth semantics remain green.
- **REQUIRED TESTS:** frontend auth/full tests, frontend lint, typecheck and production build, `git diff --check`, exact path-scope inspection and `pnpm validate`.
- **DELIVERABLES:** minimal production repair, regression coverage, clean candidate commit and handoff evidence; no merge to `main` by the worker.

## TASK-AUTH-007

- **TASK ID:** TASK-AUTH-007
- **TITLE:** SOL acceptance review, documentation reconciliation and integration
- **FEATURE:** FEAT-018
- **OWNER TYPE:** SOL
- **RECOMMENDED AGENT:** SOL
- **BRANCH:** `task/auth-007-final-integration`
- **OBJECTIVE:** review each task against frozen contracts, integrate in DAG order and issue the only Feature acceptance decision.
- **BACKGROUND:** cross-module auth work is complete only when contract, persistence, backend, frontend, operations and E2E evidence agree.
- **DEPENDENCIES:** TASK-AUTH-001 through TASK-AUTH-006 `DONE` with green evidence.
- **ALLOWED FILES:** integration conflict resolutions within previously approved paths, `docs/SECURITY_AND_PRIVACY.md`, `docs/DEPLOYMENT_GUIDE.md`, `docs/ENGINEERING_GUIDE.md`, Feature/task/canonical/health registries and final acceptance report.
- **FORBIDDEN FILES:** new feature scope, broad refactors, unreviewed dependency/schema changes, payment/community/3D, destructive branch/worktree operations.
- **CANONICAL REFERENCES:** approved Auth Session Contract, FEAT-018 plan, all task diffs/evidence, governance registries.
- **ARCHITECTURE CONSTRAINTS:** no weakened contract during merge; conflict resolution preserves the reviewed single authorities; integration order follows DAG; main remains integration-only.
- **FUNCTIONAL REQUIREMENTS:** inspect diffs, resolve only integration conflicts, replay acceptance, update lifecycle/status docs and record rollback/recovery readiness.
- **NON-FUNCTIONAL REQUIREMENTS:** traceable commits, no unrelated changes, reproducible checks and explicit Product Owner handoff.
- **OUT OF SCOPE:** implementing missing worker scope, waiving failed acceptance, starting FEAT-022 or deleting branches.
- **ACCEPTANCE CRITERIA:** every task has one owner/branch/path set; all contract and final acceptance checks are evidenced; controlling docs match code; final diff is scoped; only then record `FEATURE ACCEPTANCE: PASS`.
- **REQUIRED TESTS:** frozen install, lint, typecheck, full tests/build, fresh PostgreSQL suite, isolated desktop/mobile E2E, internal doc links and final diff/reachability inspection.
- **DELIVERABLES:** integrated candidate commit, final acceptance report, updated registries/runbooks and Product Owner merge/release recommendation.

## Parallel safety matrix

| Pair | Same files/contracts/state? | Decision |
| --- | --- | --- |
| AUTH-001 / any implementation | Contract authority overlaps every implementation decision | `SERIAL_EXECUTION_REQUIRED` |
| AUTH-002 / AUTH-003/004/005 | Shared manifests and versions | `SERIAL_EXECUTION_REQUIRED` |
| AUTH-003 / AUTH-005 | Database/docs vs frontend paths; contract already frozen | Parallel safe |
| AUTH-004 / AUTH-005 | Backend/API doc vs frontend/interaction doc; no shared runtime state implementation | Parallel safe after AUTH-003 for backend lane |
| AUTH-003 / AUTH-004 | Backend consumes identity repository | `SERIAL_EXECUTION_REQUIRED` |
| AUTH-004/005 / AUTH-006 | E2E depends on both implementations and auth fixtures | `SERIAL_EXECUTION_REQUIRED` |
| AUTH-006 red gate / AUTH-008 | AUTH-008 is defined by the production failure discovered by AUTH-006 | `SERIAL_EXECUTION_REQUIRED` |
| AUTH-008 / AUTH-006 rebase | Final E2E evidence must exercise the integrated repair; QA paths remain disjoint from frontend repair paths | `SERIAL_EXECUTION_REQUIRED` |
| AUTH-006 / AUTH-007 | Final review depends on complete evidence | `SERIAL_EXECUTION_REQUIRED` |

## One task = one owner result

PASS. No two agents implement the same backend, frontend, schema, contract, lockfile or CI scope. Reusing SOL or GLM across different serial tasks does not create co-ownership.

## Dispatch readiness

TASK-AUTH-001 is `DONE` with `CONTRACT_FROZEN_IMPLEMENTATION_PENDING`; SOL accepted contract candidate `10d1f5df44f6dff84034d09c7a5e93a2234ae745` for local integration.

TASK-AUTH-002 is `DONE`. SOL accepted repaired candidate `fbd7a540776c447289a05aeb20e50deefd8ea21a`, which verifies Auth0 SDK `4.27.0` against security-patched Next.js `16.2.12`, keeps matching `eslint-config-next@16.2.12`, freezes the three exact identity/test dependencies and the authoritative `MYSTCRAG_*` configuration mapping, and records the SDK's Next.js 16 `proxy.ts` plus GET-logout differences. The resolved tree contains none of the Proxy bypass or related Next.js High advisories patched by `>=16.2.11`.

TASK-AUTH-003 is `DONE`. SOL accepted final candidate `ab54703fba59173ab9197aaae82215d93abf4f86` after real PostgreSQL migration and 20-way concurrency verification, explicit delete/update RESTRICT assertions, no orphan User, and zero `external_identities_user_id_fkey` schema drift.

TASK-AUTH-004 is `DONE`. SOL accepted final candidate `14cb9ef3d1c37113bf2d07df72044023c440137f` after independent wildcard/IP issuer probes, TTL-independent unknown-key cooldown probes, real PostgreSQL identity/owner isolation, production-start smoke, Backend 180/180 tests and full workspace validation.

TASK-AUTH-005 is `DONE`. SOL accepted and fast-forward integrated final candidate `071c1700328de3551976eaa42ea361e5028028a2` after independent no-findings review, Frontend 397/397 tests, lint, typecheck, production build and full workspace validation.

TASK-AUTH-008 is `DONE`. SOL accepted and fast-forward integrated final candidate `8b1edacb2df7041e39b39547bf4c37f3eaad936f` after byte-fidelity repair, independent no-findings review, Frontend 405/405 tests, lint, typecheck, production build and full workspace validation.

TASK-AUTH-006 is `DONE`. SOL accepted and fast-forward integrated final candidate `1412d657236ade40872d71d4468df3d66391040c`; candidate evidence contains two clean 54/54 isolated runs, and the post-integration main run `rmtf8gu2csc2y1frhp4` again passed 54/54 with `stoppedAt`, all owned processes exited, ports released, isolated database dropped and verified gone, artifact secret scan PASS, and `pnpm validate` 15/15 packages PASS.

TASK-AUTH-007 is `IN_PROGRESS` under SOL on `task/auth-007-final-integration`. It remains the only final acceptance task and is limited to registered integration consistency, controlling-document reconciliation, final main validation and the Feature acceptance decision. Actual staging/production domain values remain deployment inputs, not a pending provider or topology decision.
