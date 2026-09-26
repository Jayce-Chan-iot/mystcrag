# Star Oracle Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-tap, server-authoritative three-coin oracle that reveals a readable result within a four-second ritual and converts the cast into three real, editable crystal bracelet designs.

**Architecture:** A new pure `@mystcrag/oracle-engine` owns only coin casts and hexagram structure. The shared contract owns public DTOs and `ORACLE_GUIDED` provenance; Context Resolver maps structure to soft design preferences; Backend owns idempotent sessions, persistence, recommendation orchestration, and privacy; Frontend owns the optional focus question and short reveal experience.

**Tech Stack:** TypeScript 6, Zod 4, Node crypto, Fastify 5, Prisma 7/PostgreSQL 17, Next.js 16, React 19, existing Design/Context/Bracelet engines.

**Spec:** `docs/superpowers/specs/2026-09-26-star-oracle-crystal-design.md`

## Global Constraints

- Start only after the Phase 0 plan passes. `BASE-004` is already frozen and integrated on `main`; all Oracle branches must start from the latest integrated `main`.
- The user performs one primary action; the six three-coin lines are generated atomically from bottom to top.
- Use a cryptographically secure server-side random source; AI and browser animation never decide the cast.
- Line probabilities are exactly `6=1/8`, `7=3/8`, `8=3/8`, `9=1/8`.
- Non-skippable ritual animation is at most 4 seconds, has a reduced-motion alternative, and can be disabled by returning users through a question-free motion preference.
- The optional question is never persisted, logged, included in public DTOs, or passed to AI/copy providers in V1.
- Oracle signals are soft cultural/design preferences; they cannot override wrist, fit, inventory, price, revision, compliance, or order authority.
- Modern interpretation and crystal copy are original Mystcrag text. Do not copy CC BY-SA or copyright-unclear modern commentary.
- Oracle-guided candidates must use active real SKU data and current authoritative price/stock. Unlike Tarot backorder behavior, Oracle V1 does not admit unavailable stock.
- Every module task must register its exact paths; shared contract lands before consumers and the database lands before production composition.
- Every commit step stages only the exact paths in that task's `Files` list. Directory-wide staging is forbidden unless the whole directory is explicitly a task-owned `Create` path.

## Review Focus

- Repeated create calls with the same actor and operation ID must return the same cast, while reuse with different input conflicts; Tasks 1, 5, and 6 own this test.
- Refresh after a successful cast must never consume new entropy or change any line; Tasks 5–8 own this test.
- All-static casts with no moving lines must omit a transformed-hexagram transition in the UI without inventing a change; Tasks 2 and 7 own this test.
- An optional raw question containing sensitive text must disappear after request handling and never reach persistence, logs, copy input, or response; Tasks 1, 5, 6, and 8 own this test.
- Price/stock changes between cast and recommendation must fail with existing stable authority codes and leave the cast readable/retryable; Tasks 6–8 own this test.

---

### Task 1: Freeze Oracle public contract and Design provenance

**Governance task:** `TASK-ORACLE-CONTRACT-001`, branch `task/oracle-contract-001-public-contract`

**Files:**
- Create: `packages/design-contract/src/schemas/oracle.schema.ts`
- Modify: `packages/design-contract/src/schemas/metadata.schema.ts`
- Modify: `packages/design-contract/src/schemas/provenance.schema.ts`
- Modify: `packages/design-contract/src/index.ts`
- Create: `packages/design-contract/tests/oracle-contract.test.ts`
- Modify: `packages/design-contract/tests/design-schema.test.ts`
- Modify: `docs/DESIGN_CONTRACT_V1.md`
- Modify: `docs/API_SPECIFICATION.md`
- Modify: `docs/SECURITY_AND_PRIVACY.md`

**Interfaces:**
- Produces: `OracleLineValueSchema = z.union([z.literal(6), z.literal(7), z.literal(8), z.literal(9)])`.
- Produces: `OracleCastDtoSchema` and inferred `OracleCastDto`, containing six bottom-to-top lines, primary hexagram, moving line indices, optional transformed hexagram, upper/lower trigrams, algorithm name/version, and no question.
- Produces: `OracleDesignSignalSchema`, containing versioned color/style/rhythm/accent-position preferences only.
- Produces: strict `CAST | RECOMMENDED | SAVED` session schemas and Create/Recommend/Get/Save request/response schemas.
- Produces: `ORACLE_GUIDED` in `DesignModeSchema` and optional `oracleCandidate` provenance `{ sessionId, ruleVersion, rank, direction }` where direction is `BALANCED | CONTRAST | NEUTRAL_LED`.
- Constraint: Create accepts `requestId`, `operationId`, `locale`, `currency`, optional `wristCircumferenceMm`, optional `question` (1–120 chars), and optional `parentSessionId`; every public response omits the question.

- [ ] **Step 1: Write failing strict-schema tests**

Assert exact six-line length/order, moving-line consistency, transformed-hexagram presence only when a 6/9 exists, status-specific recommendation fields, rank uniqueness, distinct design IDs, strict unknown-field rejection, no response question, `ORACLE_GUIDED` acceptance, `oracleCandidate` rank bounds, and absence of an ambiguous exported `OracleCast` type.

- [ ] **Step 2: Run contract tests and confirm missing exports fail**

Run: `pnpm --filter @mystcrag/design-contract exec tsx --test tests/oracle-contract.test.ts tests/design-schema.test.ts`

Expected: FAIL because Oracle schemas and mode do not exist.

- [ ] **Step 3: Implement schemas and exports**

Follow the strict Tarot contract style but do not copy Tarot drawing states. Export inferred types from the package root; no consumer may redeclare them.

- [ ] **Step 4: Update the three controlling contracts**

Document exact endpoints, question-drop behavior, `ORACLE_GUIDED` provenance, stable error codes, ownership, and that Oracle shortages remain blocked rather than entering Tarot's backorder exception.

- [ ] **Step 5: Run contract and architecture checks**

Run: `pnpm --filter @mystcrag/design-contract test && pnpm exec node --test tests/architecture.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage the whole contract package.
git commit -m "feat(contract): define oracle guided design protocol"
```

### Task 2: Implement the pure three-coin Oracle Engine

**Governance task:** `TASK-ORACLE-ENGINE-001`, branch `task/oracle-engine-001-three-coin-core`

**Files:**
- Create: `packages/oracle-engine/package.json`
- Create: `packages/oracle-engine/tsconfig.json`
- Create: `packages/oracle-engine/src/types.ts`
- Create: `packages/oracle-engine/src/random.ts`
- Create: `packages/oracle-engine/src/trigrams.ts`
- Create: `packages/oracle-engine/src/hexagrams.ts`
- Create: `packages/oracle-engine/src/cast.ts`
- Create: `packages/oracle-engine/src/index.ts`
- Create: `packages/oracle-engine/UPSTREAM_SOURCE.md`
- Create: `packages/oracle-engine/tests/cast.test.ts`
- Create: `packages/oracle-engine/tests/hexagrams.test.ts`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/architecture.test.mjs`

**Interfaces:**
- Produces: `CoinSource { nextCoin(): 2 | 3 }`.
- Produces: `NodeCryptoCoinSource` using `node:crypto.randomInt(0, 2)` and no seeded fallback.
- Produces: `castThreeCoinHexagram(source: CoinSource): OracleCastDomain` and `ORACLE_CAST_ALGORITHM_VERSION = "three-coin-v1"`.
- Produces: complete immutable trigram/hexagram structural catalog with public-domain Chinese names; no modern interpretation or crystal claims.
- Produces: an engine-owned `OracleCastDomain` independent of the wire-contract package; Backend is the sole production adapter and parses/projects the domain result through Task 1's `OracleCastDtoSchema`. No package exports a second ambiguous `OracleCast` name.

- [ ] **Step 1: Write failing exhaustive line and lookup tests**

Enumerate all eight three-coin combinations and assert counts `{6:1, 7:3, 8:3, 9:1}`. This exhaustive enumeration is the probability proof; do not add a flaky sampled/chi-squared assertion. Test known all-yang/all-yin casts, bottom-to-top ordering, moving-line transformation, no-change omission, all 64 unique binary patterns, and invalid catalog duplicates.

- [ ] **Step 2: Run engine tests and confirm the package is absent**

Run: `pnpm --filter @mystcrag/oracle-engine test`

Expected: FAIL because the package and functions do not exist.

- [ ] **Step 3: Implement the minimal pure engine**

Keep casting separate from lookup. `castThreeCoinHexagram` calls `nextCoin()` exactly 18 times, groups three values per line, and never calls time, storage, UI, database, or AI code.

- [ ] **Step 4: Add architecture assertions**

Assert the package imports no `apps/**`, React, Prisma, Fastify, browser API, or AI provider and that Backend is the only production composer of `NodeCryptoCoinSource`.

- [ ] **Step 5: Run engine and architecture suites**

Run: `pnpm --filter @mystcrag/oracle-engine test && pnpm --filter @mystcrag/oracle-engine typecheck && pnpm exec node --test tests/architecture.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/oracle-engine pnpm-lock.yaml tests/architecture.test.mjs
git commit -m "feat(oracle): add pure three coin engine"
```

### Task 3: Map casts to soft design context

**Governance task:** `TASK-ORACLE-CONTEXT-001`, branch `task/oracle-context-001-design-signals`

**Files:**
- Create: `packages/context-resolver/src/oracle.ts`
- Modify: `packages/context-resolver/src/index.ts`
- Modify: `packages/context-resolver/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/context-resolver/src/merge.ts`
- Create: `packages/context-resolver/tests/oracle.test.ts`
- Modify: `docs/OSS_RESEARCH.md`

**Interfaces:**
- Produces: `ORACLE_SOURCE_WEIGHT = 0.5` and `ORACLE_DESIGN_RULE_VERSION = "oracle-design-rules-v1"`.
- Produces: `deriveOracleDesignSignal(cast: OracleCastDto): OracleDesignSignal`; it consumes the Design Contract DTO and never imports `@mystcrag/oracle-engine`.
- Produces: `resolveOracleContext({ cast, signal, wristCircumferenceMm, locale, currency }): RecommendationContext` with `context-source:oracle`, no hard constraints except the user-supplied wrist.

- [ ] **Step 1: Write failing mapping and privacy tests**

Assert stable outputs for known DTO casts, version presence, accent positions derived only from moving lines, signal arrays containing controlled taxonomy IDs, no override of non-oracle hard constraints in `mergeContexts`, and no dependency on the engine domain package.

- [ ] **Step 2: Run tests and verify missing modules fail**

Run: `pnpm --filter @mystcrag/context-resolver test`

Expected: FAIL.

- [ ] **Step 3: Implement the versioned mapping**

Put trigram-to-color/style correspondence in the resolver with source/version comments, not in the math engine. Preserve every non-Oracle hard constraint during context merge.

- [ ] **Step 4: Record OSS/content boundaries**

Update `OSS_RESEARCH.md` with repository URL, license, exact borrowed concept, and “no modern text copied”.

- [ ] **Step 5: Run package suites and typecheck**

Run: `pnpm --filter @mystcrag/context-resolver test && pnpm --filter @mystcrag/context-resolver typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage the whole resolver package.
git commit -m "feat(oracle): map casts to design signals"
```

### Task 4: Create original compliance-safe Oracle copy

**Governance task:** `TASK-ORACLE-COPY-001`, branch `task/oracle-copy-001-safe-interpretation`

**Files:**
- Create: `packages/ai-agent/src/oracle/oracle-copy.schema.ts`
- Create: `packages/ai-agent/src/oracle/oracle-copy.service.ts`
- Create: `packages/ai-agent/src/oracle/index.ts`
- Create: `packages/ai-agent/tests/oracle-copy.service.test.ts`
- Modify: `packages/ai-agent/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/AI_AGENT_SPEC.md`
- Modify: `docs/OSS_RESEARCH.md`

**Interfaces:**
- Consumes: `OracleCastDto` and `OracleDesignSignal` from Design Contract; it never imports the engine domain type.
- Produces: `OracleCopyService.createInterpretation({ cast, signal, locale })`; its input type intentionally has no question field.
- Produces copy fields: `headline` max 48 chars, `summary` max 240, exactly three keywords, design rationale, disclaimer, and source metadata.

- [ ] **Step 1: Write failing privacy and compliance tests**

Assert no `question` key can enter copy input. Add rejection/fallback fixtures covering “转运、招财、发财、保平安、辟邪、开光、加持、治愈、疗愈、旺、桃花、挽回、命定、注定、一定、必定、大师”, medical/psychological claims, deterministic future claims, relationship predictions, and copied modern commentary markers. Match the single-character token “旺” only as a standalone efficacy claim or in an enumerated prohibited phrase (for example “旺夫”); do not reject unrelated words by raw substring.

- [ ] **Step 2: Run focused tests and verify the module is absent**

Run: `pnpm --filter @mystcrag/ai-agent exec tsx --test tests/oracle-copy.service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic original copy and fail-safe fallback**

Describe observation and composition, never prediction or efficacy. Invalid provider/copy output falls back to reviewed deterministic Mystcrag copy and never exposes the raw rejected text.

- [ ] **Step 4: Record content and provider boundaries**

Update `AI_AGENT_SPEC.md` with the no-question boundary and `OSS_RESEARCH.md` with “no modern text copied” evidence.

- [ ] **Step 5: Run package tests and typecheck**

Run: `pnpm --filter @mystcrag/ai-agent test && pnpm --filter @mystcrag/ai-agent typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage the whole AI package.
git commit -m "feat(oracle): add safe original interpretation copy"
```

### Task 5: Add owner-scoped Oracle persistence

**Governance task:** `TASK-ORACLE-DB-001`, branch `task/oracle-db-001-session-persistence`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260926090000_add_oracle_sessions/migration.sql`
- Create: `packages/database/src/mappers/oracle-snapshot.mapper.ts`
- Create: `packages/database/src/mappers/oracle-snapshot.unit.test.ts`
- Create: `packages/database/src/repositories/oracle-session.repository.ts`
- Create: `packages/database/src/repositories/oracle-session.repository.unit.test.ts`
- Create: `packages/database/src/repositories/oracle-session.integration.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `docs/DATABASE_SCHEMA.md`
- Modify: `docs/PERSISTENCE_MODEL_V1.md`

**Interfaces:**
- Produces Prisma enums: `ORACLE_GUIDED` design mode and `OracleSessionStatus { CAST RECOMMENDED SAVED }`.
- Produces models: `OracleSession` and `OracleDesignRecommendation`, owner-scoped and related to `User`/`Design` with restrictive deletion.
- Produces unique `[ownerId, operationId]`, unique `[sessionId, rank]`, and unique `[sessionId, designId]` constraints.
- Produces `OracleSessionRepository` methods `createOrGet`, `getOwned`, `saveRecommendations`, and `markSaved`, each with expected-revision/idempotency semantics.
- Stores: cast snapshot, interpretation/signal snapshot, algorithm/rule version, selected design, parent session, timestamps. Does not store question text/ciphertext/hash.

- [ ] **Step 1: Write failing mapper and repository tests**

Test strict write/read validation, corrupt JSON as `DATA_INTEGRITY_ERROR`, same operation replay, operation reuse with different wrist/parent as `CONFLICT`, cross-owner generic denial, unchanged recommendation retry, three unique ranks, stale revision rejection, and absence of every question column/value.

- [ ] **Step 2: Run database tests and verify missing schema/repository fail**

Run: `pnpm --filter @mystcrag/database exec tsx --test src/mappers/oracle-snapshot.unit.test.ts src/repositories/oracle-session.repository.unit.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement migration, mapper, and repository**

Use transactions for session state plus recommendation links. Validate JSON before write and after read. Never hand-edit the generated Prisma client.

- [ ] **Step 4: Run migration/integration verification against the test database**

Run: `pnpm db:up && pnpm --filter @mystcrag/database db:prepare-test && DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @mystcrag/database db:migrate && DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @mystcrag/database exec tsx --test src/repositories/oracle-session.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Update database control documents**

Record table fields, indexes, immutable cast behavior, ownership, retention, and the deliberate absence of question persistence.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage the whole database package.
git commit -m "feat(database): persist oracle sessions safely"
```

### Task 6: Compose Oracle service and authenticated API

**Governance task:** `TASK-ORACLE-BE-001`, branch `task/oracle-be-001-service-api`

**Files:**
- Create: `apps/backend/src/config/oracle-feature.ts`
- Create: `apps/backend/src/config/oracle-feature.test.ts`
- Create: `apps/backend/src/modules/oracle/oracle.types.ts`
- Create: `apps/backend/src/modules/oracle/oracle.public-mapper.ts`
- Create: `apps/backend/src/modules/oracle/oracle.service.ts`
- Create: `apps/backend/src/modules/oracle/oracle.service.test.ts`
- Create: `apps/backend/src/modules/oracle/oracle.routes.ts`
- Create: `apps/backend/src/modules/oracle/oracle.routes.test.ts`
- Create: `apps/backend/src/modules/oracle/index.ts`
- Modify: `apps/backend/src/modules/design/design-api.service.ts`
- Create: `apps/backend/src/modules/design/design-api.oracle-guided.test.ts`
- Modify: `apps/backend/src/app.ts`
- Modify: `apps/backend/src/app.test.ts`
- Modify: `apps/backend/src/index.ts`
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/build.mjs`
- Modify: `apps/backend/src/modules/index.ts`
- Modify: `.env.example`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `OracleApiService` methods `create`, `recommendations`, `get`, and `save` using Task 1 DTOs.
- Produces: exact-true feature flag `MYSTCRAG_ORACLE_ENABLED`; only create is gated so existing sessions remain recoverable.
- Consumes: `OracleSessionRepository`, `NodeCryptoCoinSource`, the sole `OracleCastDomain` → `OracleCastDtoSchema` adapter, `deriveOracleDesignSignal`, `resolveOracleContext`, `OracleCopyService`, catalog/stock ports, and the existing Design application service.
- Extends: Design candidate generation accepts `designMode: "ORACLE_GUIDED"` and validates `oracleCandidate` provenance; no Oracle stock shortage exception.
- Routes: `POST /api/oracle/sessions`, `POST /api/oracle/sessions/:id/recommendations`, `GET /api/oracle/sessions/:id`, `POST /api/oracle/sessions/:id/save`.

- [ ] **Step 1: Write failing service tests**

Cover exactly 18 entropy reads, atomic CAST creation, same-operation replay, different-input conflict, optional question discarded before repository/copy calls, no-change casts, parent ownership, restore without entropy, recommendation retry, current stock/price validation, `ORACLE_GUIDED` provenance, and save idempotency.

- [ ] **Step 2: Write failing route/app tests**

Cover auth, strict request/response validation, disabled create as `NOT_IMPLEMENTED`, enabled module listing, generic cross-owner error, no request body/question in logs, stable `CONFLICT`, `PRICE_CHANGED`, `INVENTORY_CHANGED`, and `COMPLIANCE_BLOCKED` mapping.

- [ ] **Step 3: Run focused Backend tests and verify failure**

Run: `pnpm --filter @mystcrag/backend exec tsx --test src/modules/oracle/*.test.ts src/config/oracle-feature.test.ts src/app.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 4: Implement service, routes, and production composition**

Create the cast and original interpretation before persistence. Recommendations call the existing deterministic design pipeline through a narrow Oracle adapter; validate returned IDs, mode, sequence, price, stock, wrist, and provenance before linking.

- [ ] **Step 5: Run Backend and production-start checks**

Run: `pnpm --filter @mystcrag/backend test && pnpm --filter @mystcrag/backend typecheck && pnpm --filter @mystcrag/backend build && pnpm --filter @mystcrag/backend smoke:start`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list, including `pnpm-lock.yaml`; do not stage `apps/backend` as a directory.
git commit -m "feat(backend): add oracle session api"
```

### Task 7: Add the strict frontend Oracle API and recovery coordinator

**Governance task:** `TASK-ORACLE-FE-001`, branch `task/oracle-fe-001-client-state`

**Files:**
- Create: `apps/frontend/src/lib/api/oracle-api.ts`
- Create: `apps/frontend/src/lib/api/oracle-api.test.tsx`
- Create: `apps/frontend/src/features/oracle/oracle-coordinator.ts`
- Create: `apps/frontend/src/features/oracle/oracle-coordinator.test.tsx`
- Create: `apps/frontend/src/features/oracle/oracle-question-provider.tsx`
- Modify: `apps/frontend/src/lib/api/api-runtime.ts`

**Interfaces:**
- Produces: `OracleApiClient { create, recommendations, get, save }`, validating request and response with Task 1 schemas.
- Produces: `createOracleCoordinator({ api, navigate, now })` with observable states `idle | casting | revealing | recommended | saving | error`.
- Produces: in-memory-only question provider; it must not use `localStorage`, `sessionStorage`, URL query, analytics, or logs.
- Guarantees: ambiguous create/recommend/save calls reconcile with `GET`; restore never invokes create.

- [ ] **Step 1: Write failing API validation tests**

Assert bearer auth, encoded session IDs, strict response parsing, stable error mapping, no request question in any returned/public object, and no browser storage calls.

- [ ] **Step 2: Write failing coordinator transition tests**

Assert one create call per double-click, redirect to the returned session, immediate cast readability, automatic recommendation, recommendation-only retry, restore after refresh, static-cast rendering state, and selected-design preservation across ambiguous save.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/lib/api/oracle-api.test.tsx src/features/oracle/oracle-coordinator.test.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement API client and coordinator**

Follow the existing Tarot client validation style but keep Oracle state smaller. The coordinator, not the component, owns network transitions and reconciliation.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @mystcrag/frontend test && pnpm --filter @mystcrag/frontend typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage the whole Oracle feature directory.
git commit -m "feat(frontend): add recoverable oracle client state"
```

### Task 8: Build the one-tap Oracle interface

**Governance task:** `TASK-ORACLE-FE-002`, branch `task/oracle-fe-002-one-tap-ui`

**Files:**
- Create: `apps/frontend/app/oracle/layout.tsx`
- Create: `apps/frontend/app/oracle/page.tsx`
- Create: `apps/frontend/app/oracle/result/[sessionId]/page.tsx`
- Create: `apps/frontend/src/features/oracle/components/oracle-setup.tsx`
- Create: `apps/frontend/src/features/oracle/components/oracle-reveal.tsx`
- Create: `apps/frontend/src/features/oracle/components/oracle-lines.tsx`
- Create: `apps/frontend/src/features/oracle/components/oracle-result.tsx`
- Create: `apps/frontend/src/features/oracle/oracle.module.css`
- Create: `apps/frontend/src/features/oracle/oracle-motion-preference.ts`
- Create: `apps/frontend/src/features/oracle/oracle-motion-preference.test.tsx`
- Create: `apps/frontend/src/features/oracle/oracle-setup.test.tsx`
- Create: `apps/frontend/src/features/oracle/oracle-result.test.tsx`
- Modify: `apps/frontend/app/page.tsx`
- Modify: `apps/frontend/app/navigation.ts`
- Modify: `apps/frontend/app/layout.tsx`
- Modify: `apps/frontend/components/mobile-bottom-nav.tsx`
- Modify: `apps/frontend/src/lib/api/frontend-api-error.ts`

**Interfaces:**
- Consumes: capability functions from Phase 0 Task 1 and coordinator/API from Task 6.
- Produces: `/oracle` with optional question, optional wrist, and one “启卦” button.
- Produces: `/oracle/result/[sessionId]` with 2.8–4 second fresh-session reveal, immediate cast summary, async recommendations, detail disclosure, and “生成我的手串”.
- Produces: `OracleLines({ lines, movingLineIndices, revealProgress })` with solid/broken geometry, text labels, and no color-only meaning.
- Consumes: `MIN_BRACELET_CIRCUMFERENCE_MM` and `MAX_BRACELET_CIRCUMFERENCE_MM` from the existing frontend `design/model/bracelet-fit.ts`; it must not redeclare `130`/`200`.
- Produces: a question-free returning-user preference that can disable the full reveal; reduced-motion always wins and receives the short reveal. Persist only the boolean motion choice under versioned key `mystcrag:oracle:full-motion:v1` in browser storage; never co-locate the question, session payload, cast, or identifiers.

- [ ] **Step 1: Write failing setup tests**

Assert optional question, default enabled button, one submit on double click, wrist validation through imported fit constants, question held only in memory, disabled feature state, and navigation to the returned session.

- [ ] **Step 2: Write failing result and accessibility tests**

Assert bottom-to-top line rendering, moving-line text labels, no-change omission, one headline/three keywords, cast remains visible when recommendation fails, only recommendation retries, design cards use authoritative values, reduced-motion short reveal, returning-user full-animation opt-out, refresh without new entropy, and animation duration no more than 4000 ms.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/oracle/oracle-setup.test.tsx src/features/oracle/oracle-result.test.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement setup, reveal, and result pages**

Keep culture/algorithm/privacy details in a disclosure. Never delay readable results for recommendation generation; show a stable skeleton and keep “重新匹配水晶” scoped to recommendations.

- [ ] **Step 5: Add conditional Oracle entry and navigation**

When `MYSTCRAG_ORACLE_ENABLED === "true"`, add “星台问卦” to desktop/mobile navigation and homepage cards. When false, leave no gap or promotional copy.

- [ ] **Step 6: Run frontend tests, lint, and build**

Run: `pnpm --filter @mystcrag/frontend test && pnpm --filter @mystcrag/frontend lint && pnpm --filter @mystcrag/frontend build`

Expected: PASS and the build lists `/oracle` and `/oracle/result/[sessionId]`.

- [ ] **Step 7: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage whole app/component/API directories.
git commit -m "feat(frontend): add one tap star oracle flow"
```

### Task 9: Register, document, and verify the complete Oracle feature

**Governance task:** `TASK-ORACLE-QA-001`, branch `task/oracle-qa-001-release-gate`

**Files:**
- Modify: `docs/governance/FEATURE_REGISTRY.md`
- Modify: `docs/governance/CANONICAL_COMPONENTS.md`
- Modify: `docs/governance/MODULE_OWNERS.md`
- Modify: `docs/INDEX.md`
- Modify: `docs/UI_DESIGN_SYSTEM.md`
- Modify: `docs/INTERACTION_TEST_PLAN.md`
- Modify: `docs/DEPENDENCY_DECISIONS.md`
- Modify: `docs/DEPLOYMENT_GUIDE.md`
- Modify: `docs/LOCAL_DEMO_GUIDE.md`
- Create: `docs/progress/2026-09-26_STAR_ORACLE_QA_REPORT.md`
- Modify: `tests/architecture.test.mjs`

**Interfaces:**
- Registers: `@mystcrag/oracle-engine` as the only cast authority, Design Contract as public schema authority, Context Resolver as design-signal authority, and Backend as session/random/persistence authority.
- Produces: release evidence and feature-flag rollback instructions.

- [ ] **Step 1: Add cross-workspace architecture assertions**

Assert there is one Oracle line enum, one session DTO family, no engine imports from apps/database/AI, no frontend import of private persistence types, and no duplicate cast implementation outside `packages/oracle-engine`.

- [ ] **Step 2: Run the end-to-end acceptance matrix**

Verify enabled/disabled flags, mobile/desktop, optional/no question, moving/no-moving cast, double-click, refresh, recommendation retry, stock and price conflict, save retry, owner isolation, keyboard, reduced motion, and one-click-to-cast behavior. Confirm no question in Backend logs or persisted rows.

- [ ] **Step 3: Update registries and controlling docs**

Record production entry points, canonical ownership, dependencies, public-domain/OSS sources, feature flag, rollback, and known non-goals. Do not mark Tarot or 3D as Oracle dependencies.

- [ ] **Step 4: Run the full validation and database gate**

Run: `pnpm validate`

Then run the documented PostgreSQL Oracle integration suite against a fresh test database.

Expected: all gates PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/governance/FEATURE_REGISTRY.md docs/governance/CANONICAL_COMPONENTS.md docs/governance/MODULE_OWNERS.md docs/INDEX.md docs/UI_DESIGN_SYSTEM.md docs/INTERACTION_TEST_PLAN.md docs/DEPENDENCY_DECISIONS.md docs/DEPLOYMENT_GUIDE.md docs/LOCAL_DEMO_GUIDE.md docs/progress/2026-09-26_STAR_ORACLE_QA_REPORT.md tests/architecture.test.mjs
git commit -m "docs: register and verify star oracle"
```

## Completion Gate

The feature is complete only after all nine governance tasks are integrated in dependency order, the feature registry points to real production composition, a fresh PostgreSQL run passes, the optional question is proven absent from persistence/logs/providers, and `pnpm validate` passes on the integrated candidate.
