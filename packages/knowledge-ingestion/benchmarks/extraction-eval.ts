/**
 * Extraction quality benchmark (Knowledge Quality Phase Q2, extended for
 * Batch B gem profiles).
 *
 * Scores the deterministic stack (PatternExtractor + GemProfileExtractor)
 * exactly as the ingestion pipeline composes it, plus each extractor on its
 * own for drill-down. An LLM endpoint (KNOWLEDGE_EXTRACTION_ENDPOINT,
 * OpenAI-compatible chat completions) joins the stack when configured so
 * semantic extraction is scored on identical ground truth:
 *
 *   pnpm --filter @mystcrag/knowledge-ingestion bench:extraction
 */
import { ExtractionRelationSchema } from "@mystcrag/design-contract";

import { evaluateExtractors, evaluateExtractor } from "../src/extract/eval.js";
import { GemProfileExtractor } from "../src/extract/gem-profile-extractor.js";
import { PatternExtractor } from "../src/extract/pattern-extractor.js";
import { createSemanticExtractorFromEnv } from "../src/extract/semantic-extractor.js";
import { LABELED_SENTENCES } from "../src/fixtures/labeled-sentences.js";

function printReport(label: string, report: Awaited<ReturnType<typeof evaluateExtractor>>): void {
  console.log(
    `[extraction-eval] ${label} overall P=${report.overall.precision.toFixed(2)} R=${report.overall.recall.toFixed(2)} F1=${report.overall.f1.toFixed(2)} (TP=${report.overall.truePositives} FP=${report.overall.falsePositives} FN=${report.overall.falseNegatives})`
  );
  for (const relation of ExtractionRelationSchema.options) {
    const entry = report.perRelation[relation];
    console.log(
      `[extraction-eval]   ${relation.padEnd(16)} P=${entry.precision.toFixed(2)} R=${entry.recall.toFixed(2)} F1=${entry.f1.toFixed(2)} (n=${entry.expected})`
    );
  }
}

async function main(): Promise<void> {
  const pattern = new PatternExtractor();
  const gemProfile = new GemProfileExtractor();
  const semantic = createSemanticExtractorFromEnv();
  const stack = [pattern, gemProfile, ...(semantic.active ? [semantic] : [])];

  console.log(
    `[extraction-eval] sentences=${LABELED_SENTENCES.length} positives=${
      LABELED_SENTENCES.filter((entry) => entry.expected !== undefined).length
    } negatives=${LABELED_SENTENCES.filter((entry) => entry.expected === undefined).length} extractors=${stack.length}`
  );

  printReport(
    `stack(${stack.map((extractor) => extractor.id).join(" + ")})`,
    await evaluateExtractors(stack, LABELED_SENTENCES)
  );
  for (const extractor of [pattern, gemProfile, ...(semantic.active ? [semantic] : [])]) {
    printReport(extractor.id, await evaluateExtractor(extractor, LABELED_SENTENCES));
  }
}

await main();
