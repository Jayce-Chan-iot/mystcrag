# Mystcrag Design Contract V1

## Status and source

`@mystcrag/design-contract` is the canonical, runtime-validated design protocol for AI generation, DIY editing, 3D conversion, pricing, saving, community publication, remixing, and order snapshots.

The executable source is `packages/design-contract/src`. This document describes schema version `1.0.0`. Phase 2A creates the contract package without switching the existing AI, 3D, Backend, Frontend, or Prisma consumers.

## Knowledge system schemas (additive)

The knowledge-driven design system (see `docs/KNOWLEDGE_SYSTEM_SPEC.md`, approved as `DEC-KNOWLEDGE-SYSTEM-001`) extends this package with five additive schema families: versioned taxonomy vocabulary, `RecommendationContext`, `KnowledgeSource`/`KnowledgeDocument`/`KnowledgeRule`, machine-executable `DecisionRule`, and the sidecar `DesignDecisionTrace`. These families do not alter `DesignV1`: the design schema version remains `1.0.0`, decision traces live in their own persistence record, and the DesignV1-facing additions are the optional `lengthAlongStringMm` bead/accessory field (falling back to `diameterMm`) plus the `TAROT_GUIDED` and `ORACLE_GUIDED` design modes.

## Top-level DesignV1

Wire JSON uses camelCase. Zod schemas infer TypeScript types.

| Field | Rule |
| --- | --- |
| `schemaVersion` | Literal `1.0.0` |
| `designId` / `designName` | Stable non-empty identity and display name |
| `designMode` | `AI_GENERATED`, `DIY_CREATED`, `AI_ASSISTED`, `TEMPLATE_REMIX`, `TAROT_GUIDED`, or `ORACLE_GUIDED` |
| `revision` | Positive safe integer starting at 1 |
| `createdAt` / `updatedAt` | ISO 8601 datetimes with offsets; update cannot precede creation |
| `locale` | BCP 47-style locale |
| `currency` | `CNY` or `TWD` |
| `bracelet` | Wrist and circle-layout geometry |
| `beads` | One ordered entry per physical bead |
| `accessories` | Inline or anchored physical accessories |
| `story` | User-visible tags, palette, story, reasons, and cultural-reference labels |
| `pricing` | Minor-unit line items, explicit adjustments, total, and rule version |
| `production` | Derived main-ring sequence, anchors, BOM, notes, and substitution candidates |
| `compliance` | Structured status, claims, disclaimer keys, and review requirement |
| `provenance` | Necessary generator/version metadata without hidden reasoning |
| `community` | Consent, visibility, remix, and creator-display controls |

## Bracelet and component order

V1 supports `braceletLayout: CIRCLE`. Bracelet geometry includes wrist circumference, target inner circumference, elastic allowance, bead gap, and total bead count.

Every bead entry represents exactly one physical bead and therefore has `quantity: 1`. A bead contains a stable `componentId`, main-ring `positionIndex`, product and crystal IDs, material and asset keys, shape, diameter, role, and `unitPriceMinor`.

Accessory types are `SPACER`, `PENDANT`, `METAL_PART`, and `CONNECTOR`. Placement is a discriminated union:

- `INLINE` requires `positionIndex`; its anchor fields are null or absent.
- `ANCHORED` requires `anchorComponentId`; its `positionIndex` is null or absent. `anchorSlot` defaults to zero.
- Pendants must use `ANCHORED`.
- An anchor must reference a bead or inline accessory. Self, missing, anchored-to-anchored, and circular anchors are rejected.

Beads and inline accessories form the main ring. Their positions must be unique, start at zero, and contain no gaps. Anchored accessories do not occupy a main-ring position. Component IDs are unique across every bead and accessory. `bracelet.totalBeadCount` equals `beads.length`.

## Money and pricing

All monetary values are safe integers. Decimal, negative, non-finite, and out-of-safe-range values are rejected unless a field explicitly permits a signed adjustment.

| Currency | Minor-unit rule |
| --- | --- |
| CNY | 1 yuan = 100 minor units (fen) |
| TWD | 1 dollar = 1 minor unit |

CNY and TWD use independent product price tables and pricing versions. The contract does not convert currencies or store an exchange rate.

Pricing fields use a `Minor` suffix: `materialSubtotalMinor`, `accessorySubtotalMinor`, `laborFeeMinor`, `designFeeMinor`, `packagingFeeMinor`, `platformFeeEstimateMinor`, `logisticsFeeEstimateMinor`, `discountMinor`, and `totalPriceMinor`.

`materialSubtotalMinor` equals the sum of bead unit prices. `accessorySubtotalMinor` equals the sum of all accessory unit prices. The total is:

```text
materialSubtotalMinor
+ accessorySubtotalMinor
+ laborFeeMinor
+ designFeeMinor
+ packagingFeeMinor
+ platformFeeEstimateMinor
+ logisticsFeeEstimateMinor
- discountMinor
+ sum(adjustments.amountMinor)
= totalPriceMinor
```

Each optional adjustment has a stable ID, label, signed safe-integer amount, and reason code. The resulting total cannot be negative or leave the safe-integer range.

## Commercial cost boundary

`DesignV1` and `PublicDesignV1` never contain component costs, `unitCostMinor`, or supplier information.

Server-only cost data uses `InternalCommercialDesignV1`:

```ts
{
  design: DesignV1;
  costs: {
    componentCosts: Array<{ componentId: string; unitCostMinor: number }>;
    laborCostMinor: number;
    packagingCostMinor: number;
    supplierReference?: string;
  };
}
```

Every component cost must reference a component in the enclosed design. The schema is exposed through the server-only `@mystcrag/design-contract/internal` subpath. `toPublicDesign()` returns a separately parsed public design and never copies the commercial envelope.

## Story and compliance

Story data contains emotion/style tags, colors, cultural inspirations, design copy, recommendation reasons, and source template IDs. Cultural references use a stable disclaimer key to identify them as design inspiration rather than scientific effect.

Compliance status is `PENDING`, `PASSED`, `FLAGGED`, or `REJECTED`. Restricted claims are structured with `code`, `category`, `fieldPath`, `severity`, and `userVisibleMessage`. Categories cover medical effects, psychological diagnosis, guaranteed wealth, guaranteed fortune change, deterministic fortune prediction, and other restricted claims.

- `FLAGGED` requires `reviewRequired: true`.
- `PASSED` cannot contain restricted claims.
- `REJECTED` designs cannot be published or converted into order snapshots.
- Hidden reasoning, full system prompts, and private conversations are not contract fields and must not be saved.

## Community and privacy

Safe defaults are:

```json
{
  "visibility": "PRIVATE",
  "publishConsent": false,
  "allowRemix": false,
  "creatorDisplayMode": "ANONYMOUS"
}
```

Visibility supports `PRIVATE`, `UNLISTED`, and `PUBLIC`. Public or unlisted visibility requires explicit consent. Without consent, visibility must remain private and remixing must remain disabled. Creator display supports anonymous or display-name presentation; personal contact data does not belong in the design contract.

## Production traceability

`production.componentSequence` must exactly match the main-ring component order derived from the design. `production.anchoredComponents` must exactly match anchored accessories and their slots.

Each BOM item includes `productId`, `specification`, positive `quantity`, and one or more `sourceComponentIds`. Every source must exist in the design. Substitution rules contain a source product, candidate product IDs, and whether user confirmation is required. They do not mutate or automatically replace design components.

Designs created through the internal `TAROT_GUIDED` generation boundary must include a strict public-safe `provenance.tarotCandidate` object containing only `sessionId`, `ruleVersion`, rank 1–3, and `BALANCED`, `CONTRAST`, or `NEUTRAL_LED` direction. This identity binds the candidate to its Tarot origin, while the persisted Tarot Design ID fingerprints the complete normalized, priced candidate authority. An unchanged retry therefore resolves to the same Design; changed catalog attributes, price, pricing version, or generated content resolve to a different validated Design and cannot reuse an unlinked stale partial. `sourceDesignId` remains reserved for actual Design lineage and is not used for a Tarot session.

Designs created through the internal `ORACLE_GUIDED` boundary use the parallel strict `provenance.oracleCandidate` object: `sessionId`, `ruleVersion`, rank 1–3, and one of `BALANCED`, `CONTRAST`, or `NEUTRAL_LED`. The Oracle session is cultural/design provenance, not Design lineage, so `sourceDesignId` remains null unless the Design itself was cloned or derived from another Design. Public Oracle recommendations validate that the provenance session, rule version, rank, and direction match the enclosing Oracle session and design signal.

## Material catalog projection

`CatalogMaterialProduct` exposes sellable product identity, bilingual Crystal names, color tags, Crystal-authored `visualTags`, `styleTags`, `emotionTags`, and compliance-safe `cultureTags`, bead geometry, render assets, currency, authoritative unit price, and a non-negative integer `availableQuantity` that backs first-party sellable and zero-stock UI states. `CatalogAccessoryProduct` exposes the same public-safe shape for accessories: identity, type, material, finish, currency, unit price, and `availableQuantity`. Neither projection exposes unit cost, supplier data, or raw inventory ledgers. The four additive Crystal tag arrays are public-safe design metadata and are the authoritative inputs for deterministic recommendation scoring.

## Public and order projections

`PublicDesignV1` is the safe design view used by every Phase 2A response DTO. It excludes commercial cost and supplier data.

`OrderDesignSnapshotV1` contains:

- a strict `fulfillment` snapshot with requested, reserved, and backorder quantities per product;
- `IN_STOCK` or `AWAITING_RESTOCK` summary state and a five-day estimate only when a shortage exists;

- `snapshotVersion: 1.0.0`
- an explicit capture timestamp
- a public-safe, validated `DesignV1`

The snapshot preserves design revision, currency, pricing version, component sequence, production data, compliance, and provenance as one immutable value. Rejected designs cannot produce this snapshot.

## API DTO schemas

The package exports request and response schemas for these Design and Order operations:

- Generate Design
- Create First-Bead DIY Design
- Update Design
- Price Design
- Save Design
- Publish Design
- Create Order From Design
- Delete Design (soft delete; response carries `deletedAt`, not a design)
- Clone Design (fresh revision-1 copy of the source snapshot)
- List My Designs and List My Orders (owner-scoped listing responses)

Mutation responses contain a validated public design and structured warnings, except Delete (identity plus `deletedAt`) and the two list responses (bounded arrays of `{ design, status, updatedAt }` and order summaries with immutable design snapshots). Update requests use only `REPLACE_COMPONENT`, `MOVE_COMPONENT`, `ADD_COMPONENT`, `REMOVE_COMPONENT`, and `UPDATE_BRACELET`; arbitrary JSON Patch is rejected. Publish and create-order requests enforce consent/compliance and revision or price expectations at the schema boundary where the required design context is present. Delete and Clone require the source design's current revision and surface stale revisions as `CONFLICT` at the Backend boundary.

`CreateDiyFirstBeadRequestSchema` / `CreateDiyFirstBeadResponseSchema` freeze the `POST /api/design/diy-first-bead` boundary that starts a brand-new DIY draft. A fresh tray is completely empty: before the first real catalog bead is chosen there is no design ID, no zero-bead `DesignV1`, no quote, and no saved state, so the empty tray stays a frontend-only transient state and no zero-bead persistence special case is added. The strict request accepts only `requestId`, `beadProductId`, `locale`, and `currency`; client-supplied owner/actor identity, `unitPriceMinor`, stock, `revision`, and fabricated `bead`/`beads` objects are rejected. The response carries `requestId`, exactly one private `DIY_CREATED` `PublicDesignV1` at revision 1, and `warnings`; zero-bead, multi-bead, accessory-bearing, non-`DIY_CREATED`, above-revision-1, and non-private designs are rejected. A first-bead design holds only the bead the user picked and no accessories, so the server never silently attaches accessories the user did not select. Owner identity, price, inventory, and revision remain server-authoritative. This preserves the `DesignV1` at-least-one-bead constraint and leaves the Generate and Clone DTOs unchanged.

The response bead must correspond to the request `beadProductId`, and the design `locale`/`currency` must correspond to the request; reusing one actor's `requestId` with different parameters is a conflict rather than a second design. Because the request and response are two independent strict DTOs, the contract cannot compare them inside a single schema and does not pretend to: these correspondences are cross-request invariants owned by the Backend idempotency fingerprint and lookup, and the dependent Backend task must cover them with cross-request tests.

The package also exports these Tarot session DTO families:

- Create Tarot Session
- Select Tarot Card
- Reveal Tarot Session
- Generate Tarot Recommendations
- Get Tarot Session
- Save Tarot Session

Tarot responses use a request ID and strict public session projection. The contract duplicates its stable Tarot wire literals locally; it does not depend on the Tarot engine package. `GET` is the broad restore projection, enforces state-specific invariants, and includes the canonical card-back metadata used by first-party draw UI. Create returns only a `DRAWING` session plus the same card-back metadata. Select accepts a strict `DRAWING`, `DRAWN`, `RECOMMENDED`, or `SAVED` public projection: new selections return `DRAWING`, while an exact accepted retry returns the authoritative current lifecycle state. Reveal returns a revealed `DRAWN`, `RECOMMENDED`, or `SAVED` projection so exact retries remain representable after later lifecycle advances. Recommendation responses require `RECOMMENDED` or `SAVED` state with exactly three distinct ranked `PublicDesignV1` values. Save responses require `SAVED` state.

Tarot public projections never contain deck or orientation order, private deck state, raw or encrypted questions, encryption material, hidden prompts, commercial costs, or inventory quantities. Ranked recommendations may expose only a fulfillment advisory containing `requiresRestock`, the five-day estimate, and affected product IDs. Card identity and orientation are absent from create and new-selection projections; an exact selection retry may include them only when the authoritative session has already been revealed. Tarot routes reuse the established API error envelope; the Design Contract does not define a separate Tarot error shape.

The package also exports strict Star Oracle DTOs from `schemas/oracle.schema.ts`:

- `OracleCastDto` carries exactly six bottom-to-top `6 | 7 | 8 | 9` lines, the matching ordered moving-line positions, primary and optional transformed hexagram structure, upper/lower trigram identifiers, and the three-coin algorithm name/version. A moving cast requires a transformed hexagram; a static cast forbids one.
- `OracleDesignSignal` contains only versioned color, style, rhythm, and accent-line preferences. Colors and styles must be registered taxonomy IDs; rhythm is one of the contract-local controlled IDs `rhythm:steady`, `rhythm:alternating`, `rhythm:gradual`, or `rhythm:punctuated`; accent positions exactly match the cast's ordered moving-line positions. It contains no SKU, price, stock, fit override, prediction, efficacy claim, or raw question.
- Taxonomy version `taxonomy-2026-09-v1` adds `context-source:oracle` as the canonical `CONTEXT_SOURCE` ID for projecting an Oracle design signal into `RecommendationContext`. Like Tarot, it is soft cultural context and cannot replace user-authored physical, budget, product, or component constraints.
- The public lifecycle is `CAST -> RECOMMENDED -> SAVED`. Create returns only `CAST`; recommendation returns `RECOMMENDED` or the authoritative `SAVED` retry state; save returns only `SAVED`; get restores any valid public state.
- Recommended and saved sessions contain exactly three distinct `ORACLE_GUIDED` `PublicDesignV1` values with ranks 1–3 and exactly one each of `BALANCED`, `CONTRAST`, and `NEUTRAL_LED`. Each design matches its session locale, currency, and supplied wrist and carries Oracle-only candidate provenance. A saved selection must reference one of those three designs.
- Create accepts `requestId`, idempotent `operationId`, locale, currency, optional 130–200 mm wrist, optional 1–120 character question, and optional parent session. Recommendation and save carry their own operation IDs and expected revisions. No response schema contains a question field.

Oracle routes reuse the established strict error envelope. Stable Backend mappings remain `NOT_IMPLEMENTED` for disabled creation, generic `FORBIDDEN` for missing/cross-owner sessions, `CONFLICT` for revision/idempotency/transition conflicts, and the existing `PRICE_CHANGED`, `INVENTORY_CHANGED`, and `COMPLIANCE_BLOCKED` authority codes. Contract schemas define wire shape; they do not create entropy, persist sessions, choose inventory, or interpret cultural meaning.

## Localized presentation projections

The package also exports a strict, read-only display-projection family from `schemas/localized-presentation.schema.ts`. `PresentationLocaleSchema` is the closed enum `zh-CN | zh-TW | en-US`, and `LocalizedPresentationRequestSchema` accepts only that `locale`; a fourth language or any unknown field is rejected. These projections are display copy, not a second authority: they carry `sourceRevision` to bind copy to the current authoritative revision but never a new revision, price, stock, or currency, and never a duplicate cast, hexagram, or draw.

- `OraclePresentationResponseSchema` returns `{ sessionId, sourceRevision, locale, headline, summary, cues, materials, cards }`. Each cue has a `COLOR`, `RHYTHM`, or `ACCENT` kind; each material carries only `beadProductId`, `role`, and `label`; each card carries only `designId`, `title`, and `description`. No cast, question, SKU, price, or full design is returned. A cast-only projection may return `cards: []` and `materials: []`; once recommendations exist, `cards` holds exactly three designs and never one or two, and an empty `materials` array is preferred over a fabricated SKU.
- `DesignPresentationResponseSchema` returns `{ designId, sourceRevision, locale, title, story, materialLabels }`, where each label carries only `beadProductId` and `label`. Pricing, inventory, and the authoritative design remain in the existing Design responses.
- `TarotPresentationResponseSchema` returns `{ sessionId, sourceRevision, locale, headline, summary, cardReflections, colorStory, designRationale, disclaimer }`, where each reflection carries a canonical Tarot `slot` and text. No revealed card identity, orientation, deck order, or recommendation is duplicated.

Every field is a strict object, so unknown fields — including price, inventory, and duplicated design or draw payloads — are rejected at the boundary. These schemas define wire shape only; owner-scoped access, reviewed templates, and the decision not to re-cast, re-draw, or persist remain Backend responsibilities.

These DTOs define data shape only. Authentication, authorization, catalog lookup, inventory checks, pricing execution, persistence, HTTP status, and application error mapping remain Backend responsibilities.

## Version and migration policy

- The current version is the literal SemVer value `1.0.0`.
- Unknown versions are rejected rather than parsed loosely.
- Backward-compatible optional additions may use a minor release. Changed meaning, removed fields, or changed invariants require a major release and an explicit migration.
- `migrateDesignToV1(input)` accepts `unknown`, does not mutate input, and returns `MIGRATED`, `REQUIRES_REVIEW`, or `REJECTED` plus warnings.
- Valid V1 input returns a validated clone and is idempotent.
- `legacy-initial` grouped beads expand into a deterministic candidate with placeholder catalog/price data. Because original order is unknowable, the result is always `REQUIRES_REVIEW`.
- Phase 2A supplies only a migration fixture and tests. It performs no production-data backfill.

## Data flow and ownership

```text
provider / HTTP / persistence unknown input
                    |
                    v
       @mystcrag/design-contract validation
                    |
                    v
                 DesignV1
          /          |           \
 public projection  3D adapter   server commercial envelope
       |              |                    |
 frontend/community  scene runtime      pricing/production
       |
 order projection -> immutable public-safe snapshot
```

The shared package owns contract fields and invariants. AI providers produce candidates, Backend owns trust-boundary validation and orchestration, Three Engine derives render state, and Prisma remains a persistence model behind future adapters.
