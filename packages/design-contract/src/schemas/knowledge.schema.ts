import { z } from "zod";

import { TaxonomyRefSchema } from "../taxonomy";
import { IdentifierSchema, PositiveSafeIntegerSchema } from "./component.schema";
import { IsoDateTimeSchema, LocaleSchema } from "./metadata.schema";
import { JsonValueSchema } from "./json.schema";

export const KnowledgeTypeSchema = z.enum([
  "COLOR_THEORY",
  "MATERIAL_COMPATIBILITY",
  "STYLE_RULE",
  "PROPORTION_RULE",
  "COMPOSITION_RULE",
  "TRANSITION_RULE",
  "FOCAL_RULE",
  "NEGATIVE_RULE",
  "CULTURAL_SYMBOLISM",
  "TAROT",
  "MARKET_OBSERVATION",
  "CRYSTAL_GEMOLOGY",
  "CRYSTAL_VISUAL_PROPERTIES",
  "CRYSTAL_CULTURAL_SYMBOLISM",
  "WUXING",
  "WUXING_CRYSTAL_ASSOCIATION",
  "ZODIAC",
  "ZODIAC_CRYSTAL_ASSOCIATION",
  "TAROT_SYMBOLISM",
  "TAROT_CRYSTAL_ASSOCIATION"
]);

/** Task book §12: knowledge is not all one grade of fact. */
export const ClaimTypeSchema = z.enum([
  "SCIENTIFIC_FACT",
  "GEMOLOGICAL_FACT",
  "DESIGN_PRINCIPLE",
  "DESIGN_HEURISTIC",
  "CULTURAL_SYMBOLISM",
  "HISTORICAL_TRADITION",
  "WUXING_ASSOCIATION",
  "ASTROLOGY_ASSOCIATION",
  "TAROT_ASSOCIATION",
  "MARKET_OBSERVATION"
]);

export const KnowledgeStatusSchema = z.enum([
  "NEW",
  "EXTRACTED",
  "VALIDATED",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "CONFLICTED",
  "SUPERSEDED"
]);

export const KnowledgeSourceTypeSchema = z.enum([
  "OFFICIAL_API",
  "RSS",
  "STATIC_HTML",
  "BROWSER_AUTOMATION",
  "BOOK",
  "MANUAL"
]);

/**
 * Editorial classification of what a source IS (authority dimension), kept
 * separate from `sourceType` (the fetch mechanism). Q0 task book: sources are
 * not all equal — forums and social platforms may only feed market observation.
 */
export const SourceCategorySchema = z.enum([
  "OFFICIAL",
  "ACADEMIC",
  "BOOK",
  "DESIGN_REFERENCE",
  "JEWELRY_REFERENCE",
  "GEMOLOGY",
  "INDUSTRY",
  "FORUM",
  "SOCIAL_OBSERVATION",
  "MANUAL"
]);

export const SourceReliabilitySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

/** Sources never crawl before a human approves them (Q0.3). */
export const SourceReviewStatusSchema = z.enum([
  "DISCOVERED",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "DISABLED"
]);

export const SourceContentTypeSchema = z.enum([
  "ARTICLE",
  "DATASHEET",
  "TEXTBOOK",
  "CATALOG",
  "SPECIFICATION",
  "FORUM_THREAD",
  "SOCIAL_POST",
  "OTHER"
]);

export const SourceCrawlStrategySchema = z.strictObject({
  maxPages: PositiveSafeIntegerSchema.max(1000).default(10),
  followLinks: z.boolean().default(false),
  /**
   * Batch B child-page discovery: an allowlist of path globs (e.g.
   * "/gem-*.html"). When present, followed links must match at least one
   * pattern; when absent, same-origin links are followed as before.
   */
  pathPatterns: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^\/[A-Za-z0-9\-_.*/]*$/, "path patterns must be root-relative paths")
    )
    .min(1)
    .max(16)
    .optional(),
  /** Discovery depth from the base URL; 1 means base + its direct children. */
  maxDepth: PositiveSafeIntegerSchema.max(3).default(1),
  /** Recorded intent; the crawler always enforces robots.txt regardless. */
  respectRobots: z.boolean().default(true)
});

export const SourceFetchFailureSchema = z.strictObject({
  at: IsoDateTimeSchema,
  reason: z.string().trim().min(1).max(500),
  consecutive: PositiveSafeIntegerSchema
});

export const SOURCE_REVIEW_TRANSITIONS: Record<
  SourceReviewStatus,
  readonly SourceReviewStatus[]
> = {
  DISCOVERED: ["NEEDS_REVIEW", "REJECTED"],
  NEEDS_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["DISABLED"],
  DISABLED: ["NEEDS_REVIEW"],
  REJECTED: ["NEEDS_REVIEW"]
};

export const KnowledgeDocumentStatusSchema = z.enum(["FETCHED", "PARSED", "FAILED"]);

export const KnowledgeSourceSchema = z.strictObject({
  id: IdentifierSchema,
  name: z.string().trim().min(1).max(200),
  sourceType: KnowledgeSourceTypeSchema,
  baseUrl: z.url().optional(),
  enabled: z.boolean().default(false),
  authorityScore: z.number().min(0).max(1),
  allowedKnowledgeDomains: z.array(TaxonomyRefSchema("KNOWLEDGE_DOMAIN")).min(1),
  crawlFrequency: IdentifierSchema.optional(),
  language: LocaleSchema,
  rateLimit: z
    .strictObject({ maxRequestsPerMinute: PositiveSafeIntegerSchema })
    .optional(),
  legalNote: z.string().trim().max(2000).optional(),
  sourceCategory: SourceCategorySchema.default("MANUAL"),
  reliabilityLevel: SourceReliabilitySchema.default("MEDIUM"),
  countryOrRegion: z.string().trim().min(1).max(100).optional(),
  contentType: SourceContentTypeSchema.default("OTHER"),
  crawlStrategy: SourceCrawlStrategySchema.optional(),
  /** Only `APPROVED` sources may be crawled, and only when also `enabled`. */
  reviewStatus: SourceReviewStatusSchema.default("NEEDS_REVIEW"),
  lastSuccessfulFetch: IsoDateTimeSchema.optional(),
  lastFailure: SourceFetchFailureSchema.optional()
});

export const KnowledgeDocumentSchema = z.strictObject({
  id: IdentifierSchema,
  sourceId: IdentifierSchema,
  url: z.url(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Expected a sha-256 hex content hash"),
  title: z.string().trim().min(1).max(300),
  contentText: z.string().max(200_000).default(""),
  fetchedAt: IsoDateTimeSchema,
  parser: IdentifierSchema,
  language: LocaleSchema,
  status: KnowledgeDocumentStatusSchema.default("FETCHED")
});

export const KnowledgeSourceRefSchema = z.strictObject({
  sourceId: IdentifierSchema,
  documentId: IdentifierSchema.optional()
});

export const KnowledgeRuleSchema = z.strictObject({
  id: IdentifierSchema,
  knowledgeType: KnowledgeTypeSchema,
  knowledgeDomain: TaxonomyRefSchema("KNOWLEDGE_DOMAIN"),
  subject: IdentifierSchema,
  relation: IdentifierSchema,
  payload: JsonValueSchema,
  conditions: JsonValueSchema.default({}),
  confidence: z.number().min(0).max(1),
  claimType: ClaimTypeSchema.optional(),
  status: KnowledgeStatusSchema,
  sourceRefs: z.array(KnowledgeSourceRefSchema).min(1),
  version: PositiveSafeIntegerSchema,
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{16,64}$/, "Expected a hex rule fingerprint"),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});

export const PRODUCTION_KNOWLEDGE_STATUSES = ["APPROVED"] as const;

/**
 * Canonical relation vocabulary for extracted candidates (Quality Phase Q2).
 * Free-text extraction used to emit a single `mentioned-with` relation; the
 * nine relations below make candidates reviewable and measurable, and the
 * allowed-types matrix keeps relation × knowledgeType pairs honest.
 */
export const ExtractionRelationSchema = z.enum([
  "pairs-well-with",
  "conflicts-with",
  "avoid-exposure",
  "care-instruction",
  "symbolizes",
  "suits-style",
  "proportion-of",
  "transitions-to",
  "trending-in",
  "has-property"
]);

export const EXTRACTION_RELATION_ALLOWED_TYPES: Record<
  ExtractionRelation,
  readonly KnowledgeType[]
> = {
  "pairs-well-with": [
    "COLOR_THEORY",
    "MATERIAL_COMPATIBILITY",
    "STYLE_RULE",
    "CRYSTAL_GEMOLOGY",
    "CRYSTAL_VISUAL_PROPERTIES"
  ],
  "conflicts-with": ["NEGATIVE_RULE", "MATERIAL_COMPATIBILITY", "COLOR_THEORY", "CRYSTAL_GEMOLOGY"],
  "avoid-exposure": ["NEGATIVE_RULE", "MATERIAL_COMPATIBILITY", "CRYSTAL_GEMOLOGY"],
  "care-instruction": ["MATERIAL_COMPATIBILITY", "CRYSTAL_GEMOLOGY"],
  symbolizes: [
    "CULTURAL_SYMBOLISM",
    "TAROT",
    "CRYSTAL_CULTURAL_SYMBOLISM",
    "WUXING",
    "WUXING_CRYSTAL_ASSOCIATION",
    "ZODIAC",
    "ZODIAC_CRYSTAL_ASSOCIATION",
    "TAROT_SYMBOLISM",
    "TAROT_CRYSTAL_ASSOCIATION"
  ],
  "suits-style": ["STYLE_RULE", "CRYSTAL_VISUAL_PROPERTIES"],
  "proportion-of": ["PROPORTION_RULE", "COMPOSITION_RULE", "FOCAL_RULE"],
  "transitions-to": ["TRANSITION_RULE"],
  "trending-in": ["MARKET_OBSERVATION"],
  /**
   * Batch B gem profiles: deterministic physical/visual facts (Mohs hardness,
   * crystal system, chemistry...) ride this relation and nothing else, so gem
   * facts stay distinguishable from design/cultural assertions.
   */
  "has-property": ["CRYSTAL_GEMOLOGY", "CRYSTAL_VISUAL_PROPERTIES"]
};

export function isRelationAllowedForKnowledgeType(
  relation: ExtractionRelation,
  knowledgeType: KnowledgeType
): boolean {
  return EXTRACTION_RELATION_ALLOWED_TYPES[relation].includes(knowledgeType);
}

export const ExtractionMethodSchema = z.enum(["structured", "pattern", "semantic"]);

export const ExtractionEvidenceSchema = z
  .strictObject({
    documentId: IdentifierSchema,
    sentence: z.string().trim().min(1).max(500),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(0)
  })
  .refine((evidence) => evidence.endOffset >= evidence.startOffset, {
    message: "endOffset must not precede startOffset"
  });

export const ExtractionMetadataSchema = z.strictObject({
  extractor: z.string().trim().min(1).max(100),
  method: ExtractionMethodSchema,
  evidence: z.array(ExtractionEvidenceSchema).max(20)
});

const KNOWLEDGE_DOMAIN_BY_TYPE: Record<KnowledgeType, string> = {
  COLOR_THEORY: "knowledge-domain:color-theory",
  MATERIAL_COMPATIBILITY: "knowledge-domain:material-compatibility",
  STYLE_RULE: "knowledge-domain:style-rule",
  PROPORTION_RULE: "knowledge-domain:proportion-rule",
  COMPOSITION_RULE: "knowledge-domain:composition-rule",
  TRANSITION_RULE: "knowledge-domain:transition-rule",
  FOCAL_RULE: "knowledge-domain:focal-rule",
  NEGATIVE_RULE: "knowledge-domain:negative-rule",
  CULTURAL_SYMBOLISM: "knowledge-domain:cultural-symbolism",
  TAROT: "knowledge-domain:tarot",
  MARKET_OBSERVATION: "knowledge-domain:market-observation",
  CRYSTAL_GEMOLOGY: "knowledge-domain:crystal-gemology",
  CRYSTAL_VISUAL_PROPERTIES: "knowledge-domain:crystal-visual-properties",
  CRYSTAL_CULTURAL_SYMBOLISM: "knowledge-domain:crystal-cultural-symbolism",
  WUXING: "knowledge-domain:wuxing",
  WUXING_CRYSTAL_ASSOCIATION: "knowledge-domain:wuxing-crystal-association",
  ZODIAC: "knowledge-domain:zodiac",
  ZODIAC_CRYSTAL_ASSOCIATION: "knowledge-domain:zodiac-crystal-association",
  TAROT_SYMBOLISM: "knowledge-domain:tarot-symbolism",
  TAROT_CRYSTAL_ASSOCIATION: "knowledge-domain:tarot-crystal-association"
};

export function knowledgeDomainForType(knowledgeType: KnowledgeType): string {
  return KNOWLEDGE_DOMAIN_BY_TYPE[knowledgeType];
}

export type ProductionKnowledgeStatus = (typeof PRODUCTION_KNOWLEDGE_STATUSES)[number];

export function isProductionEligibleKnowledgeStatus(
  status: string
): status is ProductionKnowledgeStatus {
  return (PRODUCTION_KNOWLEDGE_STATUSES as readonly string[]).includes(status);
}

export type KnowledgeType = z.infer<typeof KnowledgeTypeSchema>;
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;
export type ExtractionRelation = z.infer<typeof ExtractionRelationSchema>;
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;
export type ExtractionEvidence = z.infer<typeof ExtractionEvidenceSchema>;
export type ExtractionMetadata = z.infer<typeof ExtractionMetadataSchema>;
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>;
export type SourceCategory = z.infer<typeof SourceCategorySchema>;
export type SourceReliability = z.infer<typeof SourceReliabilitySchema>;
export type SourceReviewStatus = z.infer<typeof SourceReviewStatusSchema>;
export type SourceContentType = z.infer<typeof SourceContentTypeSchema>;
export type SourceCrawlStrategy = z.infer<typeof SourceCrawlStrategySchema>;
export type SourceFetchFailure = z.infer<typeof SourceFetchFailureSchema>;
export type KnowledgeDocumentStatus = z.infer<typeof KnowledgeDocumentStatusSchema>;
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;
/** Input shape: schema defaults (enabled, reviewStatus, …) stay optional. */
export type KnowledgeSourceInput = z.input<typeof KnowledgeSourceSchema>;
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type KnowledgeSourceRef = z.infer<typeof KnowledgeSourceRefSchema>;
export type KnowledgeRule = z.infer<typeof KnowledgeRuleSchema>;
