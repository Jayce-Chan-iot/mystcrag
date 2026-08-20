import assert from "node:assert/strict";
import test from "node:test";

import { RecommendationContextSchema } from "../src/index";

const baseContext = {
  contextId: "context-questionnaire-1",
  locale: "zh-CN",
  currency: "CNY",
  sources: [{ sourceType: "context-source:questionnaire", weight: 1 }],
  hardConstraints: { wristCircumferenceMm: 155 }
};

test("a minimal questionnaire context parses and fills preference defaults", () => {
  const result = RecommendationContextSchema.parse(baseContext);
  assert.deepEqual(result.preferences, {
    emotionTags: [],
    styleTags: [],
    colorPreferences: [],
    visualPreferences: []
  });
  assert.deepEqual(result.avoidances, { materialIds: [], colorFamilyIds: [] });
  assert.deepEqual(result.contextWeights, {});
  assert.deepEqual(result.hardConstraints.requiredProductIds, []);
  assert.deepEqual(result.hardConstraints.excludedProductIds, []);
  assert.deepEqual(result.hardConstraints.mustKeepComponentIds, []);
});

test("hard constraints validate wrist size and budget amounts", () => {
  const invalidWrist = structuredClone(baseContext) as unknown as { hardConstraints: { wristCircumferenceMm: number } };
  invalidWrist.hardConstraints.wristCircumferenceMm = 0;
  assert.equal(RecommendationContextSchema.safeParse(invalidWrist).success, false);

  const invalidBudget = structuredClone(baseContext) as unknown as { hardConstraints: { maxBudgetMinor: number } };
  invalidBudget.hardConstraints.maxBudgetMinor = -1;
  assert.equal(RecommendationContextSchema.safeParse(invalidBudget).success, false);

  const fractionalBudget = structuredClone(baseContext) as unknown as { hardConstraints: { maxBudgetMinor: number } };
  fractionalBudget.hardConstraints.maxBudgetMinor = 100.5;
  assert.equal(RecommendationContextSchema.safeParse(fractionalBudget).success, false);
});

test("sources must be non-empty and use the controlled context-source taxonomy", () => {
  const noSources = structuredClone(baseContext) as unknown as { sources: unknown[] };
  noSources.sources = [];
  assert.equal(RecommendationContextSchema.safeParse(noSources).success, false);

  const unknownSource = structuredClone(baseContext) as unknown as { sources: { sourceType: string }[] };
  unknownSource.sources = [{ sourceType: "context-source:horoscope" }];
  assert.equal(RecommendationContextSchema.safeParse(unknownSource).success, false);
});

test("a tarot source with weight and refId parses", () => {
  const tarotContext = structuredClone(baseContext) as unknown as {
    sources: { sourceType: string; weight: number; refId?: string }[];
  };
  tarotContext.sources = [
    { sourceType: "context-source:tarot", weight: 0.5, refId: "tarot-session-1" }
  ];
  const result = RecommendationContextSchema.safeParse(tarotContext);
  assert.equal(result.success, true);
});

test("source weights and context weights stay within [0, 1]", () => {
  const heavySource = structuredClone(baseContext) as unknown as {
    sources: { sourceType: string; weight: number }[];
  };
  heavySource.sources = [{ sourceType: "context-source:questionnaire", weight: 1.5 }];
  assert.equal(RecommendationContextSchema.safeParse(heavySource).success, false);

  const heavyContextWeight = structuredClone(baseContext) as unknown as { contextWeights: Record<string, number> };
  heavyContextWeight.contextWeights = { "context-source:tarot": 1.2 };
  assert.equal(RecommendationContextSchema.safeParse(heavyContextWeight).success, false);
});

test("preferences must reference canonical taxonomy ids in the right domain", () => {
  const validPreferences = structuredClone(baseContext) as unknown as {
    preferences: Record<string, string[]>;
  };
  validPreferences.preferences = {
    emotionTags: ["emotion:calm", "emotion:hope"],
    styleTags: ["style:ethereal"],
    colorPreferences: ["color:blue", "color:white"]
  };
  assert.equal(RecommendationContextSchema.safeParse(validPreferences).success, true);

  const unknownEmotion = structuredClone(baseContext) as unknown as {
    preferences: Record<string, string[]>;
  };
  unknownEmotion.preferences = { emotionTags: ["emotion:unknown"] };
  assert.equal(RecommendationContextSchema.safeParse(unknownEmotion).success, false);

  const wrongDomain = structuredClone(baseContext) as unknown as {
    preferences: Record<string, string[]>;
  };
  wrongDomain.preferences = { styleTags: ["emotion:calm"] };
  assert.equal(RecommendationContextSchema.safeParse(wrongDomain).success, false);
});

test("visual preferences accept texture, luster, transparency, and level taxonomy refs", () => {
  const visual = structuredClone(baseContext) as unknown as {
    preferences: Record<string, string[]>;
  };
  visual.preferences = {
    visualPreferences: [
      "texture:banded",
      "luster:soft",
      "transparency:translucent",
      "temperature:cool",
      "saturation-level:low",
      "lightness-level:low"
    ]
  };
  assert.equal(RecommendationContextSchema.safeParse(visual).success, true);

  const nonVisual = structuredClone(baseContext) as unknown as {
    preferences: Record<string, string[]>;
  };
  nonVisual.preferences = { visualPreferences: ["color:purple"] };
  assert.equal(RecommendationContextSchema.safeParse(nonVisual).success, false);
});

test("avoidances validate against material and color taxonomy", () => {
  const validAvoidances = structuredClone(baseContext) as unknown as {
    avoidances: Record<string, string[]>;
  };
  validAvoidances.avoidances = {
    materialIds: ["material:obsidian"],
    colorFamilyIds: ["color:black"]
  };
  assert.equal(RecommendationContextSchema.safeParse(validAvoidances).success, true);

  const unknownMaterial = structuredClone(baseContext) as unknown as {
    avoidances: Record<string, string[]>;
  };
  unknownMaterial.avoidances = { materialIds: ["material:unobtainium"] };
  assert.equal(RecommendationContextSchema.safeParse(unknownMaterial).success, false);
});

test("unknown top-level fields are rejected", () => {
  const extra = { ...baseContext, hiddenReasoning: "private chain of thought" };
  assert.equal(RecommendationContextSchema.safeParse(extra).success, false);
});
