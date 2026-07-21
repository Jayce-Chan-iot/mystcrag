import { z } from "zod";

import {
  ComponentIdSchema,
  IdentifierSchema,
  MillimeterSchema,
  MinorAmountSchema,
  PositionIndexSchema
} from "./component.schema";

export const BeadShapeSchema = z.enum(["ROUND", "OVAL", "FACETED", "BAROQUE"]);
export const BeadRoleSchema = z.enum(["MAIN", "ACCENT", "FOCAL"]);

export const BeadV1Schema = z.strictObject({
  componentId: ComponentIdSchema,
  positionIndex: PositionIndexSchema,
  beadProductId: IdentifierSchema,
  crystalId: IdentifierSchema,
  materialKey: IdentifierSchema,
  shape: BeadShapeSchema,
  diameterMm: MillimeterSchema.positive(),
  quantity: z.literal(1),
  role: BeadRoleSchema,
  modelAssetKey: IdentifierSchema,
  textureAssetKey: IdentifierSchema,
  unitPriceMinor: MinorAmountSchema
});

export type BeadV1 = z.infer<typeof BeadV1Schema>;
