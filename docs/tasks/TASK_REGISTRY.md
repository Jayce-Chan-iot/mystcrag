# Task Registry

One task equals one accountable owner, one branch, one writable path set, and one acceptance gate. This registry is the lock authority.

## Governance baseline task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-GOV-001 | SOL | `task/gov-001-repository-governance` | DONE | `AGENTS.md`, `docs/INDEX.md`, `docs/governance/**`, `docs/tasks/**`, Phase 0 plan | `apps/**`, `packages/**`, Prisma, branches/worktrees, pre-existing user changes |

No cleanup task currently holds a path lock. A `READY` task may move to `IN_PROGRESS` only after its owner creates the registered branch/worktree and records exact writable paths.

## Completed cleanup task

| Task | Owner | Branch | Status | Writable paths | Forbidden paths |
| --- | --- | --- | --- | --- | --- |
| TASK-REPO-001 | QA | `task/repo-001-evidence-retention` | DONE | tracked QA/output evidence under `artifacts/**`, `output/playwright/**`, `outputs/**`, `qa-captures-*/**`, `apps/frontend/qa-captures/**`, frontend root QA PNGs, `scripts/ui-qa/artifacts/**`, `scripts/ui-qa/qa-captures-final/**`; `.gitignore`; `docs/QA_PHASE_3_REPORT.md`; governance/task/plan docs | runtime source, `apps/frontend/public/**`, `docs/ui-references/**`, knowledge coverage JSON, current spreadsheet deliverables, user files and other worktrees |

## Cleanup backlog

| Task | Owner | Priority | Dependency | Proposed branch | Scope/status |
| --- | --- | ---: | --- | --- | --- |
| TASK-CONTRACT-001 | CONTRACT | P1 | TASK-GOV-001 | `task/contract-001-tarot-schema-authority` | READY: make Design Contract the shared Tarot enum authority |
| TASK-TAROT-001 | TAROT | P1 | TASK-CONTRACT-001 | `task/tarot-001-consume-shared-contract` | BACKLOG: consume shared enums while retaining private draw validation |
| TASK-AI-001 | AI | P1 | TASK-GOV-001 | `task/ai-001-candidate-contract-decision` | READY: name and document canonical AI provider candidate |
| TASK-BE-003 | BACKEND | P1 | TASK-AI-001 | `task/be-003-ai-candidate-boundary` | BACKLOG: rename/project backend local candidate boundary |
| TASK-FE-001 | FRONTEND | P1 | TASK-GOV-001 | `task/fe-001-dormant-editor-lifecycle` | READY: decide `BraceletSequenceEditor` lifecycle |
| TASK-3D-001 | THREE | P1 | TASK-GOV-001 | `task/3d-001-production-readiness-decision` | READY: evidence-based 3D mount/experimental decision |
| TASK-BE-001 | BACKEND | P1 | TASK-GOV-001 | `task/be-001-service-wrapper-cleanup` | READY: prove/retire or justify uncomposed wrappers |
| TASK-BE-002 | BACKEND | P1 | TASK-BE-001 | `task/be-002-module-boundary-cleanup` | BACKLOG: implement or retire metadata-only module shells |
| TASK-DB-001 | DATABASE | P1 | TASK-GOV-001 | `task/db-001-design-template-lifecycle` | READY: adopt or migrate dormant `DesignTemplate` model |
| TASK-COMPAT-001 | SOL | P2 | TASK-CONTRACT-001, TASK-AI-001 | `task/compat-001-legacy-surface-audit` | BACKLOG: usage proof and retirement plan for explicit legacy exports |
| TASK-ASSET-001 | ASSET | P1 | TASK-GOV-001 | `task/asset-001-orphan-resource-decision` | READY: wire/remove state assets and resolve raw crystal image provenance |
| TASK-ASSET-002 | FRONTEND | P1 | TASK-ASSET-001 | `task/asset-002-export-visual-parity` | BACKLOG: align canvas export with photographic visible beads |
| TASK-REPO-001 | QA | P1 | TASK-GOV-001 | `task/repo-001-evidence-retention` | DONE: removed 285 duplicate/reproducible files (40.93 MiB), retained cited/current evidence, and added ignore policy |
| TASK-REPO-002 | SOL | P2 | TASK-REPO-001 | `task/repo-002-branch-worktree-cleanup` | BACKLOG: review unique commits and clean branch/worktree metadata |
| TASK-DOC-001 | SOL | P2 | all P1 decisions | `task/doc-001-current-architecture-refresh` | BACKLOG: update stale controlling architecture/status statements |
| TASK-AUTH-001 | BACKEND | P1 | explicit product security spec | `task/auth-001-production-identity` | BLOCKED: requires approved production identity/session provider design |

## Acceptance gates

### TASK-GOV-001 — Phase 0 governance

- Deliver all requested governance files and link them from the docs index.
- Record every workspace, feature family, owner, canonical authority, branch class, and health priority.
- Mark duplicate/dormant/unused code and resources with evidence and confidence.
- Modify no runtime code, schema, branch metadata, or unrelated user file.
- Pass path/link checks, architecture tests, workspace validation, and final diff review.

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

### TASK-DOC-001 — current documentation

- Reconcile `README.md`, `TECH_ARCHITECTURE.md`, autonomous state, API, database and module docs against production composition roots.
- Keep historical reports unchanged or clearly label their date/baseline.
- All internal links resolve and docs do not claim dormant/experimental features are active.

### TASK-AUTH-001 — production identity

- Approved threat model and identity/session provider specification exists first.
- Protected APIs use production-verifiable identity, authorization and session expiry/revocation.
- Development/test actor paths cannot be enabled accidentally in production.
- Security, privacy, API, deployment and operational recovery docs are updated and verified.

## Task transition rules

- `BACKLOG -> READY`: dependencies and acceptance criteria are complete.
- `READY -> IN_PROGRESS`: owner claims the row, creates the exact branch/worktree, and records writable paths.
- `IN_PROGRESS -> REVIEW`: implementation and required checks pass; diff stays within registered paths.
- `REVIEW -> DONE`: owner feedback is addressed and handoff evidence is recorded.
- `BLOCKED`: name the external decision/dependency; do not occupy a path lock unless partial work must be protected.
- Only one row may claim a writable path at a time.
