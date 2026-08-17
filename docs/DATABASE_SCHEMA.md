# Database Schema

The executable source is `packages/database/prisma/schema.prisma`; the reviewed baseline is `20260721140000_init_mystcrag_persistence_v1`. PostgreSQL tables use snake_case and Prisma fields use camelCase.

## Transactional model

- `Design` is the owner-scoped, soft-deletable current aggregate. `currentSnapshot` is a validated `DesignV1` and `currentRevision` starts at one.
- `DesignRevision` is append-only and unique by `(designId, revisionNumber)`. PostgreSQL triggers reject updates and deletes.
- `DesignPublication` fixes community visibility and consent to a specific revision; unpublishing changes status/timestamp without deleting history.
- `Order` stores a BIGINT minor-unit total and references a revision. Its required `OrderDesignSnapshot` stores immutable design, pricing, and production JSON plus currency and pricing-rule version. Triggers reject snapshot updates/deletes and order deletes.
- `MaterialProduct` and `AccessoryProduct` are sellable catalog records; `Crystal` remains knowledge data. Cost fields are server-only.
- `InventorySnapshot` and `PricingRule` are versioned inputs to order validation and price recalculation.

## Guardrails

- All money uses non-negative PostgreSQL `BIGINT`; repositories convert only to/from JavaScript safe-integer `number` values. CNY uses fen and TWD uses whole-dollar minor units. Price catalogs are independent and no exchange rate is stored.
- Design, pricing, and production JSON is validated on every repository read and write. Unknown schema majors and invalid persisted JSON become structured persistence errors.
- Design writes conditionally match owner, current revision, and `deletedAt: null`; the current row update and revision insert share one transaction.
- Publication requires consent, non-private visibility, PASSED compliance, and no review requirement. Order creation rejects rejected or review-required flagged designs, then validates server price and latest inventory.
- Every foreign key declares `Restrict`; lifecycle data is never removed by user deletion. Designs use `deletedAt`, publications use `UNPUBLISHED`, and products use `active=false`.

## Demo catalog baseline

The local seed synchronizes 18 compliant crystal knowledge entries into 36 active material products: one independent CNY and one TWD SKU per crystal. The public material catalog reads bilingual names and color tags from `Crystal`, while price, render keys, sellable status, and currency remain product-specific. Cultural references remain design inspiration only and do not introduce medical or guaranteed-effect claims.

See `PERSISTENCE_MODEL_V1.md` for the ERD, full lifecycle, constraints, and JSON boundaries.
