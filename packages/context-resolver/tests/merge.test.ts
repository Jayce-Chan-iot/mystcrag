import assert from "node:assert/strict";
import test from "node:test";

import {
  RecommendationContextSchema
} from "@mystcrag/design-contract";
import { deriveDesignSignals, tarotCardById, type RevealedTarotCard } from "@mystcrag/tarot-engine";

import { mergeContexts } from "../src/merge.js";
import { resolveQuestionnaireContext } from "../src/questionnaire.js";
import {
  resolveTarotContext,
  type TarotKnowledgeRule
} from "../src/tarot.js";

function revealed(cardId: string, slot: RevealedTarotCard["slot"]): RevealedTarotCard {
  const card = tarotCardById(cardId);
  assert.ok(card, `unknown tarot card: ${cardId}`);
  return { ...card, slot, orientation: "UPRIGHT", displayedPosition: 0 };
}

const STAR_RULE: TarotKnowledgeRule = {
  subject: "tarot:major-17-the-star",
  payload: {
    colors: ["color:blue", "color:white"],
    emotions: ["emotion:hope", "emotion:calm"],
    styles: ["style:ethereal"]
  },
  confidence: 0.85
};

const STAR = revealed("17-the-star", "GUIDANCE");

test("merging questionnaire and tarot keeps both sources with weights", () => {
  const questionnaire = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    maxBudgetMinor: 20000,
    emotionTags: ["calm"],
    styleTags: ["minimal"],
    colorTags: ["white"]
  });
  const tarot = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: deriveDesignSignals({
      spreadType: "SINGLE",
      cards: [STAR],
      theme: "SELF_GROWTH"
    }),
    revealedCards: [STAR],
    tarotRules: [STAR_RULE]
  });

  const merged = mergeContexts([questionnaire, tarot]);

  assert.ok(RecommendationContextSchema.safeParse(merged).success);
  assert.deepEqual(merged.sources, [
    { sourceType: "context-source:questionnaire", weight: 0.9 },
    { sourceType: "context-source:tarot", weight: 0.5 }
  ]);
  // Preferences are the union, questionnaire first, deduplicated.
  assert.deepEqual(merged.preferences.emotionTags, ["emotion:calm", "emotion:hope"]);
  assert.deepEqual(merged.preferences.styleTags, ["style:minimal", "style:ethereal"]);
  assert.deepEqual(merged.preferences.colorPreferences, ["color:white", "color:blue"]);
  // Hard constraints come from the non-tarot source.
  assert.equal(merged.hardConstraints.wristCircumferenceMm, 160);
  assert.equal(merged.hardConstraints.maxBudgetMinor, 20000);
});

test("merged context weights keep per-source keys distinct", () => {
  const questionnaire = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: ["calm"],
    styleTags: [],
    colorTags: []
  });
  const tarot = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: deriveDesignSignals({
      spreadType: "SINGLE",
      cards: [STAR],
      theme: "SELF_GROWTH"
    }),
    revealedCards: [STAR],
    tarotRules: [STAR_RULE]
  });

  const merged = mergeContexts([questionnaire, tarot]);
  assert.ok(merged.contextWeights["tarot:major-17-the-star"] !== undefined);
  assert.ok(Object.keys(merged.contextWeights).every((key) => key.length > 0));
});

test("merging three sources caps at four sources per contract", () => {
  const manual = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: ["focus"],
    styleTags: [],
    colorTags: []
  });
  const sources = [
    { sourceType: "context-source:manual" as const, weight: 1 },
    { sourceType: "context-source:questionnaire" as const, weight: 0.9 },
    { sourceType: "context-source:tarot" as const, weight: 0.5 }
  ];

  const merged = mergeContexts([
    { ...manual, sources: [sources[0]!] },
    { ...manual, sources: [sources[1]!] },
    { ...manual, sources: [sources[2]!] }
  ]);

  assert.ok(RecommendationContextSchema.safeParse(merged).success);
  assert.equal(merged.sources.length, 3);
});

test("duplicate sources are collapsed on merge", () => {
  const base = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: ["calm"],
    styleTags: [],
    colorTags: []
  });

  const merged = mergeContexts([base, structuredClone(base)]);
  assert.deepEqual(merged.sources, [
    { sourceType: "context-source:questionnaire", weight: 0.9 }
  ]);
  assert.deepEqual(merged.preferences.emotionTags, ["emotion:calm"]);
});

test("merged avoidances union across sources", () => {
  const first = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: [],
    styleTags: [],
    colorTags: [],
    avoidedMaterials: ["quartz"]
  });
  const second = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: [],
    styleTags: [],
    colorTags: [],
    avoidedMaterials: ["agate"],
    avoidedColorFamilies: ["red"]
  });

  const merged = mergeContexts([first, second]);
  assert.deepEqual(merged.avoidances.materialIds, ["material:quartz", "material:agate"]);
  assert.deepEqual(merged.avoidances.colorFamilyIds, ["color:red"]);
});

test("merge is order-deterministic", () => {
  const questionnaire = resolveQuestionnaireContext({
    wristCircumferenceMm: 160,
    emotionTags: ["calm"],
    styleTags: ["minimal"],
    colorTags: ["white"]
  });
  const tarot = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: deriveDesignSignals({
      spreadType: "SINGLE",
      cards: [STAR],
      theme: "SELF_GROWTH"
    }),
    revealedCards: [STAR],
    tarotRules: [STAR_RULE]
  });

  const first = JSON.stringify(mergeContexts([questionnaire, tarot]));
  const second = JSON.stringify(
    mergeContexts([structuredClone(questionnaire), structuredClone(tarot)])
  );
  assert.equal(first, second);
});
