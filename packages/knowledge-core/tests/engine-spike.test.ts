import assert from "node:assert/strict";
import test from "node:test";

import { Engine, Rule, type TopLevelCondition } from "json-rules-engine";

import { KNOWLEDGE_RULE_FIXTURES } from "../src/fixtures/knowledge-rules.js";
import { KNOWLEDGE_SOURCE_FIXTURES } from "../src/fixtures/knowledge-sources.js";
import {
  compileDecisionRules,
  type CompiledRuleSet
} from "../src/compiler/rule-compiler.js";
import type { StoredKnowledgeRule } from "@mystcrag/database";
import type { RulePriority } from "@mystcrag/design-contract";

/**
 * ADR-6 spike (task book section 19, spec ADR-6): prove json-rules-engine can
 * evaluate the Rule Compiler's output — conditions with facts, all/any/not,
 * and priority — and document the weighted-scoring gap that the typed
 * scoring layer must fill. This test doubles as the EPIC 9 compatibility
 * contract: if the engine stops satisfying these behaviors, the ADR must be
 * revisited.
 */

const PRIORITY_RANK: Record<RulePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  P5: 5,
  P6: 6,
  P7: 7,
  P8: 8
};

const storedRules: StoredKnowledgeRule[] = KNOWLEDGE_RULE_FIXTURES.map((rule) => ({
  ...rule,
  knowledgeVersionId: null
}));

const sources = new Map(
  KNOWLEDGE_SOURCE_FIXTURES.map((source) => [source.id, source])
);

const availableRefs = new Set<string>();
for (const rule of storedRules) availableRefs.add(rule.subject);

const compiled: CompiledRuleSet = compileDecisionRules({
  knowledgeVersion: "spike-v1",
  rules: storedRules,
  sources,
  catalog: {
    productCatalogVersion: "catalog-spike-v1",
    availableTaxonomyRefs: [...availableRefs]
  }
});

/**
 * Engine rules want higher priority first; our ladder ranks P0 first.
 * json-rules-engine requires the conditions root to be a single
 * all/any/not/condition node, so bare compiled conditions get wrapped in
 * `all` (semantically identical single-child conjunction). This wrap is the
 * documented adaptation point for the EPIC 9 evaluator.
 */
function toEngineRule(rule: CompiledRuleSet["rules"][number]): Rule {
  const conditions =
    "fact" in rule.conditions ? { all: [rule.conditions] } : rule.conditions;
  return new Rule({
    name: rule.id,
    priority: 8 - PRIORITY_RANK[rule.priority],
    conditions: conditions as TopLevelCondition,
    event: {
      type: "rule-fired",
      params: { ruleId: rule.id, hardness: rule.hardness }
    }
  });
}

async function runEngine(
  ruleSet: CompiledRuleSet,
  facts: { designTaxonomyRefs: string[]; contextTaxonomyRefs: string[] }
): Promise<Array<{ params: { ruleId: string; hardness: string } }>> {
  const engine = new Engine();
  for (const rule of ruleSet.rules) engine.addRule(toEngineRule(rule));
  const result = await engine.run(facts as Record<string, unknown>);
  return result.events.map((event) => event as unknown as {
    params: { ruleId: string; hardness: string };
  });
}

test("spike: the full compiled fixture corpus loads and evaluates under json-rules-engine", async () => {
  assert.ok(compiled.rules.length >= 100);

  const events = await runEngine(compiled, {
    designTaxonomyRefs: ["color:blue", "material:moonstone", "composition-role:main"],
    contextTaxonomyRefs: ["emotion:calm", "style:minimal"]
  });

  assert.ok(events.length > 0, "at least one rule must fire for a populated design");
  const firedIds = new Set(events.map((event) => event.params.ruleId));
  assert.ok(firedIds.has("dr-krule-color-01"), "blue harmony rule must fire");
});

test("spike: facts gate rule firing", async () => {
  const withBlue = await runEngine(compiled, {
    designTaxonomyRefs: ["color:blue"],
    contextTaxonomyRefs: []
  });
  const withoutBlue = await runEngine(compiled, {
    designTaxonomyRefs: ["color:red"],
    contextTaxonomyRefs: []
  });

  const firedWith = new Set(withBlue.map((e) => e.params.ruleId));
  const firedWithout = new Set(withoutBlue.map((e) => e.params.ruleId));
  assert.ok(firedWith.has("dr-krule-color-01"));
  assert.ok(!firedWithout.has("dr-krule-color-01"));
});

test("spike: context facts drive tarot and style rules", async () => {
  const events = await runEngine(compiled, {
    designTaxonomyRefs: [],
    contextTaxonomyRefs: ["tarot:major-17-the-star"]
  });

  const firedIds = events.map((event) => event.params.ruleId);
  assert.ok(
    firedIds.some((id) => id.startsWith("dr-krule-tarot-")),
    "the star card rule must fire from the context fact"
  );
});

test("spike: all/any/not composite conditions evaluate", async () => {
  const engine = new Engine();
  engine.addRule(
    new Rule({
      name: "composite-all",
      conditions: {
        all: [
          { fact: "designTaxonomyRefs", operator: "contains", value: "color:blue" },
          { fact: "beadCount", operator: "greaterThan", value: 12 }
        ]
      },
      event: { type: "rule-fired", params: { ruleId: "composite-all" } }
    })
  );
  engine.addRule(
    new Rule({
      name: "composite-not",
      conditions: {
        not: { fact: "designTaxonomyRefs", operator: "contains", value: "color:red" }
      },
      event: { type: "rule-fired", params: { ruleId: "composite-not" } }
    })
  );

  const events = (
    await engine.run({
      designTaxonomyRefs: ["color:blue"],
      beadCount: 18
    })
  ).events;
  const fired = events.map((event) => event.params?.ruleId);
  assert.ok(fired.includes("composite-all"));
  assert.ok(fired.includes("composite-not"));

  const redEvents = (
    await engine.run({
      designTaxonomyRefs: ["color:red"],
      beadCount: 18
    })
  ).events;
  // color:red fails composite-all (needs color:blue) and composite-not
  // (explicitly excludes color:red).
  assert.deepEqual(
    redEvents.map((event) => event.params?.ruleId),
    []
  );
});

test("spike: engine priority orders hard constraints ahead of soft guidance", async () => {
  const events = await runEngine(compiled, {
    designTaxonomyRefs: ["material:pyrite", "material:hematite", "color:blue"],
    contextTaxonomyRefs: []
  });

  const hardIndex = events.findIndex((event) => event.params.hardness === "HARD");
  assert.ok(hardIndex >= 0, "a material negative rule must fire as HARD");
  const softIndex = events.findIndex((event) => event.params.hardness === "SOFT");
  if (softIndex >= 0 && hardIndex >= 0) {
    assert.ok(
      hardIndex < softIndex,
      "engine priority must surface HARD rules before SOFT rules"
    );
  }
});

test("spike: evaluation is deterministic across repeated runs", async () => {
  const facts = {
    designTaxonomyRefs: ["color:blue", "material:moonstone", "material:pyrite"],
    contextTaxonomyRefs: ["emotion:calm"]
  };
  const baseline = JSON.stringify(await runEngine(compiled, facts));
  for (let run = 0; run < 20; run += 1) {
    assert.equal(JSON.stringify(await runEngine(compiled, facts)), baseline);
  }
});

test("spike: the weighted scoring gap must be filled by the typed scoring layer", async () => {
  const events = await runEngine(compiled, {
    designTaxonomyRefs: ["color:blue", "color:white", "material:moonstone"],
    contextTaxonomyRefs: []
  });

  // json-rules-engine fires binary events with no weight, priority, or
  // knowledge provenance — the engine result must be joined back to the
  // compiled rule set for scoring. This is the documented ADR-6 gap.
  const byId = new Map(compiled.rules.map((rule) => [rule.id, rule]));
  let softScore = 0;
  let hardCount = 0;
  for (const event of events) {
    const rule = byId.get(event.params.ruleId);
    assert.ok(rule !== undefined, `fired rule ${event.params.ruleId} must exist in the compiled set`);
    if (rule.hardness === "HARD") hardCount += 1;
    else softScore += rule.weight;
  }
  assert.ok(softScore > 0);
  assert.ok(
    Number.isFinite(Number(softScore.toFixed(4))),
    "soft score must be a computable weighted sum"
  );
});
