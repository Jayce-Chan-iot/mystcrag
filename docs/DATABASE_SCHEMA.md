# Database Schema

The executable source is `packages/database/prisma/schema.prisma`; the reviewed baseline is `20260721140000_init_mystcrag_persistence_v1`, with additive order-idempotency and Tarot-session migrations applied afterward. PostgreSQL tables use snake_case and Prisma fields use camelCase.

## Transactional model

- `Design` is the owner-scoped, soft-deletable current aggregate. `currentSnapshot` is a validated `DesignV1` and `currentRevision` starts at one.
- `DesignRevision` is append-only and unique by `(designId, revisionNumber)`. PostgreSQL triggers reject updates and deletes.
- `DesignPublication` fixes community visibility and consent to a specific revision; unpublishing changes status/timestamp without deleting history.
- `Order` stores a BIGINT minor-unit total and references a revision. Its nullable, unique `idempotencyKey` is populated for new order intents so concurrent retries for the same user and design revision resolve to one order; legacy rows remain readable. Its required `OrderDesignSnapshot` stores immutable design, pricing, and production JSON plus currency and pricing-rule version. Triggers reject snapshot updates/deletes and order deletes.
- `MaterialProduct` and `AccessoryProduct` are sellable catalog records; `Crystal` remains knowledge data. Cost fields are server-only.
- `InventorySnapshot` and `PricingRule` are versioned inputs to order validation and price recalculation.
- `TarotSession` is an owner-scoped, revisioned draw aggregate. It stores canonical private engine state separately from strict contract-safe draw and recommendation snapshots. `TarotDesignRecommendation` links exactly three ranked, distinct designs without duplicating design snapshots.

## Guardrails

- All money uses non-negative PostgreSQL `BIGINT`; repositories convert only to/from JavaScript safe-integer `number` values. CNY uses fen and TWD uses whole-dollar minor units. Price catalogs are independent and no exchange rate is stored.
- Design, pricing, and production JSON is validated on every repository read and write. Unknown schema majors and invalid persisted JSON become structured persistence errors.
- Design writes conditionally match owner, current revision, and `deletedAt: null`; the current row update and revision insert share one transaction.
- Publication requires consent, non-private visibility, PASSED compliance, and no review requirement. Order creation first returns an existing order for the same owner and revision, otherwise rejects rejected or review-required flagged designs, validates server price and latest inventory, and creates the order under a unique idempotency key.
- Every foreign key declares `Restrict`; lifecycle data is never removed by user deletion. Designs use `deletedAt`, publications use `UNPUBLISHED`, and products use `active=false`.
- Tarot transitions conditionally match session ID, owner ID, and state revision inside a transaction. Accepted selection operation IDs remain in the validated private engine state, making identical retries idempotent while stale or conflicting commands fail.
- Recommendation ranks must be exactly 1, 2, and 3 with three distinct, owner-scoped designs. `selectedDesignId` is nullable metadata validated against those links by the repository; it is intentionally not a cascading foreign key.
- Tarot question text has no database field. The default path stores neither question text nor ciphertext; explicit opt-in may populate only the paired nullable `questionCiphertext` and `questionSavedAt` fields, and public DTO mapping must omit ciphertext.
- New recommendation snapshots persist an internal `copySource` marker with provider or deterministic-fallback mode, provider ID/version, and copy-policy version. The marker is optional only so existing persisted snapshots remain readable; every newly generated recommendation supplies it.

## Tarot lifecycle persistence

- `TarotSpreadType` supports `SINGLE` and `PAST_PRESENT_FUTURE`; `TarotSessionStatus` supports `DRAWING`, `DRAWN`, `RECOMMENDED`, `SAVED`, and `ABANDONED`. `DesignMode.TAROT_GUIDED` is additive to existing modes.
- New sessions start at state revision 1 with an unselected, unrevealed canonical private draw state. Selection and reveal transitions update private state and its contract-safe draw snapshot together.
- Recommendation persistence validates interpretation, color story, and material-display data before write and after read, then transactionally creates unique `(sessionId, rank)` and `(sessionId, designId)` links.
- Saving a session may record a selected design only when it belongs to the session's recommendation links. A nullable restrictive self-relation records redraw lineage through `parentSessionId`.
- User, parent-session, session-recommendation, and design-recommendation foreign keys use `RESTRICT`. Deleting a referenced design or a parent/recommended session cannot erase Tarot lifecycle evidence.

## Demo catalog baseline

The local seed synchronizes 18 compliant crystal knowledge entries into 36 active material products: one independent CNY and one TWD SKU per crystal. The public material catalog reads bilingual names plus color, visual, style, emotion, and compliance-safe culture tags from `Crystal`, while price, render keys, sellable status, and currency remain product-specific. These Crystal arrays are authoritative deterministic-scoring metadata; cultural references remain design inspiration only and do not introduce medical or guaranteed-effect claims.

See `PERSISTENCE_MODEL_V1.md` for the ERD, full lifecycle, constraints, and JSON boundaries.
