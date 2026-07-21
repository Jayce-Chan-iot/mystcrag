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
