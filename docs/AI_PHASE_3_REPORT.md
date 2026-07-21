# Mystcrag AI Phase 3 Report

Date: 2026-07-21

## Identity

- Agent role: AI Lead
- Branch name: `feature/ai-recommendation`
- Baseline commit: `64957c1 feat: add versioned design persistence and order snapshots`
- Final post-rebase implementation commit: `949bf57369605dd6f82b536018dbf0397ea5a2f9 feat: implement rule based bracelet recommendation`
- Report amendment commit: recorded in the handoff message because a commit cannot embed its own hash.

## Change scope

- Changed modules: `packages/ai-agent` and module-local AI fixtures/tests.
- Changed files: Emotion, Crystal, Design, Pricing, and Compliance Agent implementations; AI candidate and recommendation schemas; candidate-to-DesignV1 adapter; Provider adapters; recommendation service; fixtures; package exports; AI tests; this report.
- New or changed interfaces: `LLMProvider`, `MockProvider`, `RuleBasedProvider`, `RecommendationRequestSchema`, `RecommendationProviderOutputSchema`, and `generateRecommendations`.
- Shared assets changed: None.
- Approved decision-log entries: None required. Design Contract V1, API, database, and architecture protocols were not changed.

## Agent implementation

- Emotion Agent maps questionnaire goals and free text onto six standard emotion tags. It uses design-preference language only and does not diagnose mental state.
- Crystal Agent scores color, style, and emotion overlap, then filters disabled, out-of-stock, explicitly excluded, and over-budget catalog fixtures.
- Design Agent scores Design DNA templates and deterministically creates three differentiated candidates. Every candidate contains a final twelve-bead component sequence with contiguous `positionIndex` values; no grouped `count` representation is used.
- Pricing Agent supplies only currency, budget band, and eligible product IDs. It does not decide a sale price and does not emit unit, cost, or total price fields.
- Compliance Agent detects medical effects, psychological diagnosis, guaranteed wealth, guaranteed fortune change, and deterministic fortune prediction. Cultural content is consistently labeled as `文化参考`, `设计灵感`, and `非科学功效` with the stable Design Contract disclaimer key.
- Provider flow treats every implementation result as `unknown`, applies strict recommendation and AI Candidate schema validation, runs compliance normalization, and returns candidates only after both boundaries pass.
- A real network LLM provider is intentionally absent. The provider interface is replaceable without changing the rule pipeline or candidate trust boundary.

## Rule recommendation flow

```text
questionnaire preferences
  -> Emotion Agent standard emotionTags
  -> normalized styleTags and colorTags
  -> Crystal Agent status, inventory, exclusion, and budget filtering
  -> crystal tag-match scoring
  -> Design DNA template scoring
  -> three differentiated ordered bead sequences
  -> Provider result treated as unknown
  -> RecommendationProviderOutputSchema
  -> AiDesignCandidateSchema
  -> Compliance normalization
  -> trusted AI Candidate output
  -> Backend-owned enrichment
  -> aiCandidateToDesignV1
  -> DesignV1Schema
```

Template scores combine emotion, style, color, and popularity signals. Crystal scores combine emotion, style, color, availability, and budget eligibility. Equal scores use stable identifier ordering, so identical inputs and fixture versions produce identical outputs.

## Provider adapters

- `LLMProvider` is the provider-neutral asynchronous interface. Its return type is always `unknown` at the trust boundary.
- `MockProvider` returns a cloned configured value for malformed-output, unknown-field, schema, and compliance tests.
- `RuleBasedProvider` composes the five rule Agents and returns three deterministic candidates without a network dependency.
- Real LLM call status: **No real LLM call exists or is enabled.** There is no model SDK, API key, prompt execution, network retry, or model billing path in V1.

## Dataset scale

- Crystal fixtures: 20 products, including one out-of-stock case and one disabled case.
- Design DNA fixtures: 12 templates.
- Standard design styles: 6 (`minimal`, `eastern-contemporary`, `romantic`, `natural`, `modern`, `vintage`).
- Standard emotion goals: 6 (`calm`, `focus`, `confidence`, `joy`, `connection`, `renewal`).
- Currency contexts: independent CNY and TWD catalog values and budget bands; no exchange-rate path.

## Candidate and DesignV1 boundary

- AI Candidate contains creative suggestions only: design name/story, emotion/style/color tags, cultural inspiration, recommendation reasons, source template IDs, crystal/product IDs, and final component order.
- Strict candidate schemas reject additional unknown fields and attempts to set `unitPriceMinor`, `unitCostMinor`, `totalPriceMinor`, inventory, owner/design identity, revision/timestamps, visibility, or publication consent.
- Candidate data is not a trusted price, stock, publication, persistence, or order record.
- Backend must supply authoritative IDs, timestamps, catalog assets, prices, pricing versions, provenance, and bracelet context through `AiDesignServerEnrichment`.
- `aiCandidateToDesignV1` validates the Candidate, normalizes compliance, verifies catalog mappings, performs server-owned enrichment, and finally validates the complete result with `DesignV1Schema`. It returns no partially trusted design.

## Compliance detection range

- Medical-effect claims.
- Psychological diagnosis.
- Guaranteed wealth or guaranteed attracting-wealth claims.
- Guaranteed fortune-change claims.
- Deterministic destiny or fortune predictions.

Scanning covers design name, design story, recommendation reasons, and cultural-reference/inspiration text in Chinese and English rule patterns. Cultural fields use `文化参考`, `设计灵感`, `非科学功效`, and `CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT`. V1 compliance is deterministic keyword/rule detection, not a medical classifier or model-based semantic review.

## Determinism evaluation

- Repeated `RuleBasedProvider` calls with the same request, context, and fixture version are asserted with deep equality.
- Template and crystal rankings use explicit score weights plus stable ID tie-breaking.
- Candidate count is fixed at three, each source template is distinct, component positions are contiguous, and every physical bead is represented individually.
- The deterministic test passes as part of the AI package's 25/25 test suite.

## Verification

- Focused checks and results: `pnpm --filter @mystcrag/ai-agent lint` passed; `pnpm --filter @mystcrag/ai-agent test` passed 25/25 tests; `git diff --check -- packages/ai-agent` passed.
- Tests added or updated: emotion mapping, style/color matching, budget and inventory filtering, template scoring, three-candidate differentiation, ordered components, five compliance categories, malformed/extra Provider output, determinism, Candidate Schema, CNY/TWD contexts, forbidden price/cost/inventory/publication fields, and generated-candidate conversion through `aiCandidateToDesignV1`.
- `pnpm validate` command: `pnpm validate`.
- `pnpm validate` result: Passed in the dedicated `feature/ai-recommendation` worktree: 7/7 lint tasks, 7/7 typecheck tasks, 7/7 root architecture tests, all workspace tests including AI 25/25, and 7/7 build tasks.
- Validation commit: Working tree before `feat: implement rule based bracelet recommendation`.

## Backend integration

1. Backend validates or maps its questionnaire DTO into `RecommendationRequestSchema` input.
2. Backend calls `generateRecommendations(new RuleBasedProvider(), request, context)` and handles `READY | REJECTED` without trusting Provider JSON.
3. For a selected candidate, Backend loads authoritative catalog, inventory, price, identity, timestamp, and provenance values into `AiDesignServerEnrichment`.
4. Backend calls `aiCandidateToDesignV1(candidate, enrichment)` and returns only a schema-valid public projection. Production integration must not reuse fixture prices as authoritative catalog prices.

No Backend file was changed by the AI Lead.

## Handoff notes

- Known limitations: fixed expert weights; twelve-bead templates; bead-only V1 candidates; static fixtures; conservative inventory filtering; keyword-based compliance; no retries, observability, production prompt management, or real LLM SDK.
- Unfinished work: production catalog/inventory adapters, accessory generation, wrist-size-derived bead count, localized explanation copy, and a separately approved real Provider implementation.
- Cross-module dependencies: Backend owns trusted enrichment and selection persistence; `@mystcrag/design-contract` remains the candidate-to-design destination; 3D consumes the resulting validated `DesignV1`.
- Merge risks: the shared working directory contained concurrent uncommitted Backend, Database, Three Engine, and lockfile changes. They are excluded from this AI commit and must be reviewed/committed by their owners.
- Recommended reviewer focus: strict unknown-field rejection, no trusted commercial/publication fields in candidates, deterministic ranking, compliance coverage, and Backend use of authoritative enrichment.

## Agent confirmation

- [x] I confirmed the assigned branch before development.
- [x] I changed only my owned module, owned tests, and role report.
- [x] No shared Contract, API, database, architecture, or 3D-contract change was required.
- [x] No commercial cost, supplier, prompt, hidden reasoning, or private conversation data leaks through candidate output.
- [x] I ran `pnpm validate` successfully on the final change.
