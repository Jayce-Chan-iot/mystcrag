# Mystcrag 2.0 — M0 Project Audit

**Task:** `TASK-AUDIT-001`

**Observed:** 2026-08-25

**Branch / commit:** `task/audit-001-baseline-planning` / `74fca1f`

**Scope:** repository and product audit only; no runtime, schema, API, UI, dependency, or generated-file changes

## Executive decision

Mystcrag already has a real, persisted product loop and a substantially canonical design model. The correct next move is not to create another `BraceletDesign` schema and not to start a broad UI rewrite.

The current stop-the-line issue is repository authority: the governance candidate is not yet integrated into the protected baseline, and two public contract concepts still have duplicate authorities. Until those gates close, Feature work must remain `BACKLOG`.

Key conclusions:

1. `packages/design-contract` `DesignV1` is the canonical versioned design aggregate. AI generation, 2D editing, persistence, pricing, BOM, 3D scene projection, save/revision, and order snapshots all consume or derive from it.
2. `packages/bracelet-engine` is already the canonical pure geometry/fit/layout/hit-test core, but pricing, BOM, operation application, and commercial validation remain server/database authorities. Moving all of them into the geometry package is not automatically correct and requires a contract-owned design task.
3. The mounted 2D DIY path is functional and uses 20 photographic bead assets. Its main gaps are resilient/local editing, component concentration, copy/rotation/precise insertion UX, save-state clarity, and repeatable browser coverage.
4. AI supports structured questionnaire recommendations, real-catalog selection, deterministic design optimization, material suggestions, and operation scripts. It does not support natural-language Copilot Tool Calling that directly interprets an arbitrary instruction.
5. The 3D renderer and `DesignV1` adapter exist but are experimental and not mounted in a production route.
6. Order creation is an idempotent, actor-scoped immutable snapshot with price/inventory revalidation. It is not checkout: address, payment, shipping purchase, tax, refund, and operational fulfillment are absent.
7. White Label remains architecture-only intent. No `Tenant`, tenant isolation, tenant-scoped catalog, brand config, or runtime theme authority exists.

## 1. Repository overview

The monorepo uses pnpm 11 and Turborepo with a root `pnpm validate` gate.

| Area | Current composition |
| --- | --- |
| Applications | 4: Next.js frontend, Fastify backend, knowledge worker, MCP server |
| Packages | 11: UI, database, Design Contract, Bracelet, Three, AI, Design, Context, Tarot, Knowledge Core, Knowledge Ingestion |
| Frontend routes | 20 `page.tsx` routes, including 8 knowledge-admin pages |
| Persistence | PostgreSQL + Prisma 7, 21 models, 12 migrations recorded by the current baseline report |
| Product stack | Next.js 16, React 19, Fastify 5, Zod 4, Three 0.180 / R3F 9 |
| Automated checks | workspace lint, typecheck, unit/integration tests, build, Prisma lifecycle/architecture tests; PostgreSQL verification exists |

Generated output (`dist`, `.next`, generated Prisma clients), retained QA evidence, and user-owned local modifications are not product source and were excluded from edit scope.

## 2. Current architecture

```text
Frontend routes / typed API clients
                |
                v
Fastify transport + application services
    |           |              |
    v           v              v
Design       AI/Design       Knowledge/Tarot
Contract     engines         services
    |           |              |
    +-----------+--------------+
                |
                v
Database repositories -> Prisma -> PostgreSQL

DesignV1 -> Bracelet Engine -> 2D layout
DesignV1 -> Three adapter -> SceneDescriptor -> experimental 3D renderer
DesignV1 -> Order projection/repository -> immutable order snapshot
```

Authority boundaries are mostly sound:

- Design Contract owns public/versioned schemas and API DTOs.
- Database owns Prisma and persistence mapping.
- Backend owns orchestration, authorization, inventory, mutation, and server policy.
- Bracelet Engine owns pure geometry, fit, layout, and slot hit testing.
- Design Engine owns deterministic allocation, scoring, color, rule evaluation, and optimization.
- Three Engine consumes plain scene descriptors and does not own business state.
- Frontend local `DiyEditor` state is an unsaved working projection, not a second canonical aggregate.

## 3. Current user flow

```text
Home
  +-> AI questionnaire -> three recommendations -> DesignV1 result
  +-> Tarot setup/draw/result -> ranked DesignV1 recommendations
  +-> Direct DIY -> persisted or loaded DesignV1
                                      |
                                      v
                           FlatBraceletEditor (2D)
                                      |
                           update operations + revision
                                      |
                      save / clone / delete / optimize
                                      |
                                      v
                        immutable internal order snapshot
```

The loop is demonstrable through design and internal order creation. Production sign-in/session, commercial checkout, payment, shipping, and post-order operations are not complete.

## 4. Current bracelet model

The canonical aggregate is `DesignV1` in `packages/design-contract/src/schemas/design.schema.ts`. It includes metadata, bracelet fit inputs, ordered beads, inline/anchored accessories, story, pricing, production/BOM, compliance, provenance, and community state.

Important invariants already enforced by the strict schema include:

- unique stable `componentId` across beads and accessories;
- contiguous `positionIndex` for main-ring components;
- valid anchored-accessory references;
- material/accessory subtotals matching components;
- production wrist size matching bracelet wrist size;
- production sequence and anchors matching design order;
- BOM source IDs referencing real components;
- rejected designs remaining private.

Public update operations are finite and typed: replace, move, add, remove, and bracelet update. Duplicate and visual rotation are not first-class contract operations.

Canonical conflicts outside the bracelet aggregate remain:

- Design Contract and Tarot Engine both define public Tarot theme/spread/slot/orientation schemas.
- AI Agent and backend use `AiDesignCandidateSchema` for incompatible positional-component and provider-product candidate concepts.

## 5. Current DIY implementation

The mounted editor is `DiyEditor` -> `FlatBraceletEditor`; `BraceletSequenceEditor` is dormant.

| Capability | Status | Evidence-based note |
| --- | --- | --- |
| Size-aware circular layout | Implemented | Bracelet Engine solves mixed-width ring layout rather than `360 / count` |
| Select / add / replace / remove / move | Implemented | typed update operations; server revalidates and increments revision |
| Drag and center-delete | Implemented | pointer/drag handling in `FlatBraceletEditor` |
| Undo / redo | Implemented | operation-level stacks, capped at 50 entries |
| Live price / fit feedback | Implemented with caveats | refreshed after server mutation; fit semantics require UX review |
| Material suggestions | Implemented | real-catalog suggestion endpoint and UI |
| Deterministic design optimization | Implemented | returns public operation script and preserves locked components |
| Photographic bead visuals | Implemented | 20 WebP assets mapped by `visual-assets.ts` |
| Mobile material sheet | Implemented | collapsed/half/expanded states |
| Duplicate | Missing | no public duplicate operation or UI action |
| Whole-bracelet visual rotation | Missing | no canonical view rotation state/control |
| Arbitrary gap insertion preview | Partial | add inserts after selection; reorder exists, but insertion UX is not mature |
| Local optimistic mutation / autosave recovery | Missing | edit waits for full server mutation; explicit save remains separate |
| Click-to-ring motion | Missing | no source-to-slot transition |
| Repeatable browser E2E | Missing | current browser evidence is manual/partial |

The largest concentration risks are `diy-editor.tsx` (1,275 lines) and backend `design-api.service.ts` (1,284 lines). Decomposition must preserve the single working-state authority and server revision semantics.

## 6. Current 3D implementation

Three Engine provides a `DesignV1` adapter, scene descriptor, R3F canvas/scene, selection callbacks, runtime quality/resource handling, and tests. It does not create a second design state.

`ThreeBraceletPreview` and its scene client are defined, but production source references do not mount the preview from a route or active editor. Therefore 2D/3D synchronization is structurally possible but not product-proven.

Lifecycle status: `EXPERIMENTAL`. Production promotion requires explicit WebGL fallback, responsive/performance budgets, geometry/selection parity, asset handling, and browser acceptance. Its absence is an M3 gap, not a reason to block current 2D MVP usage.

## 7. Current AI architecture

The AI/recommendation path is structured rather than free-form:

- questionnaire/Tarot context is normalized;
- candidate output is Zod validated;
- selections are constrained to catalog products;
- recommendation and optimization use deterministic Design Engine/Knowledge rules;
- optimization emits `UpdateDesignOperation[]` and persists a new revision;
- compliance and provenance remain part of `DesignV1`.

This is stronger than a text-only recommender. However, the target acceptance phrase—“改成紫白色，保留主珠，总价不超过 300”—cannot yet be interpreted as arbitrary natural-language tool calls. There is no general Copilot planner/tool registry or LLM provider composition for modifying an existing design.

## 8. Current database

The 21 Prisma models cover users, catalog, designs/revisions/publications, immutable order snapshots, inventory/pricing, Tarot, knowledge, collection runs, decision traces, and usage events.

Strengths:

- design snapshot validation on persistence boundaries;
- immutable revision and order snapshot concepts;
- BigInt minor-unit money storage;
- actor-scoped repositories;
- transaction/idempotency/inventory tests;
- explicit migrations and generated-client lifecycle checks.

Gaps relevant to this audit:

- no production external identity mapping/session provider;
- no tenant model or tenant-scoped uniqueness/isolation;
- `DesignTemplate` lifecycle is unresolved;
- catalog/seed counts and some documentation require reconciliation.

## 9. Current order flow

Order creation reloads the requested actor-owned revision, rejects stale/deleted/non-orderable designs, recalculates catalog price, checks pricing version and total, evaluates inventory, reserves available quantity, records backorder state, and creates an idempotent immutable snapshot.

This is a good internal production boundary, but not a commercial checkout. Address data is browser-local in the profile UI and is not attached to the order. No payment provider, shipping purchase, tax calculation, refund, or operational fulfillment integration is present.

## 10. Current UI system

The active visual language already matches the approved direction: warm ivory surfaces, restrained violet accents, serif/editorial headings, thin borders, photographic beads, responsive navigation, and mobile sheets. Brand tokens are partly centralized as CSS variables.

Current UX debt is concentrated in resilience and hierarchy rather than a missing visual identity:

- editor/server round-trip latency and unclear durable-save semantics;
- 1,275-line editor composition;
- incomplete keyboard/touch/browser regression evidence;
- selected-bead tools and insertion feedback are less mature than the target;
- 3D is not an active view;
- profile contains browser-local identity/address/preferences state that looks more durable than it is.

A broad visual redesign would create unnecessary regression risk. Future Qwen tasks should be bounded interaction tasks that preserve the established brand system.

## 11. White Label readiness

| Concern | Readiness |
| --- | --- |
| Core/domain package separation | Good foundation |
| Canonical design aggregate | Good foundation, currently single-tenant |
| CSS theme variables | Partial |
| Brand/logo/metadata config | Missing; Mystcrag is hard-coded |
| Tenant persistence and isolation | Missing |
| Tenant-scoped catalog/design/order | Missing |
| Per-tenant AI/knowledge policy | Missing |
| Demo Brand A/B proof | Missing |

Overall White Label readiness is low. Adding `tenantId` mechanically before identity, isolation, uniqueness, migration, and cache-key contracts are designed would be unsafe. The first White Label task must be contract-first and migration-aware, not an admin UI.

## 12. Technical debt by priority

### P0 — baseline / contract stop-the-line

1. Governance/audit candidate is not integrated into protected `main`; no frozen owner-approved baseline exists.
2. Public Tarot enums have two definition authorities.
3. `AiDesignCandidateSchema` names two incompatible concepts at AI/backend boundaries.
4. Final baseline replay lacks isolated authenticated browser evidence.

### P1 — next product/release blockers

1. Production identity/session is absent; frontend relies on development-grade token behavior.
2. DIY mutations are full server round trips with manual persistence/recovery semantics.
3. No repeatable authenticated browser E2E gate.
4. Checkout stops before address/payment/shipping/tax/fulfillment.
5. Large frontend/backend orchestration files raise regression risk.

### P2 — important product maturity

1. Decide experimental 3D lifecycle and, if promoted, prove fallback/performance/parity.
2. Add duplicate, precise insertion preview, view rotation, and bounded motion to DIY.
3. Resolve asset provenance/export parity and dormant editor lifecycle.
4. Complete community publish/discovery/share/moderation.
5. Design White Label tenant/theme/catalog contract.

### P3 — defer until foundations are frozen

1. Multi-brand admin tooling, billing, agency RBAC, and complex SaaS operations.
2. Broad visual redesign or renderer replacement.
3. Compatibility/branch cleanup without reachability and owner approval.

## 13. KEEP / REFACTOR / ADD / REMOVE

| Decision | Modules / boundaries | Reason |
| --- | --- | --- |
| KEEP | `DesignV1`, public projections, typed API DTOs | canonical aggregate already exists |
| KEEP | Bracelet geometry/layout/fit/hit testing | pure, UI-independent authority |
| KEEP | `FlatBraceletEditor` production role | mounted 2D product path |
| KEEP | deterministic recommendation/optimization and catalog constraints | real structured capability, not chatbot text |
| KEEP | Three scene descriptor/adapter as experimental | correct one-way consumer boundary |
| KEEP | repositories, revisions, immutable order snapshots | strong persistence boundary |
| REFACTOR | Tarot Engine public types | consume Design Contract; retain private draw invariants |
| REFACTOR | backend AI candidate naming/adapter boundary | remove conceptual collision without changing behavior |
| REFACTOR | DIY session/state composition | resilience and decomposition, not a second store |
| REFACTOR | editor/export asset/layout parity | one material identity and geometry result |
| ADD | production identity/session and authenticated E2E | prerequisite for durable customer product |
| ADD | natural-language Copilot tool planner | only after operation/catalog contracts are frozen |
| ADD | tenant/theme/catalog isolation contract | White Label Alpha foundation |
| REMOVE | none authorized | dormant/legacy/duplicate evidence requires a separate lifecycle task and regression proof |

## 14. M1–M4 gap analysis

| Milestone | Completion | Confidence | Current evidence | Main gap |
| --- | ---: | --- | --- | --- |
| M1 Foundation | **68%** | High | canonical `DesignV1`; geometry/fit/layout; schema validation; server pricing/BOM/operations | authority split across engine/server/database; thin Bracelet tests; two adjacent contract conflicts |
| M2 DIY Editor 2.0 | **72%** | High | mounted 2D, add/replace/remove/move, undo/redo, live price/fit, photos, responsive sheet | resilient local session, duplicate/rotation/insertion feedback/motion, E2E/performance proof |
| M3 AI + 3D | **48%** | Medium-High | structured generation, optimization, suggestions, operation scripts; tested 3D adapter/renderer | no arbitrary-language Copilot Tool Calling; 3D unmounted/unproven |
| M4 White Label | **5%** | High | package separation and partial CSS variables only | no tenant/theme/isolation/config/demo brands |

Percentages measure the Master Prompt acceptance scope, not whether source files merely exist.

## 15. Dependency graph

```text
TASK-AUDIT-001 (M0)
        |
        v
TASK-BASELINE-001 (SOL integration + Owner approval)
        |
        +------------------------------+
        v                              v
TASK-CONTRACT-001                  TASK-AI-001
        |                              |
        v                              v
TASK-TAROT-001                     TASK-BE-003
        +--------------+---------------+
                       v
              TASK-BASELINE-002
              frozen replay gate
                       |
                       v
             FEAT-018 identity/session
                       |
              +--------+---------+
              v                  v
      resilient DIY session   authenticated E2E
              |
              v
      bounded M2 interaction tasks
              |
              v
       M3 3D/Copilot contracts
              |
              v
       M4 tenant/theme/catalog
```

No downstream Feature task may start before `TASK-BASELINE-002` passes.

## 16. Recommended execution order

1. Product Owner reviews this audit and the complete governance candidate.
2. SOL integrates the complete candidate via `TASK-BASELINE-001`; do not cherry-pick partial registries.
3. In parallel only after that gate, GLM may execute the disjoint Tarot public-contract lane and AI candidate-boundary lane. This audit dispatches only the first lane.
4. Freeze and replay-validate one candidate commit with install/lint/typecheck/tests/build/PostgreSQL and isolated authenticated browser smoke.
5. Implement one major Feature: production identity/session.
6. Then address resilient DIY editing and browser release coverage.
7. Promote 3D or build Copilot only through separate contract-first tasks.
8. Start White Label Alpha with tenant/isolation/config contracts; do not begin with an admin SaaS.

## 17. NEXT DISPATCH

**Current Milestone:** M0 complete, baseline gate pending

**Why this task now:** public Tarot values already cross frontend/backend/database boundaries and currently have two authorities; this must be resolved before unrelated Feature work

**Agent:** GLM

**Task ID:** `TASK-CONTRACT-001`

**Dependency:** `TASK-BASELINE-001` must be `DONE` and Owner-approved

**Risk:** public enum/schema drift can break persisted sessions and API compatibility

**Expected Result:** Design Contract is explicitly frozen as the only public Tarot enum/schema authority; exact consumer migration contract and tests are ready for `TASK-TAROT-001`

**After PASS:** dispatch `TASK-TAROT-001`; the disjoint `TASK-AI-001` lane may proceed separately only with its own lock

**Dispatch status:** `BLOCKED` until the dependency above passes. Do not create the branch or change files yet.

### GLM task prompt

```text
=== GLM TASK PROMPT ===

TASK
ID: TASK-CONTRACT-001
Owner: GLM
Branch: task/contract-001-tarot-schema-authority
Priority: P0
Execution Mode: SERIAL_EXECUTION_REQUIRED

OBJECTIVE

Freeze packages/design-contract as the single public authority for TarotTheme,
TarotSpreadType, TarotSlot, and TarotOrientation, and define the exact tested
contract that TASK-TAROT-001 will consume.

BACKGROUND

Design Contract already exports TarotThemeSchema, TarotSpreadTypeSchema,
TarotSlotSchema, and TarotOrientationSchema. packages/tarot-engine/src/types.ts
independently redeclares the same public types and Zod enums. The engine must
eventually consume the shared public contract while retaining private deck,
draw-order, uniqueness, reveal, and randomization invariants.

Do not start this task until TASK-BASELINE-001 is DONE and the Product Owner has
approved the integrated baseline. Register/claim this task and mark it
IN_PROGRESS before editing.

CURRENT CONTRACT

Input authority:
- packages/design-contract/src/schemas/tarot.schema.ts
- packages/design-contract/src/index.ts

Public values:
- TarotTheme: RELATIONSHIPS | CAREER | SELF_GROWTH | NEW_BEGINNINGS | FINANCIAL_PLANNING
- TarotSpreadType: SINGLE | PAST_PRESENT_FUTURE
- TarotSlot: GUIDANCE | PAST | PRESENT | FUTURE
- TarotOrientation: UPRIGHT | REVERSED

Output of this task:
- one documented public authority;
- exact public value vectors protected by contract tests;
- no behavior or payload-shape change;
- a clear consumer handoff for TASK-TAROT-001.

ALLOWED FILES

packages/design-contract/src/schemas/tarot.schema.ts
packages/design-contract/src/index.ts
packages/design-contract/tests/tarot-contract.test.ts
docs/DESIGN_CONTRACT_V1.md
docs/API_SPECIFICATION.md

FORBIDDEN FILES

packages/tarot-engine/**
apps/frontend/**
apps/backend/**
packages/database/**
packages/bracelet-engine/**
packages/ai-agent/**
packages/design-engine/**
packages/context-resolver/**
packages/three-engine/**
package.json
pnpm-lock.yaml
Prisma schema or migrations
generated output, dist, .next, screenshots, evidence artifacts
unrelated documentation or refactors

IMPLEMENTATION REQUIREMENTS

1. Verify that Design Contract already represents every public Tarot value used
   by API and persistence consumers. Do not invent a replacement schema.
2. Preserve all existing JSON values and public exported names.
3. Add or strengthen explicit vector tests proving the four enum schemas accept
   exactly the current value sets and reject unknown values.
4. Add type-level/use-site coverage only within the allowed contract test file.
5. Document that Tarot Engine owns private mechanics but imports public enum
   authority from @mystcrag/design-contract in the dependent task.
6. Document compatibility expectations for persisted sessions and API DTOs.
7. If the current Design Contract already satisfies the code requirements,
   make the smallest documentation/test-only change that freezes the boundary.
8. Do not modify UI or visual behavior.
9. Do not redefine DesignV1 or any Canonical Contract.
10. Do not skip tests or refactor unrelated code.

LOGIC INPUT

The exact public strings listed under CURRENT CONTRACT and representative invalid
unknown strings/lowercase variants.

LOGIC OUTPUT

Successful Zod parsing for every listed value, failure for invalid values, and
stable exported TypeScript types inferred from the canonical schemas.

SCHEMA AND EDGE CASES

- Exact case sensitivity is preserved.
- No aliases or silent coercion are introduced.
- No private deck order, selection operation ID, card catalog, or unrevealed
  state is exposed through this task.
- Existing persisted/API values remain parseable without migration.

TEST VECTORS

- Every TarotTheme value listed above: PASS.
- Every TarotSpreadType value listed above: PASS.
- Every TarotSlot value listed above: PASS.
- Every TarotOrientation value listed above: PASS.
- UNKNOWN, lowercase variants, empty string, null, and numeric values: FAIL.
- Existing Tarot public request/response fixtures: PASS unchanged.

NON-GOALS

- Migrating Tarot Engine consumers (TASK-TAROT-001).
- Changing public enum values or API payloads.
- Changing private draw state or randomization.
- Database migration.
- UI, 3D, Bracelet Engine, AI candidate cleanup, authentication, or White Label.

TEST REQUIREMENTS

pnpm --filter @mystcrag/design-contract lint
pnpm --filter @mystcrag/design-contract typecheck
pnpm --filter @mystcrag/design-contract test
node --test tests/architecture.test.mjs
pnpm validate

ACCEPTANCE CRITERIA

- Design Contract is explicitly documented and tested as the sole public Tarot
  enum/schema authority.
- All current public values and payloads remain compatible.
- No duplicate schema is created.
- No forbidden file changes.
- Required checks pass with fresh output.

REGRESSION CHECKS

- DesignV1 schema/projection tests remain green.
- Tarot API DTO contract tests remain green.
- Architecture tests remain green.
- git diff contains only allowed files.

DELIVERABLE

Return exactly:

TASK COMPLETION REPORT

Task: TASK-CONTRACT-001
Branch:
Commit:

Files changed:

Implementation summary:

Tests run:

Test results:

Build:

Known risks:

Out-of-scope findings:

Suggested follow-up:

COMMIT REQUIREMENT

Create one Conventional Commit on the task branch, for example:
test(contract): freeze public tarot enum authority

Do not merge main, push main, delete branches, or expand scope.

=== END GLM TASK PROMPT ===
```

## 18. Audit limitations

- This report is based on current source, reachability, contracts, tests, governance documents, and fresh non-destructive verification performed on the audit branch.
- It does not promote dormant/experimental code based only on compilation.
- It does not assert production browser readiness; the current isolated authenticated browser gate is explicitly incomplete.
- Historical reports are evidence only where they match current code.
