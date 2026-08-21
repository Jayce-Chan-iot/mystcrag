import { z } from "zod";

import { TaxonomyRefSchema } from "../taxonomy";
import {
  IdentifierSchema,
  NonEmptyTextSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";
import { JsonValueSchema } from "./json.schema";
import {
  ExtractionMetadataSchema,
  KnowledgeSourceTypeSchema,
  KnowledgeStatusSchema,
  KnowledgeTypeSchema,
  SourceCategorySchema,
  SourceContentTypeSchema,
  SourceCrawlStrategySchema,
  SourceFetchFailureSchema,
  SourceReliabilitySchema,
  SourceReviewStatusSchema
} from "./knowledge.schema";
import { IsoDateTimeSchema, LocaleSchema } from "./metadata.schema";

/**
 * Knowledge Admin API DTOs (Quality Phase Q3). The admin surface projects
 * only what a reviewer needs — never raw stored rows — and shares the
 * review service with the CLI so both entrances behave identically.
 */
const NonNegativeIntegerSchema = z.number().int().min(0);

export const KnowledgeAdminRuleCountsSchema = z.strictObject({
  NEW: NonNegativeIntegerSchema,
  EXTRACTED: NonNegativeIntegerSchema,
  VALIDATED: NonNegativeIntegerSchema,
  NEEDS_REVIEW: NonNegativeIntegerSchema,
  APPROVED: NonNegativeIntegerSchema,
  REJECTED: NonNegativeIntegerSchema,
  CONFLICTED: NonNegativeIntegerSchema,
  SUPERSEDED: NonNegativeIntegerSchema
});

export const KnowledgeAdminSourceCountsSchema = z.strictObject({
  DISCOVERED: NonNegativeIntegerSchema,
  NEEDS_REVIEW: NonNegativeIntegerSchema,
  APPROVED: NonNegativeIntegerSchema,
  REJECTED: NonNegativeIntegerSchema,
  DISABLED: NonNegativeIntegerSchema,
  enabled: NonNegativeIntegerSchema
});

export const KnowledgeAdminVersionSummarySchema = z.strictObject({
  id: IdentifierSchema,
  version: NonEmptyTextSchema,
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  ruleCount: NonNegativeIntegerSchema,
  publishedAt: IsoDateTimeSchema.nullable()
});

export const KnowledgeAdminOverviewResponseSchema = z.strictObject({
  rules: KnowledgeAdminRuleCountsSchema,
  sources: KnowledgeAdminSourceCountsSchema,
  conflictGroups: NonNegativeIntegerSchema,
  latestVersion: KnowledgeAdminVersionSummarySchema.nullable()
});

export const KnowledgeAdminReviewEvidenceSchema = z.strictObject({
  source: z.strictObject({
    id: IdentifierSchema,
    name: NonEmptyTextSchema,
    sourceType: KnowledgeSourceTypeSchema,
    sourceCategory: SourceCategorySchema,
    authorityScore: z.number().min(0).max(1),
    reliabilityLevel: SourceReliabilitySchema,
    enabled: z.boolean()
  }),
  document: z
    .strictObject({
      id: IdentifierSchema,
      title: NonEmptyTextSchema,
      url: z.url(),
      fetchedAt: IsoDateTimeSchema
    })
    .nullable()
});

export const KnowledgeAdminQueueItemSchema = z.strictObject({
  ruleId: IdentifierSchema,
  status: KnowledgeStatusSchema,
  knowledgeType: KnowledgeTypeSchema,
  knowledgeDomain: TaxonomyRefSchema("KNOWLEDGE_DOMAIN"),
  subject: IdentifierSchema,
  relation: IdentifierSchema,
  confidence: z.number().min(0).max(1),
  validation: z.strictObject({
    valid: z.boolean(),
    issues: z.array(NonEmptyTextSchema)
  }),
  evidence: z.array(KnowledgeAdminReviewEvidenceSchema),
  extraction: ExtractionMetadataSchema.nullable(),
  payload: JsonValueSchema
});

export const KnowledgeAdminReviewQueueResponseSchema = z.strictObject({
  items: z.array(KnowledgeAdminQueueItemSchema),
  total: NonNegativeIntegerSchema
});

export const KnowledgeAdminConflictRuleSchema = z.strictObject({
  ruleId: IdentifierSchema,
  status: KnowledgeStatusSchema,
  confidence: z.number().min(0).max(1),
  payload: JsonValueSchema
});

export const KnowledgeAdminConflictGroupSchema = z.strictObject({
  key: z.strictObject({
    knowledgeType: KnowledgeTypeSchema,
    subject: IdentifierSchema,
    relation: IdentifierSchema
  }),
  rules: z.array(KnowledgeAdminConflictRuleSchema).min(2)
});

export const KnowledgeAdminConflictsResponseSchema = z.strictObject({
  groups: z.array(KnowledgeAdminConflictGroupSchema)
});

export const KnowledgeAdminPipelineResponseSchema = z.strictObject({
  extracted: NonNegativeIntegerSchema,
  validated: NonNegativeIntegerSchema,
  needsReview: NonNegativeIntegerSchema,
  conflicted: NonNegativeIntegerSchema
});

export const KnowledgeAdminRuleActionParamsSchema = z.strictObject({
  ruleId: IdentifierSchema
});

export const KnowledgeAdminRuleActionResponseSchema = z.strictObject({
  ruleId: IdentifierSchema,
  status: KnowledgeStatusSchema
});

export const KnowledgeAdminPublishVersionRequestSchema = z.strictObject({
  version: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9.\-_]*$/, "Version must be a slug like 2026-08-v2")
});

export const KnowledgeAdminPublishVersionResponseSchema =
  KnowledgeAdminVersionSummarySchema;

export const KnowledgeAdminSourceQueueItemSchema = z.strictObject({
  id: IdentifierSchema,
  name: NonEmptyTextSchema,
  sourceType: KnowledgeSourceTypeSchema,
  sourceCategory: SourceCategorySchema,
  contentType: SourceContentTypeSchema,
  reliabilityLevel: SourceReliabilitySchema,
  reviewStatus: SourceReviewStatusSchema,
  enabled: z.boolean(),
  authorityScore: z.number().min(0).max(1),
  allowedKnowledgeDomains: z.array(TaxonomyRefSchema("KNOWLEDGE_DOMAIN")).min(1),
  language: LocaleSchema,
  lastSuccessfulFetch: IsoDateTimeSchema.optional(),
  lastFailure: SourceFetchFailureSchema.optional(),
  rateLimit: z
    .strictObject({ maxRequestsPerMinute: PositiveSafeIntegerSchema })
    .optional(),
  crawlStrategy: SourceCrawlStrategySchema.optional()
});

export const KnowledgeAdminSourceQueueResponseSchema = z.strictObject({
  items: z.array(KnowledgeAdminSourceQueueItemSchema),
  total: NonNegativeIntegerSchema
});

export const KnowledgeAdminSourceActionParamsSchema = z.strictObject({
  sourceId: IdentifierSchema
});

export const KnowledgeAdminReviewSourceRequestSchema = z.strictObject({
  reviewStatus: z.enum(["NEEDS_REVIEW", "APPROVED", "REJECTED"])
});

export const KnowledgeAdminSetSourceEnabledRequestSchema = z.strictObject({
  enabled: z.boolean()
});

export const KnowledgeAdminUpdateSourcePolicyRequestSchema = z
  .strictObject({
    allowedKnowledgeDomains: z
      .array(TaxonomyRefSchema("KNOWLEDGE_DOMAIN"))
      .min(1)
      .optional(),
    maxRequestsPerMinute: PositiveSafeIntegerSchema.max(600).optional()
  })
  .refine(
    (request) =>
      request.allowedKnowledgeDomains !== undefined ||
      request.maxRequestsPerMinute !== undefined,
    { message: "At least one policy field is required" }
  );

export const KnowledgeAdminSourceMutationResponseSchema = z.strictObject({
  sourceId: IdentifierSchema,
  reviewStatus: SourceReviewStatusSchema,
  enabled: z.boolean()
});

export type KnowledgeAdminOverview = z.infer<typeof KnowledgeAdminOverviewResponseSchema>;
export type KnowledgeAdminReviewQueueResponse = z.infer<
  typeof KnowledgeAdminReviewQueueResponseSchema
>;
export type KnowledgeAdminQueueItem = z.infer<typeof KnowledgeAdminQueueItemSchema>;
export type KnowledgeAdminConflictsResponse = z.infer<
  typeof KnowledgeAdminConflictsResponseSchema
>;
export type KnowledgeAdminPipelineResponse = z.infer<
  typeof KnowledgeAdminPipelineResponseSchema
>;
export type KnowledgeAdminRuleActionResponse = z.infer<
  typeof KnowledgeAdminRuleActionResponseSchema
>;
export type KnowledgeAdminPublishVersionResponse = z.infer<
  typeof KnowledgeAdminPublishVersionResponseSchema
>;
export type KnowledgeAdminSourceQueueResponse = z.infer<
  typeof KnowledgeAdminSourceQueueResponseSchema
>;
export type KnowledgeAdminSourceMutationResponse = z.infer<
  typeof KnowledgeAdminSourceMutationResponseSchema
>;
