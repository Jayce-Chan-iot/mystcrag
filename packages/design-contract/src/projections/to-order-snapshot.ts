import { ORDER_SNAPSHOT_VERSION } from "../constants/versions";
import type { DesignV1 } from "../schemas/design.schema";
import {
  OrderDesignSnapshotV1Schema,
  type OrderDesignSnapshotV1
} from "../schemas/order-snapshot.schema";
import { toPublicDesign } from "./to-public-design";

export function toOrderSnapshot(
  design: DesignV1,
  capturedAt: string
): OrderDesignSnapshotV1 {
  return OrderDesignSnapshotV1Schema.parse({
    snapshotVersion: ORDER_SNAPSHOT_VERSION,
    capturedAt,
    design: toPublicDesign(design)
  });
}
