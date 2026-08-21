import assert from "node:assert/strict";
import test from "node:test";

import { buildDesignFacts, evaluateRuleSet } from "../src/index.js";
import { CATALOG, RULE_SET, buildContext } from "./fixtures.js";

const context = buildContext({
  preferences: { emotionTags: ["emotion:hope"], colorPreferences: ["color:blue"] }
});

test("soft rule score sums weight x confidence for fired rules only", async () => {
  const facts = buildDesignFacts({
    products: [CATALOG[1]!],
    context
  });
  const evaluation = await evaluateRuleSet(RULE_SET.rules, facts);
  assert.equal(evaluation.firedRuleIds.includes("dr-soft-blue"), true);
  assert.equal(evaluation.firedRuleIds.includes("dr-soft-tarot"), true);
  assert.equal(evaluation.softScore, Number((0.5 * 0.8 + 0.4 * 0.7).toFixed(6)));
  assert.equal(evaluation.violations.length, 0);
});

test("facts gate rule firing", async () => {
  const facts = buildDesignFacts({
    products: [CATALOG[4]!],
    context
  });
  const evaluation = await evaluateRuleSet(RULE_SET.rules, facts);
  assert.equal(evaluation.firedRuleIds.includes("dr-soft-blue"), false);
  assert.equal(
    evaluation.softScore,
    Number((0.4 * 0.7).toFixed(6)),
    "only the context-driven tarot rule fires for a black bead"
  );
});

test("hard conflict rule firing yields a violation", async () => {
  const facts = buildDesignFacts({
    products: [CATALOG[0]!, CATALOG[3]!],
    context
  });
  const evaluation = await evaluateRuleSet(RULE_SET.rules, facts);
  const conflict = evaluation.violations.find((v) => v.ruleId === "dr-hard-conflict");
  assert.ok(conflict);
  assert.equal(conflict.code, "HARD_RULE");
});

test("context refs mirror the compiler's context ref set", () => {
  const avoidContext = buildContext({
    avoidances: { materialIds: ["material:obsidian"], colorFamilyIds: ["color:black"] }
  });
  const facts = buildDesignFacts({ products: [], context: avoidContext });
  assert.equal(facts.contextTaxonomyRefs.includes("material:obsidian"), true);
  assert.equal(facts.contextTaxonomyRefs.includes("color:black"), true);
});

test("design refs carry product tags and composition roles", () => {
  const facts = buildDesignFacts({
    products: [CATALOG[0]!],
    context,
    compositionRoles: ["composition-role:focal"]
  });
  assert.equal(facts.designTaxonomyRefs.includes("color:purple"), true);
  assert.equal(facts.designTaxonomyRefs.includes("material:amethyst"), true);
  assert.equal(facts.designTaxonomyRefs.includes("composition-role:focal"), true);
});

test("evaluation is deterministic across repeated runs", async () => {
  const facts = buildDesignFacts({ products: [CATALOG[0]!, CATALOG[1]!], context });
  const first = await evaluateRuleSet(RULE_SET.rules, facts);
  for (let i = 0; i < 20; i += 1) {
    const repeat = await evaluateRuleSet(RULE_SET.rules, facts);
    assert.deepEqual(repeat, first);
  }
});
