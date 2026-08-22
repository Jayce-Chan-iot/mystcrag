# Tarot Backorder Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make zero-stock active beads recommendable, editable, and orderable in the Tarot flow with an explicit five-day replenishment advisory and immutable fulfillment records.

**Architecture:** Keep raw availability internal, add structured public advisory and order fulfillment contracts, and permit shortages only when the persisted design mode is `TAROT_GUIDED`. Order creation atomically snapshots fulfillment and reserves only the currently available portion by appending inventory snapshots.

**Tech Stack:** TypeScript, Zod, Fastify, Prisma, PostgreSQL, React, Next.js, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-22-tarot-backorder-fulfillment.md`

## Global Constraints

- Backordering is limited to persisted `TAROT_GUIDED` designs.
- Estimated restock time is `5` days and customer copy must say it is an estimate.
- Raw inventory quantities remain server-private.
- Inactive, missing, or wrong-currency products still fail.
- Inventory snapshots remain append-only and remaining inventory never becomes negative.
- UI redesign is explicitly out of scope for this plan; only the approved compact fulfillment notice may be added.

---

### Task 1: Fulfillment contracts and persistence schema

**Files:**
- Modify: `packages/design-contract/src/schemas/tarot.schema.ts`
- Create: `packages/design-contract/src/schemas/order-fulfillment.schema.ts`
- Modify: `packages/design-contract/src/schemas/order-snapshot.schema.ts`
- Modify: `packages/design-contract/src/schemas/api-dto.schema.ts`
- Modify: `packages/design-contract/src/projections/to-order-snapshot.ts`
- Modify: `packages/design-contract/src/index.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260822150000_add_backorder_fulfillment/migration.sql`
- Test: `packages/design-contract/src/design-contract.test.ts`

**Interfaces:**
- Produces: `OrderFulfillmentSnapshotV1`, `OrderFulfillmentLineV1`, `TarotFulfillmentAdvisory`, and public order status `AWAITING_RESTOCK`.
- The snapshot builder becomes `toOrderSnapshot(design, capturedAt, fulfillment)`.

- [ ] Write failing schema tests for a three-state fulfillment line, a five-day Tarot advisory, and `AWAITING_RESTOCK` response parsing.
- [ ] Run `pnpm --filter @mystcrag/design-contract test` and confirm the new assertions fail.
- [ ] Add strict Zod schemas with safe integer quantities, `estimatedRestockDays: 5` for shortages, and cross-field totals.
- [ ] Extend the Prisma order enum and immutable order snapshot with `fulfillment_snapshot JSONB NOT NULL`.
- [ ] Regenerate Prisma and rerun the design-contract tests.
- [ ] Commit the contract and migration change as `feat(order): add backorder fulfillment contract`.

### Task 2: Include zero-stock products in Tarot recommendation generation

**Files:**
- Modify: `packages/database/src/repositories/product.repository.ts`
- Test: `packages/database/src/repositories/product.repository.unit.test.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.service.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.types.ts`
- Test: `apps/backend/src/modules/tarot/tarot.service.test.ts`
- Test: `apps/backend/src/modules/tarot/tarot.recommendations.integration.test.ts`

**Interfaces:**
- `listAvailableCatalogMaterialProducts(currency)` returns active configured materials with `availableQuantity >= 0`.
- Tarot recommendations expose `{ requiresRestock, estimatedRestockDays, affectedProductIds }` without quantities.

- [ ] Change repository tests to require zero-stock active materials in the internal Tarot catalog while still excluding inactive products.
- [ ] Add service tests proving a zero-stock material can score and repeat to fit the wrist without an availability cap.
- [ ] Add response tests proving only safe advisory data reaches the public session.
- [ ] Run the focused tests and confirm they fail for the expected positive-inventory filters.
- [ ] Relax only the stock predicate, remove stock from sequence capacity, and derive a candidate advisory from affected products.
- [ ] Add the approved advisory to generated Tarot production notes.
- [ ] Run both focused suites and commit as `feat(tarot): recommend backorder materials`.

### Task 3: Make Tarot inventory validation advisory during editing

**Files:**
- Modify: `apps/backend/src/modules/design/design-api.service.ts`
- Modify: `apps/backend/src/modules/design/design.service.ts`
- Test: `apps/backend/src/modules/design/design.routes.test.ts`
- Test: `apps/backend/src/modules/design/design-api.service.test.ts`

**Interfaces:**
- Produces: `RESTOCK_REQUIRED` contract warning for a Tarot shortage.
- Preserves: `INVENTORY_CHANGED` failures for non-Tarot design generation and update.

- [ ] Add failing tests for zero-stock Tarot generation, update, and price while retaining a failing non-Tarot update test.
- [ ] Run the focused backend tests and verify the shortage paths fail.
- [ ] Route inventory validation through a design-mode-aware helper that converts only Tarot shortages to `RESTOCK_REQUIRED` warnings.
- [ ] Preserve product activation and pricing checks in every mode.
- [ ] Run the focused tests and commit as `feat(design): allow tarot backorder editing`.

### Task 4: Create atomic mixed-stock orders

**Files:**
- Modify: `packages/database/src/repositories/order.repository.ts`
- Test: `packages/database/src/repositories/persistence.integration.test.ts`
- Modify: `apps/backend/src/modules/design/design-api.service.ts`
- Test: `apps/backend/src/modules/design/design.routes.test.ts`

**Interfaces:**
- `PersistedOrder` includes `fulfillmentSnapshot` and `AWAITING_RESTOCK`.
- `createOrderFromDesign` reserves `min(remaining, requested)` and backorders the remainder only for Tarot designs.

- [ ] Replace the old zero-stock rejection test with a Tarot full-backorder test and add mixed-stock, non-Tarot rejection, no-negative-inventory, and idempotent-retry cases.
- [ ] Run the database integration test against PostgreSQL and confirm the new cases fail.
- [ ] Calculate fulfillment lines from the latest snapshot inside the transaction.
- [ ] Append reservation snapshots only for positive reserved quantities, create the order and fulfillment snapshot once, and return `AWAITING_RESTOCK` when needed.
- [ ] Map fulfillment through the backend response and rerun database and route tests.
- [ ] Commit as `feat(order): persist tarot backorders`.

### Task 5: Add compact customer notices without redesigning UI

**Files:**
- Modify: `apps/frontend/src/features/tarot/components/tarot-recommendation-card.tsx`
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot-result.test.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: recommendation advisory, production notes, `RESTOCK_REQUIRED`, and `AWAITING_RESTOCK`.
- Visible copy: `本方案含需补货材料，下单后预计等待约 5 天，具体以实际补货时间为准。`

- [ ] Add failing render tests for inline notices on a Tarot recommendation, restored DIY design, and completed awaiting-restock order.
- [ ] Run focused frontend tests and verify the notices are missing.
- [ ] Render a compact semantic status notice without modal behavior and without disabling completion.
- [ ] Keep existing layout, design tokens, and interaction hierarchy unchanged.
- [ ] Run focused frontend tests and commit as `feat(frontend): show tarot restock notices`.

### Task 6: Documentation and verification

**Files:**
- Modify: `docs/API_SPECIFICATION.md`
- Modify: `docs/DATABASE_SCHEMA.md`
- Modify: `docs/PERSISTENCE_MODEL_V1.md`
- Modify: `docs/DESIGN_CONTRACT_V1.md`
- Modify: `docs/INTERACTION_TEST_PLAN.md`

**Interfaces:**
- Documents: private availability, Tarot-only backorder policy, immutable fulfillment snapshot, statuses, copy, and deferred replenishment transition.

- [ ] Update controlling documents in the same terminology as the schemas.
- [ ] Run all focused package tests changed by Tasks 1-5.
- [ ] Walk the desktop and mobile Tarot recommendation to DIY to order flow with zero stock and capture evidence.
- [ ] Confirm a non-Tarot shortage remains blocked and inventory never becomes negative.
- [ ] Run `pnpm validate` and confirm it exits successfully.
- [ ] Commit as `docs: document tarot backorder fulfillment`.

