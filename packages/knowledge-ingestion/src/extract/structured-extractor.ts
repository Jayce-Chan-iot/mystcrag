import { StructuredRuleSchema, structuredRuleToSeed } from "./candidates.js";
import type { ExtractorInput, KnowledgeExtractor, KnowledgeRuleSeed } from "./extractor.js";

/**
 * Structured feeds (OFFICIAL_API JSON) carry machine-readable rules whose
 * provenance is the feed itself, so they enter the pipeline as NEW candidates
 * with feed-declared confidence (task book section 30, semantics unchanged
 * from the pre-Q2 path — Quality Phase Q2 only wraps them in the extractor
 * interface so all three methods compose identically).
 */
export class StructuredExtractor implements KnowledgeExtractor {
  readonly id = "structured-extractor-v1";
  readonly method = "structured" as const;

  async extract(input: ExtractorInput): Promise<KnowledgeRuleSeed[]> {
    const seeds: KnowledgeRuleSeed[] = [];
    for (const raw of input.structuredRules ?? []) {
      const rule = StructuredRuleSchema.safeParse(raw);
      if (!rule.success) continue;
      seeds.push(
        structuredRuleToSeed(rule.data, {
          sourceId: input.source.sourceId,
          documentId: input.documentId,
          fetchedAt: input.fetchedAt
        })
      );
    }
    return seeds;
  }
}
