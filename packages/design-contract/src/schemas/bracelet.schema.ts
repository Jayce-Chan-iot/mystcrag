import { z } from "zod";

import { MillimeterSchema, NonNegativeSafeIntegerSchema } from "./component.schema";

export const BraceletLayoutSchema = z.literal("CIRCLE");

export const BraceletV1Schema = z.strictObject({
  wristCircumferenceMm: MillimeterSchema.positive(),
  targetInnerCircumferenceMm: MillimeterSchema.positive(),
  elasticAllowanceMm: MillimeterSchema,
  braceletLayout: BraceletLayoutSchema,
  beadGapMm: MillimeterSchema,
  totalBeadCount: NonNegativeSafeIntegerSchema
});

export type BraceletV1 = z.infer<typeof BraceletV1Schema>;
