/**
 * Extraction quality benchmark (Knowledge Quality Phase Q2).
 *
 * Runs the labeled sentence set through each configured extractor and prints
 * relation-level precision / recall / F1. The pattern extractor always runs;
 * an LLM endpoint (KNOWLEDGE_EXTRACTION_ENDPOINT, OpenAI-compatible chat
 * completions) joins when configured so semantic extraction can be scored on
 * identical ground truth:
 *
 *   pnpm --filter @mystcrag/knowledge-ingestion bench:extraction
 */
import { ExtractionRelationSchema } from "@mystcrag/design-contract";

import { evaluateExtractor } from "../src/extract/eval.js";
import { PatternExtractor } from "../src/extract/pattern-extractor.js";
import { createSemanticExtractorFromEnv } from "../src/extract/semantic-extractor.js";
import { LABELED_SENTENCES } from "../src/fixtures/labeled-sentences.js";

async function main(): Promise<void> {
  const extractors = [new PatternExtractor()];
  const semantic = createSemanticExtractorFromEnv();
  if (semantic.active) {
    extractors.push(semantic);
  }

  console.log(
    `[extraction-eval] sentences=${LABELED_SENTENCES.length} positives=${
      LABELED_SENTENCES.filter((entry) => entry.expected !== undefined).length
    } negatives=${LABELED_SENTENCES.filter((entry) => entry.expected === undefined).length} extractors=${extractors.length}`
  );

  for (const extractor of extractors) {
    const report = await evaluateExtractor(extractor, LABELED_SENTENCES);
    console.log(
      `[extraction-eval] ${extractor.id} overall P=${report.overall.precision.toFixed(2)} R=${report.overall.recall.toFixed(2)} F1=${report.overall.f1.toFixed(2)} (TP=${report.overall.truePositives} FP=${report.overall.falsePositives} FN=${report.overall.falseNegatives})`
    );
    for (const relation of ExtractionRelationSchema.options) {
      const entry = report.perRelation[relation];
      console.log(
        `[extraction-eval]   ${relation.padEnd(16)} P=${entry.precision.toFixed(2)} R=${entry.recall.toFixed(2)} F1=${entry.f1.toFixed(2)} (n=${entry.expected})`
      );
    }
  }
}

await main();
