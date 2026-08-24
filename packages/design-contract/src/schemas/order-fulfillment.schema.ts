import { z } from "zod";

import { IdentifierSchema, NonNegativeSafeIntegerSchema, PositiveSafeIntegerSchema } from "./component.schema";

export const RESTOCK_ESTIMATE_DAYS = 5 as const;

export const OrderFulfillmentLineV1Schema = z.strictObject({
  productId: IdentifierSchema,
  requestedQuantity: PositiveSafeIntegerSchema,
  reservedQuantity: NonNegativeSafeIntegerSchema,
  backorderQuantity: NonNegativeSafeIntegerSchema,
  status: z.enum(["IN_STOCK", "PARTIALLY_BACKORDERED", "BACKORDERED"]),
  estimatedRestockDays: NonNegativeSafeIntegerSchema
}).superRefine((line, context) => {
  if (line.reservedQuantity + line.backorderQuantity !== line.requestedQuantity) {
    context.addIssue({ code: "custom", path: ["requestedQuantity"], message: "Fulfillment quantities must equal requested quantity" });
  }
  const expectedStatus = line.backorderQuantity === 0
    ? "IN_STOCK"
    : line.reservedQuantity === 0 ? "BACKORDERED" : "PARTIALLY_BACKORDERED";
  if (line.status !== expectedStatus) {
    context.addIssue({ code: "custom", path: ["status"], message: "Fulfillment line status does not match quantities" });
  }
  const expectedDays = line.backorderQuantity > 0 ? RESTOCK_ESTIMATE_DAYS : 0;
  if (line.estimatedRestockDays !== expectedDays) {
    context.addIssue({ code: "custom", path: ["estimatedRestockDays"], message: "Restock estimate does not match fulfillment status" });
  }
});

export const OrderFulfillmentSnapshotV1Schema = z.strictObject({
  status: z.enum(["IN_STOCK", "AWAITING_RESTOCK"]),
  estimatedRestockDays: NonNegativeSafeIntegerSchema,
  lines: z.array(OrderFulfillmentLineV1Schema).min(1)
}).superRefine((snapshot, context) => {
  const requiresRestock = snapshot.lines.some((line) => line.backorderQuantity > 0);
  if (snapshot.status !== (requiresRestock ? "AWAITING_RESTOCK" : "IN_STOCK")) {
    context.addIssue({ code: "custom", path: ["status"], message: "Fulfillment status does not match lines" });
  }
  if (snapshot.estimatedRestockDays !== (requiresRestock ? RESTOCK_ESTIMATE_DAYS : 0)) {
    context.addIssue({ code: "custom", path: ["estimatedRestockDays"], message: "Restock estimate does not match lines" });
  }
});

export type OrderFulfillmentLineV1 = z.infer<typeof OrderFulfillmentLineV1Schema>;
export type OrderFulfillmentSnapshotV1 = z.infer<typeof OrderFulfillmentSnapshotV1Schema>;
