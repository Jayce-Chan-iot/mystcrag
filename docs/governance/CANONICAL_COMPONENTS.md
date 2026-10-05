# Canonical Components

Consult this registry before introducing another schema, renderer, service, store, asset resolver, or persistence abstraction.

| Concern | Canonical component | Consumers | Alternatives and disposition |
| --- | --- | --- | --- |
| Versioned design aggregate | `packages/design-contract/src/schemas/design.schema.ts` (`DesignV1`) | Backend, DB, AI, Three, frontend projections | Legacy grouped designs are compatibility input only |
| Public design shape | Design Contract `PublicDesignV1Schema` and projection | Frontend, publication, Tarot recommendation | Local view models may project presentation fields but do not redefine the DTO |
| API DTO validation | `packages/design-contract/src/schemas/*api*.schema.ts` | Backend routes, frontend clients, MCP | Route-local validation may narrow transport params, not duplicate shared payloads |
| Production identity/session contract | `docs/AUTH_SESSION_CONTRACT.md` (`IMPLEMENTATION_COMPLETE_ACCEPTANCE_PENDING`) | Next.js BFF, Backend AuthProvider, Database identity mapping, QA/Operations | Authing/OIDC types stay behind adapters; no second public Domain/Design Contract authority |
| Authentication verification | `apps/backend/src/auth/AccessTokenVerifier` composed through `AuthenticatedActorProvider` and the authentication pre-handler; provider-neutral semantics frozen by Auth Session Contract | Protected design, recommendation, order and Tarot routes | Authing OIDC RS256/JWKS verification is production; `SignedTestTokenAuthProvider` is an explicitly enabled development/test verifier only and cannot create an actor without durable identity composition |
| User identity persistence | Prisma `User`, unique `ExternalIdentity(issuer, subject)` and `ExternalIdentityRepository.findOrProvisionExternalIdentity` | Backend actor composition, Design, order, publication and Tarot repositories | Provider subject/email are not `User.id`; email/display name are mutable hints only; browser-local profile/address/preferences remain presentation state |
| Persistence schema | `packages/database/prisma/schema.prisma` | Database client/repositories | Generated Prisma client is output, never edited |
| Persistence access | `packages/database/src/repositories/**` | Backend, worker, MCP, Knowledge Core | Thin backend wrappers require policy value or retirement review |
| Product catalog | Prisma `Crystal`, `MaterialProduct`, `AccessoryProduct` plus Design Contract catalog DTOs | Recommendation, pricing, DIY and library | Spreadsheet imports and frontend visual metadata are projections, not catalog authority |
| Design persistence | `DesignRepository` through `DesignApplicationService` | protected Design API | Frontend local editor state is an unsaved working copy only |
| Immutable order snapshot | `OrderRepository` plus Design Contract order schemas | protected order API and profile | No cart/payment/shipping authority exists yet |
| 2D bracelet geometry/fit | `packages/bracelet-engine` | Flat editor, Three Engine | Renderer-local placement math must remain consistent with engine semantics |
| Production DIY renderer | `FlatBraceletEditor` in frontend design feature — the sole production DIY renderer | DIY editor | `ThreeBraceletPreview` EXPERIMENTAL_NOT_PRODUCTION_MOUNTED (no production mount, enforced by `tests/three-preview-lifecycle.test.mjs`); `BraceletSequenceEditor` EXPERIMENTAL test-only (no production mount, enforced by `tests/fe-sequence-editor-lifecycle.test.mjs`) |
| Compact display renderer | `BraceletPreview` | results, Tarot cards | Complementary to editing, not a duplicate DIY editor |
| 3D scene descriptor | `packages/three-engine/src/runtime/scene-descriptor.ts` | Three renderer/interactions | Legacy `BraceletConfiguration` is compatibility-only |
| 3D rendering | `BraceletCanvas` -> `BraceletScene`, loaded by `LazyBraceletScene` | Experimental frontend wrapper/demo | Not production-mounted as of baseline |
| Deterministic design rules | `packages/design-engine` | Backend, Knowledge Core, MCP | Do not recreate allocation/scoring in routes |
| AI provider bead-layout candidate | `AiBeadLayoutCandidateSchema` in AI Agent (`FROZEN`) | AI providers, compliance and DesignV1 conversion | BASE-003 removed the ambiguous old identifier; no compatibility alias is authorized |
| Backend catalog generation draft | `CatalogDesignGenerationDraftSchema` in backend Design Application Service (`FROZEN`) | AI recommendation adapter, Tarot generation and mock adapter | Backend-owned internal concept; it is not an AI provider contract and does not belong in Design Contract |
| Recommendation context | `packages/context-resolver` plus Design Contract context schemas | Backend/MCP/Tarot | UI form state is input, not canonical context |
| `CANONICAL_TAROT_SCHEMA` public values/DTOs | `packages/design-contract/src/schemas/tarot.schema.ts` (`FROZEN`) | Backend, DB projections, AI copy, frontend and Tarot Engine | BASE-002 removed Tarot Engine runtime copies; theme/spread/slot/orientation have one definition source |
| Tarot deck/draw mechanics | `packages/tarot-engine` | Backend Tarot service | Owns cards, private draw state, selection/reveal and signal invariants; it consumes but does not redefine public Tarot values |
| `CANONICAL_ORACLE_SCHEMA` public values/DTOs | `packages/design-contract/src/schemas/oracle.schema.ts` (`FROZEN`) | Backend Oracle module/routes, Database snapshot mappers, AI copy, frontend client and coordinator, Oracle Engine | One definition of the Oracle line enum, trigram enum and the CAST/RECOMMENDED/SAVED session DTO family; consumers import from Design Contract and never redeclare them |
| Oracle cast mechanics | `packages/oracle-engine` (`castThreeCoinHexagram`, `CoinSource`) | Backend Oracle service | Sole authority for the public-domain three-coin method and King Wen hexagram ordering; it mirrors the Design Contract line/trigram values as engine-local types but redefines no public schema and no other workspace implements a cast algorithm |
| Oracle design signal | `packages/context-resolver` (`deriveOracleDesignSignal`, `resolveOracleContext`) | Backend Oracle service | Deterministic cast-to-design-context mapping; the frontend must not re-derive a signal or cast |
| Oracle session/random/persistence authority | backend `apps/backend/src/modules/oracle` over `OracleSessionRepository` (`packages/database`) | Frontend Oracle client | Backend owns entropy, idempotent create/recommend/save revisions and the owner-scoped persisted snapshot; the frontend never invents a cast, revision or saved state |
| Oracle interpretation copy | AI Agent `OracleCopyService` (`@mystcrag/ai-agent/oracle`, `MYSTCRAG_ORIGINAL`) | Backend Oracle service | Original compliance-safe copy only; no fortune claim, no modern commentary, no crystal-effect claim |
| Frontend Oracle state | `apps/frontend/src/features/oracle/oracle-coordinator.ts` plus `apps/frontend/src/lib/api/oracle-api.ts` | `/oracle` and `/oracle/result/[sessionId]` routes | The coordinator owns the `idle/casting/revealing/recommended/saving/error` state machine and GET reconciliation; components do not own request lifecycle |
| Knowledge ingestion | `packages/knowledge-ingestion` | Worker/Knowledge Core | Backend should orchestrate, not fetch external sources directly |
| Knowledge retrieval/review/compiler | `packages/knowledge-core` | Backend, worker, MCP, recommendation | Fixtures are seed/evaluation data, not a second production authority |
| Product visual asset mapping | `apps/frontend/src/features/design/model/visual-assets.ts` | frontend product visuals | `crystal-bead-base.png` remains export-only divergence pending asset task |
| Shared UI primitive | `packages/ui/src/Surface` | frontend | Add components only when reused across features |
| Star design tokens | `apps/frontend/app/styles/star-tokens.css` (single source for `--star-*`) | frontend, `packages/ui` | LEGACY aliases in the same file and `globals.css` map `--background/--foreground/--surface/--muted/--accent/--border` onto star tokens for admin/intermediate pages; removal needs a registered admin redesign |
| Star shared primitives | `packages/ui/src/star-surface.tsx` (`StarSurface`), `instrument-button.tsx` (`InstrumentButton`), `constellation-divider.tsx` (`ConstellationDivider`), `status-panel.tsx` (`StatusPanel`) | frontend routes and page families | Decorations are `aria-hidden` + `pointer-events: none`; interactive floor 44px; no product copy or route imports |
| Star style entry order | `apps/frontend/app/globals.css` imports after `atelier.css`: `star-tokens.css` → `star-shell.css` → `star-components.css` → `star-acquisition.css` → `star-workbench.css` → `star-content.css` | frontend shell and page families | Route rules scope with `[data-star-surface...]`; no global `zoom` or body transforms |
| Frontend server state | Typed API clients under `apps/frontend/src/lib/api` | frontend features | `mock-design-api` is explicit demo/test behavior, not production authority |
| Active DIY working state | local state in `DiyEditor` projected from `DesignV1` | production DIY route | No second global design store is authorized; future extraction must preserve one active authority |

## Renderer responsibilities

The renderer family is intentionally separated:

```text
DesignV1
  ├─ BraceletPreview       compact/read-only 2D presentation
  ├─ FlatBraceletEditor    production interactive 2D editing
  ├─ BraceletSequenceEditor EXPERIMENTAL test-only sequence manipulation (no production mount)
  └─ ThreeBraceletPreview EXPERIMENTAL_NOT_PRODUCTION_MOUNTED 3D wrapper (no production mount)
       └─ LazyBraceletScene -> BraceletCanvas -> BraceletScene
```

`FlatBraceletEditor` is the only production DIY renderer. Both experimental renderers already have decided lifecycles and machine guards: `BraceletSequenceEditor` was decided EXPERIMENTAL test-only by TASK-FE-001 (guarded by `tests/fe-sequence-editor-lifecycle.test.mjs`), and `ThreeBraceletPreview` was decided EXPERIMENTAL_NOT_PRODUCTION_MOUNTED by TASK-3D-001 (guarded by `tests/three-preview-lifecycle.test.mjs`). No lifecycle decision is pending; changing either component's production role requires a new product decision and task.

### `CANONICAL_DISPLAY_LOCALE`

`apps/frontend/src/i18n/locale.ts` plus `locale-provider.tsx` are the single authority for the **display** language: the accepted set is exactly `zh-CN`, `zh-TW`, `en-US`, the default is `zh-CN`, and the only persisted form is the non-sensitive `mystcrag_locale` cookie written together with `html lang`. `LocaleProvider` is mounted once by `apps/frontend/app/layout.tsx`, which seeds it from the validated cookie so server render and hydration agree; no page, feature or shell component may keep its own parallel language state or write that cookie directly. Shared static copy resolves through the `messages/zh-CN.ts` key set, which `zh-TW` and `en-US` must mirror.

Boundaries that keep this authority narrow: the display locale is independent of the `locale` recorded on a design or Oracle session (that value is fixed when the session or design is created and is never rewritten by a switch), independent of currency (prices keep their own server-owned minor-unit rules), and independent of identity (the Authing session cookie remains the only actor source). Dynamic projections — Oracle/Tarot narrative, design names and stories, server error text — are not consumers of this dictionary and stay server-owned until their own registered tasks. Switching the display language must not navigate, reload, clear a route, or drop in-progress form, tray or edit state.

The shell is fully behind this authority: `apps/frontend/app/navigation.ts` resolves the desktop header links and `apps/frontend/components/mobile-bottom-nav.tsx` resolves the phone tab bar's visible labels and accessible names through `resolveMobileNavigationLabels()`. The Simplified Chinese strings that remain in those two files are declared fallbacks for the tab and link tables, not a second locale.

When the browser refuses the preference cookie (private mode, blocked storage, sandboxed frame) the switch is still applied for the current session: `applyDisplayLocale` sets `html lang` first, reports `persisted: false`, and `LocaleProvider` publishes the new language to React regardless, so copy, `html lang` and state stay consistent even when only the next server render cannot remember the choice.

Established by TASK-UX-I18N-FE-001 (FEAT-029).

## Canonical change rule

A canonical replacement needs an approved task that names the old and new authority, migrates every production consumer, updates contract/architecture tests, and records the lifecycle change here. Adding a second implementation does not make it canonical.

TASK-AUDIT-002 found that Design Contract edit operations and Bracelet Engine layout/fit/slot behavior are sufficient for the first competitive Web UX task. No new DIY session Core or workspace package is authorized. A future cross-platform extraction decision must follow accepted Web interaction evidence and must not pre-emptively create a second active authority.

## Frozen P0 schema decisions

### `CANONICAL_TAROT_SCHEMA`

`TarotThemeSchema`, `TarotSpreadTypeSchema`, `TarotSlotSchema`, `TarotOrientationSchema` and their inferred public types are owned only by Design Contract. Tarot Engine may use these values inside its private validators but may not define or re-export alternative runtime schemas. There is no current external engine import requiring a compatibility re-export.

### `CANONICAL_ORACLE_SCHEMA`

`OracleLineValueSchema`, `OracleTrigramSchema` and the Oracle session DTO family (`OracleCastDtoSchema`, `OraclePublicSessionSchema`, `OracleCastSessionSchema`, `OracleRecommendedSessionSchema`, `OracleSavedSessionSchema`, and the create/recommendations/get/save request and response schemas) are owned only by Design Contract. `packages/oracle-engine` mirrors the line and trigram value unions as engine-local types inside `packages/oracle-engine/src/types.ts` so its pure cast logic can run without a Design Contract runtime import, but it defines no alternative public schema and no other workspace declares these identifiers. The frontend imports the line value type from Design Contract and must not redeclare it.

### AI candidate concepts

The two existing schemas are not the same domain concept:

- `AiBeadLayoutCandidateSchema`: untrusted/provider-produced creative proposal with a complete, contiguous physical bead sequence; it is validated and compliance-checked before server enrichment.
- `CatalogDesignGenerationDraftSchema`: backend-internal, catalog-selected generation draft containing material/accessory product IDs and provider/Tarot provenance; it is parsed immediately before authoritative `DesignV1` assembly.

Neither schema belongs in Design Contract. The first is AI-owned; the second is backend-owned. BASE-003 eliminated the ambiguous `AiDesignCandidateSchema` identifier from runtime source and atomically migrated all consumers.
