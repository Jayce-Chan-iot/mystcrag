import assert from "node:assert/strict";
import test from "node:test";

import { DesignDecisionTraceSchema } from "../src/index";

const validTrace = {
  traceId: "trace-design-1-rev-1",
  designId: "design-ai-published",
  revision: 1,
  knowledgeVersion: "knowledge-2026-08-v1",
  productCatalogVersion: "seed-2026-07-v1",
  decisionRuleSetVersion: "rules-2026-08-v1",
  layoutStrategy: "REPEAT_RHYTHM",
  activeRuleIds: ["rule-inventory-available", "rule-adjacent-hue-preference"],
  knowledgeRefs: ["rule-color-adjacent-hue"],
  contextRefs: ["context-source:questionnaire"],
  scores: {
    colorScore: 82,
    materialScore: 90,
    styleScore: 75,
    compositionScore: 88,
    constraintScore: 100,
    overallScore: 86,
    formulaVersion: "design-score-v1"
  },
  warnings: [],
  createdAt: "2026-08-20T10:00:00+08:00"
};

test("a complete decision trace parses", () => {
  const result = DesignDecisionTraceSchema.parse(validTrace);
  assert.equal(result.designId, "design-ai-published");
  assert.equal(result.scores.formulaVersion, "design-score-v1");
});

test("all four layout strategies are accepted; others are rejected", () => {
  for (const layoutStrategy of [
    "SYMMETRIC_BALANCE",
    "CENTER_FOCAL",
    "REPEAT_RHYTHM",
    "LOW_CONTRAST_FLOW"
  ]) {
    assert.equal(
      DesignDecisionTraceSchema.safeParse({ ...validTrace, layoutStrategy }).success,
      true,
      `expected ${layoutStrategy} to be accepted`
    );
  }
  assert.equal(
    DesignDecisionTraceSchema.safeParse({ ...validTrace, layoutStrategy: "GOLDEN_SPIRAL" }).success,
    false
  );
});

test("scores stay within 0-100 and revisions are positive integers", () => {
  const highScore = {
    ...validTrace,
    scores: { ...validTrace.scores, colorScore: 101 }
  };
  assert.equal(DesignDecisionTraceSchema.safeParse(highScore).success, false);

  const negativeScore = {
    ...validTrace,
    scores: { ...validTrace.scores, materialScore: -1 }
  };
  assert.equal(DesignDecisionTraceSchema.safeParse(negativeScore).success, false);

  assert.equal(
    DesignDecisionTraceSchema.safeParse({ ...validTrace, revision: 0 }).success,
    false
  );
});

test("warnings follow the shared contract warning shape", () => {
  const warned = {
    ...validTrace,
    warnings: [
      { code: "PRICE_CHANGED", message: "catalog price drifted from fixture price" },
      {
        code: "INVENTORY_CHANGED",
        message: "replacement used for missing crystal id",
        fieldPath: "beads[3].beadProductId"
      }
    ]
  };
  assert.equal(DesignDecisionTraceSchema.safeParse(warned).success, true);

  const malformed = {
    ...validTrace,
    warnings: [{ message: "missing code" }]
  };
  assert.equal(DesignDecisionTraceSchema.safeParse(malformed).success, false);
});

test("hidden reasoning and unknown fields are rejected", () => {
  const leaky = { ...validTrace, hiddenChainOfThought: "private" };
  assert.equal(DesignDecisionTraceSchema.safeParse(leaky).success, false);

  const promptLeak = { ...validTrace, fullPrompt: "system prompt" };
  assert.equal(DesignDecisionTraceSchema.safeParse(promptLeak).success, false);
});
