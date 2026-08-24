import type {
  ExtractionMethod,
  KnowledgeRule,
  SourceCategory,
  SourceReliability
} from "@mystcrag/design-contract";

export type KnowledgeRuleSeed = KnowledgeRule & { sourceId: string };

/** Q0 policy: forums and social platforms may only feed market observation. */
export const FORUM_LIKE_CATEGORIES: readonly SourceCategory[] = ["FORUM", "SOCIAL_OBSERVATION"];
export const FORUM_ALLOWED_DOMAIN = "knowledge-domain:market-observation";

export type ExtractorSourceContext = {
  sourceId: string;
  sourceCategory: SourceCategory;
  reliabilityLevel: SourceReliability;
  allowedKnowledgeDomains: readonly string[];
};

export type ExtractorInput = {
  documentId: string;
  title: string;
  contentText: string;
  fetchedAt: string;
  source: ExtractorSourceContext;
  /** Machine-readable rules carried by structured feeds, consumed by StructuredExtractor. */
  structuredRules?: readonly unknown[];
};

/**
 * Pluggable extraction surface (Quality Phase Q2). Structured feeds, pattern
 * matching, and LLM-backed extraction all implement this one interface; the
 * pipeline composes them and every candidate carries provenance + evidence.
 */
export interface KnowledgeExtractor {
  readonly id: string;
  readonly method: ExtractionMethod;
  extract(input: ExtractorInput): Promise<KnowledgeRuleSeed[]>;
}

export const PATTERN_CONFIDENCE_CAP = 0.85;

export const RELIABILITY_CONFIDENCE_FACTOR: Record<SourceReliability, number> = {
  HIGH: 1,
  MEDIUM: 0.9,
  LOW: 0.75
};

export function confidenceFor(
  base: number,
  reliabilityLevel: SourceReliability,
  cap: number = PATTERN_CONFIDENCE_CAP
): number {
  const factor = RELIABILITY_CONFIDENCE_FACTOR[reliabilityLevel];
  return Math.round(Math.min(base * factor, cap) * 1_000) / 1_000;
}

/**
 * Extraction-time enforcement of the source policy: the candidate's knowledge
 * domain must be within the source's allowed domains, and forum-like sources
 * are clamped to market observation regardless of their declared allowance.
 */
export function isCandidateAllowedForSource(
  knowledgeDomain: string,
  source: ExtractorSourceContext
): boolean {
  if (FORUM_LIKE_CATEGORIES.includes(source.sourceCategory)) {
    return knowledgeDomain === FORUM_ALLOWED_DOMAIN;
  }
  return source.allowedKnowledgeDomains.includes(knowledgeDomain);
}
