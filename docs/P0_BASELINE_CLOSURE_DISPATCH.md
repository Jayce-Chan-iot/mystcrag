# P0 Baseline Closure — Human Worker Dispatch Package

**Prepared by:** SOL / TASK-BASELINE-001<br>
**Date:** 2026-08-24<br>
**Current local main:** governance integrated; exact handoff commit reported after this package is merged<br>
**Baseline status:** `NOT READY`<br>
**Feature work:** forbidden until BASE-004 records `BASELINE STATUS: READY`

No Worker Agent has been dispatched. The Human Product Owner must dispatch BASE-002 first and must not dispatch BASE-003 until BASE-002 is reviewed, rebased, merged and validated on `main`.

## 1. Governance integration result

Review result: **PASS**.

The candidate is the linear commit chain:

```text
1a34c16 product main
  -> c1262f3 docs(governance): establish repository phase zero
  -> 7649f59 chore(repo): remove duplicate QA evidence
  -> 74fca1f docs(audit): plan baseline and production identity phase
  -> 4e7cdcb docs(governance): claim baseline closure integration
```

- `c1262f3` changes only root governance and governance/plan/task documentation.
- `7649f59` is the separately registered TASK-REPO-001 cleanup: `.gitignore`, reproducible/duplicate QA outputs and their evidence reports. It changes no business source, Prisma schema, migration or runtime asset; every deletion is recoverable from `c1262f3`.
- `74fca1f` changes only audit, planning, governance and task documents.
- `4e7cdcb` records the isolated worktree/path lock for this closure task.
- `apps/frontend/next-env.d.ts`, `docs/audit/` and `docs/progress/` are absent from the entire commit chain.

The chain was fast-forwarded into local `main`; nothing was pushed. Frozen install and `pnpm validate` passed from the isolated `.worktrees/baseline-001` worktree.

## 2. Frozen canonical decisions

### P0-SCHEMA-01 — `CANONICAL_TAROT_SCHEMA`

#### Definitions found

| Location | Current responsibility | Production use |
| --- | --- | --- |
| `packages/design-contract/src/schemas/tarot.schema.ts` | Public theme/spread/slot/orientation values, public session states, request/response DTOs and inferred public types | Backend routes/mappers, frontend Tarot API/UI, database public snapshots/repository, AI copy |
| `packages/tarot-engine/src/types.ts` | Duplicate theme/spread/slot/orientation types and Zod enums plus private deck/draw/card schemas | Tarot Engine private state, draw mechanics and design signals |
| `packages/tarot-engine/src/index.ts` | Re-exports the duplicate public schemas/types | No repository consumer needs the four public values from this package |

The enum values are currently identical. Design Contract is already the production transport/persistence-facing authority. Tarot Engine is the production authority only for the 78-card catalog, private deck order, selection order/uniqueness, reveal invariants and deterministic design signals.

#### Approaches considered

1. **Design Contract owns public values; Tarot Engine consumes them — selected.** Preserves the existing API/frontend/database boundary and adds only a one-way `tarot-engine -> design-contract` dependency.
2. Tarot Engine owns public values. Rejected because Design Contract would need to depend on an implementation/domain engine or duplicate projections, breaking its application-independent role.
3. Create a third shared Tarot package. Rejected as unnecessary indirection for four already-canonical public enums.

#### Frozen contract

```text
CANONICAL_TAROT_SCHEMA = packages/design-contract/src/schemas/tarot.schema.ts

Canonical runtime schemas:
TarotThemeSchema
TarotSpreadTypeSchema
TarotSlotSchema
TarotOrientationSchema

Canonical public types:
TarotTheme
TarotSpreadType
TarotSlot
TarotOrientation
```

Tarot Engine must import these schemas/types and may compose them into private validators. It must not redeclare or re-export an alternative runtime schema. Its private card/deck/draw types and validators remain engine-owned.

Compatibility decision: repository analysis found no external consumer importing the four public schemas/types from `@mystcrag/tarot-engine`. Therefore no deprecated re-export is required. If BASE-002 finds a consumer missed by the frozen scan, it must stop and return to SOL; it may not invent an alias.

### P0-SCHEMA-02 — AI candidate concepts

#### Definitions found

| Current schema | Real meaning | Trust/ownership |
| --- | --- | --- |
| `packages/ai-agent/src/schemas/ai-design-candidate.schema.ts::AiDesignCandidateSchema` | Creative/provider bead-layout proposal: name/tags/story plus a complete contiguous `components[]` physical bead sequence with crystal/product/shape/diameter/role | AI-owned, untrusted until strict validation/compliance; converted to DesignV1 with server enrichment |
| `apps/backend/src/modules/design/design-api.service.ts::AiDesignCandidateSchema` | Backend catalog generation draft: ordered `materialProductIds`, accessory IDs, copy, production notes and provider/Tarot provenance | Backend-owned internal application boundary; parsed immediately before authoritative catalog/pricing/DesignV1 assembly |

These schemas cannot be unified without either discarding final bead-order semantics or leaking backend catalog/provenance assembly into the provider contract.

#### Approaches considered

1. **Rename both concepts in their owning modules — selected.** Keeps the existing adapter boundary and states domain meaning directly.
2. Pick one schema and delete the other. Rejected because they validate different stages and data shapes.
3. Move both into Design Contract. Rejected because neither is a public cross-application DTO; one is AI provider input and the other is backend-internal orchestration state.

#### Frozen contract

```text
AiBeadLayoutCandidateSchema
AiBeadLayoutCandidate
AiBeadCandidateSchema (unchanged component schema)

CatalogDesignGenerationDraftSchema
CatalogDesignGenerationDraft
```

`AiBeadLayoutCandidateSchema` remains under AI Agent and remains the element schema of `RecommendationProviderOutputSchema`. `CatalogDesignGenerationDraftSchema` remains route-local/backend-internal and keeps `DesignGenerationAdapter.generate(...): Promise<unknown>` so the application boundary still validates untrusted adapter output.

Compatibility decision: all packages are private workspace packages and the scan found no external repository consumer of the AI schema subpath. The ambiguous `AiDesignCandidateSchema`/`AiDesignCandidate` names must be removed from runtime source after atomic consumer migration; no deprecated alias is authorized. The explicit legacy grouped-design adapter remains `LEGACY`, but its output type/function naming must state `AiBeadLayoutCandidate`.

## 3. BASE-002 Task Spec

- **TASK ID:** BASE-002
- **TITLE:** Tarot Canonical Schema Consolidation
- **OWNER:** GLM
- **BRANCH:** `task/base-002-tarot-canonical-schema`
- **STATUS:** READY after Human Product Owner dispatch
- **DEPENDENCIES:** TASK-BASELINE-001 `DONE`; branch starts from the exact latest local `main`; BASE-003 not started.
- **CANONICAL CONTRACT:** `CANONICAL_TAROT_SCHEMA` above and `docs/governance/CANONICAL_COMPONENTS.md`.
- **OBJECTIVE:** make Design Contract the only runtime definition source for public Tarot values while preserving all Tarot Engine private invariants and observable API behavior.

### Allowed files

- `packages/tarot-engine/package.json`
- `pnpm-lock.yaml`
- `packages/tarot-engine/src/types.ts`
- `packages/tarot-engine/src/index.ts`
- `packages/tarot-engine/src/spreads.ts`
- `packages/tarot-engine/src/draw-session.ts`
- `packages/tarot-engine/src/design-signals.ts`
- `packages/tarot-engine/tests/**`
- `tests/architecture.test.mjs` only for the authority regression assertion

Any newly discovered required consumer outside this list is a blocker requiring SOL re-scope before edit.

### Forbidden files

- `apps/**`, `packages/database/**`, `packages/design-contract/src/**`
- Prisma schema/migrations/generated client
- AI candidate/backend generation code
- root or application configuration other than the exact lockfile dependency edge
- governance/architecture/product docs, P1/P2 work and every FEAT-018/AUTH path

### Migration requirements

1. Add the one-way workspace dependency `@mystcrag/design-contract` to Tarot Engine.
2. Replace the four local string-union and Zod-enum definitions with direct imports of canonical schemas/types.
3. Update Tarot Engine internal imports so private interfaces/validators compose canonical public values.
4. Remove the four public schema re-exports from Tarot Engine; retain private engine exports.
5. Add an architecture regression proving Tarot Engine has no local definitions of the four schemas and Design Contract remains independent of Tarot Engine.

### Compatibility requirements

- Do not change enum values, JSON shape or inferred public values.
- Preserve private deck length/catalog integrity, canonical slot order, unique positions/operation IDs, revision/idempotency and reveal secrecy/immutability.
- Do not add an alias/re-export without SOL approval prompted by an actual consumer.
- No persisted data migration is authorized or required.

### Acceptance criteria

- Exactly one runtime definition of each public Tarot schema exists under `apps/**` and `packages/**`, in Design Contract.
- `rg` finds no `z.enum` definition for the four schemas in Tarot Engine.
- Tarot Engine package declares exactly one Design Contract workspace dependency and no cycle exists.
- No external repository consumer imports the four public values from Tarot Engine.
- All public request/response payloads and private draw behavior remain byte/shape compatible in tests.
- Diff contains only allowed files and no formatting/refactor churn.

### Required tests

```text
pnpm --filter @mystcrag/design-contract test
pnpm --filter @mystcrag/tarot-engine test
pnpm --filter @mystcrag/tarot-engine typecheck
pnpm --filter @mystcrag/context-resolver test
pnpm --filter @mystcrag/database test
pnpm --filter @mystcrag/backend test
node --test tests/architecture.test.mjs
pnpm validate
git diff --check
```

### Regression scope

Tarot create/select/reveal/get/recommend/save lifecycle; frontend/backend public DTO compilation; database snapshot validation; AI Tarot copy; context resolution; unrevealed-card privacy; deterministic/idempotent draw behavior.

### Worker prohibition

No scope expansion, opportunistic refactor, second schema, architecture redesign, persisted-data migration, P1/P2 cleanup or FEAT-018 work.

## 4. BASE-003 Task Spec

- **TASK ID:** BASE-003
- **TITLE:** AI Candidate Domain Concept Consolidation
- **OWNER:** GLM
- **BRANCH:** `task/base-003-ai-candidate-concepts`
- **STATUS:** BLOCKED until BASE-002 is merged and validated on `main`
- **DEPENDENCIES:** BASE-002 `DONE`; branch created/rebased from the new `main` after BASE-002 validation.
- **CANONICAL CONTRACT:** the two AI candidate concepts above and `docs/governance/CANONICAL_COMPONENTS.md`.
- **OBJECTIVE:** replace the ambiguous shared name with two explicit domain names without changing recommendation, compliance, catalog, provenance, pricing or generated DesignV1 behavior.

### Allowed files

- `packages/ai-agent/package.json`
- `packages/ai-agent/index.ts`
- `packages/ai-agent/src/schemas/**` only for the schema file rename/imports
- `packages/ai-agent/src/adapters/**` only for candidate naming migration
- `packages/ai-agent/src/recommendation/**`
- `packages/ai-agent/src/fixtures/crystals.ts`
- `packages/ai-agent/design-agent/index.ts`
- `packages/ai-agent/compliance-agent/index.ts`
- `packages/ai-agent/tests/**`
- `apps/backend/src/modules/design/design-api.service.ts`
- `apps/backend/src/modules/design/ai-recommendation-design.adapter.ts`
- co-located tests `apps/backend/src/modules/design/design-api.service.test.ts`, `design.routes.test.ts`, `ai-recommendation-design.adapter.test.ts`
- `docs/AI_AGENT_SPEC.md`, `docs/INTEGRATION_CHECKLIST.md`, `docs/TECH_ARCHITECTURE.md`, `docs/KNOWLEDGE_SYSTEM_SPEC.md`
- `tests/architecture.test.mjs` only for the naming/authority regression assertion

Any additional file requires SOL re-scope before edit.

### Forbidden files

- Design Contract schemas/DTOs/DesignV1, Tarot Engine, database/Prisma/migrations
- public API response shapes, pricing/inventory/order semantics
- provider algorithms, template scoring or candidate differentiation behavior beyond identifier migration
- root/package dependency versions and lockfile
- governance decision documents, P1/P2 work and every FEAT-018/AUTH path

### Migration requirements

1. Rename the AI schema file and exported schema/type to `AiBeadLayoutCandidateSchema` / `AiBeadLayoutCandidate`; update package exports and every AI/backend consumer atomically.
2. Rename directly coupled adapter/function/result identifiers where leaving `AiCandidate` would make the concept ambiguous; do not refactor their behavior.
3. Rename the backend local schema to `CatalogDesignGenerationDraftSchema` and infer/use `CatalogDesignGenerationDraft` only where it improves the validated boundary; retain `unknown` at `DesignGenerationAdapter` input/output trust seams.
4. Update current controlling docs, not dated historical reports/plans.
5. Add an architecture regression that rejects `AiDesignCandidateSchema` and `AiDesignCandidate` in runtime source and verifies each new schema has one owner.

### Compatibility requirements

- No deprecated alias for `AiDesignCandidateSchema` or `AiDesignCandidate` after all workspace consumers migrate.
- Keep `RecommendationProviderOutputSchema` at exactly three bead-layout candidates.
- Keep strict unknown-field rejection and contiguous/unique position validation.
- Keep backend catalog availability, currency, pricing, inventory, IDs, timestamps, revision and provenance authoritative.
- Keep explicit legacy grouped-design conversion behavior and label; rename only its output vocabulary.
- No public API or persisted data migration.

### Acceptance criteria

- `AiDesignCandidateSchema` and `AiDesignCandidate` occur zero times in runtime `apps/**` and `packages/**` source.
- `AiBeadLayoutCandidateSchema` exists once in AI Agent and validates the original components-based contract.
- `CatalogDesignGenerationDraftSchema` exists once in backend and validates the original product-ID/provenance contract.
- The adapter between the bead-layout proposal and catalog draft remains explicit and tested.
- Invalid provider output, restricted copy and unknown/mismatched catalog products remain rejected with the same stable error behavior.
- Generated designs preserve candidate sequence, three-option differentiation, Tarot provenance, authoritative price/inventory and idempotency.
- Diff contains only allowed files and identifier-focused documentation changes.

### Required tests

```text
pnpm --filter @mystcrag/ai-agent test
pnpm --filter @mystcrag/ai-agent typecheck
pnpm --filter @mystcrag/backend test
pnpm --filter @mystcrag/backend typecheck
pnpm --filter @mystcrag/design-contract test
node --test tests/architecture.test.mjs
pnpm validate
git diff --check
```

### Regression scope

Rule-based three-candidate output; compliance normalization; legacy grouped-design conversion; provider-to-DesignV1 adapter; backend recommendation adapter; mock generation; Tarot-generated candidate provenance; catalog/inventory/currency rejection; pricing, trace and idempotent design generation.

### Worker prohibition

No scope expansion, opportunistic file split, service refactor, schema centralization, compatibility alias, new provider behavior, P1/P2 cleanup or FEAT-018 work.

## 5. Mandatory integration queue

```text
BASE-002 worker branch
  -> SOL contract/scope review
  -> rebase latest main
  -> required tests
  -> fast-forward/approved merge
  -> main pnpm validate + targeted validation

ONLY THEN

BASE-003 worker branch from new main
  -> SOL contract/scope review
  -> rebase latest main
  -> required tests
  -> fast-forward/approved merge
  -> main pnpm validate + targeted validation

ONLY THEN

BASE-004 final validation, re-audit and optional tag
```

`SERIAL_EXECUTION_REQUIRED`: BASE-002 and BASE-003 may not be developed, rebased for merge, reviewed for merge or merged concurrently. This conservative ordering keeps the shared architecture test, task registry and dependency baseline single-writer.

## 6. BASE-004 freeze gate

BASE-004 must run on the exact latest clean `main` without changing configuration, deleting/skipping tests or weakening assertions:

- frozen dependency installation;
- lint and typecheck;
- all unit and repository-provided integration tests;
- production build;
- Prisma validate/generate and fresh PostgreSQL migration/constraint suite where locally available;
- repository-provided E2E/browser smoke if runnable in an isolated stack;
- `pnpm validate`;
- internal document links, task/branch uniqueness and final diff inspection.

If any required check fails, `BASELINE STATUS: NOT READY`, no tag is created, and remaining failures are P0 until classified by SOL.

If every gate passes, BASE-004 records the exact main commit, final health score, governance version and freeze date, then creates an annotated tag. No repository tag convention exists and root package version is `0.1.0`; the proposed first baseline tag is:

```text
baseline/v0.1.0-20260824
```

The tag is reserved only; it must not be created before `BASELINE STATUS: READY`.

## 7. FEAT-018 readiness checkpoint

AUTH-001 through AUTH-007 remain blocked. After BASE-004 passes, SOL must re-audit their dependencies/path overlap/acceptance and submit Product Owner decisions for:

1. identity provider strategy;
2. separate development/staging/production callback and deployment domains;
3. browser session topology.

Decision proposal: reuse the existing backend `AuthProvider`; keep provider configuration environment-specific; use separate callback allowlists per environment; prefer a server-controlled `HttpOnly`, `Secure`, `SameSite` cookie session or a validated same-origin BFF topology; never place long-lived credentials in `localStorage` or `NEXT_PUBLIC_*`; map provider `(issuer, subject)` to an internal provider-neutral user identity. Exact provider and topology remain Product Owner decisions and are not authorized by this package.

## 8. Current conclusion

Governance integration is complete and contracts are frozen. Runtime consolidation and final validation are not complete because Workers have not been dispatched.

`BASELINE_NOT_READY`
