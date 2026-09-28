import { z } from "zod";

import { IdentifierSchema } from "./component.schema";

const NullableIdentifierSchema = IdentifierSchema.nullable();

export const GeneratedBySchema = z.enum(["USER", "AI", "AI_AND_USER", "TEMPLATE"]);

export const TarotCandidateProvenanceSchema = z.strictObject({
  sessionId: IdentifierSchema,
  ruleVersion: IdentifierSchema,
  rank: z.number().int().min(1).max(3),
  direction: z.enum(["BALANCED", "CONTRAST", "NEUTRAL_LED"])
});

export const OracleCandidateDirectionSchema = z.enum(["BALANCED", "CONTRAST", "NEUTRAL_LED"]);

export const OracleCandidateProvenanceSchema = z.strictObject({
  sessionId: IdentifierSchema,
  ruleVersion: IdentifierSchema,
  rank: z.number().int().min(1).max(3),
  direction: OracleCandidateDirectionSchema
});

export const ProvenanceV1Schema = z.strictObject({
  generatedBy: GeneratedBySchema,
  modelProvider: NullableIdentifierSchema,
  modelName: NullableIdentifierSchema,
  promptVersion: NullableIdentifierSchema,
  knowledgeBaseVersion: NullableIdentifierSchema,
  designTemplateVersion: NullableIdentifierSchema,
  pricingRuleVersion: IdentifierSchema,
  sourceDesignId: NullableIdentifierSchema,
  tarotCandidate: TarotCandidateProvenanceSchema.optional(),
  oracleCandidate: OracleCandidateProvenanceSchema.optional()
});

export type ProvenanceV1 = z.infer<typeof ProvenanceV1Schema>;
export type OracleCandidateDirection = z.infer<typeof OracleCandidateDirectionSchema>;
export type OracleCandidateProvenance = z.infer<typeof OracleCandidateProvenanceSchema>;
