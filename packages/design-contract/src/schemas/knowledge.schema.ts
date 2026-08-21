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
  legalNote: z.string().trim().max(2000).optional()
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
  MARKET_OBSERVATION: "knowledge-domain:market-observation"
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
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeSchema>;
export type KnowledgeDocumentStatus = z.infer<typeof KnowledgeDocumentStatusSchema>;
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type KnowledgeSourceRef = z.infer<typeof KnowledgeSourceRefSchema>;
export type KnowledgeRule = z.infer<typeof KnowledgeRuleSchema>;
