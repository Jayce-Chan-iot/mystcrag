import { z } from "zod";

import {
  ContractWarningSchema,
  UpdateDesignOperationSchema
} from "./api-dto.schema";
import {
  IdentifierSchema,
  MillimeterSchema,
  MinorAmountSchema,
  NonEmptyTextSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";
import {
  DesignDecisionTraceSchema,
  DesignScoreSchema,
  LayoutStrategySchema
} from "./decision-trace.schema";
import { CurrencySchema, LocaleSchema } from "./metadata.schema";
import { PublicDesignV1Schema } from "./public-design.schema";
import { RecommendationContextSchema } from "./recommendation-context.schema";

/**
 * EPIC 10 DTOs. The recommend request keeps the questionnaire projection of
 * GenerateDesignRequest (raw tags; the backend resolves them onto canonical
 * taxonomy ids via the Context Resolver) and additionally accepts an explicit
 * pre-resolved RecommendationContext for server-side callers (tarot pipeline,
 * MCP tools) that already hold one.
 */
export const RecommendDesignRequestSchema = z
  .strictObject({
    requestId: IdentifierSchema,
    locale: LocaleSchema,
    currency: CurrencySchema,
    wristCircumferenceMm: MillimeterSchema.positive(),
    targetInnerCircumferenceMm: MillimeterSchema.positive().optional(),
    emotionTags: z.array(IdentifierSchema).max(30),
    styleTags: z.array(IdentifierSchema).max(30),
    colorTags: z.array(IdentifierSchema).max(30),
    minBudgetMinor: MinorAmountSchema.optional(),
    maxBudgetMinor: MinorAmountSchema.optional(),
    excludedProductIds: z.array(IdentifierSchema).default([]),
    personalizationConsent: z.boolean().default(false),
    context: RecommendationContextSchema.optional()
  })
  .superRefine((request, context) => {
    if (
      request.minBudgetMinor !== undefined &&
      request.maxBudgetMinor !== undefined &&
      request.minBudgetMinor > request.maxBudgetMinor
    ) {
      context.addIssue({
        code: "custom",
        message: "minBudgetMinor cannot exceed maxBudgetMinor",
        path: ["minBudgetMinor"]
      });
    }
  });

export const RecommendedDesignCandidateSchema = z.strictObject({
  designId: IdentifierSchema,
  layoutStrategy: LayoutStrategySchema,
  score: DesignScoreSchema,
  design: PublicDesignV1Schema
});

export const RecommendDesignResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  candidates: z.array(RecommendedDesignCandidateSchema).max(3),
  warnings: z.array(ContractWarningSchema)
});

export const EvaluateDesignRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  designId: IdentifierSchema
});

export const EvaluateDesignResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  designId: IdentifierSchema,
  layoutStrategy: LayoutStrategySchema,
  scores: DesignScoreSchema,
  reasons: z.array(NonEmptyTextSchema).max(24),
  warnings: z.array(ContractWarningSchema)
});

export const DesignTraceResponseSchema = z.strictObject({
  designId: IdentifierSchema,
  trace: DesignDecisionTraceSchema.nullable()
});

export const MaterialSuggestionSchema = z.strictObject({
  material: z.strictObject({
    beadProductId: IdentifierSchema,
    displayName: NonEmptyTextSchema,
    colorTags: z.array(IdentifierSchema).max(12),
    styleTags: z.array(IdentifierSchema).max(12),
    materialKey: IdentifierSchema
  }),
  score: z.number().min(0).max(100),
  reason: NonEmptyTextSchema,
  knowledgeRefs: z.array(IdentifierSchema).max(32)
});

export const MaterialSuggestQuerySchema = z.strictObject({
  currency: CurrencySchema,
  locale: LocaleSchema.optional()
});

export const MaterialSuggestResponseSchema = z.strictObject({
  materialId: IdentifierSchema,
  currency: CurrencySchema,
  suggestions: z.array(MaterialSuggestionSchema).max(8)
});

export const OptimizeDesignRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  designId: IdentifierSchema,
  expectedRevision: PositiveSafeIntegerSchema,
  lockedComponentIds: z.array(IdentifierSchema).max(200).default([]),
  targetInnerCircumferenceMm: MillimeterSchema.positive().optional(),
  maxBudgetMinor: MinorAmountSchema.optional()
});

export const OptimizeDesignResponseSchema = z.strictObject({
  requestId: IdentifierSchema,
  design: PublicDesignV1Schema,
  layoutStrategy: LayoutStrategySchema,
  score: DesignScoreSchema,
  operations: z.array(UpdateDesignOperationSchema).max(600),
  reasons: z.array(NonEmptyTextSchema).max(24),
  warnings: z.array(ContractWarningSchema)
});

export type RecommendDesignRequest = z.infer<typeof RecommendDesignRequestSchema>;
export type RecommendDesignResponse = z.infer<typeof RecommendDesignResponseSchema>;
export type RecommendedDesignCandidate = z.infer<typeof RecommendedDesignCandidateSchema>;
export type EvaluateDesignRequest = z.infer<typeof EvaluateDesignRequestSchema>;
export type EvaluateDesignResponse = z.infer<typeof EvaluateDesignResponseSchema>;
export type DesignTraceResponse = z.infer<typeof DesignTraceResponseSchema>;
export type MaterialSuggestion = z.infer<typeof MaterialSuggestionSchema>;
export type MaterialSuggestResponse = z.infer<typeof MaterialSuggestResponseSchema>;
export type OptimizeDesignRequest = z.infer<typeof OptimizeDesignRequestSchema>;
export type OptimizeDesignResponse = z.infer<typeof OptimizeDesignResponseSchema>;
