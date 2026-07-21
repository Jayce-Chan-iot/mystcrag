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

The Design Agent output contains `designName`, `story`, `style`, and structured bead groups with `crystalId`, `sizeMm`, and `count`. Pricing and compliance consume this structured output. The compliance result must flag medical claims, guaranteed effects, and deterministic fortune claims before content reaches users.

Provider adapters, prompt versions, retry policies, observability, and wiring provider output into runtime validation are deferred to AI workflow implementation.

## Design Contract V1 boundary

`@mystcrag/design-contract` now owns the provider-independent, runtime-validated `DesignV1` schema and the pricing, compliance, provenance, and Generate Design DTO children. AI/provider output remains untrusted `unknown` until it is validated and catalog IDs, assets, inventory, and server prices are supplied by the owning workflow.

The contract stores user-visible recommendation reasons and necessary provider/version metadata. It has no field for hidden reasoning, full system prompts, or private conversations. Cultural references must use disclaimer keys and may not be represented as medical, guaranteed-effect, or deterministic-fortune guidance.

Phase 2A does not change `packages/ai-agent` consumers or remove `BeadDesign` and `BraceletDesignOutput`. Phase 2B should add an adapter, keep the current exports temporarily deprecated, and only remove grouped bead types after all consumers and compatibility tests have switched.
