# Tarot-Guided Bracelet Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, server-authoritative Tarot guidance flow that turns a one-card or three-card draw into three real, priced, editable Mystcrag bracelet designs.

**Architecture:** Keep the authorized upstream snapshot isolated under `prototypes/tarot-upstream`. Port only reviewed card metadata and art into a pure `@mystcrag/tarot-engine`, expose versioned Zod DTOs through `@mystcrag/design-contract`, persist owner-scoped sessions in PostgreSQL, orchestrate designs through the existing Design API service, and render responsive Next.js setup/draw/result routes. The browser owns animation only; the backend owns deck order, selection, reveal, recommendation, price, and design IDs.

**Tech Stack:** pnpm workspaces, TypeScript 6, Node 22, Next.js 16, React 19, Fastify 5, Zod 4, Prisma/PostgreSQL, `node:test` through `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-19-tarot-guided-bracelet-design.md`

## Global Constraints

- Keep `prototypes/tarot-upstream` outside the pnpm workspace and never import it at runtime.
- Preserve current AI Design and direct DIY behavior.
- Use existing bearer authentication, owner scoping, error envelopes, catalog SKUs, pricing, Design persistence, and `/diy/:designId` handoff.
- Never expose private deck order, raw saved question, prompts, costs, inventory quantities, credentials, or chain-of-thought.
- Default question persistence is off. Redact request logging for recommendation requests before the route is enabled.
- Treat Tarot and crystal associations as cultural/design inspiration; do not add deterministic prediction, medical, efficacy, or guaranteed-return claims.
- Additive migration only. Existing saved designs and orders must remain readable.
- Backend and server-rendered frontend flags default off unless explicitly enabled.
- Before editing, inspect `git status --short`; do not stage or alter the owner's unrelated work in `apps/frontend/package.json`, current design components/tests, or local evidence folders unless a task explicitly requires that file and the overlap is reconciled first.
- Follow TDD: add one failing assertion, run it and observe the expected failure, implement the smallest behavior, rerun the narrow test, then refactor.
- Run `pnpm validate` only after all narrow checks pass.

## File Map

### New files

- `packages/tarot-engine/package.json`
- `packages/tarot-engine/tsconfig.json`
- `packages/tarot-engine/src/index.ts`
- `packages/tarot-engine/src/types.ts`
- `packages/tarot-engine/src/card-catalog.ts`
- `packages/tarot-engine/src/spreads.ts`
- `packages/tarot-engine/src/random.ts`
- `packages/tarot-engine/src/draw-session.ts`
- `packages/tarot-engine/src/design-signals.ts`
- `packages/tarot-engine/tests/card-catalog.test.ts`
- `packages/tarot-engine/tests/draw-session.test.ts`
- `packages/tarot-engine/tests/design-signals.test.ts`
- `packages/design-contract/src/schemas/tarot.schema.ts`
- `packages/design-contract/tests/tarot-contract.test.ts`
- `packages/database/prisma/migrations/20260820100000_add_tarot_sessions/migration.sql`
- `packages/database/src/mappers/tarot-snapshot.mapper.ts`
- `packages/database/src/repositories/tarot-session.repository.ts`
- `packages/database/src/repositories/tarot-session.integration.test.ts`
- `packages/ai-agent/src/tarot/tarot-copy.schema.ts`
- `packages/ai-agent/src/tarot/tarot-copy.service.ts`
- `packages/ai-agent/src/tarot/index.ts`
- `packages/ai-agent/tests/tarot-copy.service.test.ts`
- `apps/backend/src/modules/tarot/index.ts`
- `apps/backend/src/modules/tarot/tarot.types.ts`
- `apps/backend/src/modules/tarot/tarot.public-mapper.ts`
- `apps/backend/src/modules/tarot/tarot.service.ts`
- `apps/backend/src/modules/tarot/tarot.routes.ts`
- `apps/backend/src/modules/tarot/tarot.service.test.ts`
- `apps/backend/src/modules/tarot/tarot.routes.test.ts`
- `apps/frontend/src/lib/api/tarot-api.ts`
- `apps/frontend/src/lib/api/tarot-api.test.tsx`
- `apps/frontend/src/features/tarot/components/tarot-setup.tsx`
- `apps/frontend/src/features/tarot/components/tarot-draw.tsx`
- `apps/frontend/src/features/tarot/components/tarot-fan.tsx`
- `apps/frontend/src/features/tarot/components/tarot-slots.tsx`
- `apps/frontend/src/features/tarot/components/tarot-result.tsx`
- `apps/frontend/src/features/tarot/components/tarot-recommendation-card.tsx`
- `apps/frontend/src/features/tarot/components/tarot-question-draft-provider.tsx`
- `apps/frontend/src/features/tarot/tarot.module.css`
- `apps/frontend/src/features/tarot/tarot-setup.test.tsx`
- `apps/frontend/src/features/tarot/tarot-draw.test.tsx`
- `apps/frontend/src/features/tarot/tarot-result.test.tsx`
- `apps/frontend/app/tarot/page.tsx`
- `apps/frontend/app/tarot/layout.tsx`
- `apps/frontend/app/tarot/setup/page.tsx`
- `apps/frontend/app/tarot/draw/[sessionId]/page.tsx`
- `apps/frontend/app/tarot/result/[sessionId]/page.tsx`
- `apps/frontend/public/tarot/cards/UPSTREAM_SOURCE.md`
- `tests/e2e/tarot-guided-flow.spec.ts`

### Modified files

- `pnpm-lock.yaml`
- `packages/design-contract/src/index.ts`
- `packages/design-contract/src/schemas/metadata.schema.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/src/index.ts`
- `packages/ai-agent/package.json`
- `packages/ai-agent/src/contracts/index.ts`
- `apps/backend/package.json`
- `apps/backend/src/app.ts`
- `apps/backend/src/index.ts`
- `apps/backend/src/modules/index.ts`
- `apps/backend/src/modules/design/design-api.service.ts`
- `apps/backend/src/modules/design/design-api.service.test.ts`
- `apps/frontend/app/layout.tsx`
- `apps/frontend/app/page.tsx`
- `apps/frontend/src/lib/api/api-runtime.ts`
- `.env.example`
- `docs/API_SPECIFICATION.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/AI_AGENT_SPEC.md`
- `docs/OSS_RESEARCH.md`
- `docs/INDEX.md`
- `docs/LOCAL_DEMO_GUIDE.md`

### Reviewed assets

- Source: `prototypes/tarot-upstream/public/images/cards/*`
- Runtime destination: `apps/frontend/public/tarot/cards/*`
- Copy exactly the reviewed 78 card faces plus card back; do not copy the upstream app, state store, pages, styles, or navigation.

---

## Task 1: Establish the pure Tarot engine and card catalog

**Interfaces**

- **Consumes:** deterministic `RandomSource`, card catalog metadata, spread type, displayed deck position, expected state revision, and operation ID.
- **Produces:** `createPrivateDrawState`, `selectPosition`, `revealDraw`, `deriveDesignSignals`, and immutable domain types exported from `@mystcrag/tarot-engine`.

**Files:**

- Create all `packages/tarot-engine/**` files listed in the file map.
- Modify `pnpm-lock.yaml` only through `pnpm install --lockfile-only` after the package exists.

- [ ] Write `card-catalog.test.ts` first. Assert exactly 78 unique IDs, unique asset filenames, localized names, keywords, and versioned design tags. Add an assertion that every runtime-facing filename is a basename, not a URL or traversal path.

- [ ] Run `pnpm --filter @mystcrag/tarot-engine test` and confirm the package/filter is missing or the test fails because the implementation does not exist.

- [ ] Add package scaffolding matching existing pure packages:

```json
{
  "name": "@mystcrag/tarot-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc --noEmit",
    "lint": "tsc --noEmit",
    "test": "tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] Define the public engine types with no framework imports:

```ts
export type TarotSpreadType = "SINGLE" | "PAST_PRESENT_FUTURE";
export type TarotSlot = "GUIDANCE" | "PAST" | "PRESENT" | "FUTURE";
export type TarotOrientation = "UPRIGHT" | "REVERSED";

export interface RandomSource {
  nextInt(maxExclusive: number): number;
}

export interface TarotCardDefinition {
  readonly id: string;
  readonly number: number;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly assetFile: string;
  readonly uprightKeywords: readonly string[];
  readonly reversedKeywords: readonly string[];
  readonly designTags: {
    readonly colors: readonly string[];
    readonly visual: readonly string[];
    readonly themes: readonly string[];
  };
}
```

- [ ] Port and normalize the 78-card metadata from the authorized snapshot into `card-catalog.ts`. Keep any substantial adapted structure accompanied by a short provenance comment referencing commit `e4d3a20265dd8a8b7e14e9ec980685fe20a79040`; do not copy long upstream interpretation prose.

- [ ] Add `draw-session.test.ts` covering deterministic Fisher-Yates order, one-card and three-card slot order, unique displayed positions, stale revision rejection, idempotent operation retry, no reveal before completion, stable repeated reveal, and both orientations.

- [ ] Implement the minimal immutable draw state API:

```ts
export interface PrivateDrawState {
  readonly spreadType: TarotSpreadType;
  readonly deckOrder: readonly string[];
  readonly orientationOrder: readonly TarotOrientation[];
  readonly selections: readonly {
    slot: TarotSlot;
    displayedPosition: number;
    operationId: string;
  }[];
  readonly revision: number;
  readonly revealed: boolean;
}

export function createPrivateDrawState(input: {
  spreadType: TarotSpreadType;
  random: RandomSource;
}): PrivateDrawState;

export function selectPosition(
  state: PrivateDrawState,
  command: {
    slot: TarotSlot;
    displayedPosition: number;
    expectedRevision: number;
    operationId: string;
  }
): PrivateDrawState;

export function revealDraw(
  state: PrivateDrawState,
  expectedRevision: number
): { state: PrivateDrawState; cards: readonly RevealedTarotCard[] };
```

- [ ] Implement `NodeCryptoRandomSource` with `node:crypto.randomInt` in `random.ts`; tests must use a deterministic fake and must never patch global randomness.

- [ ] Add `design-signals.test.ts` for Present→primary, Past→support, Future→accent, single-card neutral completion, reversed tags, and the three distinct direction names `BALANCED`, `CONTRAST`, `NEUTRAL_LED`.

- [ ] Implement `deriveDesignSignals` as deterministic structured output only:

```ts
export function deriveDesignSignals(input: {
  spreadType: TarotSpreadType;
  cards: readonly RevealedTarotCard[];
  theme: TarotTheme;
}): {
  palette: { primary: string; support: string; accent: string };
  styleTags: readonly string[];
  themeTags: readonly string[];
  directions: readonly ["BALANCED", "CONTRAST", "NEUTRAL_LED"];
  ruleVersion: string;
};
```

- [ ] Run `pnpm install --lockfile-only`, then `pnpm --filter @mystcrag/tarot-engine test` and `pnpm --filter @mystcrag/tarot-engine typecheck`. Expect both to pass.

- [ ] Commit only this package and its lockfile change:

```bash
git add packages/tarot-engine pnpm-lock.yaml
git commit -m "feat(tarot): add deterministic draw engine"
```

---

## Task 2: Define the public Tarot API contract

**Interfaces**

- **Consumes:** stable enum literals from the approved spec plus existing `PublicDesignV1Schema`, metadata, identifier, currency, locale, and amount schemas. The contract package must not depend on the engine package.
- **Produces:** versioned Zod request/response schemas and inferred TypeScript types for all six Tarot endpoints. No private deck fields are representable.

**Files:**

- Create `packages/design-contract/src/schemas/tarot.schema.ts`.
- Create `packages/design-contract/tests/tarot-contract.test.ts`.
- Modify `packages/design-contract/src/schemas/metadata.schema.ts`.
- Modify `packages/design-contract/src/index.ts`.

- [ ] Write contract tests for valid create/select/reveal/recommend/get/save payloads and invalid unknown keys, 121-character questions, private deck fields, invalid slot order, negative positions, invalid ranks, fewer/more than three recommendations, and non-`PublicDesignV1` designs. Extend metadata tests to accept `TAROT_GUIDED` and keep all existing design modes valid.

- [ ] Run `pnpm --filter @mystcrag/design-contract test`; confirm the new imports or schema assertions fail.

- [ ] Define strict schemas around these exact public shapes:

```ts
export const TarotThemeSchema = z.enum([
  "RELATIONSHIPS", "CAREER", "SELF_GROWTH", "NEW_BEGINNINGS", "FINANCIAL_PLANNING"
]);
export const TarotSpreadTypeSchema = z.enum(["SINGLE", "PAST_PRESENT_FUTURE"]);
export const TarotSessionStatusSchema = z.enum([
  "DRAWING", "DRAWN", "RECOMMENDED", "SAVED", "ABANDONED"
]);

export const CreateTarotSessionRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  spreadType: TarotSpreadTypeSchema,
  theme: TarotThemeSchema,
  parentSessionId: IdentifierSchema.optional()
});

export const SelectTarotCardRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  slot: z.enum(["GUIDANCE", "PAST", "PRESENT", "FUTURE"]),
  displayedPosition: z.number().int().min(0).max(77),
  expectedRevision: PositiveSafeIntegerSchema,
  operationId: IdentifierSchema
});

export const GenerateTarotRecommendationsRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  question: z.string().trim().min(1).max(120).optional(),
  saveQuestion: z.boolean().default(false),
  locale: LocaleSchema,
  currency: CurrencySchema
});
```

- [ ] Define `TarotPublicSessionSchema` with only `sessionId`, `spreadType`, `theme`, `status`, `revision`, ordered slots, accepted selections, optional revealed cards, optional interpretation/color story/material display recommendations, exactly three ranked `PublicDesignV1` recommendations, selected design ID, parent session ID, and timestamps. Ensure `privateDeckState`, `questionCiphertext`, costs, and inventory quantities are impossible under `.strictObject`.

- [ ] Define endpoint response schemas that carry `requestId` plus the relevant public session projection. Reuse the existing API error envelope rather than creating a Tarot-specific envelope.

- [ ] Export schemas and types from `packages/design-contract/src/index.ts`.

- [ ] Add `TAROT_GUIDED` to `DesignModeSchema`; do not change any existing serialized design mode value.

- [ ] Run `pnpm --filter @mystcrag/design-contract test` and `pnpm --filter @mystcrag/design-contract typecheck`. Expect both to pass.

- [ ] Commit:

```bash
git add packages/design-contract
git commit -m "feat(contract): add tarot session API schemas"
```

---

## Task 3: Add additive Tarot persistence and validated repository mapping

**Interfaces**

- **Consumes:** Prisma client, authenticated owner ID, engine private state, contract-safe snapshots, expected revision, and operation ID.
- **Produces:** owner-scoped `TarotSessionRecord` CRUD/state transition methods and ranked design links; every JSON value is validated on read and write.

**Files:**

- Modify `packages/database/prisma/schema.prisma`.
- Create `packages/database/prisma/migrations/20260820100000_add_tarot_sessions/migration.sql`.
- Create `packages/database/src/mappers/tarot-snapshot.mapper.ts`.
- Create `packages/database/src/repositories/tarot-session.repository.ts`.
- Create `packages/database/src/repositories/tarot-session.integration.test.ts`.
- Modify `packages/database/src/index.ts`.
- Modify `docs/DATABASE_SCHEMA.md` in the same commit.

- [ ] Add failing integration tests for create/read, owner isolation, JSON corruption detection, optimistic revision conflict, select operation idempotency, three unique ranks/designs, restrictive design foreign keys, redraw lineage, and default absence of raw question data.

- [ ] Run the repository integration test with the project test database command documented in `packages/database/package.json`; confirm it fails because the model/repository does not exist.

- [ ] Add enums and relations exactly as specified:

```prisma
enum TarotSpreadType { SINGLE PAST_PRESENT_FUTURE }
enum TarotSessionStatus { DRAWING DRAWN RECOMMENDED SAVED ABANDONED }

model TarotSession {
  id                     String             @id @default(cuid())
  ownerId                String             @map("owner_id")
  spreadType             TarotSpreadType    @map("spread_type")
  theme                  String
  status                 TarotSessionStatus @default(DRAWING)
  stateRevision          Int                @default(1) @map("state_revision")
  deckVersion            String             @map("deck_version")
  ruleVersion            String             @map("rule_version")
  privateDeckState       Json               @map("private_deck_state")
  drawSnapshot           Json               @map("draw_snapshot")
  recommendationSnapshot Json?              @map("recommendation_snapshot")
  questionCiphertext     String?            @map("question_ciphertext")
  questionSavedAt        DateTime?           @map("question_saved_at")
  selectedDesignId       String?             @map("selected_design_id")
  parentSessionId        String?             @map("parent_session_id")
  createdAt              DateTime            @default(now()) @map("created_at")
  updatedAt              DateTime            @updatedAt @map("updated_at")
  owner                  User                @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  parentSession          TarotSession?       @relation("TarotRedraw", fields: [parentSessionId], references: [id], onDelete: Restrict)
  redraws                TarotSession[]      @relation("TarotRedraw")
  recommendations        TarotDesignRecommendation[]

  @@index([ownerId, updatedAt])
  @@map("tarot_sessions")
}

model TarotDesignRecommendation {
  id        String       @id @default(cuid())
  sessionId String       @map("session_id")
  designId  String       @map("design_id")
  rank      Int
  createdAt DateTime     @default(now()) @map("created_at")
  session   TarotSession @relation(fields: [sessionId], references: [id], onDelete: Restrict)
  design    Design       @relation(fields: [designId], references: [id], onDelete: Restrict)

  @@unique([sessionId, rank])
  @@unique([sessionId, designId])
  @@map("tarot_design_recommendations")
}
```

- [ ] Add `TAROT_GUIDED` to `DesignMode`; add `tarotSessions` to `User` and `tarotRecommendations` to `Design`. Generate SQL with explicit enum/table/index/FK additions and no destructive statements.

- [ ] Implement mapper schemas for private engine state, draw snapshot, and recommendation snapshot. Parse values both before write and after Prisma read; throw the existing data-integrity error type on malformed persisted JSON.

- [ ] Implement this repository boundary:

```ts
export interface TarotSessionRepository {
  create(input: CreateTarotSessionRecord): Promise<TarotSessionRecord>;
  getOwned(ownerId: string, sessionId: string): Promise<TarotSessionRecord>;
  updateDraw(input: UpdateTarotDrawRecord): Promise<TarotSessionRecord>;
  saveRecommendations(input: SaveTarotRecommendationsRecord): Promise<TarotSessionRecord>;
  markSaved(input: MarkTarotSessionSavedRecord): Promise<TarotSessionRecord>;
}
```

- [ ] Use a transaction plus `updateMany({ where: { id, ownerId, stateRevision: expectedRevision } })` (or equivalent compare-and-swap) for every transition. Store accepted operation IDs in validated private state so retry returns the prior accepted result without incrementing revision.

- [ ] Run Prisma formatting/generation, migration SQL review, database unit tests, and integration test. Confirm the generated diff contains no drop/recreate of existing tables.

- [ ] Commit schema, migration, repository, tests, exports, and database documentation together:

```bash
git add packages/database docs/DATABASE_SCHEMA.md
git commit -m "feat(database): persist owner-scoped tarot sessions"
```

---

## Task 4: Implement authenticated session, selection, reveal, and restore APIs

**Interfaces**

- **Consumes:** authenticated actor ID, Tarot contract DTOs, `TarotSessionRepository`, `NodeCryptoRandomSource`, and `MYSTCRAG_TAROT_ENABLED`.
- **Produces:** create/select/reveal/get/save service methods and Fastify routes using the existing error envelope and validation helpers.

**Files:**

- Create `apps/backend/src/modules/tarot/index.ts`.
- Create `apps/backend/src/modules/tarot/tarot.types.ts`.
- Create `apps/backend/src/modules/tarot/tarot.public-mapper.ts`.
- Create `apps/backend/src/modules/tarot/tarot.service.ts`.
- Create `apps/backend/src/modules/tarot/tarot.routes.ts`.
- Create `apps/backend/src/modules/tarot/tarot.service.test.ts`.
- Create `apps/backend/src/modules/tarot/tarot.routes.test.ts`.
- Modify `apps/backend/package.json`, `apps/backend/src/app.ts`, `apps/backend/src/index.ts`, and `apps/backend/src/modules/index.ts`.

- [ ] Write service tests for session creation, parent ownership, hidden deck data, slot ordering, duplicate physical position, stale revision, idempotent operation ID, premature reveal, repeated reveal, completed draw immutability, save selection, and owner isolation.

- [ ] Write route tests for missing/invalid bearer token, disabled feature, malformed DTO, forbidden owner, stable error envelope, and raw question/request-body absence from captured logs.

- [ ] Run `pnpm --filter @mystcrag/backend test`; confirm failures occur at missing Tarot service/routes.

- [ ] Add `@mystcrag/tarot-engine` to backend dependencies and implement:

```ts
export interface TarotApiService {
  create(actorId: string, input: CreateTarotSessionRequest): Promise<CreateTarotSessionResponse>;
  select(actorId: string, sessionId: string, input: SelectTarotCardRequest): Promise<SelectTarotCardResponse>;
  reveal(actorId: string, sessionId: string, input: RevealTarotSessionRequest): Promise<RevealTarotSessionResponse>;
  get(actorId: string, sessionId: string): Promise<GetTarotSessionResponse>;
  save(actorId: string, sessionId: string, input: SaveTarotSessionRequest): Promise<SaveTarotSessionResponse>;
}
```

- [ ] Implement the public mapper as an allowlist. It must derive card-back metadata from static configuration and never spread a repository record into an API payload.

- [ ] Register protected routes under `/api/tarot/sessions`. Reuse `createAuthenticationPreHandler`, `validateRequest`, `validateResponse`, `DomainApiError`, and `toApiErrorEnvelope`.

- [ ] Extend `createApp` with an optional `tarotService`; require `authProvider` when either API service is present. Make new-session creation return a stable disabled response when `MYSTCRAG_TAROT_ENABLED` is not `true`, while GET for an existing session stays available for already-created local/saved sessions.

- [ ] Wire the repository and production crypto source in `apps/backend/src/index.ts`. Add `tarotModule` to `/api/modules` only when registered.

- [ ] Run `pnpm --filter @mystcrag/backend test` and `pnpm --filter @mystcrag/backend typecheck`. Expect pass.

- [ ] Commit:

```bash
git add apps/backend
git commit -m "feat(backend): add tarot draw session API"
```

---

## Task 5: Add deterministic catalog scoring and three real Design candidates

**Interfaces**

- **Consumes:** revealed cards, theme, active `CatalogMaterialProduct[]`, saved wrist/budget preferences when available, the existing Design application service's internal candidate-generation boundary, Tarot session repository, and rule version.
- **Produces:** exactly three distinct ranked `PublicDesignV1` values linked idempotently to the session, plus structured palette and material display recommendations.

**Files:**

- Modify `packages/tarot-engine/src/design-signals.ts` and `packages/tarot-engine/tests/design-signals.test.ts`.
- Modify `apps/backend/src/modules/tarot/tarot.types.ts`, `tarot.service.ts`, and their tests.
- Modify `apps/backend/src/modules/design/design-api.service.ts` and `design-api.service.test.ts`.
- Modify `apps/backend/src/index.ts` for dependency wiring.

- [ ] Add engine tests for weighted scoring: 40 color, 25 visual/style, 15 theme, 10 availability, and 10 budget. Assert deterministic tie-breaking by product ID and exclusion of inactive products.

- [ ] Implement a pure scorer with explicit scores, not prose:

```ts
export function scoreTarotMaterials(input: {
  signals: TarotDesignSignals;
  products: readonly TarotCatalogCandidate[];
  budget?: { minMinor?: number; maxMinor?: number };
}): readonly ScoredTarotMaterial[];
```

- [ ] Add backend tests asserting exactly three generation calls with stable request IDs `${sessionId}:1..3`, target wrist 155 mm when no saved preference exists, distinct direction tags, only active catalog IDs, authoritative returned prices, and no duplicate designs after retry.

- [ ] Introduce narrow dependencies instead of importing concrete services:

```ts
export interface TarotCatalogPort {
  listActiveCatalogProducts(currency: "CNY" | "TWD"): Promise<readonly CatalogMaterialProduct[]>;
}

export interface TarotDesignGenerator {
  generateFromCandidate(input: {
    actorId: string;
    request: GenerateDesignRequest;
    candidate: unknown;
    designMode: "TAROT_GUIDED";
  }): Promise<GenerateDesignResponse>;
}
```

- [ ] Refactor `DesignApplicationService.generate` without changing its public behavior: it obtains provider output and delegates to a new `generateFromCandidate` method. Pass `designMode` into `buildGeneratedDesign` instead of hard-coding `AI_GENERATED`. Restrict the internal mode parameter to `AI_GENERATED | TAROT_GUIDED`, keep `/api/design/generate` fixed to `AI_GENERATED`, and add a regression test proving callers cannot set mode through the public request.

- [ ] Implement `recommendations` in the Tarot service: require `DRAWN`, derive signals, score products, construct three schema-valid design candidates containing the selected active product IDs, create the three direction-specific `GenerateDesignRequest` values, call `generateFromCandidate(..., "TAROT_GUIDED")`, validate all outputs, transactionally link ranks 1–3, and return persisted results on retry.

- [ ] Preserve existing Design service responsibility for valid sequence, price, compliance, and persistence. Do not hand-assemble `PublicDesignV1` or calculate prices inside the Tarot module.

- [ ] Run engine and backend tests/typechecks. Expect pass.

- [ ] Commit:

```bash
git add packages/tarot-engine apps/backend
git commit -m "feat(tarot): generate three catalog-backed designs"
```

---

## Task 6: Add bounded AI interpretation with deterministic fallback

**Interfaces**

- **Consumes:** validated revealed-card summary, theme, optional ephemeral question, palette, selected material names, and compliance policy.
- **Produces:** validated concise reflective copy only; it cannot alter cards, orientation, products, sequence, price, inventory, or design IDs.

**Files:**

- Create `packages/ai-agent/src/tarot/tarot-copy.schema.ts`.
- Create `packages/ai-agent/src/tarot/tarot-copy.service.ts`.
- Create `packages/ai-agent/src/tarot/index.ts`.
- Create `packages/ai-agent/tests/tarot-copy.service.test.ts` so the existing `tests/*.test.ts` script executes it.
- Modify `packages/ai-agent/package.json` to export `./tarot`.
- Modify `apps/backend/src/modules/tarot/tarot.types.ts`, `tarot.service.ts`, tests, and production wiring.
- Modify `docs/AI_AGENT_SPEC.md` in the same commit.

- [ ] Write tests for valid provider output, provider failure, invalid schema, deterministic-fortune language, medical/efficacy claims, death language, guaranteed financial returns, and question omission from persistence by default.

- [ ] Define strict output:

```ts
export const TarotInterpretationSchema = z.strictObject({
  headline: z.string().trim().min(1).max(48),
  summary: z.string().trim().min(1).max(240),
  cardReflections: z.array(z.strictObject({
    slot: TarotSlotSchema,
    reflection: z.string().trim().min(1).max(160)
  })).min(1).max(3),
  designRationale: z.string().trim().min(1).max(240),
  disclaimer: z.string().trim().min(1).max(160)
});
```

- [ ] Implement a provider port and deterministic fallback. Run schema validation and compliance rewriting after provider output. The final disclaimer must state that the result is reflective/design inspiration, not deterministic advice or claimed crystal efficacy.

- [ ] Pass `question` in memory only to the copy adapter. When `saveQuestion` is false, ensure the repository command contains neither raw question nor ciphertext. When true, require an injected application encryption port and persist ciphertext only.

- [ ] Make AI failure non-fatal: designs and structured signals remain; fallback copy is returned and stored with a provider/fallback version marker.

- [ ] Run `pnpm --filter @mystcrag/ai-agent test`, its typecheck, and backend tests. Expect pass.

- [ ] Commit:

```bash
git add packages/ai-agent apps/backend docs/AI_AGENT_SPEC.md
git commit -m "feat(ai): add safe tarot interpretation copy"
```

---

## Task 7: Build the frontend Tarot API client and restore model

**Interfaces**

- **Consumes:** existing access token resolver, fetch implementation, and contract request/response schemas.
- **Produces:** typed create/select/reveal/recommendations/get/save client methods; all UI state can be rehydrated from `get(sessionId)`.

**Files:**

- Create `apps/frontend/src/lib/api/tarot-api.ts`.
- Create `apps/frontend/src/lib/api/tarot-api.test.tsx`.
- Modify `apps/frontend/src/lib/api/api-runtime.ts` only for the server-rendered feature flag helper.

- [ ] Write tests for route/method/body/auth header, URL-encoded IDs, response validation, server error mapping, missing credential, disabled frontend flag, and no local-storage or raw-question writes.

- [ ] Run `pnpm --filter @mystcrag/frontend test`; confirm missing client failures.

- [ ] Extract or reuse the Design API's generic authenticated request behavior without weakening its schemas. Expose:

```ts
export interface TarotApiClient {
  create(input: CreateTarotSessionRequest): Promise<CreateTarotSessionResponse>;
  select(sessionId: string, input: SelectTarotCardRequest): Promise<SelectTarotCardResponse>;
  reveal(sessionId: string, input: RevealTarotSessionRequest): Promise<RevealTarotSessionResponse>;
  recommendations(sessionId: string, input: GenerateTarotRecommendationsRequest): Promise<GenerateTarotRecommendationsResponse>;
  get(sessionId: string): Promise<GetTarotSessionResponse>;
  save(sessionId: string, input: SaveTarotSessionRequest): Promise<SaveTarotSessionResponse>;
}
```

- [ ] Add a server-only `isTarotFeatureEnabled()` that reads `MYSTCRAG_TAROT_ENABLED`; do not rely on a mutable browser-only flag to hide/enable server routes.

- [ ] Run frontend tests and typecheck. Expect pass.

- [ ] Commit only the API/model work; `apps/frontend/package.json` is not required by this task and must remain unstaged:

```bash
git add apps/frontend/src/lib/api
git commit -m "feat(frontend): add tarot API client"
```

---

## Task 8: Add equal landing entry and setup route

**Interfaces**

- **Consumes:** server-rendered Tarot feature flag and Tarot API `create` method.
- **Produces:** equal AI/Tarot/DIY landing paths, `/tarot` redirect, setup form with five themes, optional 120-character question held only in component memory, and one/three-card mode selection.

**Files:**

- Modify `apps/frontend/app/page.tsx` and `apps/frontend/app/layout.tsx`.
- Create `apps/frontend/app/tarot/page.tsx` and `apps/frontend/app/tarot/setup/page.tsx`.
- Create `apps/frontend/app/tarot/layout.tsx`.
- Create `apps/frontend/src/features/tarot/components/tarot-setup.tsx`.
- Create `apps/frontend/src/features/tarot/components/tarot-question-draft-provider.tsx`.
- Create `apps/frontend/src/features/tarot/tarot-setup.test.tsx`.

- [ ] Write tests asserting three equal entries when enabled, no Tarot entry when disabled, unchanged AI and DIY hrefs, exact approved DIY copy, Five Elements/Tarot safety copy, `/tarot` redirect, all themes, both spreads, question counter/limit, inline errors, and navigation only after server session creation.

- [ ] Run frontend tests and observe expected missing UI failures.

- [ ] Implement the landing panel group with shared markup/classes so the three paths have equal width and action weight. Add `塔罗引导` to the main navigation beside AI and DIY when enabled.

- [ ] Implement setup as an accessible form. Submit only `spreadType`, `theme`, and optional `parentSessionId` to session creation; keep the question in memory for the later recommendation call and make the privacy explanation visible. Because route navigation loses component memory, pass the question through an ephemeral in-memory handoff module scoped to the tab, never URL/localStorage/sessionStorage; on refresh, ask the user to re-enter it before recommendations.

- [ ] Implement a small `TarotQuestionDraftProvider` in `app/tarot/layout.tsx` so it survives setup → draw → result navigation within the Tarot route tree but disappears when the user leaves that tree. Its API is:

```ts
type TarotQuestionDraft = { question: string; saveQuestion: boolean };
type TarotQuestionDraftStore = {
  get(sessionId: string): TarotQuestionDraft | undefined;
  set(sessionId: string, draft: TarotQuestionDraft): void;
  clear(sessionId: string): void;
};
```

- [ ] Run setup tests, the existing AI flow tests, and frontend typecheck. Expect pass.

- [ ] Commit:

```bash
git add apps/frontend/app apps/frontend/src/features/tarot
git commit -m "feat(frontend): add tarot entry and setup flow"
```

---

## Task 9: Implement the responsive fan, server-confirmed selection, and reveal

**Interfaces**

- **Consumes:** restored public session, Tarot API select/reveal methods, pointer/touch/keyboard events, and `prefers-reduced-motion`.
- **Produces:** approved desktop fan, mobile half-fan, ordered slots, stable card visuals during drag/select, pending/rejected states, in-place reveal, and result navigation.

**Files:**

- Create `apps/frontend/app/tarot/draw/[sessionId]/page.tsx`.
- Create `apps/frontend/src/features/tarot/components/tarot-draw.tsx`.
- Create `apps/frontend/src/features/tarot/components/tarot-fan.tsx`.
- Create `apps/frontend/src/features/tarot/components/tarot-slots.tsx`.
- Create `apps/frontend/src/features/tarot/tarot.module.css`.
- Create `apps/frontend/src/features/tarot/tarot-draw.test.tsx`.
- Copy reviewed assets to `apps/frontend/public/tarot/cards/` and add `UPSTREAM_SOURCE.md`.

- [ ] Write interaction tests for 78 positions, required slot order, no duplicate choice, pointer/touch/Enter/Space input, pending confirmation, rejected rollback, unchanged shape/color/ratio, reveal lock until complete, reversed rotation, reduced motion, redraw lineage, and refresh rehydration.

- [ ] Add responsive assertions at component/layout level: desktop fan stays within 1440×1024; mobile scrollable half-fan and all actions stay within 390×844 without horizontal page overflow.

- [ ] Run frontend tests and confirm expected draw component failures.

- [ ] Copy only 78 faces and one back from the authorized snapshot. Compare source/destination file counts and hashes; document source repository, commit, adaptation scope, and release-rights gate in `UPSTREAM_SOURCE.md`.

- [ ] Render cards as buttons with stable `aspect-ratio`, `border-radius`, and image content. Selection may change only transform/position/shadow; it must not apply opacity, grayscale, hue, square drag preview, or placeholder styling to the selected card.

- [ ] Send `displayedPosition`, ordered slot, current revision, and UUID operation ID to the server. Do not move the card permanently until confirmation. On conflict, re-fetch the session and reconcile; on other errors, return it to the fan and show an inline error.

- [ ] After all slots are confirmed, enable Reveal. Reveal through the server, animate slots in order, rotate reversed artwork 180°, and route to `/tarot/result/:sessionId` after the reveal completes or immediately under reduced motion.

- [ ] Implement redraw by creating a new session with `parentSessionId`, never by resetting the completed session.

- [ ] Run draw tests, frontend typecheck/lint, and manually inspect asset counts:

```bash
find apps/frontend/public/tarot/cards -type f | sort
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
```

- [ ] Commit:

```bash
git add apps/frontend/app/tarot apps/frontend/src/features/tarot apps/frontend/public/tarot/cards
git commit -m "feat(frontend): add responsive tarot draw experience"
```

---

## Task 10: Implement the approved result UI and DIY handoff

**Interfaces**

- **Consumes:** restored revealed session, ephemeral optional question, recommendation API, three `PublicDesignV1` recommendations, save API, and existing DIY route.
- **Produces:** approved centered reading stage, three always-visible responsive recommendations, authoritative prices/materials/wrist size, save/select/redraw actions, and `/diy/:designId` navigation.

**Files:**

- Create `apps/frontend/app/tarot/result/[sessionId]/page.tsx`.
- Create `apps/frontend/src/features/tarot/components/tarot-result.tsx`.
- Create `apps/frontend/src/features/tarot/components/tarot-recommendation-card.tsx`.
- Create `apps/frontend/src/features/tarot/tarot-result.test.tsx`.
- Modify `apps/frontend/src/features/tarot/tarot.module.css`.

- [ ] Write tests for revealed card order/orientation, interpretation/palette/materials, exactly three options, real design names/prices/currency/wrist sizes, selected option state, save, DIY href, redraw, AI fallback notice, refresh restore, missing question recovery, and no carousel on mobile.

- [ ] Run frontend tests and observe expected missing result UI failures.

- [ ] Implement result page loading rules: if `DRAWING`, return to draw; if `DRAWN`, call recommendations once using the ephemeral question draft; if the draft was lost after refresh, show an inline optional question field with Skip/Continue; if `RECOMMENDED` or `SAVED`, render persisted recommendations immediately.

- [ ] Match the approved composition: centered title and reading, Past/Present/Future cards across desktop, three bracelet recommendation cards in one desktop row, and a vertical card section followed by all three bracelet options on mobile. Do not use a modal or carousel.

- [ ] Render bracelet visuals with existing Mystcrag bracelet preview components and the actual returned `PublicDesignV1`. Do not substitute generated static bracelet images for authoritative designs.

- [ ] Save calls the Tarot session save endpoint with optional selected design ID. Primary action is `选择方案并进入 DIY` and navigates to `/diy/${encodeURIComponent(design.designId)}`. Verify that existing DIY loader retrieves the real design.

- [ ] Ensure mobile actions remain visible without covering the third recommendation; sticky actions need bottom padding equal to their measured height plus safe-area inset.

- [ ] Run result tests, existing design/DIY frontend tests, typecheck, and lint. Expect pass.

- [ ] Commit:

```bash
git add apps/frontend/app/tarot apps/frontend/src/features/tarot
git commit -m "feat(frontend): add tarot results and DIY handoff"
```

---

## Task 11: Complete flags, environment wiring, and living documentation

**Interfaces**

- **Consumes:** `MYSTCRAG_TAROT_ENABLED`, question-encryption configuration for opt-in saving, existing local-demo environment, and authorization provenance.
- **Produces:** documented safe defaults, startup instructions, API/database/AI documentation, and a release-rights checklist.

**Files:**

- Modify `.env.example`.
- Modify `docs/API_SPECIFICATION.md`, `docs/OSS_RESEARCH.md`, `docs/INDEX.md`, and `docs/LOCAL_DEMO_GUIDE.md`.
- Reconcile any missed updates in `docs/DATABASE_SCHEMA.md` and `docs/AI_AGENT_SPEC.md`.

- [ ] Add configuration tests or startup assertions for backend/frontend flag parity. New session creation must be unavailable when disabled; existing normal Design/DIY routes must remain usable.

- [ ] Document these environment variables without real secrets:

```dotenv
MYSTCRAG_TAROT_ENABLED="false"
MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY=""
```

- [ ] If no production-grade encryption key/provider is configured, force `saveQuestion` to false and return an inline validation response rather than storing plaintext or reversible ad-hoc encoding.

- [ ] Add all six routes, DTO links, state transitions, retry semantics, and privacy behavior to `API_SPECIFICATION.md`; link the approved spec and implementation plan from `docs/INDEX.md`.

- [ ] Update `OSS_RESEARCH.md` with upstream URL, exact commit, copied asset/code inventory, local authorization status, and unresolved public/commercial release evidence for source code, card art, card back, fonts, and imagery.

- [ ] Update `LOCAL_DEMO_GUIDE.md` with flag enablement, migration/reset steps, test credential flow, and real backend mode. Do not enable mock mode for acceptance.

- [ ] Run documentation link/path checks already used by `pnpm validate`, plus targeted flag tests.

- [ ] Commit:

```bash
git add .env.example docs/API_SPECIFICATION.md docs/OSS_RESEARCH.md docs/INDEX.md docs/LOCAL_DEMO_GUIDE.md docs/DATABASE_SCHEMA.md docs/AI_AGENT_SPEC.md
git commit -m "docs(tarot): document rollout privacy and local demo"
```

---

## Task 12: End-to-end verification, regressions, and handoff evidence

**Interfaces**

- **Consumes:** migrated local PostgreSQL, real backend, real frontend, verified development credential, feature flag enabled, deterministic test fixtures, and viewport matrix.
- **Produces:** passing narrow/full checks, browser evidence for all acceptance flows, a clean scoped diff, and no completion claim until evidence is fresh.

**Files:**

- Create `tests/e2e/tarot-guided-flow.spec.ts` only if the repository's accepted browser harness can run it; otherwise place the equivalent script beside the existing QA harness and document the exact command.
- Modify no product files unless a failing acceptance test first demonstrates a defect; return to the relevant task's TDD loop for fixes.

- [ ] Start from a clean understanding of scope:

```bash
git status --short
git diff --check
```

Confirm unrelated owner changes/evidence remain unstaged and unchanged.

- [ ] Apply the additive migration to the local test/demo database and seed the existing active catalog. Verify all 78 card assets return HTTP 200 and the feature is running with real backend mode, not `NEXT_PUBLIC_MYSTCRAG_MOCK_API`.

- [ ] Add/execute end-to-end cases at 1440×1024 and 390×844 for:

  - single-card complete flow;
  - three-card flow with a deterministic reversed-card fixture;
  - refresh during draw and result;
  - rejected selection rollback and revision conflict recovery;
  - redraw creates a distinct child session;
  - optional question not saved by default;
  - AI provider failure uses deterministic copy without losing designs;
  - inventory/price conflict recovery;
  - selection enters the actual `/diy/:designId`, then edit, save, export, and complete;
  - existing AI Design questionnaire/generation and direct DIY regression flows.

- [ ] Capture screenshots of setup, partial draw, revealed draw, desktop result, mobile result, and DIY handoff. Inspect for overflow, hidden actions, square drag shadows, card color/shape mutation, carousels, oversized modals, or clipped third recommendation.

- [ ] Run the full narrow matrix:

```bash
pnpm --filter @mystcrag/tarot-engine test
pnpm --filter @mystcrag/tarot-engine typecheck
pnpm --filter @mystcrag/design-contract test
pnpm --filter @mystcrag/database test
pnpm --filter @mystcrag/ai-agent test
pnpm --filter @mystcrag/backend test
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend typecheck
```

- [ ] Run `pnpm validate`. Record the command, exit code, and timestamp. Do not claim completion if any check is skipped or stale.

- [ ] Review the final diff against the approved spec section by section. Search for prohibited or unfinished content:

```bash
rg -n "TO[D]O|FIX[M]E|Math\.random|prototypes/tarot-upstream" packages/tarot-engine apps/backend/src/modules/tarot apps/frontend/src/features/tarot apps/frontend/app/tarot
rg -n "治愈|疗效|保证|必然|一定会|确定未来|稳赚" packages apps --glob '!**/*.test.*'
git diff --check
git status --short
```

Runtime imports from the prototype, `Math.random` in the engine/backend, unfinished placeholders, plaintext question persistence, or deterministic claims block handoff.

- [ ] Request code review using `superpowers:requesting-code-review`; address findings through `superpowers:receiving-code-review`, rerun affected checks, and then rerun `pnpm validate`.

- [ ] Use `superpowers:verification-before-completion` before reporting success. If all evidence is fresh, create the final scoped commit only for any test/docs evidence not already committed:

```bash
git add tests docs
git commit -m "test(tarot): verify guided bracelet flow"
```

- [ ] Use `superpowers:finishing-a-development-branch` to present integration choices. Public/commercial flag enablement remains blocked until the recorded rights evidence is attached, even when local integration and tests pass.

---

## Plan Self-Review Checklist

- [ ] Every requirement in spec sections 2–14 maps to at least one task and one verification step.
- [ ] Engine, contract, database, backend, AI, frontend, asset provenance, privacy, rollout, and QA boundaries are explicit.
- [ ] Every task declares exact consumed and produced interfaces.
- [ ] Every behavior task begins with a failing test and includes narrow pass commands.
- [ ] No task asks runtime code to import `prototypes/tarot-upstream`.
- [ ] No API projection can expose private deck state or plaintext/ciphertext question fields.
- [ ] Exactly three real `PublicDesignV1` recommendations are produced by the existing Design service and priced authoritatively.
- [ ] Mobile and desktop approved layouts, refresh recovery, reduced motion, and DIY handoff are tested.
- [ ] Feature flags default off, local integration is allowed, and public release rights remain a separate gate.
- [ ] The plan contains no unfinished markers, vague placeholders, omitted test expectations, or unresolved type names.
