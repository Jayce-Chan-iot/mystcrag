import { z } from "zod";

import { TaxonomyRefSchema, VisualTaxonomyRefSchema } from "../taxonomy";
import { IdentifierSchema, NonNegativeSafeIntegerSchema } from "./component.schema";
import { CurrencySchema, LocaleSchema } from "./metadata.schema";

export const ContextSourceSchema = z.strictObject({
  sourceType: TaxonomyRefSchema("CONTEXT_SOURCE"),
  weight: z.number().min(0).max(1).default(1),
  refId: IdentifierSchema.optional()
});

export const ContextHardConstraintsSchema = z.strictObject({
  wristCircumferenceMm: z.number().finite().positive(),
  targetInnerCircumferenceMm: z.number().finite().positive().optional(),
  maxBudgetMinor: NonNegativeSafeIntegerSchema.optional(),
  requiredProductIds: z.array(IdentifierSchema).max(50).default([]),
  excludedProductIds: z.array(IdentifierSchema).max(50).default([]),
  mustKeepComponentIds: z.array(IdentifierSchema).max(50).default([])
});

export const ContextPreferencesSchema = z.strictObject({
  emotionTags: z.array(TaxonomyRefSchema("EMOTION")).max(12).default([]),
  styleTags: z.array(TaxonomyRefSchema("STYLE")).max(12).default([]),
  colorPreferences: z.array(TaxonomyRefSchema("COLOR")).max(12).default([]),
  visualPreferences: z.array(VisualTaxonomyRefSchema).max(12).default([])
});

export const ContextAvoidancesSchema = z
  .strictObject({
    materialIds: z.array(TaxonomyRefSchema("MATERIAL")).max(12).default([]),
    colorFamilyIds: z.array(TaxonomyRefSchema("COLOR")).max(12).default([])
  })
  .default({ materialIds: [], colorFamilyIds: [] });

export const RecommendationContextSchema = z.strictObject({
  contextId: IdentifierSchema,
  locale: LocaleSchema,
  currency: CurrencySchema,
  sources: z.array(ContextSourceSchema).min(1).max(4),
  hardConstraints: ContextHardConstraintsSchema,
  preferences: ContextPreferencesSchema.default({
    emotionTags: [],
    styleTags: [],
    colorPreferences: [],
    visualPreferences: []
  }),
  avoidances: ContextAvoidancesSchema.default({ materialIds: [], colorFamilyIds: [] }),
  contextWeights: z
    .record(z.string().trim().min(1).max(160), z.number().min(0).max(1))
    .default({})
});

export type ContextSource = z.infer<typeof ContextSourceSchema>;
export type ContextHardConstraints = z.infer<typeof ContextHardConstraintsSchema>;
export type ContextPreferences = z.infer<typeof ContextPreferencesSchema>;
export type ContextAvoidances = z.infer<typeof ContextAvoidancesSchema>;
export type RecommendationContext = z.infer<typeof RecommendationContextSchema>;
