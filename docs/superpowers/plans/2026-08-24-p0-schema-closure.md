# P0 Schema Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two P0 schema authority conflicts without changing public behavior, then freeze a validated baseline.

**Architecture:** Design Contract is the one public Tarot value authority; Tarot Engine composes those values into private invariants. AI provider bead-layout proposals and backend catalog generation drafts remain separate, explicitly named concepts joined by the existing adapter boundary. BASE-002 and BASE-003 execute serially.

**Tech Stack:** TypeScript 6, Zod 4, pnpm workspaces, Node test runner, Fastify, Turborepo.

**Spec:** `docs/P0_BASELINE_CLOSURE_DISPATCH.md`

## Global Constraints

- BASE-002 must be merged and validated on `main` before BASE-003 starts.
- No Feature, AUTH, P1 or P2 implementation is authorized.
- Do not change enum values, public API payloads, DesignV1, Prisma or persisted data.
- Provider/adapter outputs remain `unknown` until parsed at the existing trust boundary.
- Do not retain `AiDesignCandidateSchema` or `AiDesignCandidate` compatibility aliases.
- Every task uses its registered branch, worktree and exact allowed path set.

---

### Task 1: BASE-002 Tarot public authority regression

**Files:**
- Modify: `tests/architecture.test.mjs`

**Interfaces:**
- Consumes: Design Contract public Tarot schema names.
- Produces: an architecture gate that prevents Tarot Engine from redefining public values.

- [ ] **Step 1: Add the failing authority test**

Append a test using the file helpers already present in `tests/architecture.test.mjs`:

```js
test("Design Contract is the only public Tarot schema authority", async () => {
  const duplicateDefinitions = await matchingFiles(
    ["packages/tarot-engine"],
    /export const Tarot(?:Theme|SpreadType|Slot|Orientation)Schema\s*=\s*z\.enum/
  );
  assertNoMatches(duplicateDefinitions);

  const designContractManifest = JSON.parse(
    await readFile("packages/design-contract/package.json", "utf8")
  );
  assert.equal(designContractManifest.dependencies?.["@mystcrag/tarot-engine"], undefined);
});
```

- [ ] **Step 2: Run the test and verify it fails for the duplicate engine definitions**

Run: `node --test --test-name-pattern="only public Tarot schema authority" tests/architecture.test.mjs`

Expected: FAIL listing `packages/tarot-engine/src/types.ts`.

### Task 2: BASE-002 consume canonical Tarot schemas

**Files:**
- Modify: `packages/tarot-engine/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/tarot-engine/src/types.ts`
- Modify: `packages/tarot-engine/src/index.ts`
- Modify: `packages/tarot-engine/src/spreads.ts`
- Modify: `packages/tarot-engine/src/draw-session.ts`
- Modify: `packages/tarot-engine/src/design-signals.ts`
- Test: `packages/tarot-engine/tests/**`

**Interfaces:**
- Consumes: `TarotThemeSchema`, `TarotSpreadTypeSchema`, `TarotSlotSchema`, `TarotOrientationSchema` and their types from `@mystcrag/design-contract`.
- Produces: unchanged private Tarot Engine APIs with no alternative public schema exports.

- [ ] **Step 1: Add the one-way workspace dependency**

Set the Tarot Engine dependencies to include:

```json
"@mystcrag/design-contract": "workspace:*"
```

Run: `pnpm install --lockfile-only`

Expected: only the Tarot Engine workspace importer changes in `pnpm-lock.yaml`.

- [ ] **Step 2: Replace local public definitions with canonical imports**

At the top of `packages/tarot-engine/src/types.ts`, import the exact public values:

```ts
import {
  TarotOrientationSchema,
  TarotSlotSchema,
  TarotSpreadTypeSchema,
  type TarotOrientation,
  type TarotSlot,
  type TarotSpreadType
} from "@mystcrag/design-contract";
```

Remove local declarations for `TarotTheme`, `TarotSpreadType`, `TarotSlot`, `TarotOrientation` and their four schemas. Import `TarotTheme` only in `design-signals.ts`, where it is used. Preserve every private interface/schema refinement unchanged.

- [ ] **Step 3: Move internal public-type imports to Design Contract**

Use `@mystcrag/design-contract` for public Tarot types in `spreads.ts`, `draw-session.ts` and `design-signals.ts`; continue importing private draw/card interfaces from `./types`.

Remove the four schema exports from `packages/tarot-engine/src/index.ts` while retaining private engine schema/function exports.

- [ ] **Step 4: Run targeted tests**

Run:

```text
pnpm --filter @mystcrag/design-contract test
pnpm --filter @mystcrag/tarot-engine test
pnpm --filter @mystcrag/tarot-engine typecheck
pnpm --filter @mystcrag/context-resolver test
pnpm --filter @mystcrag/database test
pnpm --filter @mystcrag/backend test
node --test tests/architecture.test.mjs
```

Expected: all commands exit 0; authority test passes.

- [ ] **Step 5: Verify no compatibility path is needed**

Run: `rg -n "(?:TarotTheme|TarotSpreadType|TarotSlot|TarotOrientation)(?:Schema)?" apps packages --glob '*.ts' --glob '*.tsx'`

Expected: public schema/type imports outside Tarot Engine resolve to Design Contract; no external import of those names from `@mystcrag/tarot-engine`.

- [ ] **Step 6: Run the BASE-002 gate and commit**

Run: `pnpm validate && git diff --check`

Expected: exit 0 and only BASE-002 allowed files changed.

Commit: `fix(contract): make tarot public schemas canonical`

### Task 3: SOL integrate BASE-002

**Files:**
- No new implementation files; conflict resolution is limited to BASE-002 allowed paths.

**Interfaces:**
- Consumes: reviewed BASE-002 commit.
- Produces: new validated `main` from which BASE-003 branches.

- [ ] **Step 1: Verify scope and contract**

Run: `git diff --name-status main...task/base-002-tarot-canonical-schema`

Expected: only BASE-002 allowed files.

- [ ] **Step 2: Rebase, retest and integrate**

Rebase onto latest `main`, rerun BASE-002 required tests, then perform the approved serial merge/fast-forward.

- [ ] **Step 3: Validate main**

Run: `pnpm validate`

Expected: exit 0 before BASE-003 is moved from BLOCKED to READY.

### Task 4: BASE-003 AI naming regression

**Files:**
- Modify: `tests/architecture.test.mjs`

**Interfaces:**
- Consumes: frozen `AiBeadLayoutCandidateSchema` and `CatalogDesignGenerationDraftSchema` names.
- Produces: a source-level gate preventing the ambiguous old schema/type names.

- [ ] **Step 1: Add the failing naming test**

```js
test("AI bead layouts and backend catalog drafts have distinct names", async () => {
  const ambiguousNames = await matchingFiles(
    ["apps", "packages"],
    /\bAiDesignCandidate(?:Schema)?\b/
  );
  assertNoMatches(ambiguousNames);

  const aiSchemas = await matchingFiles(
    ["packages/ai-agent"],
    /export const AiBeadLayoutCandidateSchema\b/
  );
  const backendSchemas = await matchingFiles(
    ["apps/backend"],
    /const CatalogDesignGenerationDraftSchema\b/
  );
  assert.equal(aiSchemas.length, 1);
  assert.equal(backendSchemas.length, 1);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test --test-name-pattern="distinct names" tests/architecture.test.mjs`

Expected: FAIL listing the current AI schema and backend design service.

### Task 5: BASE-003 rename AI bead-layout contract

**Files:**
- Rename: `packages/ai-agent/src/schemas/ai-design-candidate.schema.ts` -> `packages/ai-agent/src/schemas/ai-bead-layout-candidate.schema.ts`
- Modify: `packages/ai-agent/package.json`
- Modify: `packages/ai-agent/index.ts`
- Modify: `packages/ai-agent/src/schemas/recommendation-output.schema.ts`
- Modify: `packages/ai-agent/src/adapters/**`
- Modify: `packages/ai-agent/src/recommendation/**`
- Modify: `packages/ai-agent/src/fixtures/crystals.ts`
- Modify: `packages/ai-agent/design-agent/index.ts`
- Modify: `packages/ai-agent/compliance-agent/index.ts`
- Test: `packages/ai-agent/tests/**`

**Interfaces:**
- Consumes: provider output as `unknown`.
- Produces: `AiBeadLayoutCandidateSchema`, `AiBeadLayoutCandidate`, `RecommendationProviderOutputSchema` and conversion to DesignV1.

- [ ] **Step 1: Rename the schema and exports atomically**

The renamed file must export:

```ts
export const AiBeadLayoutCandidateSchema = z
  .strictObject({
    designName: z.string().trim().min(1).max(200),
    emotionTags: z.array(IdentifierSchema).max(30),
    styleTags: z.array(IdentifierSchema).max(30),
    colorPalette: z.array(z.string().trim().min(1).max(80)).max(20),
    culturalInspiration: z.array(CulturalInspirationSchema).max(20),
    designStory: z.string().trim().max(4_000),
    recommendationReasons: z.array(NonEmptyTextSchema).max(30),
    sourceTemplateIds: z.array(IdentifierSchema).max(30),
    components: z.array(AiBeadCandidateSchema).min(1)
  })
  .superRefine((candidate, context) => {
    const positions = candidate.components
      .map((component) => component.positionIndex)
      .sort((left, right) => left - right);
    if (new Set(positions).size !== positions.length) {
      context.addIssue({
        code: "custom",
        message: "AI candidate positions must be unique",
        path: ["components"]
      });
    }
    positions.forEach((position, index) => {
      if (position !== index) {
        context.addIssue({
          code: "custom",
          message: "AI candidate positions must start at zero and remain contiguous",
          path: ["components"]
        });
      }
    });
  });

export type AiBeadLayoutCandidate = z.infer<typeof AiBeadLayoutCandidateSchema>;
```

Update the package root and `./schemas` export to the new filename/name. Update all AI consumers. Rename directly coupled public helpers to `aiBeadLayoutCandidateToDesignV1`, `AiBeadLayoutConversionIssue`, `AiBeadLayoutConversionResult` and `legacyDesignToAiBeadLayoutCandidate`; retain their behavior.

- [ ] **Step 2: Run AI tests**

Run: `pnpm --filter @mystcrag/ai-agent test && pnpm --filter @mystcrag/ai-agent typecheck`

Expected: exit 0 with strict/contiguous/compliance/legacy conversion cases preserved.

### Task 6: BASE-003 rename backend catalog draft

**Files:**
- Modify: `apps/backend/src/modules/design/design-api.service.ts`
- Modify: `apps/backend/src/modules/design/ai-recommendation-design.adapter.ts`
- Test: `apps/backend/src/modules/design/design-api.service.test.ts`
- Test: `apps/backend/src/modules/design/design.routes.test.ts`
- Test: `apps/backend/src/modules/design/ai-recommendation-design.adapter.test.ts`

**Interfaces:**
- Consumes: AI bead-layout candidate through `AiRecommendationDesignAdapter` and Tarot/mock draft objects as `unknown`.
- Produces: validated `CatalogDesignGenerationDraft` immediately before DesignV1 assembly.

- [ ] **Step 1: Rename the backend-local boundary**

Rename the existing local Zod constant without changing its shape:

```ts
const CatalogDesignGenerationDraftSchema = z.strictObject({
  designName: z.string().trim().min(1).max(120),
  materialProductIds: z.array(z.string().min(1)).min(1),
  accessoryProductIds: z.array(z.string().min(1)),
  designStory: z.string().trim().min(1).max(2_000),
  recommendationReasons: z.array(z.string().trim().min(1).max(500)).min(1),
  culturalInspiration: z.array(CulturalInspirationSchema),
  sourceTemplateIds: z.array(z.string().trim().min(1)),
  productionNotes: z.array(z.string().trim().min(1).max(500)).default([]),
  providerMetadata: z.strictObject({
    modelProvider: z.string().trim().min(1),
    modelName: z.string().trim().min(1),
    promptVersion: z.string().trim().min(1),
    knowledgeBaseVersion: z.string().trim().min(1),
    designTemplateVersion: z.string().trim().min(1).nullable(),
    tarotCandidate: z.strictObject({
      sessionId: z.string().trim().min(1).max(160),
      ruleVersion: z.string().trim().min(1).max(160),
      rank: z.number().int().min(1).max(3),
      direction: z.enum(["BALANCED", "CONTRAST", "NEUTRAL_LED"])
    }).optional()
  })
});

type CatalogDesignGenerationDraft = z.infer<
  typeof CatalogDesignGenerationDraftSchema
>;
```

Parse `candidateInput` with `CatalogDesignGenerationDraftSchema` in `buildGeneratedDesign`. Keep `DesignGenerationAdapter.generate(...): Promise<unknown>` and `generateFromCandidate(...candidate: unknown)` unchanged.

- [ ] **Step 2: Run backend regressions**

Run: `pnpm --filter @mystcrag/backend test && pnpm --filter @mystcrag/backend typecheck`

Expected: exit 0; AI, mock and Tarot generation behavior unchanged.

### Task 7: BASE-003 controlling docs, gate and commit

**Files:**
- Modify: `docs/AI_AGENT_SPEC.md`
- Modify: `docs/INTEGRATION_CHECKLIST.md`
- Modify: `docs/TECH_ARCHITECTURE.md`
- Modify: `docs/KNOWLEDGE_SYSTEM_SPEC.md`

**Interfaces:**
- Consumes: implemented names and unchanged trust boundary.
- Produces: current documentation matching runtime source.

- [ ] **Step 1: Replace current controlling terminology**

Document the pipeline exactly as:

```text
provider unknown
  -> AiBeadLayoutCandidateSchema
  -> compliance + catalog mapping adapter
  -> CatalogDesignGenerationDraftSchema
  -> authoritative catalog/inventory/pricing enrichment
  -> DesignV1Schema
```

Do not edit dated phase reports or historical plans.

- [ ] **Step 2: Run the complete BASE-003 gate**

Run:

```text
rg -n "\bAiDesignCandidate(Schema)?\b" apps packages
node --test tests/architecture.test.mjs
pnpm --filter @mystcrag/design-contract test
pnpm validate
git diff --check
```

Expected: `rg` returns no runtime matches; all tests exit 0; only BASE-003 allowed files changed.

- [ ] **Step 3: Commit**

Commit: `fix(ai): distinguish layout candidates from catalog drafts`

### Task 8: SOL integrate BASE-003 and execute BASE-004

**Files:**
- Modify after validation only: governance health/baseline/task/branch records.
- Create after READY only: annotated tag `baseline/v0.1.0-20260824`.

**Interfaces:**
- Consumes: reviewed BASE-003 and validated latest main.
- Produces: frozen baseline commit/tag or an explicit remaining-P0 report.

- [ ] **Step 1: Rebase, review and integrate BASE-003**

Verify exact allowed paths, frozen names, behavior-preserving tests and zero ambiguous runtime names before the serial approved merge.

- [ ] **Step 2: Run full repository validation**

Run frozen install, `pnpm validate`, fresh PostgreSQL migration/integration verification and the repository's available isolated browser smoke. Do not change config or tests to obtain green output.

- [ ] **Step 3: Re-audit and decide**

If any required gate fails, record `BASELINE STATUS: NOT READY`, list remaining P0 and create no tag.

If every gate passes, record the exact main commit, final score, governance version and 2026-08-24 freeze date, then create annotated tag `baseline/v0.1.0-20260824`.
