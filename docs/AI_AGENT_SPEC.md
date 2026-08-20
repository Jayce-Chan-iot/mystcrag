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

The Design Agent accepts provider output as `unknown`. `AiDesignCandidateSchema` permits only creative suggestions: name, tags, palette, cultural inspiration, story, recommendation reasons, candidate catalog IDs, and candidate sequence. The provider cannot set server IDs, timestamps, revision, visibility, consent, prices, costs, inventory, or order data.

`aiCandidateToDesignV1` performs strict candidate validation, restricted-copy normalization, catalog lookup, server pricing/provenance enrichment, and final `DesignV1Schema` validation. A failed stage returns structured conversion issues; it never returns a partially trusted design. `designV1ToAgentOutput` exposes the validated result to downstream agent orchestration.

## Design Contract V1 boundary

`@mystcrag/design-contract` now owns the provider-independent, runtime-validated `DesignV1` schema and the pricing, compliance, provenance, and Generate Design DTO children. AI/provider output remains untrusted `unknown` until it is validated and catalog IDs, assets, inventory, and server prices are supplied by the owning workflow.

The contract stores user-visible recommendation reasons and necessary provider/version metadata. It has no field for hidden reasoning, full system prompts, or private conversations. Cultural references must use disclaimer keys and may not be represented as medical, guaranteed-effect, or deterministic-fortune guidance.

Phase 2B keeps `BeadDesign` and `BraceletDesignOutput` only in `src/contracts/legacy-design.ts`, marks them deprecated, and provides `legacyDesignToAiCandidate` as the compatibility bridge. New adapters do not use the grouped format. Real provider SDKs, production prompts, retries, model-based compliance, and orchestration remain deferred.

## Bounded Tarot copy

`@mystcrag/ai-agent/tarot` owns the provider-independent Tarot prose boundary. `TarotCopyService` accepts only validated revealed-card summaries, the selected theme, a server-derived palette, selected material display names, locale, and an optional in-memory question. It returns a strict `TarotInterpretationSchema` plus a source marker containing provider/fallback mode, provider version, and compliance-policy version. It has no authority to change cards, orientation, catalog IDs, sequences, inventory, prices, or Design IDs.

Provider output is untrusted `unknown`. After strict schema and slot-order validation, every creative field must exactly match one server-generated approved template for the validated input: headline, summary, each slot reflection, and design rationale. Comparison applies NFKC and whitespace canonicalization but permits no additional sentence, substitution, cross-field movement, or arbitrary provider prose. The provider disclaimer is never trusted and is always replaced with the localized canonical disclaimer. Provider throws, invalid schemas, unknown fields, wrong slots, near-matches, and any freeform prose select the localized deterministic fallback without changing or discarding server-owned recommendation designs.

The current phase has one approved template per locale and validated input. A provider may therefore be marked `PROVIDER` only when it returns an exact canonical echo of that server-approved copy. This deliberately finite positive protocol makes the display boundary independent of incomplete language classification. Arbitrary provider-authored copy is intentionally not displayable until a separately reviewed moderation or template-ID contract can establish an equally bounded authority model.

Raw questions never cross the provider boundary. Any non-empty optional question, whether it asks about design, reflection, health, finance, relationships, or another topic, receives localized deterministic reflective copy and causes zero provider calls. Questions requesting hidden prompts, initialized/internal rules or directives, or chain-of-thought, and questions requiring a certain death or lifespan prediction, remain rejected with `COMPLIANCE_BLOCKED`. A future provider may receive only server-derived revealed-card summaries, theme, palette, selected material display data, and locale; it never receives the raw question. Provider metadata and returned results never contain the raw question, prompts, hidden reasoning, or provider failure details.

The output boundary does not claim that a lexicon or classifier can recognize every unsafe medical, self-harm, financial, deterministic, or hidden-policy phrase. Those phrases cannot be displayed because all non-template prose is rejected, including otherwise plausible reflection or bracelet styling language. Limited question checks remain only to return `COMPLIANCE_BLOCKED` for explicit hidden-instruction/reasoning and certain-death/lifespan requests. Every other non-empty question is handled locally with deterministic copy and still causes zero provider calls, so question safety does not depend on exhaustively classifying user language.

No live Tarot copy provider is configured in production yet. Backend explicitly instantiates the provider-independent service without a provider, so `mystcrag-deterministic-tarot-copy@1.0.0` is the current safe production source. A future provider is injected through `TarotCopyProvider` without changing Tarot recommendation authority or `TarotService`.
