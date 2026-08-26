# Task Registry

One task equals one accountable owner, one branch, one writable path set, and one acceptance gate. This registry is the lock authority.

## Governance baseline task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-GOV-001 | SOL | `task/gov-001-repository-governance` | DONE | `AGENTS.md`, `docs/INDEX.md`, `docs/governance/**`, `docs/tasks/**`, Phase 0 plan | `apps/**`, `packages/**`, Prisma, branches/worktrees, pre-existing user changes |
| TASK-AUDIT-001 | SOL | `task/audit-001-baseline-planning` | DONE | `docs/INDEX.md`, `docs/governance/CURRENT_REPOSITORY_MAP.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/MODULE_OWNERS.md`, `docs/governance/REPOSITORY_HEALTH.md`, `docs/governance/BRANCH_REGISTRY.md`, `docs/governance/BASELINE_VALIDATION.md`, `docs/tasks/TASK_REGISTRY.md`, `docs/CURRENT_PRODUCT_STATUS.md`, `docs/NEXT_PHASE_BACKLOG.md`, `docs/FEATURE-*_PLAN.md`, `docs/TASK_DISPATCH_PACKAGE.md` | `apps/**`, `packages/**`, Prisma, root/runtime configuration, tests, generated output, pre-existing user changes and untracked files |
| TASK-BASELINE-001 | SOL | `task/baseline-001-governance-integration` | DONE | `docs/INDEX.md`, `docs/governance/BRANCH_REGISTRY.md`, `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/DUPLICATE_CODE_AUDIT.md`, `docs/governance/BASELINE_VALIDATION.md`, `docs/governance/REPOSITORY_HEALTH.md`, `docs/tasks/TASK_REGISTRY.md`, `docs/P0_BASELINE_CLOSURE_DISPATCH.md`, `docs/superpowers/plans/2026-08-24-p0-schema-closure.md` | `apps/**`, `packages/**`, Prisma, root/runtime configuration, tests, generated output, QA evidence, pre-existing user changes and FEAT-018 implementation |

No cleanup task currently holds a path lock. A `READY` task may move to `IN_PROGRESS` only after its owner creates the registered branch/worktree and records exact writable paths.

## Completed cleanup task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-REPO-001 | QA | `task/repo-001-evidence-retention` | DONE | tracked QA/output evidence under `artifacts/**`, `output/playwright/**`, `outputs/**`, `qa-captures-*/**`, `apps/frontend/qa-captures/**`, frontend root QA PNGs, `scripts/ui-qa/artifacts/**`, `scripts/ui-qa/qa-captures-final/**`; `.gitignore`; `docs/QA_PHASE_3_REPORT.md`; governance/task/plan docs | runtime source, `apps/frontend/public/**`, `docs/ui-references/**`, knowledge coverage JSON, current spreadsheet deliverables, user files and other worktrees |

## P0 baseline closure queue

The complete worker specifications and exact migration sequence are frozen in `docs/P0_BASELINE_CLOSURE_DISPATCH.md`. `BASE-002` and `BASE-003` are deliberately serial.

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| BASE-002 | GLM | `task/base-002-tarot-canonical-schema` | DONE | Tarot Engine manifest/source/tests; `pnpm-lock.yaml`; exact architecture test named in dispatch package | apps, database, Design Contract definitions, Prisma, unrelated packages/docs, AI candidate code, FEAT-018 |
| BASE-003 | GLM | `task/base-003-ai-candidate-concepts` | DONE | AI Agent schema/adapters/agents/tests; backend design generation schema/adapter/tests; exact controlling AI docs and architecture test named in dispatch package | Tarot, Prisma, public API/DesignV1 schemas, unrelated refactors, FEAT-018 |
| BASE-004 | SOL | `task/base-004-freeze-baseline` | DONE | integration-only conflict resolution, governance/task/health/baseline records, validation evidence, annotated baseline tag | new behavior, schema redesign, test deletion/skip, config bypass, P1/P2 or FEAT-018 implementation |

Integration evidence: BASE-002 passed SOL review and is reachable at `be5646b418274fd93c905cd7d9482ee99824a6db`; BASE-003 passed SOL review and is reachable at `8d31f280b6fa6c39f30580284a252cb2f6563090`. BASE-004 replay validation and freeze evidence are recorded in `docs/governance/BASELINE_VALIDATION.md`; its final commit is the target of `baseline/v0.1.0-20260825`.

## Cleanup backlog

| Task | Owner | Priority | Dependency | Proposed branch | Scope/status |
| --- | --- | ---: | --- | --- | --- |
| TASK-CONTRACT-001 | CONTRACT | P0 | superseded by SOL decision | `task/contract-001-tarot-schema-authority` | CANCELLED: contract decision folded into TASK-BASELINE-001; implementation is BASE-002 |
| TASK-TAROT-001 | TAROT | P0 | superseded by BASE-002 | `task/tarot-001-consume-shared-contract` | CANCELLED: duplicate implementation scope |
| TASK-AI-001 | AI | P0 | superseded by SOL decision | `task/ai-001-candidate-contract-decision` | CANCELLED: contract decision folded into TASK-BASELINE-001; implementation is BASE-003 |
| TASK-BE-003 | BACKEND | P0 | superseded by BASE-003 | `task/be-003-ai-candidate-boundary` | CANCELLED: duplicate implementation scope |
| TASK-BASELINE-002 | QA | P0 | superseded by BASE-004 | `task/baseline-002-freeze-validation` | CANCELLED: renamed to avoid collision with BASE-002 |
| TASK-FE-001 | FRONTEND | P1 | TASK-GOV-001 | `task/fe-001-dormant-editor-lifecycle` | READY: decide `BraceletSequenceEditor` lifecycle |
| TASK-3D-001 | THREE | P1 | TASK-GOV-001 | `task/3d-001-production-readiness-decision` | READY: evidence-based 3D mount/experimental decision |
| TASK-BE-001 | BACKEND | P1 | TASK-GOV-001 | `task/be-001-service-wrapper-cleanup` | READY: prove/retire or justify uncomposed wrappers |
| TASK-BE-002 | BACKEND | P1 | TASK-BE-001 | `task/be-002-module-boundary-cleanup` | BACKLOG: implement or retire metadata-only module shells |
| TASK-DB-001 | DATABASE | P1 | TASK-GOV-001 | `task/db-001-design-template-lifecycle` | READY: adopt or migrate dormant `DesignTemplate` model |
| TASK-COMPAT-001 | SOL | P2 | BASE-003 | `task/compat-001-legacy-surface-audit` | BACKLOG: usage proof and retirement plan for remaining explicit legacy exports |
| TASK-ASSET-001 | ASSET | P1 | TASK-GOV-001 | `task/asset-001-orphan-resource-decision` | READY: wire/remove state assets and resolve raw crystal image provenance |
| TASK-ASSET-002 | FRONTEND | P1 | TASK-ASSET-001 | `task/asset-002-export-visual-parity` | BACKLOG: align canvas export with photographic visible beads |
| TASK-REPO-002 | SOL | P2 | TASK-REPO-001 | `task/repo-002-branch-worktree-cleanup` | BACKLOG: review unique commits and clean branch/worktree metadata |
| TASK-DOC-001 | SOL | P2 | all P1 decisions | `task/doc-001-current-architecture-refresh` | BACKLOG: update stale controlling architecture/status statements |
| TASK-AUTH-001 | SOL | P0 | BASE-004 DONE; Product Owner approved Auth0 OIDC, environment-isolated callbacks and Next.js BFF secure-cookie topology on 2026-08-25 | `task/auth-001-identity-contract` | DONE: contract reviewed and accepted at `10d1f5df44f6dff84034d09c7a5e93a2234ae745`; `CONTRACT_FROZEN_IMPLEMENTATION_PENDING` |
| TASK-AUTH-002 | SOL | P0 | TASK-AUTH-001 DONE | `task/auth-002-dependency-baseline` | DONE: SOL accepted security-patched dependency/configuration baseline at `fbd7a540776c447289a05aeb20e50deefd8ea21a`; Next `16.2.12`, Auth0 SDK `4.27.0`, `jose` `6.2.10`, Playwright `1.62.1` |
| TASK-AUTH-003 | DATABASE / GLM | P0 | TASK-AUTH-002 DONE | `task/auth-003-identity-persistence` | DONE: SOL accepted final candidate `ab54703fba59173ab9197aaae82215d93abf4f86`; additive `ExternalIdentity`, canonical find-or-provision API, PostgreSQL 20-way concurrency, no-orphan proof, explicit delete/update RESTRICT and zero identity-constraint drift all PASS |
| TASK-AUTH-004 | BACKEND / GLM | P0 | TASK-AUTH-003 DONE | `task/auth-004-backend-provider` | DONE: SOL accepted final candidate `14cb9ef3d1c37113bf2d07df72044023c440137f`; Auth0 RS256/JWKS verification, fail-closed configuration, TTL-independent unknown-key cooldown, durable internal actor composition, real PostgreSQL identity isolation and production-start smoke all PASS |
| TASK-AUTH-005 | FRONTEND | P0 | TASK-AUTH-002 DONE | `task/auth-005-frontend-session` | READY: login/session/logout UX; may parallel AUTH-003/004 on disjoint paths after FRONTEND owner claims its registered branch/worktree |
| TASK-AUTH-006 | QA | P0 | TASK-AUTH-004, TASK-AUTH-005 | `task/auth-006-security-e2e` | BLOCKED: TASK-AUTH-004 DONE; waits for TASK-AUTH-005 DONE before isolated security, two-user and protected full-loop E2E gate |
| TASK-AUTH-007 | SOL | P0 | TASK-AUTH-006 | `task/auth-007-final-integration` | BACKLOG: acceptance review, documentation reconciliation and integration |

## Acceptance gates

### TASK-GOV-001 — Phase 0 governance

- Deliver all requested governance files and link them from the docs index.
- Record every workspace, feature family, owner, canonical authority, branch class, and health priority.
- Mark duplicate/dormant/unused code and resources with evidence and confidence.
- Modify no runtime code, schema, branch metadata, or unrelated user file.
- Pass path/link checks, architecture tests, workspace validation, and final diff review.

### TASK-BASELINE-001 / BASE-004 — integrate and freeze

- Integrate the complete governance/audit candidate; `main` must never contain partial or contradictory registries.
- Resolve both P0 contract DAGs before nominating the freeze candidate.
- Candidate worktree has no unexplained change and every controlling registry names the same commit/code state.
- Frozen install, lint, typecheck, tests, build, fresh PostgreSQL verification and isolated signed-test authenticated browser smoke pass.
- Product Owner records and approves the exact baseline commit before Feature tasks become `READY`.

### BASE-002 — Tarot contract authority

- Shared public enums have exactly one definition source.
- Tarot Engine retains deck integrity, private state, slot-order, uniqueness, and reveal invariants.
- Backend, frontend, database and Tarot tests compile and pass with no unsafe casts.
- Contract and Tarot specs describe public versus private ownership.

### BASE-003 — AI candidate boundaries

- The positional AI candidate and backend product-selection/provider result receive unambiguous names and roles.
- No two incompatible schemas export the same conceptual name.
- Conversion occurs at one tested adapter boundary; invalid provider output remains rejected.
- Design generation, Tarot candidate metadata, trace, provenance, and pricing behavior remain unchanged.

### TASK-FE-001 — dormant sequence editor

- Product owner chooses one: production role, documented experiment, or removal.
- Reachability test proves the selected lifecycle.
- If removed, tests migrate to the canonical editor and no barrel/export/import remains.
- 2D DIY add/replace/reorder/delete/fit/save/export flows remain covered.

### TASK-3D-001 — 3D lifecycle

- Record whether 3D is `EXPERIMENTAL` or approved for a specific production route.
- Production approval requires WebGL fallback, performance budget, selection parity, geometry parity, responsive QA and browser tests.
- Experimental decision keeps it out of production bundles/routes where practical and labels the feature accurately.

### TASK-BE-001 / TASK-BE-002 — backend service/module cleanup

- Source/import/composition analysis names every consumer of each candidate class/module.
- Thin wrappers either add documented application policy or are removed without deleting production factories.
- Module registry reflects real route/service ownership; metadata-only modules are labeled or removed.
- Backend unit, route, production-start and persistence tests pass.

### TASK-DB-001 — DesignTemplate lifecycle

- Choose persisted templates or deprecation with an approved schema/migration design.
- Existing data is measured and preserved or explicitly migrated; no destructive migration without backup/approval.
- Provenance `designTemplateVersion` meaning remains documented and validated.

### TASK-COMPAT-001 — legacy surfaces

- Search internal and published-package consumers for each legacy export.
- Separate required data migrations from unused TypeScript interfaces.
- Keep fixture migration coverage for any supported historical payload.
- Record removal version/date or a justified retention owner.

### TASK-ASSET-001 / TASK-ASSET-002 — resource lifecycle and parity

- Produce a runtime-reference and provenance manifest for every candidate asset.
- Empty/loading states are either mounted according to the UI spec or removed with visual approval.
- Raw marketplace image license/provenance is established before retention.
- Export output uses the same material identity/photographic mapping as the visible editor, with screenshot/image regression evidence.

### TASK-REPO-001 — evidence retention

- Hash all tracked captures/outputs and classify canonical, cited historical, reproducible raw, product deliverable, or orphan.
- Preserve every artifact cited by a controlling/current report or replace its link with a canonical equivalent.
- Define one target evidence location and `.gitignore` policy; delete only owner-approved duplicates.
- Report before/after tracked file count and repository size.

### TASK-REPO-002 — branches and worktrees

- Compare unique commits for every unmerged branch.
- Confirm no live worktree, open PR, tag, release, or recovery policy needs each deletion candidate.
- Obtain explicit user approval for remote or destructive actions.
- Record removed/retained branches and recovery references in `BRANCH_REGISTRY.md`.

### TASK-DOC-001 — current documentation

- Reconcile `README.md`, `TECH_ARCHITECTURE.md`, autonomous state, API, database and module docs against production composition roots.
- Keep historical reports unchanged or clearly label their date/baseline.
- All internal links resolve and docs do not claim dormant/experimental features are active.

### TASK-AUTH-001 — production identity

- TASK-AUTH-001 through TASK-AUTH-007 use the exact scopes, dependencies and measurable gates in `docs/TASK_DISPATCH_PACKAGE.md`.
- Approved threat model, identity provider and browser session topology exist before dependency or implementation tasks.
- Protected APIs use production-verifiable identity, collision-safe internal actor mapping, authorization and expiry/revocation.
- Reusable credentials never enter browser storage/client bundles; development/test actor paths cannot be enabled in production.
- Security, privacy, API, database, deployment, rollback and operational recovery docs match the integrated code.
- Only TASK-AUTH-007 may record `FEATURE ACCEPTANCE: PASS` after isolated desktop/mobile E2E and two-user isolation pass.

## Task transition rules

- `BACKLOG -> READY`: dependencies and acceptance criteria are complete.
- `READY -> IN_PROGRESS`: owner claims the row, creates the exact branch/worktree, and records writable paths.
- `IN_PROGRESS -> REVIEW`: implementation and required checks pass; diff stays within registered paths.
- `REVIEW -> DONE`: owner feedback is addressed and handoff evidence is recorded.
- `BLOCKED`: name the external decision/dependency; do not occupy a path lock unless partial work must be protected.
- Only one row may claim a writable path at a time.
