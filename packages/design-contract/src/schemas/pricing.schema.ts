import { z } from "zod";

import {
  IdentifierSchema,
  MinorAmountSchema,
  NonEmptyTextSchema,
  SignedMinorAmountSchema
} from "./component.schema";
import { IsoDateTimeSchema } from "./metadata.schema";

export const PricingAdjustmentSchema = z.strictObject({
  adjustmentId: IdentifierSchema,
  label: NonEmptyTextSchema,
  amountMinor: SignedMinorAmountSchema,
  reasonCode: IdentifierSchema
});

export const PricingV1Schema = z
  .strictObject({
    materialSubtotalMinor: MinorAmountSchema,
    accessorySubtotalMinor: MinorAmountSchema,
    laborFeeMinor: MinorAmountSchema,
    designFeeMinor: MinorAmountSchema,
    packagingFeeMinor: MinorAmountSchema,
    platformFeeEstimateMinor: MinorAmountSchema,
    logisticsFeeEstimateMinor: MinorAmountSchema,
    discountMinor: MinorAmountSchema,
    adjustments: z.array(PricingAdjustmentSchema).default([]),
    totalPriceMinor: MinorAmountSchema,
    pricingVersion: IdentifierSchema,
    priceCalculatedAt: IsoDateTimeSchema
  })
  .superRefine((pricing, context) => {
    const adjustmentTotal = pricing.adjustments.reduce(
      (total, adjustment) => total + adjustment.amountMinor,
      0
    );
    const expectedTotal =
      pricing.materialSubtotalMinor +
      pricing.accessorySubtotalMinor +
      pricing.laborFeeMinor +
      pricing.designFeeMinor +
      pricing.packagingFeeMinor +
      pricing.platformFeeEstimateMinor +
      pricing.logisticsFeeEstimateMinor -
      pricing.discountMinor +
      adjustmentTotal;

    if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0) {
      context.addIssue({
        code: "custom",
        message: "Calculated total price must be a non-negative safe integer",
        path: ["totalPriceMinor"]
      });
      return;
    }

    if (pricing.totalPriceMinor !== expectedTotal) {
      context.addIssue({
        code: "custom",
        message: `totalPriceMinor must equal ${expectedTotal}`,
        path: ["totalPriceMinor"]
      });
    }
  });

export type PricingAdjustment = z.infer<typeof PricingAdjustmentSchema>;
export type PricingV1 = z.infer<typeof PricingV1Schema>;
