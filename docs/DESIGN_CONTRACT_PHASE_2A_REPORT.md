# Design Contract Phase 2A Report

Date: 2026-07-21

## 1. New structure

Phase 2A adds the independent `@mystcrag/design-contract` workspace package with:

- modular Zod schemas and inferred TypeScript types;
- constants for contract versions, currencies, minor units, and disclaimers;
- public and order-snapshot projections;
- a server-only commercial-cost schema;
- `legacy-initial` validation and migration;
- ten categorized fixtures;
- package-local schema, DTO, projection, migration, and architecture tests.

No existing AI, 3D, Backend, Frontend, or Prisma consumer imports the package in this phase.

## 2. Implemented schemas

- `DesignV1Schema` and all metadata, bracelet, bead, accessory, story, pricing, production, compliance, provenance, and community children.
- `PublicDesignV1Schema`, `InternalCommercialDesignV1Schema`, and `OrderDesignSnapshotV1Schema`.
- Twelve schemas covering six request/response API DTO pairs.
- Finite update-operation schemas for replace, move, add, remove, and bracelet update.
- `LegacyInitialDesignSchema`, structured migration warnings, and migration result types.

Design-level refinements enforce component identity, contiguous main-ring order, anchor validity, bead count, component price subtotals, pricing total, production sequence, anchored production mapping, BOM sources, community consent, compliance review, and rejected publication/order guards.

## 3. Test coverage

Package tests cover:

- valid and missing-field input;
- version, enum, locale/time, quantity, revision, and money constraints;
- total, material subtotal, and accessory subtotal equations;
- signed explicit adjustments;
- duplicate component IDs and duplicate/gapped positions;
- invalid, self, and anchored-to-anchored/circular anchors;
- bead-count, BOM-source, and production-order consistency;
- unauthorized public visibility and flagged review requirements;
- server cost references and public projection leakage;
- all six request/response DTO pairs and arbitrary JSON Patch rejection;
- rejected publication and order snapshot creation;
- deterministic, immutable, idempotent migration and information-loss warnings;
- forbidden dependency and source-import protection.

The fixture registry contains the ten required valid, invalid, flagged, and migration scenarios.

## 4. Known limitations

- The package validates catalog IDs, stock warnings, and price values but does not query a catalog, inventory service, promotion engine, or exchange rate.
- Budget excess and unavailable material are workflow fixtures; they are not intrinsic `DesignV1` invalidity.
- Compliance schemas store structured results but do not scan natural language or connect to an AI/provider.
- Legacy migration creates deterministic placeholder product, asset, and price values and always requires review. No production data is backfilled.
- Order snapshots are in-memory contract values in this phase; Prisma persistence is unchanged.
- The public schema currently shares all non-commercial `DesignV1` fields. Future authorization work may define narrower endpoint-specific projections without adding cost data.

## 5. Phase 2B consumer migration recommendation

1. Add Backend boundary adapters first and parse all HTTP/provider values as `unknown`.
2. Add an AI candidate-to-DesignV1 adapter while retaining and deprecating existing grouped interfaces.
3. Add a DesignV1-to-scene adapter in Three Engine, preserving engine-only runtime descriptors.
4. Move pricing and compliance services onto the shared child schemas before enabling product routes.
5. Give Frontend only `PublicDesignV1` and finite update operations.
6. Add persistence adapters and reviewed database migrations only in the later database phase.
7. Remove legacy AI/3D duplicate types only after every consumer and compatibility test has switched.

## 6. Manual confirmation for later phases

- Confirm endpoint-specific authorization and error response contracts in Backend.
- Confirm catalog ownership of product/material/asset keys and separate CNY/TWD price tables.
- Confirm physical bracelet range rules and whether anchored accessories may target connector sub-slots beyond integer `anchorSlot`.
- Confirm whether public gallery views should remove production notes or other non-commercial fields beyond cost/supplier data.
- Confirm the persistent revision/history and immutable order-snapshot model before changing Prisma.
- Confirm the human compliance review workflow and localized disclaimer catalog.
