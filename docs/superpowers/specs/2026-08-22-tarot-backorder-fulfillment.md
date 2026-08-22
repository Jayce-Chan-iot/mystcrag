# Tarot Backorder Fulfillment Specification

**Status:** Approved on 2026-08-22

## Goal

Allow an active material SKU with zero available inventory to participate in Tarot recommendations, remain editable in a Tarot-guided design, and create a valid order that clearly records the replenishment wait instead of failing with `INVENTORY_CHANGED`.

## Product policy

- Backordering is enabled only for designs whose persisted mode is `TAROT_GUIDED`.
- Active, correctly configured material SKUs remain eligible for Tarot scoring even when their latest remaining quantity is zero.
- Availability is not a recommendation-capacity limit. A Tarot design may use the quantity required by its bracelet pattern; any shortage is recorded at order time.
- Inactive, missing, wrong-currency, or visually incomplete products remain ineligible and cannot be backordered.
- Non-Tarot design modes retain the existing hard inventory validation.
- Customer-facing copy is advisory: `本方案含需补货材料，下单后预计等待约 5 天，具体以实际补货时间为准。`
- Public APIs expose fulfillment state and estimated days, never raw warehouse availability.

## Recommendation and editing flow

1. The Tarot catalog returns all active material products plus their private remaining quantity, including zero.
2. Tarot scoring and sequence generation accept zero-stock products and generate three distinct wrist-sized candidates without treating stock as a sequence cap.
3. Each ranked recommendation carries a public fulfillment advisory with `requiresRestock`, `estimatedRestockDays`, and affected product IDs.
4. A generated Tarot design stores the advisory in its production notes so the message survives navigation into DIY and page restoration.
5. Generate and update operations treat availability as advisory for `TAROT_GUIDED` designs. Pricing remains authoritative and inactive or missing products still fail.
6. The recommendation page and DIY editor show a compact inline notice. No modal is used and completion remains enabled.

## Order fulfillment model

- Add `AWAITING_RESTOCK` to the persisted and public order status vocabulary.
- Each immutable order snapshot stores a fulfillment snapshot containing one line per BOM product:
  - requested quantity;
  - quantity reserved from currently available stock;
  - backorder quantity;
  - line status: `IN_STOCK`, `PARTIALLY_BACKORDERED`, or `BACKORDERED`;
  - estimated restock days, set to `5` when backorder quantity is positive.
- An order with any backorder quantity is created as `AWAITING_RESTOCK`; otherwise it remains `PENDING`.
- For each in-stock portion, order creation appends a new inventory snapshot with the increased reserved quantity. It never makes remaining inventory negative.
- Order creation, fulfillment snapshot creation, and inventory reservation occur in one database transaction.
- Idempotent order retries return the existing order and do not reserve inventory again.
- The initial release does not automatically move an order out of `AWAITING_RESTOCK` after replenishment. That workflow is intentionally deferred.

## Error behavior

- Tarot orders do not fail merely because remaining quantity is zero or insufficient.
- Non-Tarot orders continue returning `INVENTORY_CHANGED` for a shortage.
- Missing inventory observations count as zero remaining for a Tarot order and as unavailable for other modes.
- Price, product activation, currency, compliance, ownership, revision, and idempotency checks remain unchanged.

## Verification

- Repository tests cover zero-stock inclusion and private quantity handling.
- Tarot service tests cover zero-stock scoring, sequence generation, and recommendation advisories.
- Design API tests cover advisory validation for Tarot and hard validation for other modes.
- Database integration tests cover mixed fulfillment, full backorder, immutable snapshots, no negative inventory, and idempotent retry.
- Frontend tests cover recommendation and DIY notices without blocking completion.
- Browser tests cover desktop and mobile Tarot-to-DIY-to-order flows.
- `pnpm validate` must pass before handoff.

