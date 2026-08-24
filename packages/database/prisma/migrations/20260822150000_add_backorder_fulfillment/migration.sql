ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_RESTOCK';

ALTER TABLE "order_design_snapshots"
ADD COLUMN IF NOT EXISTS "fulfillment_snapshot" JSONB;

DROP TRIGGER IF EXISTS "order_design_snapshots_immutable" ON "order_design_snapshots";

UPDATE "order_design_snapshots"
SET "fulfillment_snapshot" = jsonb_build_object(
  'status', 'IN_STOCK',
  'estimatedRestockDays', 0,
  'lines', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'productId', item->>'productId',
      'requestedQuantity', (item->>'quantity')::integer,
      'reservedQuantity', (item->>'quantity')::integer,
      'backorderQuantity', 0,
      'status', 'IN_STOCK',
      'estimatedRestockDays', 0
    )), '[]'::jsonb)
    FROM jsonb_array_elements("production_snapshot"->'billOfMaterials') AS item
  )
);

ALTER TABLE "order_design_snapshots"
ALTER COLUMN "fulfillment_snapshot" SET NOT NULL;

CREATE TRIGGER "order_design_snapshots_immutable"
BEFORE UPDATE OR DELETE ON "order_design_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_row_change();
