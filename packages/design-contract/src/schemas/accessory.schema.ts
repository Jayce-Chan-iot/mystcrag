import { z } from "zod";

import {
  ComponentIdSchema,
  IdentifierSchema,
  MillimeterSchema,
  MinorAmountSchema,
  NonNegativeSafeIntegerSchema,
  PositionIndexSchema
} from "./component.schema";

export const AccessoryTypeSchema = z.enum(["SPACER", "PENDANT", "METAL_PART", "CONNECTOR"]);

export const AccessoryDimensionsSchema = z
  .strictObject({
    widthMm: MillimeterSchema.positive().optional(),
    heightMm: MillimeterSchema.positive().optional(),
    depthMm: MillimeterSchema.positive().optional(),
    diameterMm: MillimeterSchema.positive().optional()
  })
  .refine((dimensions) => Object.values(dimensions).some((value) => value !== undefined), {
    message: "At least one accessory dimension is required"
  });

const AccessoryBaseShape = {
  componentId: ComponentIdSchema,
  accessoryType: AccessoryTypeSchema,
  accessoryProductId: IdentifierSchema,
  material: IdentifierSchema,
  finish: IdentifierSchema,
  dimensions: AccessoryDimensionsSchema,
  quantity: z.literal(1),
  unitPriceMinor: MinorAmountSchema,
  modelAssetKey: IdentifierSchema,
  textureAssetKey: IdentifierSchema.optional()
} as const;

export const InlineAccessoryV1Schema = z.strictObject({
  ...AccessoryBaseShape,
  placementMode: z.literal("INLINE"),
  positionIndex: PositionIndexSchema,
  anchorComponentId: z.null().optional(),
  anchorSlot: z.null().optional()
});

export const AnchoredAccessoryV1Schema = z.strictObject({
  ...AccessoryBaseShape,
  placementMode: z.literal("ANCHORED"),
  positionIndex: z.null().optional(),
  anchorComponentId: ComponentIdSchema,
  anchorSlot: NonNegativeSafeIntegerSchema.default(0)
});

export const AccessoryV1Schema = z
  .discriminatedUnion("placementMode", [InlineAccessoryV1Schema, AnchoredAccessoryV1Schema])
  .superRefine((accessory, context) => {
    if (accessory.accessoryType === "PENDANT" && accessory.placementMode !== "ANCHORED") {
      context.addIssue({
        code: "custom",
        message: "PENDANT accessories must use ANCHORED placement",
        path: ["placementMode"]
      });
    }
  });

export type InlineAccessoryV1 = z.infer<typeof InlineAccessoryV1Schema>;
export type AnchoredAccessoryV1 = z.infer<typeof AnchoredAccessoryV1Schema>;
export type AccessoryV1 = z.infer<typeof AccessoryV1Schema>;
