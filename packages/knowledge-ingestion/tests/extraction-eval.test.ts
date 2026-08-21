import assert from "node:assert/strict";
import test from "node:test";

import { ExtractionRelationSchema } from "@mystcrag/design-contract";

import {
  LABELED_SENTENCES,
  relationCoverage
} from "../src/fixtures/labeled-sentences.js";
import { evaluateExtractor } from "../src/extract/eval.js";
import { PatternExtractor } from "../src/extract/pattern-extractor.js";

test("the labeled sentence set meets the Q2 coverage contract", () => {
  assert.ok(LABELED_SENTENCES.length >= 40, "at least 40 labeled sentences");
  const coverage = relationCoverage(LABELED_SENTENCES);
  for (const relation of ExtractionRelationSchema.options) {
    assert.ok(
      (coverage[relation] ?? 0) >= 3,
      `${relation} needs at least 3 positive sentences (got ${coverage[relation] ?? 0})`
    );
  }
  const negatives = LABELED_SENTENCES.filter((entry) => entry.expected === undefined);
  assert.ok(negatives.length >= 8, "at least 8 negative sentences for precision");
});

test("pattern extractor holds the F1=1.00 baseline on the labeled set", async () => {
  const report = await evaluateExtractor(new PatternExtractor(), LABELED_SENTENCES);
  assert.equal(report.overall.truePositives, report.overall.expected);
  assert.equal(report.overall.falsePositives, 0);
  assert.equal(report.overall.falseNegatives, 0);
  assert.equal(report.overall.f1, 1);
});

test("the eval report is structured per relation", async () => {
  const report = await evaluateExtractor(new PatternExtractor(), LABELED_SENTENCES);
  for (const relation of ExtractionRelationSchema.options) {
    const entry = report.perRelation[relation];
    assert.ok(entry !== undefined, `${relation} must appear in the report`);
    assert.ok(entry.precision >= 0 && entry.precision <= 1);
    assert.ok(entry.recall >= 0 && entry.recall <= 1);
  }
});
