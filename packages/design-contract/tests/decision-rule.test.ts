import assert from "node:assert/strict";
import test from "node:test";

import { DecisionRuleSchema } from "../src/index";

const validRule = {
  id: "rule-inventory-available",
  type: "inventory-available",
  priority: "P0",
  hardness: "HARD",
  conditions: {
    all: [
      { fact: "product.active", operator: "equal", value: true },
      {
        any: [
          { fact: "product.availableQuantity", operator: "greaterThanInclusive", value: 1 },
          { fact: "design.requiredQuantity", operator: "lessThan", value: 0 }
        ]
      }
    ]
  },
  action: { kind: "reject-design", params: { errorCode: "INVENTORY_CHANGED" } },
  knowledgeRefs: [],
  contextRefs: []
};

test("a hard P0 rule with nested all/any conditions parses", () => {
  const result = DecisionRuleSchema.parse(validRule);
  assert.equal(result.priority, "P0");
  assert.equal(result.hardness, "HARD");
  assert.equal(result.weight, 1);
  assert.equal(result.confidence, 1);
});

test("fact conditions and not-conditions both parse; weight and confidence default to 1", () => {
  const minimal = {
    id: "rule-adjacent-hue-preference",
    type: "prefer-adjacent-hue",
    priority: "P4",
    hardness: "SOFT",
    conditions: {
      not: { fact: "context.preferences.colorPreferences", operator: "isEmpty" }
    },
    action: { kind: "boost-score", params: { amount: 2 } }
  };
  const result = DecisionRuleSchema.parse(minimal);
  assert.equal(result.weight, 1);
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.knowledgeRefs, []);
  assert.deepEqual(result.contextRefs, []);
});

test("condition shapes without fact, all, any, or not are rejected", () => {
  const invalid = { ...validRule, conditions: { maybe: [] } };
  assert.equal(DecisionRuleSchema.safeParse(invalid).success, false);

  const emptyCombinator = { ...validRule, conditions: { all: [] } };
  assert.equal(DecisionRuleSchema.safeParse(emptyCombinator).success, false);

  const missingOperator = {
    ...validRule,
    conditions: { fact: "product.active", value: true }
  };
  assert.equal(DecisionRuleSchema.safeParse(missingOperator).success, false);
});

test("priorities P0 through P8 are accepted and other values rejected", () => {
  for (let level = 0; level <= 8; level++) {
    const priority = `P${level}`;
    assert.equal(
      DecisionRuleSchema.safeParse({ ...validRule, priority }).success,
      true,
      `expected ${priority} to be accepted`
    );
  }
  assert.equal(DecisionRuleSchema.safeParse({ ...validRule, priority: "P9" }).success, false);
  assert.equal(DecisionRuleSchema.safeParse({ ...validRule, priority: "HIGH" }).success, false);
});

test("hardness, weight, and confidence bounds are enforced", () => {
  assert.equal(
    DecisionRuleSchema.safeParse({ ...validRule, hardness: "FIRM" }).success,
    false
  );
  assert.equal(DecisionRuleSchema.safeParse({ ...validRule, weight: 1.5 }).success, false);
  assert.equal(DecisionRuleSchema.safeParse({ ...validRule, weight: -0.1 }).success, false);
  assert.equal(DecisionRuleSchema.safeParse({ ...validRule, confidence: 0 }).success, true);
  assert.equal(DecisionRuleSchema.safeParse({ ...validRule, confidence: 1.1 }).success, false);
});

test("knowledge refs and context refs are plain identifier arrays", () => {
  const referenced = {
    ...validRule,
    knowledgeRefs: ["rule-color-adjacent-hue"],
    contextRefs: ["context-source:questionnaire"]
  };
  assert.equal(DecisionRuleSchema.safeParse(referenced).success, true);
});

test("unknown fields are rejected", () => {
  const extra = { ...validRule, chainOfThought: "private reasoning" };
  assert.equal(DecisionRuleSchema.safeParse(extra).success, false);
});
