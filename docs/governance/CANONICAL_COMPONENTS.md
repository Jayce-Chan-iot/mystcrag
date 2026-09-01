# Canonical Components

Consult this registry before introducing another schema, renderer, service, store, asset resolver, or persistence abstraction.

| Concern | Canonical component | Consumers | Alternatives and disposition |
| --- | --- | --- | --- |
| Versioned design aggregate | `packages/design-contract/src/schemas/design.schema.ts` (`DesignV1`) | Backend, DB, AI, Three, frontend projections | Legacy grouped designs are compatibility input only |
| Public design shape | Design Contract `PublicDesignV1Schema` and projection | Frontend, publication, Tarot recommendation | Local view models may project presentation fields but do not redefine the DTO |
| API DTO validation | `packages/design-contract/src/schemas/*api*.schema.ts` | Backend routes, frontend clients, MCP | Route-local validation may narrow transport params, not duplicate shared payloads |
| Production identity/session contract | `docs/AUTH_SESSION_CONTRACT.md` (`IMPLEMENTATION_COMPLETE_ACCEPTANCE_PENDING`) | Next.js BFF, Backend AuthProvider, Database identity mapping, QA/Operations | Auth0 SDK/provider types stay behind adapters; no second public Domain/Design Contract authority |
| Authentication verification | `apps/backend/src/auth/AccessTokenVerifier` composed through `AuthenticatedActorProvider` and the authentication pre-handler; provider-neutral semantics frozen by Auth Session Contract | Protected design, recommendation, order and Tarot routes | Auth0 RS256/JWKS verification is production; `SignedTestTokenAuthProvider` is an explicitly enabled development/test verifier only and cannot create an actor without durable identity composition |
| User identity persistence | Prisma `User`, unique `ExternalIdentity(issuer, subject)` and `ExternalIdentityRepository.findOrProvisionExternalIdentity` | Backend actor composition, Design, order, publication and Tarot repositories | Provider subject/email are not `User.id`; email/display name are mutable hints only; browser-local profile/address/preferences remain presentation state |
| Persistence schema | `packages/database/prisma/schema.prisma` | Database client/repositories | Generated Prisma client is output, never edited |
| Persistence access | `packages/database/src/repositories/**` | Backend, worker, MCP, Knowledge Core | Thin backend wrappers require policy value or retirement review |
| Product catalog | Prisma `Crystal`, `MaterialProduct`, `AccessoryProduct` plus Design Contract catalog DTOs | Recommendation, pricing, DIY and library | Spreadsheet imports and frontend visual metadata are projections, not catalog authority |
| Design persistence | `DesignRepository` through `DesignApplicationService` | protected Design API | Frontend local editor state is an unsaved working copy only |
| Immutable order snapshot | `OrderRepository` plus Design Contract order schemas | protected order API and profile | No cart/payment/shipping authority exists yet |
| 2D bracelet geometry/fit | `packages/bracelet-engine` | Flat editor, Three Engine | Renderer-local placement math must remain consistent with engine semantics |
| Production DIY renderer | `FlatBraceletEditor` in frontend design feature | DIY editor | `ThreeBraceletPreview` experimental; `BraceletSequenceEditor` dormant |
| Compact display renderer | `BraceletPreview` | results, Tarot cards | Complementary to editing, not a duplicate DIY editor |
| 3D scene descriptor | `packages/three-engine/src/runtime/scene-descriptor.ts` | Three renderer/interactions | Legacy `BraceletConfiguration` is compatibility-only |
| 3D rendering | `BraceletCanvas` -> `BraceletScene`, loaded by `LazyBraceletScene` | Experimental frontend wrapper/demo | Not production-mounted as of baseline |
| Deterministic design rules | `packages/design-engine` | Backend, Knowledge Core, MCP | Do not recreate allocation/scoring in routes |
| AI provider bead-layout candidate | `AiBeadLayoutCandidateSchema` in AI Agent (`FROZEN`) | AI providers, compliance and DesignV1 conversion | BASE-003 removed the ambiguous old identifier; no compatibility alias is authorized |
| Backend catalog generation draft | `CatalogDesignGenerationDraftSchema` in backend Design Application Service (`FROZEN`) | AI recommendation adapter, Tarot generation and mock adapter | Backend-owned internal concept; it is not an AI provider contract and does not belong in Design Contract |
| Recommendation context | `packages/context-resolver` plus Design Contract context schemas | Backend/MCP/Tarot | UI form state is input, not canonical context |
| `CANONICAL_TAROT_SCHEMA` public values/DTOs | `packages/design-contract/src/schemas/tarot.schema.ts` (`FROZEN`) | Backend, DB projections, AI copy, frontend and Tarot Engine | BASE-002 removed Tarot Engine runtime copies; theme/spread/slot/orientation have one definition source |
| Tarot deck/draw mechanics | `packages/tarot-engine` | Backend Tarot service | Owns cards, private draw state, selection/reveal and signal invariants; it consumes but does not redefine public Tarot values |
| Knowledge ingestion | `packages/knowledge-ingestion` | Worker/Knowledge Core | Backend should orchestrate, not fetch external sources directly |
| Knowledge retrieval/review/compiler | `packages/knowledge-core` | Backend, worker, MCP, recommendation | Fixtures are seed/evaluation data, not a second production authority |
| Product visual asset mapping | `apps/frontend/src/features/design/model/visual-assets.ts` | frontend product visuals | `crystal-bead-base.png` remains export-only divergence pending asset task |
| Shared UI primitive | `packages/ui/src/Surface` | frontend | Add components only when reused across features |
| Frontend server state | Typed API clients under `apps/frontend/src/lib/api` | frontend features | `mock-design-api` is explicit demo/test behavior, not production authority |
| Active DIY working state | local state in `DiyEditor` projected from `DesignV1` | production DIY route | No second global design store is authorized; future extraction must preserve one active authority |

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

TASK-AUDIT-002 found that Design Contract edit operations and Bracelet Engine layout/fit/slot behavior are sufficient for the first competitive Web UX task. No new DIY session Core or workspace package is authorized. A future cross-platform extraction decision must follow accepted Web interaction evidence and must not pre-emptively create a second active authority.

## Frozen P0 schema decisions

### `CANONICAL_TAROT_SCHEMA`

`TarotThemeSchema`, `TarotSpreadTypeSchema`, `TarotSlotSchema`, `TarotOrientationSchema` and their inferred public types are owned only by Design Contract. Tarot Engine may use these values inside its private validators but may not define or re-export alternative runtime schemas. There is no current external engine import requiring a compatibility re-export.

### AI candidate concepts

The two existing schemas are not the same domain concept:

- `AiBeadLayoutCandidateSchema`: untrusted/provider-produced creative proposal with a complete, contiguous physical bead sequence; it is validated and compliance-checked before server enrichment.
- `CatalogDesignGenerationDraftSchema`: backend-internal, catalog-selected generation draft containing material/accessory product IDs and provider/Tarot provenance; it is parsed immediately before authoritative `DesignV1` assembly.

Neither schema belongs in Design Contract. The first is AI-owned; the second is backend-owned. BASE-003 eliminated the ambiguous `AiDesignCandidateSchema` identifier from runtime source and atomically migrated all consumers.
