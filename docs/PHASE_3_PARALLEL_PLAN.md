# Mystcrag Phase 3 Parallel Development Plan

Date: 2026-07-21  
Status: Approved  
Local baseline: `64957c1 feat: add versioned design persistence and order snapshots`

## 1. Team roles

| Role | Responsibility | Branch |
| --- | --- | --- |
| Tech Lead | Own collaboration rules, review handoffs, protect shared contracts, control merge order, and rerun the integration gate | `chore/phase-3-parallel-workflow` |
| Backend Lead | Enable authenticated design API orchestration over the existing repositories and services | `feature/backend-design-api` |
| AI Lead | Implement schema-validated recommendation generation, fixtures, and evaluations | `feature/ai-recommendation` |
| 3D Lead | Implement the bracelet scene and runtime behavior behind the existing DesignV1 adapter | `feature/three-bracelet-scene` |
| Frontend Lead | Implement the user-facing AI design flow using public API DTOs | `feature/frontend-ai-flow` |
| QA Lead | Add cross-module MVP integration and end-to-end coverage after upstream modules are merged | `test/mvp-integration` |

Each Agent records its baseline and final commit in `HANDOFF_TEMPLATE.md` format. A branch belongs to exactly one role and must not be reused by another Agent.

## 2. Branch rules

All Phase 3 role branches are created from the same latest reviewed `main` baseline. Before starting work, every Agent must run:

```sh
git status
git branch --show-current
```

If the branch is incorrect, the Agent stops and switches to its assigned branch. Agents never develop directly on `main` and never merge another Agent's work branch into their own. To synchronize after a newer `main` is available, use:

```sh
git fetch
git rebase origin/main
```

If a conflict touches another owner's module, do not resolve it by changing that module. Record the conflict and ask the Tech Lead to coordinate it.

## 3. Directory ownership

| Role | May modify | Role report |
| --- | --- | --- |
| Backend Lead | `apps/backend`, `packages/database`, backend-owned or database-owned tests | `docs/BACKEND_PHASE_3_REPORT.md` |
| AI Lead | `packages/ai-agent`, AI fixtures, AI evaluation tests | `docs/AI_PHASE_3_REPORT.md` |
| 3D Lead | `packages/three-engine`, 3D demo code, 3D tests | `docs/THREE_PHASE_3_REPORT.md` |
| Frontend Lead | `apps/frontend`, `packages/ui`, frontend tests | `docs/FRONTEND_PHASE_3_REPORT.md` |
| QA Lead | `tests`, E2E configuration, test helpers | `docs/QA_PHASE_3_REPORT.md`, `docs/BUG_REPORT.md` |

Module-local tests follow the module owner. Cross-workspace and end-to-end tests belong to QA. The Tech Lead owns the Phase 3 governance documents and reviews any requested shared-asset change.

## 4. Prohibited changes by role

- Backend Lead must not modify `apps/frontend`, `packages/ai-agent`, `packages/three-engine`, or `packages/ui`.
- AI Lead must not modify `apps/frontend`, `apps/backend`, `packages/database`, or `packages/three-engine`.
- 3D Lead must not modify `packages/ai-agent`, `packages/database`, backend business logic, or frontend product flows.
- Frontend Lead must not modify `packages/database`, `packages/ai-agent`, `packages/three-engine` internals, or backend business logic.
- QA Lead must not modify core business logic without confirmation from the responsible Agent and Tech Lead review.
- No Agent may perform opportunistic refactors outside its owned boundary or delete a documented module.

The following are shared assets and have no single feature owner:

- `packages/design-contract`
- `docs/API_SPECIFICATION.md`
- `docs/TECH_ARCHITECTURE.md`
- `docs/DATABASE_SCHEMA.md`
- `package.json`
- `pnpm-lock.yaml`
- `turbo.json`
- `tsconfig.base.json`

Before changing a shared asset, the proposing Agent must add an entry to `DECISION_LOG.md`, explain why the change cannot remain inside its owned module, and wait for Tech Lead approval. After approval and implementation, the Tech Lead notifies every affected Agent.

## 5. API and Contract dependencies

`@mystcrag/design-contract` is the only definition source for design JSON, design DTOs, schemas, and invariants. Phase 3 starts on `schemaVersion: "1.0.0"`; no Agent may redeclare or silently extend it.

```text
AI provider unknown
  -> AI candidate schema
  -> server-owned catalog, pricing, provenance, and compliance enrichment
  -> DesignV1
       -> Backend request/response schemas and services
       -> PublicDesignV1 -> Frontend
       -> designV1ToSceneDescriptor adapter -> 3D runtime
       -> repository validation -> immutable revisions and order snapshots
```

- Backend owns HTTP validation, authentication/actor identity, orchestration, stable error mapping, trusted pricing, inventory checks, and persistence calls.
- AI returns only schema-validated creative candidates or enriched `DesignV1`; provider output is always untrusted `unknown` before validation.
- 3D consumes validated `DesignV1` only through the existing adapter and keeps scene/runtime data out of API DTOs.
- Frontend consumes `PublicDesignV1` and public request/response DTOs only. It must not import database models or `@mystcrag/design-contract/internal`.
- Commercial costs, supplier references, hidden reasoning, prompts, and private conversations must never enter public DTOs, frontend state, community projections, or 3D descriptors.
- Database JSON is validated on write and read. Revision and order snapshots remain immutable.

Any required change to Contract, API, database schema, architecture, AI output contract, or 3D input contract is protocol work: record it in `DECISION_LOG.md`, update the controlling document, and obtain approval before implementation.

## 6. Mock strategy

- Use checked-in deterministic fixtures from the owning package; do not create a second design protocol for mocks.
- Backend route tests inject repository/service fakes through existing seams. Mocked success responses must still pass the public response schema.
- AI tests use provider fixtures represented as `unknown`, then validate them through `AiDesignCandidateSchema` and the final `DesignV1Schema`. No live provider or secret is required for the default test gate.
- 3D tests use validated Design Contract fixtures and pure-data asset/runtime fakes. Tests must not require WebGL, network assets, or GPU state unless explicitly isolated from `pnpm validate`.
- Frontend uses public Design Contract fixtures and mocked HTTP responses parsed by the same production boundary parser. It must not import internal fixtures containing costs.
- QA integrates only public API behavior and user-visible flows. External AI, object storage, payment, and asset services use deterministic test doubles unless a separately documented environment is available.
- A mock may replace infrastructure behavior, but it may not relax schemas, authorization, compliance, pricing, inventory, consent, or revision invariants.

## 7. Merge order

The Tech Lead merges reviewed branches to `main` in this order:

1. `feature/backend-design-api`
2. `feature/ai-recommendation`
3. `feature/three-bracelet-scene`
4. `feature/frontend-ai-flow`
5. `test/mvp-integration`

No Agent branch merges another Agent branch. After every merge, the Tech Lead runs:

```sh
pnpm install
pnpm validate
```

If either command fails, stop the merge train, preserve the failing evidence, and return the failure to the responsible Agent. Do not merge later branches until `main` is green again.

## 8. Acceptance criteria

An Agent handoff is acceptable only when:

- the branch and recorded baseline are correct;
- changes stay inside the assigned ownership boundary;
- any shared change has an approved decision-log entry and controlling documentation update;
- public APIs remain compatible with the shared schemas and stable error envelope;
- Frontend uses only public DTOs;
- 3D consumes `DesignV1` through the adapter;
- AI provider output passes candidate and final schemas;
- database revision, snapshot, money, and privacy invariants remain intact;
- no cost, supplier, private conversation, prompt, or hidden reasoning leaks into public outputs;
- focused tests and all relevant new tests pass;
- `pnpm validate` passes on the final commit;
- the role report and completed handoff include limitations, unfinished work, dependencies, and merge risks.

The Tech Lead reviews the diff, report, test evidence, API/Contract compatibility, and `INTEGRATION_CHECKLIST.md` before merging.

## 9. Three mandatory prerequisites

These rules apply to every Codex Agent without exception:

1. **Independent Git branch.** Work only on the assigned branch, never on `main` or another Agent's branch, and confirm the branch is based on the latest reviewed `main` before development.
2. **Owned module only.** Modify only the assigned directories and report. Log and obtain approval for every cross-module or shared-protocol change before implementation.
3. **Validation before commit and merge.** Run `pnpm validate` and require lint, TypeScript, unit tests, Prisma validation, Backend build, and Frontend production build to pass. A failing branch must not be committed, handed off, or merged. After each merge, the Tech Lead reruns `pnpm install` and `pnpm validate`.
