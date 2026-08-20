# Mystcrag Design Contract V1

## Status and source

`@mystcrag/design-contract` is the canonical, runtime-validated design protocol for AI generation, DIY editing, 3D conversion, pricing, saving, community publication, remixing, and order snapshots.

The executable source is `packages/design-contract/src`. This document describes schema version `1.0.0`. Phase 2A creates the contract package without switching the existing AI, 3D, Backend, Frontend, or Prisma consumers.

## Top-level DesignV1

Wire JSON uses camelCase. Zod schemas infer TypeScript types.

| Field | Rule |
| --- | --- |
| `schemaVersion` | Literal `1.0.0` |
| `designId` / `designName` | Stable non-empty identity and display name |
| `designMode` | `AI_GENERATED`, `DIY_CREATED`, `AI_ASSISTED`, `TEMPLATE_REMIX`, or `TAROT_GUIDED` |
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

Designs created through the internal `TAROT_GUIDED` generation boundary must include a strict public-safe `provenance.tarotCandidate` object containing only `sessionId`, `ruleVersion`, rank 1–3, and `BALANCED`, `CONTRAST`, or `NEUTRAL_LED` direction. This identity binds deterministic retry reuse to the intended Tarot candidate. `sourceDesignId` remains reserved for actual Design lineage and is not used for a Tarot session.

## Material catalog projection

`CatalogMaterialProduct` exposes sellable product identity, bilingual Crystal names, color tags, Crystal-authored `visualTags`, `styleTags`, `emotionTags`, and compliance-safe `cultureTags`, bead geometry, render assets, currency, and authoritative unit price. It never exposes unit cost, supplier data, or inventory quantity. The four additive Crystal tag arrays are public-safe design metadata and are the authoritative inputs for deterministic recommendation scoring.

## Public and order projections

`PublicDesignV1` is the safe design view used by every Phase 2A response DTO. It excludes commercial cost and supplier data.

`OrderDesignSnapshotV1` contains:

- `snapshotVersion: 1.0.0`
- an explicit capture timestamp
- a public-safe, validated `DesignV1`

The snapshot preserves design revision, currency, pricing version, component sequence, production data, compliance, and provenance as one immutable value. Rejected designs cannot produce this snapshot.

## API DTO schemas

The package exports request and response schemas for these Design and Order operations:

- Generate Design
- Update Design
- Price Design
- Save Design
- Publish Design
- Create Order From Design

Every response contains a validated public design and structured warnings. Update requests use only `REPLACE_COMPONENT`, `MOVE_COMPONENT`, `ADD_COMPONENT`, `REMOVE_COMPONENT`, and `UPDATE_BRACELET`; arbitrary JSON Patch is rejected. Publish and create-order requests enforce consent/compliance and revision or price expectations at the schema boundary where the required design context is present.

The package also exports these Tarot session DTO families:

- Create Tarot Session
- Select Tarot Card
- Reveal Tarot Session
- Generate Tarot Recommendations
- Get Tarot Session
- Save Tarot Session

Tarot responses use a request ID and strict public session projection. The contract duplicates its stable Tarot wire literals locally; it does not depend on the Tarot engine package. `GET` is the broad restore projection and enforces state-specific invariants. Create returns only a `DRAWING` session. Select returns a pre-reveal `DRAWING` or completed `DRAWN` selection projection without card identity. Reveal returns a revealed `DRAWN`, `RECOMMENDED`, or `SAVED` projection so idempotent retries remain representable. Recommendation responses require `RECOMMENDED` or `SAVED` state with exactly three distinct ranked `PublicDesignV1` values. Save responses require `SAVED` state.

Tarot public projections never contain deck or orientation order, private deck state, raw or encrypted questions, encryption material, hidden prompts, commercial costs, or inventory quantities. Card identity and orientation are absent from create/select projections and appear only after reveal. Tarot routes reuse the established API error envelope; the Design Contract does not define a separate Tarot error shape.

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
