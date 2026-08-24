# Duplicate, Dormant, and Unused Code/Resource Audit

**Audit date:** 2026-08-24
**Deletion performed:** none
**Interpretation:** “unused” means no production reference was found by repository-wide static search and composition-root inspection. Dynamic imports, external package consumers, operational use, and historical evidence can invalidate a static conclusion, so every deletion requires its own task and regression proof.

## Classification

- `CONFIRMED_DUPLICATE`: equivalent concepts are defined in more than one authority.
- `SEMANTIC_COLLISION`: same name/responsibility label, but incompatible shapes or meanings.
- `DORMANT`: implemented or exported but no production composition root was found.
- `PLACEHOLDER`: declares a future boundary without substantive runtime behavior.
- `LEGACY`: explicitly compatibility-only and still covered by migration/tests.
- `MOCK/FIXTURE`: intentional non-production behavior.
- `RESOURCE_ORPHAN`: tracked file with no runtime or operational reference found.
- `EVIDENCE_SPRAWL`: useful historical/generated evidence duplicated across locations.
- `COMPLEMENTARY`: looks similar but has a distinct valid responsibility.

## Code findings

| ID | Classification | Finding and evidence | Risk | Disposition/task |
| --- | --- | --- | --- | --- |
| DUP-001 | CONFIRMED_DUPLICATE / P0 | `TarotThemeSchema`, `TarotSpreadTypeSchema`, `TarotSlotSchema`, and `TarotOrientationSchema` are defined with the same values in both `packages/design-contract/src/schemas/tarot.schema.ts` and `packages/tarot-engine/src/types.ts`. | Drift between public DTO and private engine state | SOL decision frozen: Design Contract is `CANONICAL_TAROT_SCHEMA`; BASE-002 migrates the engine and removes its runtime copies |
| DUP-002 | SEMANTIC_COLLISION / P0 | `AiDesignCandidateSchema` exists in AI Agent and as a route-local schema in backend `design-api.service.ts`. The AI schema is a contiguous bead-layout proposal; backend schema is a catalog-selected generation draft plus provenance. | Wrong boundary/schema may be imported during changes | SOL decision frozen: rename to `AiBeadLayoutCandidateSchema` and `CatalogDesignGenerationDraftSchema`; BASE-003 migrates consumers without merging the concepts |
| DUP-003 | COMPLEMENTARY | `BraceletPreview` is compact/read-only while `FlatBraceletEditor` is production editing. Both render a bracelet but are not duplicates. | P2: future contributors may collapse responsibilities | Retain; keep canonical roles documented |
| DUP-004 | DORMANT | `BraceletSequenceEditor` is referenced only by `frontend-ai-flow.test.tsx`; no app route or production component imports it. | P1: unowned UI behavior and maintenance | Product-role or retirement decision in TASK-FE-001 |
| DUP-005 | DORMANT | `ThreeBraceletPreview`/`ThreeBraceletSceneClient` are imported by 3D tests, while `three-integration.test.tsx` explicitly asserts the DIY source contains `FlatBraceletEditor` and not `ThreeBraceletPreview`. | P1: implemented capability is mistaken for shipped capability | Mount or retain experimental in TASK-3D-001 |
| DUP-006 | DORMANT/PLACEHOLDER | `BeadSystem`, `MaterialSystem`, and deprecated `BraceletGenerator` interfaces are exported from Three Engine but have no consumers or implementations outside their defining exports. | P2: misleading public API | Review with legacy Three surface in TASK-COMPAT-001 |
| DUP-007 | LEGACY | `packages/three-engine/src/legacy/contracts.ts`, `packages/ai-agent/src/contracts/legacy-design.ts`, and the legacy AI adapter are explicitly isolated and architecture-tested. | P2: compatibility tax; not currently dead | Measure external/fixture need before retirement in TASK-COMPAT-001 |
| DUP-008 | LEGACY | Design Contract `legacy-initial` migration remains a supported, tested information-loss migration path. | P2: must not be removed with legacy types blindly | Retain until data-format usage proof exists |
| DUP-009 | DORMANT MEMBERS | `NotImplementedDesignStubService` and the `DesignService` wrapper classes in `design.service.ts` have no consumers; the same file’s `createDesignApplicationService` and `createRecommendationApplicationService` factories are production-composed and must remain. | P1: deleting whole file would break production | Class-level cleanup only under TASK-BE-001 |
| DUP-010 | DORMANT MEMBERS | `PricingService`, `InventoryService`, `PublicationService`, and `OrderService` only delegate to repositories and have no located consumers. Production flows call repository ports through `DesignApplicationService`. | P1: duplicate service layer suggests wrong extension point | Prove and retire/justify under TASK-BE-001 |
| DUP-011 | PLACEHOLDER | `user`, `crystal`, `community`, and `order` backend module descriptors are registered metadata shells; `crystal`/`user` contain no service/route, while order/publication behavior is composed elsewhere. | P1: module map overstates boundaries | Decide real module composition in TASK-BE-002 |
| DUP-012 | MOCK/FIXTURE | Frontend `mock-design-api.ts`, backend `MockDesignGenerationAdapter`, and AI mock provider are intentional test/development paths. Architecture tests prevent silent production fallback. | P2: safe only while selection remains explicit | Retain and continue test isolation |
| DUP-013 | DORMANT DATA MODEL | Prisma `DesignTemplate` has no repository/service consumer; similarly named design-template provenance is stored as strings and AI templates are fixtures/code. | P1: database model may imply nonexistent feature | Adopt or deprecate via migration plan in TASK-DB-001 |
| DUP-014 | CONCENTRATION, NOT DUPLICATE | `design-api.service.ts` (1,284 lines), `recommendation.service.ts` (1,127), `tarot.service.ts` (941), and `diy-editor.tsx` (1,275) are change hotspots. | P2 maintainability | Split only by behavior-preserving owner tasks after governance cleanup |

## Resource findings

| ID | Classification | Resource and evidence | Risk | Disposition/task |
| --- | --- | --- | --- | --- |
| RES-001 | RESOURCE_ORPHAN | `apps/frontend/public/states/empty-design.webp` and `loading-crystal.webp` are specified in asset docs but have no runtime reference in `apps/frontend/app` or `src`. | P1: intended UI states are not wired; assets may be abandoned | Either mount them or remove after visual approval in TASK-ASSET-001 |
| RES-002 | DIVERGENT ACTIVE RESOURCE | `crystal-bead-base.png` is still loaded by the DIY canvas export path, while visible beads resolve to 20 photographic WebP assets through `visual-assets.ts`. | P1: exported image can differ from visible UI | Align export renderer in TASK-ASSET-002 |
| RES-003 | RESOURCE_ORPHAN | Root `水晶图片/O1CN01Nqkkhp1uZs7HVZZEF_!!2021156052-0-cib.jpg` has no source, doc, script, or test reference and no manifest entry. | P2: unattributed source image and licensing uncertainty | Identify provenance or remove in TASK-ASSET-001 |
| RES-004 | RESOLVED EVIDENCE_SPRAWL | TASK-REPO-001 removed 285 duplicate/reproducible QA and superseded output files (40.93 MiB), retained canonical UI references and release screenshots, and added ignore rules. | Resolved on cleanup branch | See `QA_EVIDENCE_RETENTION.md`; recover deleted files from `c1262f3` if historical investigation requires them |
| RES-005 | CONTROLLED MIXED ARTIFACTS | `outputs/knowledge-acquisition/` remains machine-readable evidence and `outputs/bead-catalog-template-20260724/` remains the current deliverable. The superseded 2026-07-23 catalog output was removed. | P2: keep category boundaries explicit | Do not bulk-delete `outputs/`; classify new output by purpose |
| RES-006 | CANONICAL EVIDENCE | `docs/ui-references/` is referenced by the UI asset manifest and contains the current canonical screenshots. | Retain | Do not merge with raw captures without updating manifest |
| RES-007 | ACTIVE DYNAMIC ASSETS | Tarot card files are selected from `TAROT_CARD_CATALOG` and rendered through dynamic `/tarot/cards/${assetFile}` paths. Basename-only static scans can falsely mark them unused. | False-positive guard | Retain 78-card deck, card back, and `UPSTREAM_SOURCE.md` together |
| RES-008 | ACTIVE ASSETS | Home images, avatar, tray images, wrist guide, accessory image, and all photographic bead files have production mapping/route references. | None found | Retain |

## “No use found” does not authorize deletion

Before removing any item above, its task must:

1. Search direct, barrel, dynamic, CLI, test, docs, seed, and external-package entry points.
2. Identify the canonical replacement or explicitly state that no replacement is needed.
3. Add or retain a regression test for affected behavior.
4. Run narrow tests and `pnpm validate`.
5. Update this audit, the feature registry, canonical registry, and any controlling spec.
6. For images/data, verify provenance, license, and historical-document references.

## Priority summary

- P0: none established by the Phase 0 audit.
- P1: Tarot/AI contract collisions, dormant renderers, uncomposed service wrappers, placeholder modules, dormant template model, unwired state assets, export visual divergence, and evidence sprawl.
- P2: explicit compatibility surfaces, unattributed raw image, and large-file maintainability hotspots.
