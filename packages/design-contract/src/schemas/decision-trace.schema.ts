import { z } from "zod";

import { ContractWarningSchema } from "./api-dto.schema";
import { IdentifierSchema, PositiveSafeIntegerSchema } from "./component.schema";
import { IsoDateTimeSchema } from "./metadata.schema";

export const LayoutStrategySchema = z.enum([
  "SYMMETRIC_BALANCE",
  "CENTER_FOCAL",
  "REPEAT_RHYTHM",
  "LOW_CONTRAST_FLOW"
]);

const ScoreRangeSchema = z.number().min(0).max(100);

export const DesignScoreSchema = z.strictObject({
  colorScore: ScoreRangeSchema,
  materialScore: ScoreRangeSchema,
  styleScore: ScoreRangeSchema,
  compositionScore: ScoreRangeSchema,
  constraintScore: ScoreRangeSchema,
  overallScore: ScoreRangeSchema,
  formulaVersion: IdentifierSchema
});

export const DesignDecisionTraceSchema = z.strictObject({
  traceId: IdentifierSchema,
  designId: IdentifierSchema,
  revision: PositiveSafeIntegerSchema,
  knowledgeVersion: IdentifierSchema,
  productCatalogVersion: IdentifierSchema,
  decisionRuleSetVersion: IdentifierSchema,
  layoutStrategy: LayoutStrategySchema,
  activeRuleIds: z.array(IdentifierSchema).max(500).default([]),
  knowledgeRefs: z.array(IdentifierSchema).max(500).default([]),
  contextRefs: z.array(IdentifierSchema).max(100).default([]),
  scores: DesignScoreSchema,
  warnings: z.array(ContractWarningSchema).default([]),
  createdAt: IsoDateTimeSchema
});

export type LayoutStrategy = z.infer<typeof LayoutStrategySchema>;
export type DesignScore = z.infer<typeof DesignScoreSchema>;
export type DesignDecisionTrace = z.infer<typeof DesignDecisionTraceSchema>;
