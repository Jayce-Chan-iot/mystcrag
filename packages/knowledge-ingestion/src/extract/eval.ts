import { ExtractionRelationSchema, type ExtractionRelation } from "@mystcrag/design-contract";

import type { LabeledSentence } from "../fixtures/labeled-sentences.js";
import type { ExtractorInput, KnowledgeExtractor } from "./extractor.js";

export type RelationEvalEntry = {
  expected: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
};

export type ExtractionEvalReport = {
  overall: RelationEvalEntry & { labeledSentences: number; negatives: number };
  perRelation: Record<ExtractionRelation, RelationEvalEntry>;
};

const ALL_DOMAINS = [
  "knowledge-domain:color-theory",
  "knowledge-domain:material-compatibility",
  "knowledge-domain:style-rule",
  "knowledge-domain:proportion-rule",
  "knowledge-domain:composition-rule",
  "knowledge-domain:transition-rule",
  "knowledge-domain:focal-rule",
  "knowledge-domain:negative-rule",
  "knowledge-domain:cultural-symbolism",
  "knowledge-domain:tarot",
  "knowledge-domain:market-observation",
  "knowledge-domain:crystal-gemology",
  "knowledge-domain:crystal-visual-properties"
];

function inputForSentence(entry: LabeledSentence, index: number): ExtractorInput {
  return {
    documentId: `doc-eval-${index}`,
    title: entry.title ?? "Eval document",
    contentText: entry.sentence,
    fetchedAt: "2026-08-22T10:00:00.000Z",
    source: {
      sourceId: "source-eval",
      sourceCategory: "DESIGN_REFERENCE",
      reliabilityLevel: "HIGH",
      allowedKnowledgeDomains: ALL_DOMAINS
    }
  };
}

function emptyEntry(): RelationEvalEntry {
  return {
    expected: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    precision: 0,
    recall: 0,
    f1: 0
  };
}

/**
 * Precision / recall / F1 over the labeled sentence set, matched by the
 * (relation, knowledgeType) pair each sentence is expected to yield. Negative
 * sentences (no expectation) penalize precision when an extractor fires on
 * them. Run via `pnpm --filter @mystcrag/knowledge-ingestion bench:extraction`.
 */
export async function evaluateExtractor(
  extractor: KnowledgeExtractor,
  sentences: readonly LabeledSentence[]
): Promise<ExtractionEvalReport> {
  return evaluateExtractors([extractor], sentences);
}

/**
 * Scores an extractor composition exactly as the ingestion pipeline runs it:
 * every extractor sees the same sentence, and the union of their candidates
 * is the prediction. The deterministic stack (pattern + gem-profile) carries
 * the F1 = 1.00 baseline; prose relations come from the pattern extractor,
 * `has-property` datasheet lines from the gem-profile extractor.
 */
export async function evaluateExtractors(
  extractors: readonly KnowledgeExtractor[],
  sentences: readonly LabeledSentence[]
): Promise<ExtractionEvalReport> {
  const perRelation = Object.fromEntries(
    ExtractionRelationSchema.options.map((relation) => [relation, emptyEntry()])
  ) as Record<ExtractionRelation, RelationEvalEntry>;
  let overallTruePositives = 0;
  let overallFalsePositives = 0;
  let overallFalseNegatives = 0;
  let overallExpected = 0;
  let negatives = 0;

  for (const [index, entry] of sentences.entries()) {
    const input = inputForSentence(entry, index);
    const predicted = new Set<string>();
    for (const extractor of extractors) {
      for (const candidate of await extractor.extract(input)) {
        predicted.add(`${candidate.relation}×${candidate.knowledgeType}`);
      }
    }
    const expected = new Set(
      entry.expected === undefined
        ? []
        : [`${entry.expected.relation}×${entry.expected.knowledgeType}`]
    );
    if (entry.expected === undefined) negatives += 1;

    for (const pair of expected) {
      overallExpected += 1;
      const relation = pair.split("×")[0] as ExtractionRelation;
      perRelation[relation].expected += 1;
      if (predicted.has(pair)) {
        overallTruePositives += 1;
        perRelation[relation].truePositives += 1;
      } else {
        overallFalseNegatives += 1;
        perRelation[relation].falseNegatives += 1;
      }
    }
    for (const pair of predicted) {
      if (expected.has(pair)) continue;
      overallFalsePositives += 1;
      const relation = pair.split("×")[0] as ExtractionRelation;
      if (perRelation[relation] !== undefined) {
        perRelation[relation].falsePositives += 1;
      }
    }
  }

  for (const entry of Object.values(perRelation)) {
    entry.precision = entry.truePositives + entry.falsePositives === 0 ? 1 : entry.truePositives / (entry.truePositives + entry.falsePositives);
    entry.recall = entry.expected === 0 ? 1 : entry.truePositives / entry.expected;
    entry.f1 = entry.precision + entry.recall === 0 ? 0 : (2 * entry.precision * entry.recall) / (entry.precision + entry.recall);
  }

  const precision = overallTruePositives + overallFalsePositives === 0 ? 1 : overallTruePositives / (overallTruePositives + overallFalsePositives);
  const recall = overallTruePositives + overallFalseNegatives === 0 ? 1 : overallTruePositives / (overallTruePositives + overallFalseNegatives);
  return {
    overall: {
      labeledSentences: sentences.length,
      negatives,
      expected: overallExpected,
      truePositives: overallTruePositives,
      falsePositives: overallFalsePositives,
      falseNegatives: overallFalseNegatives,
      precision,
      recall,
      f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
    },
    perRelation
  };
}
