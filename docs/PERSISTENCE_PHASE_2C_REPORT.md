# Persistence Phase 2C Report

Date: 2026-07-21

## 1. Prisma model changes

The initialization-only `DesignHistory`, `CommunityDesign`, `Material`, and mutable order shape were replaced before production data existed. The new model separates editable `Design`, append-only `DesignRevision`, fixed-revision `DesignPublication`, `Order`, and one-to-one immutable `OrderDesignSnapshot`. Sellable beads and accessories now use `MaterialProduct` and `AccessoryProduct`; `InventorySnapshot` and `PricingRule` capture versioned commerce inputs. All foreign keys use explicit `RESTRICT` behavior.

Money changed from ambiguous Decimal major units to non-negative PostgreSQL BIGINT minor units. Design/revision/order snapshot JSON retains schema versions and passes Design Contract validation on write and read. Database checks cover revision positivity, money, inventory quantities, product diameter, and publication consent/state. Triggers prevent revision and order-snapshot update/delete and prevent physical order deletion.

Breaking change: the old initialization tables and Decimal fields have no compatibility migration or backfill. This is intentional because there is no production data.

## 2. Migration name

`20260721140000_init_mystcrag_persistence_v1`

The migration is a formal PostgreSQL baseline generated from an empty schema and augmented with reviewed checks and immutability triggers.

## 3. Repositories

- `DesignRepository`: create/get/update/soft-delete current designs and list/get immutable revisions with optimistic concurrency.
- `DesignRevisionRepository`: read-only revision retrieval/listing; revision writes remain inside current-design transactions.
- `PublicationRepository`: transactional publish/unpublish/read against a fixed revision and privacy-safe projection.
- `OrderRepository`: transactional revision/compliance/price/inventory validation and immutable order snapshot creation.
- `PricingRepository`: active currency-specific catalog/rule recalculation.
- `ProductRepository`: public catalog DTOs and separately named internal pricing DTOs with safe bigint mapping.
- `InventoryRepository`: latest-snapshot availability validation.
- Mappers validate design/pricing/production JSON and minor-unit conversions; persistence errors translate known Prisma codes without exposing raw database messages.

No repository returns generated Prisma rows or `JsonValue`.

## 4. Backend services

- `DesignService`: `createDesign`, `getDesign`, `updateDesign`, `createRevision`, `listDesignRevisions`.
- `PublicationService`: `publishDesign`, `unpublishDesign`, `getPublication`.
- `OrderService`: `createOrderFromDesign`, `getOrder`.
- `PricingService`: `recalculateDesignPrice`.
- `InventoryService`: `validateAvailability`.

All write paths accept explicit `actorId`. Phase 2B HTTP routes remain deliberate stubs until authentication is connected; Phase 2C does not accept owner identity from request bodies.

## 5. Transaction boundaries

- Design creation/update writes the current aggregate and matching revision atomically. Updates conditionally match owner, non-deleted state, and `expectedRevision`; stale writes return `CONFLICT`.
- Publication atomically validates ownership, revision, consent, visibility, and compliance before inserting a fixed-revision authorization.
- Order creation atomically loads the revision, validates compliance, recalculates active catalog pricing, compares expected price/version, validates latest inventory, and creates the order plus snapshot. Any failure rolls back all writes.

## 6. Seed data

The idempotent seed uses stable IDs, upserts mutable catalog/current data, `createMany(..., skipDuplicates)` for append-only data, and creates its immutable order snapshot only when absent. It supplies one user; three crystal knowledge records; six material products split across independent CNY/TWD catalogs; two accessories; two pricing rules; inventory snapshots; AI, DIY/private, publishable PASSED, and REJECTED designs; four revisions; one fixed-revision publication; and one order snapshot. Every design is parsed by `DesignV1Schema` before insertion.

## 7. Test summary

- `pnpm validate`: passed lint, strict type checks, 7 architecture tests, all workspace tests, Prisma validation, backend build, and Next.js production build.
- Database unit tests: 4 passed for CNY/TWD integers, bigint safe-range checks, persisted JSON validation/unknown major rejection, and database-error translation.
- PostgreSQL integration suite is implemented for creation/revision 1, invalid owner/schema input, optimistic conflicts, immutable revision/snapshot triggers, fixed publication revision, server price changes, inventory changes, transaction rollback, preserved order snapshots, and soft-delete editing denial.
- `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, and `pnpm db:test` were invoked but could not complete on this host because neither Docker nor a local PostgreSQL server is installed. The corrected `db:test` command reaches the isolated `mystcrag_test` datasource before failing to connect.

## 8. Known limitations

- Live PostgreSQL migration/seed/integration behavior still requires one run on a Docker-enabled host; static Prisma validation cannot prove trigger execution.
- Authentication and authorization middleware are not implemented. Repository/service `actorId` is the prepared boundary for the next phase.
- Public HTTP success orchestration is not enabled; existing endpoints continue to return stable `NOT_IMPLEMENTED` responses after DTO validation.
- Inventory is validation-only: there is no reservation, release, allocation, or production scheduling.
- Pricing uses active independent currency catalogs and fixed fees already present in the design; promotions, tax, shipping integrations, payment, exchange rates, and Shopee remain out of scope.
- Public projection clearing of production notes is applied by `PublicationRepository`; a future Design Contract major/minor review should formalize narrower endpoint-specific public schemas.

## 9. Next phase recommendations

1. Run the four database commands on a Docker-enabled machine and retain CI evidence for migration-from-empty, repeat seed, and integration tests.
2. Add authentication middleware and map authenticated subject to `actorId`; then wire save/update routes first.
3. Map `PersistenceError` codes to the existing API envelope and enable publish/order HTTP paths incrementally.
4. Add request idempotency keys for order creation before payment or external commerce integration.
5. Design inventory reservation and audit events as a separate reviewed phase; do not mutate immutable snapshots.
