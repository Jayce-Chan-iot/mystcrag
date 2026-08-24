import { ORDER_SNAPSHOT_VERSION } from "../constants/versions";
import type { DesignV1 } from "../schemas/design.schema";
import type { OrderFulfillmentSnapshotV1 } from "../schemas/order-fulfillment.schema";
import {
  OrderDesignSnapshotV1Schema,
  type OrderDesignSnapshotV1
} from "../schemas/order-snapshot.schema";
import { toPublicDesign } from "./to-public-design";

export function toOrderSnapshot(
  design: DesignV1,
  capturedAt: string,
  fulfillment: OrderFulfillmentSnapshotV1 = {
    status: "IN_STOCK",
    estimatedRestockDays: 0,
    lines: design.production.billOfMaterials.map((item) => ({
      productId: item.productId,
      requestedQuantity: item.quantity,
      reservedQuantity: item.quantity,
      backorderQuantity: 0,
      status: "IN_STOCK",
      estimatedRestockDays: 0
    }))
  }
): OrderDesignSnapshotV1 {
  return OrderDesignSnapshotV1Schema.parse({
    snapshotVersion: ORDER_SNAPSHOT_VERSION,
    capturedAt,
    design: toPublicDesign(design),
    fulfillment
  });
}
