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

Provider output is untrusted `unknown`. A bounded risk-category classifier rejects unknown fields, over-length copy, missing or reordered card slots, medical or mental-health Crystal-efficacy claims (including symptom-relief paraphrases), death certainty, deterministic-future language, guaranteed financial returns, and exposed hidden reasoning. The classifier requires category-specific subject, action, and outcome signals; ordinary color, styling, and reflective uses of words such as `bracelet`, `crystal`, or `can` remain allowed. Provider throws, invalid schemas, and unsafe provider prose select the localized deterministic fallback without discarding the server-owned recommendation designs. Every accepted or fallback result replaces the provider disclaimer with a localized statement that the copy is reflective/design inspiration, not deterministic advice or claimed Crystal efficacy.

Questions requesting hidden prompts or chain-of-thought, or questions requiring a certain death prediction (including time-bounded variants), are rejected with `COMPLIANCE_BLOCKED` and are never sent to a provider. Other unsafe efficacy, medical, deterministic, or guaranteed-return questions are not sent to a provider and receive reflective deterministic fallback copy. Provider metadata and returned results never contain the raw question, prompts, hidden reasoning, or provider failure details.

No live Tarot copy provider is configured in production yet. Backend explicitly instantiates the provider-independent service without a provider, so `mystcrag-deterministic-tarot-copy@1.0.0` is the current safe production source. A future provider is injected through `TarotCopyProvider` without changing Tarot recommendation authority or `TarotService`.
