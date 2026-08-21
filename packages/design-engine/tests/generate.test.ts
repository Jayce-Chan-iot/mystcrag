import assert from "node:assert/strict";
import test from "node:test";

import {
  BeadV1Schema,
  DesignDecisionTraceSchema,
  DesignScoreSchema
} from "@mystcrag/design-contract";

import {
  evaluateDesignDraft,
  generateDesignCandidates
} from "../src/index.js";
import { CATALOG, NOW, RULE_SET, buildContext } from "./fixtures.js";

test("generate returns exactly three ranked candidates with distinct strategies", async () => {
  const candidates = await generateDesignCandidates({
    context: buildContext(),
    products: CATALOG,
    ruleSet: RULE_SET,
    now: NOW
  });
  assert.equal(candidates.length, 3);
  const strategies = new Set(candidates.map((candidate) => candidate.layoutStrategy));
  assert.equal(strategies.size, 3);
  for (let i = 1; i < candidates.length; i += 1) {
    assert.ok(candidates[i - 1]!.score.overallScore >= candidates[i]!.score.overallScore);
  }
});

test("candidate drafts validate against the contract schemas", async () => {
  const candidates = await generateDesignCandidates({
    context: buildContext(),
    products: CATALOG,
    ruleSet: RULE_SET,
    now: NOW
  });
  for (const candidate of candidates) {
    assert.equal(DesignDecisionTraceSchema.safeParse(candidate.trace).success, true);
    assert.equal(DesignScoreSchema.safeParse(candidate.score).success, true);
    for (const bead of candidate.draft.beads) {
      assert.equal(BeadV1Schema.safeParse(bead).success, true);
    }
    assert.equal(candidate.draft.bracelet.totalBeadCount, candidate.draft.beads.length);
    assert.equal(candidate.trace.designId, candidate.designId);
    assert.equal(candidate.trace.scores, candidate.score);
  }
});

test("identical inputs produce identical candidates across 100 runs", async () => {
  const context = buildContext({
    preferences: { colorPreferences: ["color:purple"], styleTags: ["style:minimal"] }
  });
  const first = await generateDesignCandidates({
    context,
    products: CATALOG,
    ruleSet: RULE_SET,
    now: NOW
  });
  assert.ok(first.length > 0);
  for (let i = 0; i < 99; i += 1) {
    const repeat = await generateDesignCandidates({
      context,
      products: CATALOG,
      ruleSet: RULE_SET,
      now: NOW
    });
    assert.deepEqual(repeat, first);
  }
});

test("hard budget is respected by every candidate", async () => {
  const context = buildContext({ maxBudgetMinor: 4000 });
  const candidates = await generateDesignCandidates({
    context,
    products: CATALOG,
    ruleSet: RULE_SET,
    now: NOW
  });
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.ok(
      candidate.draft.materialCostMinor <= 4000,
      `cost ${candidate.draft.materialCostMinor} over budget`
    );
  }
});

test("avoided materials never appear in any candidate", async () => {
  const context = buildContext({
    avoidances: { materialIds: ["material:obsidian"] }
  });
  const candidates = await generateDesignCandidates({
    context,
    products: CATALOG,
    ruleSet: RULE_SET,
    now: NOW
  });
  for (const candidate of candidates) {
    assert.equal(
      candidate.draft.beads.some((bead) => bead.materialKey === "material:obsidian"),
      false
    );
  }
});

test("empty catalog yields no candidates instead of throwing", async () => {
  const candidates = await generateDesignCandidates({
    context: buildContext(),
    products: [],
    ruleSet: RULE_SET,
    now: NOW
  });
  assert.equal(candidates.length, 0);
});

test("evaluate scores an existing draft and reports fired rules", async () => {
  const generated = await generateDesignCandidates({
    context: buildContext(),
    products: CATALOG,
    ruleSet: RULE_SET,
    now: NOW
  });
  const candidate = generated[0]!;
  const evaluation = await evaluateDesignDraft({
    draft: candidate.draft,
    layoutStrategy: candidate.layoutStrategy,
    context: buildContext(),
    products: CATALOG,
    ruleSet: RULE_SET
  });
  assert.equal(evaluation.scores.formulaVersion, "design-score-v1");
  assert.deepEqual(evaluation.scores, candidate.score);
  assert.ok(Array.isArray(evaluation.firedRuleIds));
  assert.ok(evaluation.softRuleScore >= 0);
});

test("evaluate flags geometry violations on a badly undersized draft", async () => {
  const generated = await generateDesignCandidates({
    context: buildContext(),
    products: CATALOG,
    ruleSet: RULE_SET,
    now: NOW
  });
  const candidate = generated[0]!;
  const undersized = {
    ...candidate.draft,
    beads: candidate.draft.beads.slice(0, 2),
    bracelet: {
      ...candidate.draft.bracelet,
      totalBeadCount: 2
    }
  };
  const evaluation = await evaluateDesignDraft({
    draft: undersized,
    layoutStrategy: candidate.layoutStrategy,
    context: buildContext(),
    products: CATALOG,
    ruleSet: RULE_SET
  });
  assert.ok(evaluation.violations.some((v) => v.code === "GEOMETRY_UNDERFILL"));
});
