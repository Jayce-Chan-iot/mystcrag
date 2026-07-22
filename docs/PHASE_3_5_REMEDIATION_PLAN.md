# Mystcrag Phase 3.5 MVP Integration Remediation Plan

Date: 2026-07-22
Status: `COORDINATION_ACTIVE`
remoteStatus: `NOT_CONFIGURED`
integrationBaseline: `LOCAL_MAIN`
baselineCommit: `8ae159a734ad2cd38f8af11c2d9d44791b1d47c7`
mvpReadiness: `BLOCKED`

## 1. Objective and scope

Phase 3.5 remediates the seven confirmed Phase 3 QA defects without changing product positioning or weakening existing Contract, privacy, pricing, revision, compliance, or persistence assertions.

Required blockers:

- `BUG-P3-001`: replace the Mock-backed browser lifecycle with a real Backend path.
- `BUG-P3-002`: mount the real Three Engine in the Frontend DIY flow.
- `BUG-P3-003`: preserve questionnaire data and enforce transparent budget handling.
- `BUG-P3-004`: produce passing migration, seed, trigger, transaction, and repository evidence on PostgreSQL.
- `BUG-P3-005`: remove external trust in `x-actor-id` and use verified authentication context.

Best-effort fixes in the same phase:

- `BUG-P3-006`: make mobile interactive targets at least 44 by 44 CSS pixels.
- `BUG-P3-007`: provide a valid application icon/favicon response.

This coordination phase creates governance, branches, ownership, shared-change decisions, handoff gates, and merge order. It does not merge a fix branch, start the QA rerun, or declare any existing candidate implementation accepted.

## 2. Mandatory prerequisites

Every role must follow all three rules:

1. Work only on its independent branch. Never develop directly on `main` or another role branch.
2. Modify only the assigned module, role-owned tests, and role report. Cross-module or shared changes require a Decision Log entry and Tech Lead approval before additional implementation.
3. Run `pnpm validate` successfully on the final commit before handoff. A failing or incomplete branch cannot be submitted or merged.

Forbidden actions:

- changing `packages/design-contract` or `packages/database/prisma/schema.prisma` without a separately approved decision;
- silently changing shared API semantics, DTOs, root configuration, or lockfiles;
- weakening assertions, deleting failing tests, inventing a second design protocol, or reporting fixture/Mock evidence as real integration;
- trusting browser-supplied actor identity, price, inventory, revision, cost, or publication state;
- merging a later branch before the preceding post-merge gate passes.

## 3. Branch registry and current audit

All requested branches exist locally. The QA rerun branch was created by the Tech Lead at the clean baseline and must remain idle until all four fix branches are merged.

| Role | Branch | Current HEAD | Direct parent | Status |
| --- | --- | --- | --- | --- |
| Database Verification Lead | `fix/postgres-verification` | `d923f0680d8de10f2fc030a651249f48701e3a0b` | `0bb60a44c2fa110b0343a08a5c51e3b43ab2ed7b` | Existing candidate; history cleanup required |
| Backend Security Lead | `fix/backend-auth-boundary` | `acd4df836ccdf39bcf4c97108a6f976779990d45` | `8ae159a734ad2cd38f8af11c2d9d44791b1d47c7` | Correct direct baseline; pending review |
| Integration Lead | `fix/mvp-browser-integration` | `1402ab1b963cfcab32fbb1d90a71cbb26fcf6774` | `0bb60a44c2fa110b0343a08a5c51e3b43ab2ed7b` | Existing candidate; history and auth adaptation required |
| 3D Integration Lead | `fix/frontend-three-integration` | `210010af2532c59e205d9b67fd904bddf36e1854` | `0bb60a44c2fa110b0343a08a5c51e3b43ab2ed7b` | Existing candidate; history and auth adaptation required |
| QA Lead | `test/mvp-integration-rerun` | `8ae159a734ad2cd38f8af11c2d9d44791b1d47c7` | Phase 3 integrated `main` | Created; do not start yet |

`test/mvp-integration@0bb60a4` remains the immutable source of the first QA evidence and bug reports. It is not an approved base commit for the fix branches in the controlled merge train.

### Required branch-history correction

The PostgreSQL, Browser Integration, and Frontend Three Integration candidate commits currently include `0bb60a4` in their unique history. Merging any of them as-is would import the old QA branch before the approved QA merge step and violate the required order.

Each responsible Lead must, in its own clean worktree:

1. record the pre-cleanup HEAD in the role report;
2. rebase only its role commit onto the latest approved `main`, using `0bb60a4` as the old boundary;
3. exclude inherited `docs/BUG_REPORT.md`, `docs/QA_PHASE_3_PLAN.md`, `docs/QA_PHASE_3_REPORT.md`, and QA-owned test changes unless the ownership table below explicitly permits the exact assertion;
4. stop and request Tech Lead resolution for any cross-owner conflict;
5. rerun focused tests and `pnpm validate`;
6. record the post-cleanup HEAD and exact `main...HEAD` inventory.

The expected local operation is `git rebase --onto main 0bb60a4 <fix-branch>` after verifying a clean worktree. It may require conflict resolution because some candidate commits modified QA-owned files introduced at `0bb60a4`; those conflicts must not be solved by silently importing the whole QA commit.

No Tech Lead task may reset, delete, force-move, or discard the existing branches on behalf of their owners.

## 4. Ownership and prohibited paths

### Integration Lead

Branch: `fix/mvp-browser-integration`

Owns:

- `apps/frontend` browser lifecycle, questionnaire/result transport, accessible touch targets, and icon assets;
- `apps/backend` design-flow integration layer only when an existing public route needs composition, not authentication or repository internals;
- module-local Frontend/Backend integration tests;
- `docs/INTEGRATION_FIX_REPORT.md`.

Primary defects: `BUG-P3-001`, `BUG-P3-003`, `BUG-P3-006`, `BUG-P3-007`.

Must not modify Three Engine internals, authentication verification, Prisma Schema, Design Contract, AI internals, or QA reports. Browser code must not send or synthesize `x-actor-id`; it consumes the verified-auth boundary delivered by the Backend Security Lead.

### 3D Integration Lead

Branch: `fix/frontend-three-integration`

Owns:

- the `apps/frontend` DIY Three mounting boundary;
- `packages/three-engine` only when a package-local runtime defect is proven;
- module-local Frontend/Three integration tests;
- `docs/THREE_INTEGRATION_FIX_REPORT.md`.

Primary defect: `BUG-P3-002`.

Must not change Backend business/auth logic, database files, AI internals, shared Design Contract, or the questionnaire/product flow. Scene selection and hit testing use `componentId`. A replacement may update the scene only after a Backend-confirmed, schema-valid `PublicDesignV1` response.

### Backend Security Lead

Branch: `fix/backend-auth-boundary`

Owns:

- `apps/backend` authentication middleware/provider and request actor context;
- Backend-local security tests;
- `docs/AUTH_FIX_REPORT.md`.

Primary defect: `BUG-P3-005`.

Must not change Frontend, Database, AI, Three Engine, Design Contract, or pricing/revision semantics. `x-actor-id` must never be an external identity fallback. Protected routes consume only a subject produced by a verified provider. Authentication failures must not disclose credentials or verifier details.

### Database Verification Lead

Branch: `fix/postgres-verification`

Owns:

- `packages/database` test infrastructure and live repository tests;
- Docker/CI PostgreSQL service configuration;
- database test commands and database verification documentation;
- `docs/POSTGRES_VERIFICATION_REPORT.md`.

Primary defect: `BUG-P3-004`.

Must not modify Prisma Schema or migration semantics without a new approved database decision. Live evidence must identify PostgreSQL version, database isolation, migration, repeated seed, test counts, trigger/transaction results, and cleanup. A unit double is not live PostgreSQL evidence.

### QA Lead

Branch: `test/mvp-integration-rerun`

Owns final cross-module tests, E2E configuration, QA evidence, `docs/QA_PHASE_3_REPORT.md`, and `docs/BUG_REPORT.md` updates after the four fix merges.

QA must not start before the Tech Lead declares all four post-merge gates passed. QA may verify fixes but must not repair core business logic.

## 5. Overlap and interface rules

`apps/frontend` is intentionally shared by the Integration and 3D Integration roles, but file ownership must not overlap silently:

- Integration Lead owns questionnaire, result, save/order lifecycle, general error handling, navigation, touch targets, and icon assets.
- 3D Integration Lead owns the Three preview mount, scene client, hit-test callback, WebGL fallback, and scene lifecycle.
- `diy-editor.tsx`, Frontend transport/proxy files, `next.config.ts`, `apps/frontend/package.json`, and `pnpm-lock.yaml` are coordination hotspots. Before modifying one of these files, the second role must be notified in the handoff report and the Tech Lead must decide the final merge resolution.
- Shared behavior is integrated through existing `PublicDesignV1`, finite update DTOs, and `componentId`; neither role may create a local replacement DTO.

The Backend Security branch merges before Browser and 3D integration. After it merges, both Frontend integration branches must synchronize with the new `main` and remove all actor-header seams. Browser-controlled identity, `NEXT_PUBLIC_*` actor IDs, and server configuration that merely converts an actor ID into a trusted header do not satisfy `BUG-P3-005`.

The approved identity flow is:

```text
browser credential or verified session
  -> Backend AuthProvider verification
  -> request ActorContext
  -> owner-scoped design service
```

Development/test credentials must be explicit, environment-restricted, signed/verified, and absent from production fallback behavior.

## 6. Shared assets and decisions

Shared assets remain:

- `packages/design-contract`;
- `packages/database/prisma/schema.prisma`;
- `docs/API_SPECIFICATION.md`;
- `docs/TECH_ARCHITECTURE.md`;
- `pnpm-lock.yaml`;
- root `package.json`;
- `turbo.json`;
- `tsconfig.base.json`.

Approved Phase 3.5 decision scopes are recorded in `docs/DECISION_LOG.md`:

- `P35-001`: Phase 3.5 branch, ownership, gate, and merge governance.
- `DEC-P35-POSTGRES-TEST-COMMAND-001`: retain only the reviewed root `db:test` change that uses a guarded `TEST_DATABASE_URL` preparation/migration/test flow.
- `DEC-P35-FRONTEND-THREE-LINK-001`: retain only the generated three-line Frontend importer link to `@mystcrag/three-engine` in `pnpm-lock.yaml`.
- `DEC-P35-AUTH-BOUNDARY-001`: add the verified Backend actor context and stable authentication errors, with the controlling API specification updated before handoff.

These decisions authorize only the described scope. They do not approve the current branch implementation, waive history cleanup, or authorize additional Contract, schema, API, manifest, or lockfile changes.

## 7. Required implementation outcomes

### Browser and questionnaire

- Production browser traffic reaches the real Backend Generate, Get, Update, Save, and at least one Publish or Create Order path.
- The questionnaire's emotion/state, colors, style, cultural input, wrist size, exclusions, consent, currency, and budget arrive in the validated Backend request.
- Navigation/reload does not replace generated results with fixed Mock options.
- Over-budget results are rejected or explicitly require user-visible acceptance; they are never silently presented as compliant with the selected maximum.
- Revision and price changes are adopted only from the Backend response.
- Save creates/retains real persistence state, and at least one publish/order path records a fixed confirmed revision.
- Production has no silent Mock fallback. An explicit development Mock mode must be visibly labeled.

### Three integration

- Frontend dynamically mounts the real Three Engine path.
- Validated Backend design data enters `designV1ToSceneDescriptor`.
- Hit testing and UI selection return `componentId`.
- Replacement sends a finite update operation and waits for Backend confirmation.
- The confirmed revision regenerates the scene; Frontend/Three never calculates trusted price or inventory.
- WebGL/asset failure has an operable accessible fallback and is not misreported as the normal 3D path.

### PostgreSQL

- A real PostgreSQL 17 environment applies the reviewed migration to an isolated empty database.
- Seed is idempotent and verified after a second run.
- Live tests cover revision creation, optimistic conflict, rollback, immutable revision/order snapshot triggers, fixed publication revision, BIGINT boundaries, JSON read/write validation, and foreign-key restrictions.
- Commands refuse unsafe or non-test database targets and preserve enough environment/run identity for review.

### Authentication

- Protected routes reject missing, malformed, forged, expired, wrong-issuer, and wrong-audience credentials.
- `x-actor-id` alone is rejected and cannot override a verified subject.
- Owner identity is absent from trusted browser/request body input.
- Production without a supported authentication provider fails safely; test authentication is explicitly environment-gated.
- Frontend integration uses the verified credential/session path after the Auth branch merges.

## 8. Branch handoff gate

Every role report must include:

- role, branch, baseline, pre-cleanup/rebase HEAD, post-cleanup/rebase HEAD, and final commit;
- exact `git diff --name-status main...HEAD` inventory;
- owned and prohibited modules confirmation;
- shared assets and Decision Log IDs;
- new routes, adapters, interfaces, fixtures, and tests;
- focused test names/counts and full `pnpm validate` results;
- real versus Mock environment evidence;
- cross-module dependencies, known limitations, rollback, and merge risks.

Before handoff, the role Lead runs:

```sh
git status
git branch --show-current
git merge-base --is-ancestor main HEAD
git diff --name-status main...HEAD
pnpm validate
```

The worktree must be clean after the final commit. A report that references inherited QA files, unapproved shared changes, old actor-header seams, or unverified environment claims is `BLOCKED`.

## 9. Controlled merge order

The Tech Lead merges only after branch admission, in this exact order:

1. `fix/postgres-verification`
2. `fix/backend-auth-boundary`
3. `fix/mvp-browser-integration`
4. `fix/frontend-three-integration`
5. `test/mvp-integration-rerun`

Every merge uses `git merge --no-ff <branch>`. Immediately after each merge:

```sh
pnpm install
pnpm validate
```

The train stops on any conflict that implies a new protocol, any unapproved shared diff, or any failed install/validation. Browser and 3D branches must synchronize with the post-auth `main` before their final handoff so the integration does not reintroduce actor-header trust.

## 10. QA restart gate

QA may restart only when all of the following are true:

- four fix reports are complete and accepted;
- all four branches have clean role-only history based on the then-current `main`;
- every shared change matches an `APPROVED` Decision Log entry;
- every focused suite and `pnpm validate` passes;
- real browser requests reach Backend and preserve questionnaire/budget data;
- update creates a real revision, save persists, and publish or order has one real path;
- Frontend mounts Three Engine and uses `componentId` with Backend-confirmed designs;
- PostgreSQL migration, repeated seed, triggers, transactions, and repository tests pass live;
- external `x-actor-id` trust is removed end-to-end;
- no cost, supplier, hidden reasoning, prompt, private conversation, or internal database type leaks into public outputs.

When the gate passes, QA rebases `test/mvp-integration-rerun` onto the fully integrated `main`, reruns browser/database/security/accessibility/performance/full-workspace gates, and issues a new independent `mvpReadiness` result.

Until then:

```text
mvpReadiness: BLOCKED
qaRerunStatus: NOT_STARTED
```

## 11. Merge acceptance and rollback

Each fix remains one independently reversible `--no-ff` merge. If a post-merge gate fails, stop before the next branch and return the evidence to the owning Lead. Do not delete tests, lower assertions, invent adapter-only success, or patch another owner's module on `main`.

The Tech Lead may revert a failed merge commit only as an explicit reviewed recovery operation. Database verification changes must not drop or reset non-test databases; authentication rollback must not restore external actor-header trust in an exposed environment.
