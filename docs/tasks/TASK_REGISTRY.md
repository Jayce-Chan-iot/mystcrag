# Task Registry

One task equals one accountable owner, one branch, one writable path set, and one acceptance gate. This registry is the lock authority.

## Governance baseline task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-GOV-001 | SOL | `task/gov-001-repository-governance` | DONE | `AGENTS.md`, `docs/INDEX.md`, `docs/governance/**`, `docs/tasks/**`, Phase 0 plan | `apps/**`, `packages/**`, Prisma, branches/worktrees, pre-existing user changes |
| TASK-AUDIT-001 | SOL | `task/audit-001-baseline-planning` | REVIEW | `docs/INDEX.md`, `docs/audit/MYSTCRAG_2_0_AUDIT.md`, `docs/progress/PROJECT_STATUS.md`, `docs/governance/CURRENT_REPOSITORY_MAP.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/MODULE_OWNERS.md`, `docs/governance/REPOSITORY_HEALTH.md`, `docs/governance/BRANCH_REGISTRY.md`, `docs/governance/BASELINE_VALIDATION.md`, `docs/tasks/TASK_REGISTRY.md`, `docs/CURRENT_PRODUCT_STATUS.md`, `docs/NEXT_PHASE_BACKLOG.md`, `docs/FEATURE-*_PLAN.md`, `docs/TASK_DISPATCH_PACKAGE.md` | `apps/**`, `packages/**`, Prisma, root/runtime configuration, tests, generated output, pre-existing unrelated user changes and untracked files outside the two exact M0 output paths |

No cleanup task currently holds a path lock. A `READY` task may move to `IN_PROGRESS` only after its owner creates the registered branch/worktree and records exact writable paths.

## Completed cleanup task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-REPO-001 | QA | `task/repo-001-evidence-retention` | DONE | tracked QA/output evidence under `artifacts/**`, `output/playwright/**`, `outputs/**`, `qa-captures-*/**`, `apps/frontend/qa-captures/**`, frontend root QA PNGs, `scripts/ui-qa/artifacts/**`, `scripts/ui-qa/qa-captures-final/**`; `.gitignore`; `docs/QA_PHASE_3_REPORT.md`; governance/task/plan docs | runtime source, `apps/frontend/public/**`, `docs/ui-references/**`, knowledge coverage JSON, current spreadsheet deliverables, user files and other worktrees |

## Bead asset import planning tasks

| Task | Owner | Branch | Status | Dependencies | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-ASSET-IMPORT-001 | SOL | `task/asset-import-001-design` | DONE | TASK-GOV-001; Product Owner approved the local-first, cloud-ready design direction and written specification on 2026-08-31 | `docs/tasks/TASK_REGISTRY.md`, `docs/INDEX.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/superpowers/specs/2026-08-31-bead-asset-import-assistant-design.md` | `apps/**`, `packages/**`, Prisma schema/migrations, root configuration, tests, runtime assets, source bead photographs, generated outputs, pre-existing unrelated user changes |
| TASK-ASSET-IMPORT-PLAN-001 | SOL | `task/asset-import-plan-001-implementation-plan` | DONE | TASK-ASSET-IMPORT-001; Product Owner approved dispatch on 2026-08-31 | `docs/tasks/TASK_REGISTRY.md`, `docs/governance/MODULE_OWNERS.md`, `docs/superpowers/plans/2026-08-31-bead-asset-import-assistant-implementation-plan.md` | `apps/**`, `packages/**`, Prisma schema/migrations, root configuration, tests, runtime assets, source bead photographs, generated outputs, pre-existing unrelated user changes |

## Bead asset import implementation chain

Only the named executor may claim an implementation task. SOL plans, reviews, records acceptance and archives; SOL does not implement runtime code.

| Task | Owner | Branch | Status | Dependencies | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-ASSET-CONTRACT-001 | QWEN | `task/asset-contract-001-admin-dtos` | IN_PROGRESS | TASK-ASSET-IMPORT-PLAN-001; QWEN dispatch accepted on 2026-08-31 | `packages/design-contract/src/schemas/bead-asset-import-api.schema.ts`, `packages/design-contract/src/index.ts`, `packages/design-contract/tests/bead-asset-import-api.test.ts`, `docs/API_SPECIFICATION.md` | all other paths; source bead photographs; generated output |
| TASK-ASSET-DB-001 | QWEN | `task/asset-db-001-draft-persistence` | BACKLOG | TASK-ASSET-CONTRACT-001 | `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/20260831_add_bead_asset_import/migration.sql`, `packages/database/src/repositories/asset-import.repository.ts`, `packages/database/src/repositories/asset-import.repository.unit.test.ts`, `packages/database/src/repositories/asset-import.repository.integration.test.ts`, `packages/database/src/index.ts`, `docs/DATABASE_SCHEMA.md` | all other paths; destructive migration; generated Prisma client; source bead photographs |
| TASK-ASSET-WORKER-001 | GLM | `task/asset-worker-001-local-pipeline` | BACKLOG | TASK-ASSET-CONTRACT-001, TASK-ASSET-DB-001 | `packages/asset-pipeline/**`, `apps/asset-worker/**`, `package.json`, `pnpm-lock.yaml`, `turbo.json`, `.env.example`, `docs/ASSET_PIPELINE.md` | all other paths; source bead photographs; generated output; network/generative image services |
| TASK-ASSET-BE-001 | QWEN | `task/asset-be-001-import-api` | BACKLOG | TASK-ASSET-CONTRACT-001, TASK-ASSET-DB-001, TASK-ASSET-WORKER-001 | `apps/backend/src/modules/bead-asset-import/**`, `apps/backend/src/modules/product-assets/**`, `apps/backend/src/app.ts`, `apps/backend/src/index.ts`, `apps/backend/package.json`, `docs/SECURITY_AND_PRIVACY.md` | all other paths; source bead photographs; reusable admin credentials in responses/logs/client bundles |
| TASK-ASSET-FE-001 | GLM | `task/asset-fe-001-admin-flow` | BACKLOG | TASK-ASSET-BE-001 | `apps/frontend/app/admin/page.tsx`, `apps/frontend/app/admin/bead-import/**`, `apps/frontend/app/api/admin/bead-import/**`, `apps/frontend/src/features/admin-bead-import/**` | all other paths; knowledge-admin routes; source bead photographs; public runtime visual resolver |
| TASK-ASSET-RESOLVER-001 | GLM | `task/asset-resolver-001-runtime-visuals` | BACKLOG | TASK-ASSET-BE-001, TASK-ASSET-FE-001 | `apps/frontend/src/features/design/model/visual-assets.ts`, `apps/frontend/src/features/design/model/visual-assets.test.tsx`, `apps/frontend/src/features/design/components/crystal-bead-image.tsx`, exact frontend consumers of `CrystalBeadImage` or `getBeadVisual` named in the task claim, `apps/frontend/app/api/assets/**` | all other paths; deletion of static fallback assets; source bead photographs |
| TASK-ASSET-QA-001 | QWEN | `task/asset-qa-001-integration-gate` | BACKLOG | TASK-ASSET-DB-001, TASK-ASSET-WORKER-001, TASK-ASSET-BE-001, TASK-ASSET-FE-001, TASK-ASSET-RESOLVER-001 | `tests/bead-asset-import-architecture.test.mjs`, `scripts/ui-qa/bead_import_flow.py`, `docs/qa/BEAD_ASSET_IMPORT_ACCEPTANCE.md` | runtime implementation; checked-in raw bead photographs; checked-in QA screenshots/output; unrelated tests |
| TASK-ASSET-REVIEW-001 | SOL | `task/asset-review-001-acceptance-archive` | BACKLOG | TASK-ASSET-QA-001 | `docs/tasks/TASK_REGISTRY.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/progress/PROJECT_STATUS.md`, `docs/qa/BEAD_ASSET_IMPORT_ACCEPTANCE.md` | runtime implementation; tests; root configuration; source bead photographs; generated output |

## Cleanup backlog

| Task | Owner | Priority | Dependency | Proposed branch | Scope/status |
| --- | --- | ---: | --- | --- | --- |
| TASK-BASELINE-001 | SOL | P0 | TASK-AUDIT-001 review + Product Owner approval | `task/baseline-001-governance-integration` | BACKLOG: integrate the complete governance/audit candidate into protected local `main` without partial registries |
| TASK-CONTRACT-001 | CONTRACT | P0 | TASK-BASELINE-001 | `task/contract-001-tarot-schema-authority` | BACKLOG: make Design Contract the shared Tarot enum authority |
| TASK-TAROT-001 | TAROT | P0 | TASK-CONTRACT-001 | `task/tarot-001-consume-shared-contract` | BACKLOG: consume shared enums while retaining private draw validation |
| TASK-AI-001 | AI | P0 | TASK-BASELINE-001 | `task/ai-001-candidate-contract-decision` | BACKLOG: name and document canonical AI provider candidate |
| TASK-BE-003 | BACKEND | P0 | TASK-AI-001 | `task/be-003-ai-candidate-boundary` | BACKLOG: rename/project backend local candidate boundary |
| TASK-BASELINE-002 | QA | P0 | TASK-TAROT-001, TASK-BE-003 | `task/baseline-002-freeze-validation` | BACKLOG: nominate candidate and replay install/lint/typecheck/test/build/PostgreSQL/isolated signed-test browser smoke |
| TASK-FE-001 | FRONTEND | P1 | TASK-GOV-001 | `task/fe-001-dormant-editor-lifecycle` | READY: decide `BraceletSequenceEditor` lifecycle |
| TASK-3D-001 | THREE | P1 | TASK-GOV-001 | `task/3d-001-production-readiness-decision` | READY: evidence-based 3D mount/experimental decision |
| TASK-BE-001 | BACKEND | P1 | TASK-GOV-001 | `task/be-001-service-wrapper-cleanup` | READY: prove/retire or justify uncomposed wrappers |
| TASK-BE-002 | BACKEND | P1 | TASK-BE-001 | `task/be-002-module-boundary-cleanup` | BACKLOG: implement or retire metadata-only module shells |
| TASK-DB-001 | DATABASE | P1 | TASK-GOV-001 | `task/db-001-design-template-lifecycle` | READY: adopt or migrate dormant `DesignTemplate` model |
| TASK-COMPAT-001 | SOL | P2 | TASK-CONTRACT-001, TASK-AI-001 | `task/compat-001-legacy-surface-audit` | BACKLOG: usage proof and retirement plan for explicit legacy exports |
| TASK-ASSET-001 | ASSET | P1 | TASK-GOV-001 | `task/asset-001-orphan-resource-decision` | READY: wire/remove state assets and resolve raw crystal image provenance |
| TASK-ASSET-002 | FRONTEND | P1 | TASK-ASSET-001 | `task/asset-002-export-visual-parity` | BACKLOG: align canvas export with photographic visible beads |
| TASK-REPO-002 | SOL | P2 | TASK-REPO-001 | `task/repo-002-branch-worktree-cleanup` | BACKLOG: review unique commits and clean branch/worktree metadata |
| TASK-DOC-001 | SOL | P2 | all P1 decisions | `task/doc-001-current-architecture-refresh` | BACKLOG: update stale controlling architecture/status statements |
| TASK-AUTH-001 | SOL | P0 | TASK-BASELINE-002 + Product Owner provider/topology inputs | `task/auth-001-identity-contract` | BLOCKED: freeze production identity/session contract; `CONTRACT_REQUIRES_IMPLEMENTATION_VALIDATION` |
| TASK-AUTH-002 | SOL | P0 | TASK-AUTH-001 | `task/auth-002-dependency-baseline` | BACKLOG: single-writer dependency/configuration baseline |
| TASK-AUTH-003 | DATABASE | P0 | TASK-AUTH-002 | `task/auth-003-identity-persistence` | BACKLOG: external identity mapping and idempotent User provisioning |
| TASK-AUTH-004 | BACKEND | P0 | TASK-AUTH-003 | `task/auth-004-backend-provider` | BACKLOG: production verifier and authenticated actor composition |
| TASK-AUTH-005 | FRONTEND | P0 | TASK-AUTH-002 | `task/auth-005-frontend-session` | BACKLOG: login/session/logout UX; may parallel AUTH-003/004 on disjoint paths |
| TASK-AUTH-006 | QA | P0 | TASK-AUTH-004, TASK-AUTH-005 | `task/auth-006-security-e2e` | BACKLOG: isolated security, two-user and protected full-loop E2E gate |
| TASK-AUTH-007 | SOL | P0 | TASK-AUTH-006 | `task/auth-007-final-integration` | BACKLOG: acceptance review, documentation reconciliation and integration |

## Acceptance gates

### TASK-GOV-001 — Phase 0 governance

- Deliver all requested governance files and link them from the docs index.
- Record every workspace, feature family, owner, canonical authority, branch class, and health priority.
- Mark duplicate/dormant/unused code and resources with evidence and confidence.
- Modify no runtime code, schema, branch metadata, or unrelated user file.
- Pass path/link checks, architecture tests, workspace validation, and final diff review.

### TASK-BASELINE-001 / TASK-BASELINE-002 — integrate and freeze

- Integrate the complete governance/audit candidate; `main` must never contain partial or contradictory registries.
- Resolve both P0 contract DAGs before nominating the freeze candidate.
- Candidate worktree has no unexplained change and every controlling registry names the same commit/code state.
- Frozen install, lint, typecheck, tests, build, fresh PostgreSQL verification and isolated signed-test authenticated browser smoke pass.
- Product Owner records and approves the exact baseline commit before Feature tasks become `READY`.

### TASK-CONTRACT-001 / TASK-TAROT-001 — Tarot contract authority

- Shared public enums have exactly one definition source.
- Tarot Engine retains deck integrity, private state, slot-order, uniqueness, and reveal invariants.
- Backend, frontend, database and Tarot tests compile and pass with no unsafe casts.
- Contract and Tarot specs describe public versus private ownership.

### TASK-AI-001 / TASK-BE-003 — AI candidate boundaries

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

### TASK-ASSET-IMPORT-001 — bead asset import assistant design

- Specify a standalone `/admin/bead-import` entry and a local-first, cloud-ready architecture without changing runtime code.
- Preserve original ARW/JPG files outside Git; define hash-verified archival, resumable processing, draft-only database writes and transactional publication.
- Require similarity grouping plus human naming; prohibit mineral, quality or treatment inference from photographs.
- Define conservative background removal and image enhancement that does not generate texture or silently alter product color.
- Define module boundaries, data lifecycle, failure recovery, security controls, rollout decomposition and measurable acceptance tests.
- Pass architecture tests, internal document-link validation and final scope/diff review before moving the task to REVIEW.

### TASK-ASSET-IMPORT-PLAN-001 — implementation dispatch plan

- Register a dependency-ordered implementation chain with one owner, branch and precise writable path set per task.
- Assign all runtime implementation to GLM or QWEN; limit SOL to planning, review, acceptance recording and archival.
- Provide test-first steps, concrete interfaces, narrow and repository-wide verification commands, commit messages and SOL review gates.
- Cover contract, database, archive/pipeline worker, backend security/API, standalone admin UI, runtime resolver, integration QA and final acceptance without modifying runtime code.
- Pass architecture tests, internal document-path validation, `pnpm validate` and final diff review before moving the plan to REVIEW.

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
