# AI Agent Specification

Agents:

Emotion Agent: Understand user feelings.

Crystal Agent: Match crystal knowledge.

Design Agent: Generate bracelet designs.

Pricing Agent: Calculate price.

Compliance Agent: Check risky claims.

Output should be structured JSON for 3D engine.

## Package boundary

The provider-independent interfaces live in `packages/ai-agent`. Each agent implements the shared asynchronous `Agent<Input, Output>` contract and receives a request context. No LLM SDK, prompt store, UI code, or database client belongs in this package during initialization.

The Design Agent accepts provider output as `unknown`. `AiBeadLayoutCandidateSchema` permits only creative suggestions: name, tags, palette, cultural inspiration, story, recommendation reasons, candidate catalog IDs, and candidate sequence. The provider cannot set server IDs, timestamps, revision, visibility, consent, prices, costs, inventory, or order data.

`aiBeadLayoutCandidateToDesignV1` performs strict candidate validation, restricted-copy normalization, catalog lookup, server pricing/provenance enrichment, and final `DesignV1Schema` validation. A failed stage returns structured conversion issues; it never returns a partially trusted design. `designV1ToAgentOutput` exposes the validated result to downstream agent orchestration. The backend separately validates its catalog-backed generation drafts with the route-local `CatalogDesignGenerationDraftSchema`; the two concepts are distinct and must not be merged or aliased.

## Design Contract V1 boundary

`@mystcrag/design-contract` now owns the provider-independent, runtime-validated `DesignV1` schema and the pricing, compliance, provenance, and Generate Design DTO children. AI/provider output remains untrusted `unknown` until it is validated and catalog IDs, assets, inventory, and server prices are supplied by the owning workflow.

The contract stores user-visible recommendation reasons and necessary provider/version metadata. It has no field for hidden reasoning, full system prompts, or private conversations. Cultural references must use disclaimer keys and may not be represented as medical, guaranteed-effect, or deterministic-fortune guidance.

Phase 2B keeps `BeadDesign` and `BraceletDesignOutput` only in `src/contracts/legacy-design.ts`, marks them deprecated, and provides `legacyDesignToAiBeadLayoutCandidate` as the compatibility bridge. New adapters do not use the grouped format. Real provider SDKs, production prompts, retries, model-based compliance, and orchestration remain deferred.

## Bounded Tarot copy

`@mystcrag/ai-agent/tarot` owns the provider-independent Tarot prose boundary. `TarotCopyService` accepts only validated revealed-card summaries, the selected theme, a server-derived palette, selected material display names, locale, and an optional in-memory question. It returns a strict `TarotInterpretationSchema` plus a source marker containing provider/fallback mode, provider version, and compliance-policy version. It has no authority to change cards, orientation, catalog IDs, sequences, inventory, prices, or Design IDs.

Provider output is untrusted `unknown`. After strict schema and slot-order validation, every creative field must exactly match one server-generated approved template for the validated input: headline, summary, each slot reflection, and design rationale. Comparison applies NFKC and whitespace canonicalization but permits no additional sentence, substitution, cross-field movement, or arbitrary provider prose. The provider disclaimer is never trusted and is always replaced with the localized canonical disclaimer. Provider throws, invalid schemas, unknown fields, wrong slots, near-matches, and any freeform prose select the localized deterministic fallback without changing or discarding server-owned recommendation designs.

The validated input and approved template are authoritative immutable snapshots created before provider invocation. A provider receives only a separate recursively frozen clone, so mutation attempts—including nested object, array-order, and structural changes—cannot alter locale, card identity/order, palette, material metadata, question state, template comparison, or fallback generation. Provider failures after attempted mutation still return fallback from the untouched server snapshot.

The current phase has one approved template per locale and validated input. A provider may therefore be marked `PROVIDER` only when it returns an exact canonical echo of that server-approved copy. This deliberately finite positive protocol makes the display boundary independent of incomplete language classification. Arbitrary provider-authored copy is intentionally not displayable until a separately reviewed moderation or template-ID contract can establish an equally bounded authority model.

Raw questions never cross the provider boundary. Any non-empty optional question, whether it asks about design, reflection, health, finance, relationships, or another topic, receives localized deterministic reflective copy and causes zero provider calls. Questions requesting hidden prompts, initialized/internal rules or directives, or chain-of-thought, and questions requiring a certain death or lifespan prediction, remain rejected with `COMPLIANCE_BLOCKED`. A future provider may receive only server-derived revealed-card summaries, theme, palette, selected material display data, and locale; it never receives the raw question. Provider metadata and returned results never contain the raw question, prompts, hidden reasoning, or provider failure details.

The output boundary does not claim that a lexicon or classifier can recognize every unsafe medical, self-harm, financial, deterministic, or hidden-policy phrase. Those phrases cannot be displayed because all non-template prose is rejected, including otherwise plausible reflection or bracelet styling language. Limited question checks remain only to return `COMPLIANCE_BLOCKED` for explicit hidden-instruction/reasoning and certain-death/lifespan requests. Every other non-empty question is handled locally with deterministic copy and still causes zero provider calls, so question safety does not depend on exhaustively classifying user language.

No live Tarot copy provider is configured in production yet. Backend explicitly instantiates the provider-independent service without a provider, so `mystcrag-deterministic-tarot-copy@1.0.0` is the current safe production source. A future provider is injected through `TarotCopyProvider` without changing Tarot recommendation authority or `TarotService`.

Question persistence is a Backend concern, not an AI capability. The AI package has no encryption key, database, logging, or decrypt interface. Backend passes an optional question to the bounded copy service only for the current request, never to a provider; default `saveQuestion: false` writes nothing. Explicit opt-in is accepted only when Backend has created the AES-256-GCM encryption port from a valid 32-byte base64 key. Missing configuration returns `VALIDATION_ERROR` before copy generation, catalog work, or persistence, so AI fallback cannot accidentally bypass the privacy boundary.

## Bounded Star Oracle copy

`@mystcrag/ai-agent/oracle` owns the provider-independent Star Oracle prose boundary. `OracleCopyService.createInterpretation` accepts only the Design Contract's validated `OracleCastDto`, its matching `OracleDesignSignal`, and locale. `OracleCopyInputSchema` is strict and intentionally has no question field; raw focus questions cannot enter this package or a copy provider. Accent positions must exactly match the cast's moving-line positions.

The service reuses the Design Contract's single authoritative `OracleInterpretationSchema` and `OracleInterpretation` type rather than declaring a consumer copy. It returns a strict headline (48 characters maximum), summary (240 maximum), exactly three unique short observation keywords, design rationale, canonical localized disclaimer, and the required `MYSTCRAG_ORIGINAL` content source. Separate operational metadata records provider/fallback mode, provider version, copy-policy/content versions, cast algorithm version, and design-rule version. A static cast describes stable composition only and never invents a transformed direction. A moving cast describes visual transition and accent positions only, never a future event.

All displayed text is original, reviewed Mystcrag copy framed as observation, cultural experience, and bracelet composition. It makes no medical or psychological claim, deterministic prediction, relationship prediction, efficacy promise, product claim, price/stock decision, or fortune-changing claim. The claim detector covers registered high-risk fixtures—including the standalone Chinese efficacy token `旺` and enumerated phrases such as `旺夫`—without raw-substring rejection of unrelated words such as `旺角`. This detector is defense in depth, not the display authority.

Provider output is untrusted `unknown`. As with bounded Tarot copy, the only provider-authored result eligible for display is an exact NFKC/whitespace-canonical echo of the server-generated approved template for the validated input. Provider disclaimers are ignored and replaced by the canonical disclaimer. The provider receives a recursively frozen validated clone, so attempted input mutation cannot alter the authoritative template or fallback. Freeform prose, unsafe terms, copied-modern-commentary markers, unknown fields, malformed schemas, invalid provider metadata, or throws select `mystcrag-deterministic-oracle-copy@1.0.0`; rejected text and failure details are never returned. No live Oracle copy provider is configured by this task.

## Localized Star Oracle presentation projection

`@mystcrag/ai-agent/oracle` also exports `projectOraclePresentation(session, locale, catalog)`, a deterministic, read-only projection that returns the Design Contract's strict `OraclePresentationResponse` for one display locale. It consumes only a validated `OraclePublicSession`, the closed display locale `zh-CN | zh-TW | en-US`, and a catalog snapshot of `CatalogMaterialProduct`. Copy comes from reviewed, versioned templates (`mystcrag-oracle-presentation-v1`) that are written per locale rather than machine-translated at request time. The function performs no entropy draw, provider or network call, persistence, or write of any kind.

The projection is display-only and never a second authority. `sessionId` and `sourceRevision` mirror the source session exactly, including the session's original revision, and the projection carries no price, stock, currency, or new revision. `headline`, `summary`, and the `COLOR`/`RHYTHM`/`ACCENT` cues are generated from persisted cast and signal facts; the `ACCENT` cue exists only for a moving cast. Structural facts such as the hexagram number, moving-line positions, and cast algorithm name are inputs only: customer-facing copy names just the lead color, rhythm, and accent in plain language and never prints those structural tokens. Cards reuse the persisted three recommendation design IDs in rank order with reviewed direction copy, so a recommended session always yields exactly three cards. A `CAST` session has no authoritative recommendation, so it yields zero cards and zero materials while remaining a valid projection.

Materials are derived only from the beads of the authoritative recommendations. A bead product is shown only when it matches a real catalog product whose `availableQuantity` is greater than zero; unknown or zero-stock products are dropped rather than fabricated, so an empty material list is preferred over an invented SKU. Labels use the catalog's reviewed crystal name for the target locale plus shape and diameter, and never expose SKU, price, or stock. `zh-CN` uses the catalog's simplified `crystalNameCn` and `en-US` its `crystalNameEn`; `zh-TW` uses a hand-reviewed Traditional name keyed by the stable `crystalId` and never reuses the simplified string verbatim, falling back to the catalog's authoritative English name when no reviewed entry exists so no identity is guessed or invented. Every catalog-derived material name is screened by the shared `hasProhibitedOracleClaim` detector, and a name that trips it is dropped in favor of the factual shape and diameter only, so no efficacy claim reaches any locale while the real `beadProductId` is preserved. The session creation locale is irrelevant to the requested display locale: an old session persisted with single-language interpretation is projected safely into all three locales without mutating the session, catalog, or saved interpretation, and the English projection contains no Han characters. Reviewed template copy is screened by the shared `hasProhibitedOracleClaim` detector, which remains defense in depth rather than the display authority.
