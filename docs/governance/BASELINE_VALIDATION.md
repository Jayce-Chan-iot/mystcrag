# Baseline Validation

**Audit task:** TASK-AUDIT-001<br>
**Observed:** 2026-08-24<br>
**Original product commit:** local `main` at `1a34c16`<br>
**Governance integration anchor:** `4e7cdcb` on local `main`; final P0 planning head is recorded at handoff<br>
**Decision:** `NOT READY`

## Executive decision

The product repository is buildable and its core design/persistence boundaries are substantially real. Governance is now integrated into local `main`, but the repository is not yet a safe frozen baseline because two cross-module schema conflicts still require worker implementation and no post-fix candidate has been replay-validated.

Governance result: **PASS on local `main`**. The exact linear chain `c1262f3 -> 7649f59 -> 74fca1f -> 4e7cdcb` was reviewed and fast-forwarded. It contains governance/audit documentation plus the separately registered recoverable QA-evidence cleanup; it contains no business source, Prisma change, runtime asset change, `apps/frontend/next-env.d.ts`, `docs/audit/`, or `docs/progress/`.

## Governance validation

| Check | Result | Evidence / required action |
| --- | --- | --- |
| Root agent rules cover the repository | PASS | Local `main` now defines task registration, exact path locks, branch ownership, forbidden overlap, contract-first changes and handoff checks. |
| One task, one owner, one branch, one writable set | PASS | `TASK_REGISTRY.md` is the lock authority; status transitions and exact writable paths are explicit. |
| Integration-only main and no unrelated refactors | PASS | Root rules and branch registry prohibit feature work on `main`, unrelated cleanup and destructive branch actions. |
| SOL review/integration role | PASS | Module ownership and task transitions reserve architecture, cross-module contract and integration decisions for SOL. |
| Repository map matches code | PASS AFTER CORRECTION | 16 workspace projects, 4 apps, 11 packages, 20 frontend page routes, 21 Prisma models and the actual package dependency graph were scanned. Counts and gallery semantics were corrected. |
| Feature registry matches production composition | PASS AFTER CORRECTION | Personal gallery is separated from backend-only community publication; FEAT-025 was registered. |
| Canonical components are singular | FAIL / CONTRACT FROZEN | Tarot and AI meanings are decided in `CANONICAL_COMPONENTS.md`, but BASE-002 and BASE-003 have not migrated the code. |
| Module ownership is complete | PASS | Frontend, backend, database, AI, Bracelet, Three, Tarot, Knowledge, Context, Design Engine, assets, QA, integration and governance have owners. Shared files still require exact task locks. |
| Parallel-agent safety is enforceable | PASS FOR REGISTERED WORK | Governance is on `main`; BASE-002 and BASE-003 remain serial and have disjoint frozen scopes. Baseline Feature dispatch remains blocked. |

## Repository health evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Dependency installation | PASS | `pnpm install --frozen-lockfile`; 16 workspaces, lockfile current. |
| Lint | PASS | `pnpm lint`; 15/15 Turborepo tasks succeeded, including Prisma validation. |
| Type checking | PASS | `pnpm typecheck`; 15/15 tasks succeeded. |
| Unit/architecture tests | PASS | `pnpm test`; root architecture/lifecycle suite 14/14 and all 15 workspace tasks succeeded; frontend 147/147. |
| Production build | PASS | `pnpm build`; 15/15 tasks succeeded and all Next routes compiled. |
| PostgreSQL migrations and constraints | PASS | A dedicated local audit database received all 12 migrations; database suite 65/65 and transaction/trigger/FK/idempotency verification passed. |
| Browser smoke | PARTIAL | Home rendered at desktop and 390×844 mobile sizes with all three entry paths and mobile navigation. Protected end-to-end flow was inconclusive because the already-running user dev server shared `.next` with the production build and there was no authenticated production session. No user process was restarted. |
| CI definition | PASS WITH GAP | CI runs lint, typecheck, tests, build and PostgreSQL verification. It has no reproducible browser E2E gate. |

The audit created the dedicated local database `mystcrag_audit_test_20260824_01` and left it intact because deletion was not authorized. It contains audit-only test data.

## Canonical findings

Confirmed canonical authorities:

- `DesignV1`, `BeadV1`, API DTOs and public projections: Design Contract.
- Bracelet fit, geometry, layout and hit testing: Bracelet Engine.
- Production editor: `FlatBraceletEditor`; compact read-only display: `BraceletPreview`.
- 3D: implemented experimental renderer, not an MVP release requirement and not production-mounted.
- Persistence: Prisma schema and package repositories.
- Deterministic questionnaire recommendation: backend Recommendation Application Service with Design Engine/Knowledge components.
- Active DIY working copy: local `DiyEditor` state projected from `DesignV1`; no competing global store was found.

Stop-the-line canonical conflicts:

1. Design Contract and Tarot Engine both define public Tarot theme/spread/slot/orientation schemas.
2. AI Agent and a backend boundary use `AiDesignCandidateSchema` for incompatible positional-bead and product-selection/provider-result concepts.

Both must be resolved contract-first with consumer compilation and behavior tests; neither can be fixed by deleting a type without an adapter and reachability proof.

## Baseline blockers

### P0 — must be closed before Feature work

1. Human-dispatch and merge BASE-002 so Design Contract is the only runtime authority for public Tarot values.
2. Only after BASE-002 reaches `main`, human-dispatch and merge BASE-003 so the two AI/backend domain concepts have unambiguous names.
3. Run BASE-004 on the resulting `main`: frozen install, lint, typecheck, unit/integration tests, build, Prisma/PostgreSQL verification and the repository's available browser smoke.
4. Re-audit, record `BASELINE STATUS: READY`, and create the annotated tag only if every gate passes.

### P1 — high value, not a freeze blocker after P0 closes

- Add reproducible browser E2E to CI and isolate dev/build output.
- Reconcile contradictory catalog seed counts and stale architecture/3D status documents under TASK-DOC-001.
- Decide lifecycle of dormant editor, experimental 3D wrapper, backend shells and `DesignTemplate`.
- Replace development identity/session behavior before commercial release.

### P2 — maintainability

- Split the four largest orchestration/UI files along already-tested boundaries.
- Review branch/worktree metadata and unique commits before owner-approved cleanup.
- Retire or justify compatibility surfaces and align editor/export visual assets.

## Freeze protocol

The baseline becomes `READY` only when all conditions are true:

- BASE-002, BASE-003 and BASE-004 are `DONE` and their exact commits are integrated into local `main`.
- `git status` contains no unexplained changes in the candidate worktree.
- Registries and controlling contracts describe the same candidate code.
- Required validation is green on the candidate commit, including an isolated authenticated E2E smoke.
- The Product Owner records the baseline commit in this file and authorizes Feature dispatch.

Until then, future Feature tasks remain `BACKLOG` or `BLOCKED`; they must not be moved to `IN_PROGRESS`.
