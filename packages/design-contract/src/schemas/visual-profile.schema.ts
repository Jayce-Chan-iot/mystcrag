import { z } from "zod";

import { TaxonomyRefSchema } from "../taxonomy";
import { MillimeterSchema } from "./component.schema";

export const VisualLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const VisualProfileSchema = z.strictObject({
  colorFamily: TaxonomyRefSchema("COLOR"),
  secondaryColorFamily: TaxonomyRefSchema("COLOR").optional(),
  saturationLevel: TaxonomyRefSchema("SATURATION_LEVEL"),
  lightnessLevel: TaxonomyRefSchema("LIGHTNESS_LEVEL"),
  temperature: TaxonomyRefSchema("TEMPERATURE"),
  transparency: TaxonomyRefSchema("TRANSPARENCY"),
  luster: TaxonomyRefSchema("LUSTER"),
  visualWeight: VisualLevelSchema,
  uniformity: VisualLevelSchema,
  textureComplexity: VisualLevelSchema
});

export type VisualLevel = z.infer<typeof VisualLevelSchema>;
export type VisualProfile = z.infer<typeof VisualProfileSchema>;

export const LengthAlongStringSchema = MillimeterSchema.positive();
