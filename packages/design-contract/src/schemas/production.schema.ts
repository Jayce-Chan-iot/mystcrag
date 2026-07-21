import { z } from "zod";

import {
  ComponentIdSchema,
  IdentifierSchema,
  MillimeterSchema,
  NonEmptyTextSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";

export const BillOfMaterialsItemSchema = z.strictObject({
  productId: IdentifierSchema,
  specification: NonEmptyTextSchema,
  quantity: PositiveSafeIntegerSchema,
  sourceComponentIds: z.array(ComponentIdSchema).min(1)
});

export const AnchoredProductionComponentSchema = z.strictObject({
  componentId: ComponentIdSchema,
  anchorComponentId: ComponentIdSchema,
  anchorSlot: z.number().int().safe().nonnegative()
});

export const SubstitutionRuleSchema = z.strictObject({
  sourceProductId: IdentifierSchema,
  candidateProductIds: z.array(IdentifierSchema).min(1),
  requiresUserConfirmation: z.boolean()
});

export const ProductionV1Schema = z.strictObject({
  wristCircumferenceMm: MillimeterSchema.positive(),
  billOfMaterials: z.array(BillOfMaterialsItemSchema),
  componentSequence: z.array(ComponentIdSchema),
  anchoredComponents: z.array(AnchoredProductionComponentSchema).default([]),
  productionNotes: z.array(NonEmptyTextSchema),
  substitutionRules: z.array(SubstitutionRuleSchema)
});

export type BillOfMaterialsItem = z.infer<typeof BillOfMaterialsItemSchema>;
export type ProductionV1 = z.infer<typeof ProductionV1Schema>;
