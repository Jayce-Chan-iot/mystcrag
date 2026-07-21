# Persistence Phase 2C Plan

Date: 2026-07-21

## 1. Current model problems

- `DesignHistory` simultaneously represents an editable design and history, so immutability and optimistic concurrency cannot be enforced.
- `Order` references mutable design data and stores neither a design snapshot nor pricing and production snapshots.
- `CommunityDesign` references the mutable design instead of a fixed revision.
- `Material` conflates crystal beads and accessories, uses one price per SKU, and stores Decimal major-unit money without currency.
- Persisted JSON has no runtime validation or migration boundary and Prisma rows can currently escape directly to consumers.
- Foreign-key deletion behavior permits owner deletion to cascade into saved/public design data.

## 2. New model proposal

- Replace `DesignHistory` with editable `Design` plus append-only `DesignRevision`.
- Replace `CommunityDesign` with `DesignPublication` referencing one revision.
- Add immutable one-to-one `OrderDesignSnapshot` alongside `Order`.
- Split sellable products into `MaterialProduct` and `AccessoryProduct`; retain `Crystal` as knowledge data.
- Add append-only `InventorySnapshot` and versioned `PricingRule`.
- Keep `DesignTemplate` as non-transactional design-DNA data.

There is no production data, so the first migration is a breaking baseline named `init_mystcrag_persistence_v1`; no backfill or compatibility table is required.

## 3. Migration risks

- The baseline drops the old initialization-only table shapes and field names. It must only run against an empty Phase 2C database.
- PostgreSQL `BIGINT` maps to JavaScript `bigint`; every repository conversion must check the safe-integer range.
- PostgreSQL cannot validate Design Contract JSON internals, so all application read and write paths must use Zod.
- Immutability is enforced by repository API and database triggers for revisions and order snapshots. Administrative/legal data-governance work remains a separate privileged process.

## 4. Amount storage

All persisted amounts use non-negative PostgreSQL `BIGINT` minor units. CNY values are fen and TWD values are whole-dollar minor units. Domain and API values remain JavaScript safe-integer `number` values. Mappers reject negative, fractional, unsafe, or out-of-range values before converting to `bigint`, and reject unsafe database values before converting to `number`. No exchange-rate conversion exists.

## 5. JSON versus structured fields

Complete `DesignV1`, pricing, production, and compliance snapshots remain JSON because they are versioned aggregate values and must be restored exactly. Ownership, revision, lifecycle status, currency, schema version, visibility, consent, prices used for querying, product SKU/cost, stock quantities, and foreign keys are structured columns. Prisma `JsonValue` never crosses the repository boundary.

## 6. Repository design

`@mystcrag/database` exposes domain DTOs and these repositories: design/revision, publication, order, product, and inventory. Repositories own Prisma mapping, Zod validation, bigint conversion, Prisma-error translation, and transaction composition. Backend services depend on repository interfaces and never call `prisma.*`.

## 7. Transaction boundaries

- Create/update design: validate snapshot, compare expected revision, update current row, and append the matching revision atomically.
- Publish: lock/validate the design revision, consent, visibility, and compliance before creating a fixed-revision publication atomically.
- Order: load the revision, validate compliance and inventory, recalculate server price, compare client expectations, then create the order and immutable snapshot atomically.

Any failed invariant aborts the transaction. Optimistic design updates use a conditional update on `(id, ownerId, currentRevision, deletedAt)` and return `CONFLICT` when no row matches.

## 8. Test plan

- Unit tests cover JSON validation on write/read, unknown versions, bigint safety, pricing recalculation, public projection privacy, and domain-error mapping.
- PostgreSQL integration tests cover revision 1 creation, optimistic updates/conflicts, soft-delete editing denial, immutable revision/snapshot triggers, publication fixed revisions, order snapshot isolation, inventory changes, price changes, and transaction rollback.
- Seed verification covers one user, six bead products, two accessories, both currencies, AI/DIY/private/passed/rejected designs, multiple revisions, one publication, and one order snapshot.
- Handoff runs focused package/backend checks, database reset/migrate/seed/test against a dedicated test database, then `pnpm validate`.
