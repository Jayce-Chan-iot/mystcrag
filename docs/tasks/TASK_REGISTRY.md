# Task Registry

One task equals one accountable owner, one branch, one writable path set, and one acceptance gate. This registry is the lock authority.

## Governance baseline task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-GOV-001 | SOL | `task/gov-001-repository-governance` | DONE | `AGENTS.md`, `docs/INDEX.md`, `docs/governance/**`, `docs/tasks/**`, Phase 0 plan | `apps/**`, `packages/**`, Prisma, branches/worktrees, pre-existing user changes |
| TASK-AUDIT-001 | SOL | `task/audit-001-baseline-planning` | DONE | `docs/INDEX.md`, `docs/governance/CURRENT_REPOSITORY_MAP.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/MODULE_OWNERS.md`, `docs/governance/REPOSITORY_HEALTH.md`, `docs/governance/BRANCH_REGISTRY.md`, `docs/governance/BASELINE_VALIDATION.md`, `docs/tasks/TASK_REGISTRY.md`, `docs/CURRENT_PRODUCT_STATUS.md`, `docs/NEXT_PHASE_BACKLOG.md`, `docs/FEATURE-*_PLAN.md`, `docs/TASK_DISPATCH_PACKAGE.md` | `apps/**`, `packages/**`, Prisma, root/runtime configuration, tests, generated output, pre-existing user changes and untracked files |
| TASK-AUDIT-002 | SOL | `task/audit-002-product-competitor-cross-platform` | DONE: accepted candidate `05d63d062405aaa7d9d733c35c7e16b3b5eb162a`; competitor authority is Product Owner conversation `6a8ac667-ebb4-83ea-99f9-bb5b267dd97a`; formal matrix is Qi Yi Crystal, 养个石头, 盘个串串, 良旺手作, Lucid Beads and BeadDIY; exactly one first Worker, Qwen/TASK-FE-002, remains PROPOSED and is not started; TASK-CORE-001 is withdrawn; current-run screenshot capture was browser-blocked and excluded from visual-certification claims; architecture 15/15 PASS; `pnpm validate` 15/15 packages PASS; git diff check PASS | `docs/tasks/TASK_REGISTRY.md`, `docs/M0_PRODUCT_COMPETITOR_CROSS_PLATFORM_AUDIT.md`, `docs/CURRENT_PRODUCT_STATUS.md`, `docs/NEXT_PHASE_BACKLOG.md`, `docs/TASK_DISPATCH_PACKAGE.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/governance/REPOSITORY_HEALTH.md`, `docs/governance/CURRENT_REPOSITORY_MAP.md`, `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/MODULE_OWNERS.md` | `apps/**`, `packages/**`, `tests/**`, Prisma schema/migrations, package manifests/lockfile, CI/runtime configuration, Auth implementation, `.env`/Secrets, generated output, historical evidence reports, pre-existing user changes and untracked `docs/audit/**` content |
| TASK-BASELINE-001 | SOL | `task/baseline-001-governance-integration` | DONE | `docs/INDEX.md`, `docs/governance/BRANCH_REGISTRY.md`, `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/DUPLICATE_CODE_AUDIT.md`, `docs/governance/BASELINE_VALIDATION.md`, `docs/governance/REPOSITORY_HEALTH.md`, `docs/tasks/TASK_REGISTRY.md`, `docs/P0_BASELINE_CLOSURE_DISPATCH.md`, `docs/superpowers/plans/2026-08-24-p0-schema-closure.md` | `apps/**`, `packages/**`, Prisma, root/runtime configuration, tests, generated output, QA evidence, pre-existing user changes and FEAT-018 implementation |

No cleanup task currently holds a path lock. A `READY` task may move to `IN_PROGRESS` only after its owner creates the registered branch/worktree and records exact writable paths.

## Active product development

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-FE-002 | FRONTEND / Qwen | `task/fe-002-competitive-diy-experience` | DONE — SOL accepted and fast-forward integrated final candidate `30782261eb63e74f6c22083b9580d4a114e222bc` on 2026-09-01 (implementation `6f1beae5f8e46544c31065fbe626f7f8015558ff`, review registration `0bc438080b597d00c858462132f6288dae73668b`, repair `30782261eb63e74f6c22083b9580d4a114e222bc`). All four review gaps are closed: pointer/slot angle alignment, mobile bottom-navigation clearance, visible discarded-edit recovery, and coherent optimistic `UPDATE_BRACELET` derivation. Canonical Bracelet Engine, Design Contract, server pricing/inventory/revision authority, and Auth boundaries remain unchanged. Final acceptance evidence: Bracelet Engine 4/4 tests PASS; frontend 436/436 tests PASS; frontend lint/typecheck/build PASS; architecture/lifecycle 16/16 PASS; Prisma validation PASS; full `pnpm validate` PASS; `git diff --check` PASS. Sanctioned local signed-test screenshots cover 1440/430/390/375 viewports, directional drag/drop, pointer cancellation, conflict/recovery/dismissal, and mobile catalog clearance; zero unexpected console/network failures reported. | `apps/frontend/src/features/design/components/diy-editor.tsx`, `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`, `apps/frontend/src/features/design/components/crystal-bead-image.tsx`, `apps/frontend/src/features/design/model/bracelet-fit.ts`, `apps/frontend/src/features/design/model/visual-assets.ts`, `apps/frontend/src/features/design/model/optimistic-design.ts` (new), `apps/frontend/src/features/design/model/optimistic-design.test.tsx` (new), `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`, `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`, exact TASK-FE-002 row in `docs/tasks/TASK_REGISTRY.md`, exact FEAT-004 row in `docs/governance/FEATURE_REGISTRY.md`; ignored task-owned evidence under `output/playwright/task-fe-002/{before,after}/` | `apps/backend/**`, every non-design frontend feature, `apps/frontend/public/**`, `docs/ui-references/**`, `packages/**`, unlisted `tests/**`, Prisma/migrations, package manifests, `pnpm-lock.yaml`, CI/runtime configuration, Auth implementation/contracts/tests, `.env`/Secrets, generated output, `.gitignore`, repository-root or tracked screenshots, other tasks' Playwright evidence |

## Completed cleanup task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-REPO-001 | QA | `task/repo-001-evidence-retention` | DONE | tracked QA/output evidence under `artifacts/**`, `output/playwright/**`, `outputs/**`, `qa-captures-*/**`, `apps/frontend/qa-captures/**`, frontend root QA PNGs, `scripts/ui-qa/artifacts/**`, `scripts/ui-qa/qa-captures-final/**`; `.gitignore`; `docs/QA_PHASE_3_REPORT.md`; governance/task/plan docs | runtime source, `apps/frontend/public/**`, `docs/ui-references/**`, knowledge coverage JSON, current spreadsheet deliverables, user files and other worktrees |

## Bead asset import planning tasks

| Task | Owner | Branch | Status | Dependencies | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-ASSET-IMPORT-001 | SOL | `task/asset-import-001-design` | DONE | TASK-GOV-001; Product Owner approved the local-first, cloud-ready design direction and written specification on 2026-08-31 | `docs/tasks/TASK_REGISTRY.md`, `docs/INDEX.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/superpowers/specs/2026-08-31-bead-asset-import-assistant-design.md` | `apps/**`, `packages/**`, Prisma schema/migrations, root configuration, tests, runtime assets, source bead photographs, generated outputs, pre-existing unrelated user changes |
| TASK-ASSET-IMPORT-PLAN-001 | SOL | `task/asset-import-plan-001-implementation-plan` | DONE | TASK-ASSET-IMPORT-001; Product Owner approved dispatch on 2026-08-31 and resumed it on 2026-09-01 after architecture optimization | `docs/tasks/TASK_REGISTRY.md`, `docs/governance/MODULE_OWNERS.md`, `docs/superpowers/plans/2026-08-31-bead-asset-import-assistant-implementation-plan.md` | `apps/**`, `packages/**`, Prisma schema/migrations, root configuration, tests, runtime assets, source bead photographs, generated outputs, pre-existing unrelated user changes |

## Bead asset import implementation chain

Only the named executor may claim an implementation task. SOL plans, reviews, records acceptance and archives; SOL does not implement runtime code.

### Task 2 acceptance archive

| Task | Owner | Branch | Status | Dependencies | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-ASSET-DB-REVIEW-001 | SOL | `task/asset-db-review-001-acceptance-archive` | DONE | Accepted candidate `8d66120dc533e30d6d7d0e2bf6ac8a3456cdee23`; corrected report archived byte-for-byte; independent fresh PostgreSQL 178/178, workspace validation and document checks PASS on 2026-09-03 | `docs/tasks/TASK_REGISTRY.md`, `docs/qa/asset-db-001/GLM_HANDOFF.md`, `docs/qa/asset-db-001/SOL_REVIEW.md` | runtime code, tests, schema/migrations, root configuration, source report and photographs, existing evidence, push/PR/merge, other branches/worktrees |

This documentation-only task reuses the idle SOL worktree `.worktrees/asset-import-plan-001` on its dedicated acceptance branch. Its scope is registration, evidence preservation and acceptance recording only; it does not start Task 3 or authorize integration.

Acceptance evidence: [SOL review and limitations](../qa/asset-db-001/SOL_REVIEW.md), [original GLM final handoff](../qa/asset-db-001/GLM_HANDOFF.md). Task 2 has completed implementation review and is accepted as `DONE` for the database scope only; mainline integration remains **PENDING**. Task 3 remains `BACKLOG` until integration is confirmed and dispatch is separately registered. The proposed QWEN `TASK-ASSET-CONTRACT-002` handoff was cancelled by the Product Owner; neither human asset-review nor CrystalDraft-curation HTTP contracts are available, and this archive does not reschedule that work.

| Task | Owner | Branch | Status | Dependencies | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-ASSET-CONTRACT-001 | QWEN | `task/asset-contract-001-admin-dtos` | DONE | TASK-ASSET-IMPORT-PLAN-001; SOL accepted `4d61537`; PR #4 merged as `dea4e3a` on 2026-09-02 | `packages/design-contract/src/schemas/bead-asset-import-api.schema.ts`, `packages/design-contract/src/index.ts`, `packages/design-contract/tests/bead-asset-import-api.test.ts`, `docs/API_SPECIFICATION.md` | all other paths; source bead photographs; generated output |
| TASK-ASSET-DB-001 | GLM | `task/asset-db-001-draft-persistence` | DONE | TASK-ASSET-CONTRACT-001 `DONE`; SOL accepted `8d66120` and final handoff on 2026-09-03 via TASK-ASSET-DB-REVIEW-001; database scope PASS, mainline integration PENDING, human API Contract gaps retained | `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/20260831_add_bead_asset_import/migration.sql`, `packages/database/src/repositories/asset-import.repository.ts`, `packages/database/src/repositories/asset-import.repository.unit.test.ts`, `packages/database/src/repositories/asset-import.repository.integration.test.ts`, `packages/database/src/index.ts`, `docs/DATABASE_SCHEMA.md`; retrospectively accepted exact migration-list-only deviation: `packages/database/src/repositories/persistence.integration.test.ts` (+2/-1, net +1 line) | all other paths; destructive migration; generated Prisma client; source bead photographs |
| TASK-ASSET-WORKER-001 | GLM | `task/asset-worker-001-local-pipeline` | BACKLOG | TASK-ASSET-CONTRACT-001, TASK-ASSET-DB-001 | `packages/asset-pipeline/**`, `apps/asset-worker/**`, `package.json`, `pnpm-lock.yaml`, `turbo.json`, `.env.example`, `docs/ASSET_PIPELINE.md` | all other paths; source bead photographs; generated output; network/generative image services |
| TASK-ASSET-BE-001 | GLM | `task/asset-be-001-import-api` | BACKLOG | TASK-ASSET-CONTRACT-001, TASK-ASSET-DB-001, TASK-ASSET-WORKER-001 | `apps/backend/src/modules/bead-asset-import/**`, `apps/backend/src/modules/product-assets/**`, `apps/backend/src/app.ts`, `apps/backend/src/index.ts`, `apps/backend/package.json`, `docs/SECURITY_AND_PRIVACY.md` | all other paths; source bead photographs; reusable admin credentials in responses/logs/client bundles |
| TASK-ASSET-FE-001 | QWEN | `task/asset-fe-001-admin-flow` | BACKLOG | TASK-ASSET-BE-001 | `apps/frontend/app/admin/page.tsx`, `apps/frontend/app/admin/bead-import/**`, `apps/frontend/app/api/admin/bead-import/**`, `apps/frontend/src/features/admin-bead-import/**` | all other paths; knowledge-admin routes; source bead photographs; public runtime visual resolver |
| TASK-ASSET-RESOLVER-001 | QWEN | `task/asset-resolver-001-runtime-visuals` | BACKLOG | TASK-ASSET-BE-001, TASK-ASSET-FE-001 | `apps/frontend/src/features/design/model/visual-assets.ts`, `apps/frontend/src/features/design/model/visual-assets.test.tsx`, `apps/frontend/src/features/design/components/crystal-bead-image.tsx`, exact frontend consumers of `CrystalBeadImage` or `getBeadVisual` named in the task claim, `apps/frontend/app/api/assets/**` | all other paths; deletion of static fallback assets; source bead photographs |
| TASK-ASSET-QA-001 | QWEN | `task/asset-qa-001-integration-gate` | BACKLOG | TASK-ASSET-DB-001, TASK-ASSET-WORKER-001, TASK-ASSET-BE-001, TASK-ASSET-FE-001, TASK-ASSET-RESOLVER-001 | `tests/bead-asset-import-architecture.test.mjs`, `scripts/ui-qa/bead_import_flow.py`, `docs/qa/BEAD_ASSET_IMPORT_ACCEPTANCE.md` | runtime implementation; checked-in raw bead photographs; checked-in QA screenshots/output; unrelated tests |
| TASK-ASSET-REVIEW-001 | SOL | `task/asset-review-001-acceptance-archive` | BACKLOG | TASK-ASSET-QA-001 | `docs/tasks/TASK_REGISTRY.md`, `docs/governance/FEATURE_REGISTRY.md`, `docs/qa/BEAD_ASSET_IMPORT_ACCEPTANCE.md` | runtime implementation; tests; root configuration; source bead photographs; generated output |

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
| TASK-AUTH-005 | FRONTEND / Qwen | P0 | TASK-AUTH-002, TASK-AUTH-003, TASK-AUTH-004 DONE | `task/auth-005-frontend-session` | DONE: SOL accepted and fast-forward integrated final candidate `071c1700328de3551976eaa42ea361e5028028a2`; secure-cookie BFF/session lifecycle, token custody, fail-closed dependency handling, privacy-safe events, frontend 397/397 tests, production build and full workspace validation PASS |
| TASK-AUTH-006 | QA / GLM | P0 | TASK-AUTH-004, TASK-AUTH-005, TASK-AUTH-008 DONE | `task/auth-006-security-e2e` | DONE: SOL accepted and fast-forward integrated final candidate `1412d657236ade40872d71d4468df3d66391040c`; `pnpm validate` passed 15/15 packages and the final isolated run `rmtf8gu2csc2y1frhp4` passed 54/54 security/full-loop E2E with `stoppedAt`, all owned processes exited, ports released, isolated database dropped and verified gone, and artifact secret scan PASS |
| TASK-AUTH-007 | SOL | P0 | TASK-AUTH-006 DONE | `task/auth-007-final-integration` | BLOCKED — `DEPLOYMENT_ACCEPTANCE_DEFERRED_BY_PRODUCT_OWNER`: implementation, workspace/PostgreSQL replay, 54-test security E2E, cleanup and artifact gates PASS. The approved steady-state session lookup budget is p95 added latency <= 100 ms after 30 warm-up requests over >= 300 same-region staging samples; renewal/JWKS cold paths are measured separately. Product Owner intentionally deferred staging/production deployment, so real Origins, byte-exact Auth0 allowlists, the staging benchmark and real login/logout smoke remain production release gates. This deployment-only blocker does not block separately registered non-auth Features; AUTH-007 itself may not expand scope, redesign Auth, weaken gates or implement unrelated Features |
| TASK-AUTH-008 | FRONTEND / Qwen | P0 | TASK-AUTH-005 DONE; production defect discovered by TASK-AUTH-006 candidate `3bbf8058d6a236064567ed9f0e9b3bd74597ac42` | `task/auth-008-bff-mutation-session-repair` | DONE: SOL accepted and fast-forward integrated final candidate `8b1edacb2df7041e39b39547bf4c37f3eaad936f`; byte-preserving mutation forwarding, bodyless SDK request normalization, framing-header removal, Frontend 405/405 tests, lint, typecheck, production build, independent review and `pnpm validate` PASS |

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

### TASK-ASSET-IMPORT-001 / TASK-ASSET-IMPORT-PLAN-001 — bead asset import design and dispatch

- Preserve original ARW/JPG files outside Git with hash-verified archival, resumability, draft-only writes and transactional publication.
- Require similarity grouping plus human naming; prohibit mineral, quality or treatment inference and generative texture changes.
- Register one dependency-ordered owner, branch and precise path set per implementation task; all runtime work belongs to QWEN or GLM.
- Provide test-first steps, concrete interfaces, verification commands, commit messages and SOL review gates without SOL runtime edits.

### TASK-DOC-001 — current documentation

- Reconcile `README.md`, `TECH_ARCHITECTURE.md`, autonomous state, API, database and module docs against production composition roots.
- Keep historical reports unchanged or clearly label their date/baseline.
- All internal links resolve and docs do not claim dormant/experimental features are active.

### TASK-AUTH-001 — production identity

- TASK-AUTH-001 through TASK-AUTH-007 use the exact scopes, dependencies and measurable gates in `docs/TASK_DISPATCH_PACKAGE.md`.
- TASK-AUTH-008 is the narrowly registered production-defect repair discovered by the red TASK-AUTH-006 gate; its exact scope and acceptance gate are authoritative in this registry and mirrored in the dispatch package.
- Approved threat model, identity provider and browser session topology exist before dependency or implementation tasks.
- Protected APIs use production-verifiable identity, collision-safe internal actor mapping, authorization and expiry/revocation.
- Reusable credentials never enter browser storage/client bundles; development/test actor paths cannot be enabled in production.
- Security, privacy, API, database, deployment, rollback and operational recovery docs match the integrated code.
- Only TASK-AUTH-007 may record `FEATURE ACCEPTANCE: PASS` after isolated desktop/mobile E2E and two-user isolation pass.

### TASK-AUTH-008 — BFF mutation session rolling repair

- Preserve Origin validation before every session/token side effect and preserve the frozen server-controlled secure-cookie topology.
- Authenticated mutation bodies remain byte-for-byte available to the backend while the real Auth0 SDK performs passive rolling; no consumed, disturbed or locked body stream is handed to SDK reconstruction.
- Rolling `Set-Cookie`, no-store failure envelopes, token custody and distinct 401/403/500 semantics remain unchanged.
- Add a regression that fails on baseline `4cac24cb1ebf29bc96bc4ab24c3b7a0fd6593fd1` and passes after the repair, covering a body-bearing mutation through the production request types rather than a bodyless mock.
- Frontend auth tests, frontend lint/typecheck/production build and `pnpm validate` pass; no AUTH-006 test or CI assertion is weakened.
- TASK-AUTH-008 landed before the final AUTH-006 rebase; the accepted 54-test gate passed twice on the candidate and 54/54 again after main integration, with complete cleanup and artifact-scan evidence, unblocking TASK-AUTH-007.

## Task transition rules

- `BACKLOG -> READY`: dependencies and acceptance criteria are complete.
- `READY -> IN_PROGRESS`: owner claims the row, creates the exact branch/worktree, and records writable paths.
- `IN_PROGRESS -> REVIEW`: implementation and required checks pass; diff stays within registered paths.
- `REVIEW -> DONE`: owner feedback is addressed and handoff evidence is recorded.
- `BLOCKED`: name the external decision/dependency; do not occupy a path lock unless partial work must be protected.
- Only one row may claim a writable path at a time.
