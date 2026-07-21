import { z } from "zod";

import { ComponentIdSchema, IdentifierSchema, MinorAmountSchema } from "./component.schema";
import { DesignV1Schema } from "./design.schema";

export const ComponentCostSchema = z.strictObject({
  componentId: ComponentIdSchema,
  unitCostMinor: MinorAmountSchema
});

export const InternalCommercialCostsV1Schema = z.strictObject({
  componentCosts: z.array(ComponentCostSchema),
  laborCostMinor: MinorAmountSchema,
  packagingCostMinor: MinorAmountSchema,
  supplierReference: IdentifierSchema.optional()
});

export const InternalCommercialDesignV1Schema = z
  .strictObject({
    design: DesignV1Schema,
    costs: InternalCommercialCostsV1Schema
  })
  .superRefine((commercialDesign, context) => {
    const componentIds = new Set([
      ...commercialDesign.design.beads.map((bead) => bead.componentId),
      ...commercialDesign.design.accessories.map((accessory) => accessory.componentId)
    ]);
    const costIds = commercialDesign.costs.componentCosts.map((cost) => cost.componentId);

    if (new Set(costIds).size !== costIds.length) {
      context.addIssue({
        code: "custom",
        message: "Commercial component costs must have unique componentId values",
        path: ["costs", "componentCosts"]
      });
    }

    commercialDesign.costs.componentCosts.forEach((cost, index) => {
      if (!componentIds.has(cost.componentId)) {
        context.addIssue({
          code: "custom",
          message: "Commercial costs must reference an existing design component",
          path: ["costs", "componentCosts", index, "componentId"]
        });
      }
    });
  });

export type InternalCommercialDesignV1 = z.infer<typeof InternalCommercialDesignV1Schema>;
