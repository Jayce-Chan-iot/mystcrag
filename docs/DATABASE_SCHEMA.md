# Database Schema

The canonical executable schema is `packages/database/prisma/schema.prisma`. PostgreSQL table names use snake_case; Prisma model fields use camelCase.

## Core tables

- `users`: minimal user identity and display profile.
- `crystals`: mineral facts, visual/style/emotion/cultural tags, price level, availability, and compliance notes.
- `design_templates`: reusable Design DNA including theme, bead sequence, palette, accessories, and price range.
- `design_history`: immutable design ownership boundary plus the latest structured configuration and lifecycle status.
- `community_designs`: publication metadata linked one-to-one with a saved design; `sharing_consent` defaults to false.
- `materials`: sellable crystal or accessory inventory records and unit prices.
- `orders`: production order snapshots linked to a user and saved design.

## Relationships

- A user owns many design history records, community publications, and orders.
- A design template can seed many user designs.
- A design history record can have at most one community publication and can generate many orders.
- A crystal can map to multiple material SKUs.

## Guardrails

- Community publication requires explicit sharing consent at the application layer.
- Monetary values use PostgreSQL `Decimal(10,2)`; API boundaries must serialize them explicitly.
- Crystal cultural tags are references only. `compliance_note` is required and no medical or guaranteed-effect claim may be stored as product guidance.
- The initial schema has no migration because no database environment has been selected. The first database change must create and review the baseline migration.
