import { z } from "zod";

import { TaxonomyRefSchema } from "../taxonomy";
import {
  IdentifierSchema,
  NonEmptyTextSchema,
  PositiveSafeIntegerSchema
} from "./component.schema";
import { JsonValueSchema } from "./json.schema";
import {
  ClaimTypeSchema,
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
  /** Total stored knowledge documents across all sources (Console V1 overview). */
  documents: NonNegativeIntegerSchema,
  /** External (non-fixture) rules still in a candidate status. */
  externalCandidates: NonNegativeIntegerSchema,
  /** APPROVED rules carrying at least one external source ref (Batch B KPI). */
  externalApprovedRules: NonNegativeIntegerSchema,
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
  claimType: ClaimTypeSchema.nullable(),
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
  conflicted: NonNegativeIntegerSchema,
  merged: NonNegativeIntegerSchema
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

/**
 * Knowledge Console V1 DTOs (Track B). Coverage, source yield, the crystal
 * atlas, and collection runs all read the live database — never a committed
 * JSON report — and project exactly the fields the console pages render.
 */
export const KnowledgeAdminCoverageTermSchema = z.strictObject({
  id: IdentifierSchema,
  displayName: z.strictObject({
    zh: NonEmptyTextSchema,
    en: NonEmptyTextSchema
  })
});

export const KnowledgeAdminCoverageDomainSchema = z.strictObject({
  domain: NonEmptyTextSchema,
  target: NonNegativeIntegerSchema,
  current: NonNegativeIntegerSchema,
  missing: NonNegativeIntegerSchema,
  percentage: z.number().min(0).max(1),
  coveredTaxonomyTerms: z.array(KnowledgeAdminCoverageTermSchema),
  missingTaxonomyTerms: z.array(KnowledgeAdminCoverageTermSchema)
});

export const KnowledgeAdminCoverageResponseSchema = z.strictObject({
  domains: z.array(KnowledgeAdminCoverageDomainSchema)
});

export const KnowledgeAdminSourceStatsItemSchema = z.strictObject({
  sourceId: IdentifierSchema,
  name: NonEmptyTextSchema,
  sourceType: KnowledgeSourceTypeSchema,
  sourceCategory: SourceCategorySchema,
  authorityScore: z.number().min(0).max(1),
  reliabilityLevel: SourceReliabilitySchema,
  reviewStatus: SourceReviewStatusSchema,
  enabled: z.boolean(),
  documents: NonNegativeIntegerSchema,
  candidateCount: NonNegativeIntegerSchema,
  approvedRuleCount: NonNegativeIntegerSchema,
  lastFetch: IsoDateTimeSchema.nullable(),
  failureCount: NonNegativeIntegerSchema,
  yield: z.number().min(0)
});

export const KnowledgeAdminSourceStatsResponseSchema = z.strictObject({
  items: z.array(KnowledgeAdminSourceStatsItemSchema),
  total: NonNegativeIntegerSchema
});

export const KnowledgeAdminAtlasRowSchema = z.strictObject({
  crystalId: IdentifierSchema,
  displayName: z.strictObject({
    zh: NonEmptyTextSchema,
    en: NonEmptyTextSchema
  }),
  gemologyCompleteness: z.number().min(0).max(1),
  visualCompleteness: z.number().min(0).max(1),
  culturalCompleteness: z.number().min(0).max(1),
  associationCount: NonNegativeIntegerSchema,
  conflictCount: NonNegativeIntegerSchema
});

export const KnowledgeAdminAtlasResponseSchema = z.strictObject({
  items: z.array(KnowledgeAdminAtlasRowSchema),
  total: NonNegativeIntegerSchema
});

export const KnowledgeAdminAtlasDetailPropertySchema = z.strictObject({
  property: NonEmptyTextSchema,
  value: NonEmptyTextSchema,
  knowledgeDomain: TaxonomyRefSchema("KNOWLEDGE_DOMAIN"),
  ruleId: IdentifierSchema,
  status: KnowledgeStatusSchema,
  confidence: z.number().min(0).max(1),
  sourceIds: z.array(IdentifierSchema)
});

export const KnowledgeAdminAtlasDetailRelationSchema = z.strictObject({
  relation: IdentifierSchema,
  knowledgeDomain: TaxonomyRefSchema("KNOWLEDGE_DOMAIN"),
  ruleId: IdentifierSchema,
  status: KnowledgeStatusSchema,
  confidence: z.number().min(0).max(1),
  payload: JsonValueSchema,
  sourceIds: z.array(IdentifierSchema)
});

export const KnowledgeAdminAtlasDetailResponseSchema = z.strictObject({
  row: KnowledgeAdminAtlasRowSchema,
  properties: z.array(KnowledgeAdminAtlasDetailPropertySchema),
  relations: z.array(KnowledgeAdminAtlasDetailRelationSchema),
  sources: z.array(
    z.strictObject({
      sourceId: IdentifierSchema,
      ruleCount: NonNegativeIntegerSchema
    })
  )
});

export const KnowledgeAdminAtlasDetailParamsSchema = z.strictObject({
  crystalId: IdentifierSchema
});

export const KnowledgeAdminCollectionRunErrorSchema = z.strictObject({
  sourceId: NonEmptyTextSchema,
  message: NonEmptyTextSchema
});

export const KnowledgeAdminCollectionRunSourceResultSchema = z.strictObject({
  sourceId: NonEmptyTextSchema,
  documentsAdded: NonNegativeIntegerSchema,
  duplicateDocuments: NonNegativeIntegerSchema,
  candidatesInserted: NonNegativeIntegerSchema,
  corroboratedCandidates: NonNegativeIntegerSchema,
  duplicateCandidates: NonNegativeIntegerSchema
});

export const KnowledgeAdminCollectionRunSchema = z.strictObject({
  id: IdentifierSchema,
  status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  sourcesCrawled: NonNegativeIntegerSchema,
  documentsAdded: NonNegativeIntegerSchema,
  documentDuplicates: NonNegativeIntegerSchema,
  candidatesInserted: NonNegativeIntegerSchema,
  corroboratedCandidates: NonNegativeIntegerSchema,
  candidateDuplicates: NonNegativeIntegerSchema,
  needsReview: NonNegativeIntegerSchema,
  conflicts: NonNegativeIntegerSchema,
  errors: z.array(KnowledgeAdminCollectionRunErrorSchema),
  sourceResults: z.array(KnowledgeAdminCollectionRunSourceResultSchema)
});

export const KnowledgeAdminCollectionRunsResponseSchema = z.strictObject({
  items: z.array(KnowledgeAdminCollectionRunSchema),
  total: NonNegativeIntegerSchema
});

export const KnowledgeAdminEditRuleRequestSchema = z
  .strictObject({
    confidence: z.number().min(0).max(1).optional(),
    claimType: ClaimTypeSchema.nullable().optional()
  })
  .refine(
    (request) => request.confidence !== undefined || request.claimType !== undefined,
    { message: "At least one of confidence or claimType is required" }
  );

export const KnowledgeAdminEditRuleResponseSchema = z.strictObject({
  ruleId: IdentifierSchema,
  status: KnowledgeStatusSchema,
  confidence: z.number().min(0).max(1),
  claimType: ClaimTypeSchema.nullable()
});

export type KnowledgeAdminCoverageResponse = z.infer<
  typeof KnowledgeAdminCoverageResponseSchema
>;
export type KnowledgeAdminCoverageDomain = z.infer<
  typeof KnowledgeAdminCoverageDomainSchema
>;
export type KnowledgeAdminSourceStatsResponse = z.infer<
  typeof KnowledgeAdminSourceStatsResponseSchema
>;
export type KnowledgeAdminAtlasResponse = z.infer<typeof KnowledgeAdminAtlasResponseSchema>;
export type KnowledgeAdminAtlasDetailResponse = z.infer<
  typeof KnowledgeAdminAtlasDetailResponseSchema
>;
export type KnowledgeAdminCollectionRunsResponse = z.infer<
  typeof KnowledgeAdminCollectionRunsResponseSchema
>;
export type KnowledgeAdminEditRuleResponse = z.infer<
  typeof KnowledgeAdminEditRuleResponseSchema
>;
