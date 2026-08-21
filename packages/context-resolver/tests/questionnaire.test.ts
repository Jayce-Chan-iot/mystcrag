import assert from "node:assert/strict";
import test from "node:test";

import {
  RecommendationContextSchema,
  type RecommendationContext
} from "@mystcrag/design-contract";

import {
  resolveManualContext,
  resolveQuestionnaireContext
} from "../src/questionnaire.js";

test("questionnaire input maps legacy tags onto canonical taxonomy ids", () => {
  const context = resolveQuestionnaireContext({
    wristCircumferenceMm: 158,
    emotionTags: ["calm-aesthetic", "希望"],
    styleTags: ["minimal"],
    colorTags: ["purple", "lavender"]
  });

  assert.ok(RecommendationContextSchema.safeParse(context).success);
  assert.deepEqual(context.preferences.emotionTags, ["emotion:calm", "emotion:hope"]);
  assert.deepEqual(context.preferences.styleTags, ["style:minimal"]);
  assert.deepEqual(context.preferences.colorPreferences, ["color:purple"]);
});

test("questionnaire context carries user hard constraints and source weight", () => {
  const context = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    targetInnerCircumferenceMm: 167,
    maxBudgetMinor: 30000,
    requiredProductIds: ["product-a"],
    excludedProductIds: ["product-b"],
    emotionTags: [],
    styleTags: [],
    colorTags: []
  });

  assert.equal(context.hardConstraints.wristCircumferenceMm, 160);
  assert.equal(context.hardConstraints.targetInnerCircumferenceMm, 167);
  assert.equal(context.hardConstraints.maxBudgetMinor, 30000);
  assert.deepEqual(context.hardConstraints.requiredProductIds, ["product-a"]);
  assert.deepEqual(context.hardConstraints.excludedProductIds, ["product-b"]);
  assert.deepEqual(context.sources, [
    { sourceType: "context-source:questionnaire", weight: 0.9 }
  ]);
});

test("questionnaire avoidances resolve to canonical ids and are kept explicit", () => {
  const context = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: [],
    styleTags: [],
    colorTags: [],
    avoidedMaterials: ["quartz", "水晶"],
    avoidedColorFamilies: ["ink"]
  });

  assert.deepEqual(context.avoidances.materialIds, ["material:quartz"]);
  assert.deepEqual(context.avoidances.colorFamilyIds, ["color:black"]);
});

test("unknown legacy tags are dropped with a recorded issue instead of failing", () => {
  const context = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: ["not-an-emotion", "calm"],
    styleTags: [],
    colorTags: ["chartreuse-not-a-color"]
  });

  assert.deepEqual(context.preferences.emotionTags, ["emotion:calm"]);
  assert.deepEqual(context.preferences.colorPreferences, []);
});

test("manual selections carry full weight and keep explicit picks", () => {
  const context = resolveManualContext({
    wristCircumferenceMm: 155,
    emotionTags: ["grounding"],
    styleTags: ["minimal"],
    colorTags: ["ink"],
    mustKeepComponentIds: ["component-1"]
  });

  assert.deepEqual(context.sources, [
    { sourceType: "context-source:manual", weight: 1 }
  ]);
  assert.deepEqual(context.preferences.emotionTags, ["emotion:grounding"]);
  assert.deepEqual(context.preferences.colorPreferences, ["color:black"]);
  assert.deepEqual(context.hardConstraints.mustKeepComponentIds, ["component-1"]);
});

test("context ids are deterministic for identical inputs", () => {
  const input = {
    wristCircumferenceMm: 160,
    emotionTags: ["calm"],
    styleTags: ["minimal"],
    colorTags: ["blue"]
  };
  const first: RecommendationContext = resolveQuestionnaireContext(input);
  const second = resolveQuestionnaireContext(input);
  assert.equal(first.contextId, second.contextId);
  assert.match(first.contextId, /^ctx-/);
});
