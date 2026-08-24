import { z } from "zod";

import { ORDER_SNAPSHOT_VERSION } from "../constants/versions";
import { IsoDateTimeSchema } from "./metadata.schema";
import { PublicDesignV1Schema } from "./public-design.schema";
import { OrderFulfillmentSnapshotV1Schema } from "./order-fulfillment.schema";

export const OrderDesignSnapshotV1Schema = z
  .strictObject({
    snapshotVersion: z.literal(ORDER_SNAPSHOT_VERSION),
    capturedAt: IsoDateTimeSchema,
    design: PublicDesignV1Schema,
    fulfillment: OrderFulfillmentSnapshotV1Schema
  })
  .superRefine((snapshot, context) => {
    if (snapshot.design.compliance.complianceStatus === "REJECTED") {
      context.addIssue({
        code: "custom",
        message: "REJECTED designs cannot create order snapshots",
        path: ["design", "compliance", "complianceStatus"]
      });
    }
  });

export type OrderDesignSnapshotV1 = z.infer<typeof OrderDesignSnapshotV1Schema>;
