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

Provider adapters, prompt versions, retry policies, observability, and JSON runtime validation are deferred to AI workflow implementation.
