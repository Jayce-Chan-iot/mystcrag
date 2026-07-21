import { z } from "zod";

import { IdentifierSchema } from "./component.schema";

const NullableIdentifierSchema = IdentifierSchema.nullable();

export const GeneratedBySchema = z.enum(["USER", "AI", "AI_AND_USER", "TEMPLATE"]);

export const ProvenanceV1Schema = z.strictObject({
  generatedBy: GeneratedBySchema,
  modelProvider: NullableIdentifierSchema,
  modelName: NullableIdentifierSchema,
  promptVersion: NullableIdentifierSchema,
  knowledgeBaseVersion: NullableIdentifierSchema,
  designTemplateVersion: NullableIdentifierSchema,
  pricingRuleVersion: IdentifierSchema,
  sourceDesignId: NullableIdentifierSchema
});

export type ProvenanceV1 = z.infer<typeof ProvenanceV1Schema>;
