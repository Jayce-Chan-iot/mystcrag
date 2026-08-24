# Canonical Components

Consult this registry before introducing another schema, renderer, service, store, asset resolver, or persistence abstraction.

| Concern | Canonical component | Consumers | Alternatives and disposition |
| --- | --- | --- | --- |
| Versioned design aggregate | `packages/design-contract/src/schemas/design.schema.ts` (`DesignV1`) | Backend, DB, AI, Three, frontend projections | Legacy grouped designs are compatibility input only |
| Public design shape | Design Contract `PublicDesignV1Schema` and projection | Frontend, publication, Tarot recommendation | Local view models may project presentation fields but do not redefine the DTO |
| API DTO validation | `packages/design-contract/src/schemas/*api*.schema.ts` | Backend routes, frontend clients, MCP | Route-local validation may narrow transport params, not duplicate shared payloads |
| Persistence schema | `packages/database/prisma/schema.prisma` | Database client/repositories | Generated Prisma client is output, never edited |
| Persistence access | `packages/database/src/repositories/**` | Backend, worker, MCP, Knowledge Core | Thin backend wrappers require policy value or retirement review |
| 2D bracelet geometry/fit | `packages/bracelet-engine` | Flat editor, Three Engine | Renderer-local placement math must remain consistent with engine semantics |
| Production DIY renderer | `FlatBraceletEditor` in frontend design feature | DIY editor | `ThreeBraceletPreview` experimental; `BraceletSequenceEditor` dormant |
| Compact display renderer | `BraceletPreview` | results, Tarot cards | Complementary to editing, not a duplicate DIY editor |
| 3D scene descriptor | `packages/three-engine/src/runtime/scene-descriptor.ts` | Three renderer/interactions | Legacy `BraceletConfiguration` is compatibility-only |
| 3D rendering | `BraceletCanvas` -> `BraceletScene`, loaded by `LazyBraceletScene` | Experimental frontend wrapper/demo | Not production-mounted as of baseline |
| Deterministic design rules | `packages/design-engine` | Backend, Knowledge Core, MCP | Do not recreate allocation/scoring in routes |
| AI provider candidate | `packages/ai-agent/src/schemas/ai-design-candidate.schema.ts` | AI adapters/providers | Backend has a different local schema with same name; decision required |
| Recommendation context | `packages/context-resolver` plus Design Contract context schemas | Backend/MCP/Tarot | UI form state is input, not canonical context |
| Tarot public DTOs | `packages/design-contract/src/schemas/tarot.schema.ts` | Backend, DB projections, frontend | Tarot Engine should own private draw invariants only |
| Tarot deck/draw mechanics | `packages/tarot-engine` | Backend Tarot service | Public enum copies require consolidation |
| Knowledge ingestion | `packages/knowledge-ingestion` | Worker/Knowledge Core | Backend should orchestrate, not fetch external sources directly |
| Knowledge retrieval/review/compiler | `packages/knowledge-core` | Backend, worker, MCP, recommendation | Fixtures are seed/evaluation data, not a second production authority |
| Product visual asset mapping | `apps/frontend/src/features/design/model/visual-assets.ts` | frontend product visuals | `crystal-bead-base.png` remains export-only divergence pending asset task |
| Shared UI primitive | `packages/ui/src/Surface` | frontend | Add components only when reused across features |
| Frontend server state | Typed API clients under `apps/frontend/src/lib/api` | frontend features | `mock-design-api` is explicit demo/test behavior, not production authority |

## Renderer responsibilities

The renderer family is intentionally separated:

```text
DesignV1
  ├─ BraceletPreview       compact/read-only 2D presentation
  ├─ FlatBraceletEditor    production interactive 2D editing
  ├─ BraceletSequenceEditor dormant sequence manipulation experiment
  └─ ThreeBraceletPreview experimental 3D wrapper
       └─ LazyBraceletScene -> BraceletCanvas -> BraceletScene
```

Only the last two currently require a lifecycle decision. Collapsing all renderers into one component is not a governance goal.

## Canonical change rule

A canonical replacement needs an approved task that names the old and new authority, migrates every production consumer, updates contract/architecture tests, and records the lifecycle change here. Adding a second implementation does not make it canonical.
