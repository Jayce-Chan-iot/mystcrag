import assert from "node:assert/strict";
import test from "node:test";

import {
  RecommendationContextSchema,
  type RecommendationContext
} from "@mystcrag/design-contract";
import {
  deriveDesignSignals,
  tarotCardById,
  type RevealedTarotCard,
  type TarotDesignSignals
} from "@mystcrag/tarot-engine";

import {
  resolveTarotContext,
  type TarotKnowledgeRule
} from "../src/tarot.js";

function revealed(cardId: string, slot: RevealedTarotCard["slot"]): RevealedTarotCard {
  const card = tarotCardById(cardId);
  assert.ok(card, `unknown tarot card: ${cardId}`);
  return { ...card, slot, orientation: "UPRIGHT", displayedPosition: 0 };
}

const STAR = revealed("17-the-star", "GUIDANCE");
const SUN = revealed("19-the-sun", "GUIDANCE");
const PRIESTESS = revealed("02-the-high-priestess", "GUIDANCE");

const TAROT_RULES: readonly TarotKnowledgeRule[] = [
  {
    subject: "tarot:major-17-the-star",
    payload: {
      colors: ["color:blue", "color:white"],
      emotions: ["emotion:hope", "emotion:calm", "emotion:renewal"],
      styles: ["style:ethereal"]
    },
    confidence: 0.85
  },
  {
    subject: "tarot:major-19-the-sun",
    payload: {
      colors: ["color:yellow", "color:orange"],
      emotions: ["emotion:joy", "emotion:vitality"],
      styles: ["style:natural"]
    },
    confidence: 0.82
  }
];

function singleDrawSignals(card: RevealedTarotCard): TarotDesignSignals {
  return deriveDesignSignals({
    spreadType: "SINGLE",
    cards: [card],
    theme: "SELF_GROWTH"
  });
}

test("tarot draw maps knowledge rules into soft preferences only", () => {
  const context = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: singleDrawSignals(STAR),
    revealedCards: [STAR],
    tarotRules: TAROT_RULES
  });

  assert.ok(RecommendationContextSchema.safeParse(context).success);
  assert.deepEqual(context.sources, [
    { sourceType: "context-source:tarot", weight: 0.5 }
  ]);
  assert.deepEqual(context.preferences.emotionTags, [
    "emotion:hope",
    "emotion:calm",
    "emotion:renewal"
  ]);
  assert.deepEqual(context.preferences.styleTags, ["style:ethereal"]);
  assert.deepEqual(context.preferences.colorPreferences, ["color:blue", "color:white"]);
  // Tarot stays soft cultural context: no avoidances, no product constraints.
  assert.deepEqual(context.avoidances.materialIds, []);
  assert.deepEqual(context.avoidances.colorFamilyIds, []);
  assert.deepEqual(context.hardConstraints.excludedProductIds, []);
  assert.deepEqual(context.hardConstraints.requiredProductIds, []);
  assert.equal(context.hardConstraints.wristCircumferenceMm, 160);
});

test("cards without knowledge rules fall back to design signals", () => {
  const context = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: singleDrawSignals(PRIESTESS),
    revealedCards: [PRIESTESS],
    tarotRules: TAROT_RULES
  });

  assert.ok(RecommendationContextSchema.safeParse(context).success);
  // The High Priestess tone is blue -> canonical color:blue. Her keywords
  // (intuition/mystery/reflection) match no EMOTION term, so emotions stay
  // empty rather than inventing mappings.
  assert.deepEqual(context.preferences.colorPreferences, ["color:blue"]);
  assert.deepEqual(context.preferences.emotionTags, []);
});

test("multiple cards merge rule preferences deterministically", () => {
  const context = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: deriveDesignSignals({
      spreadType: "PAST_PRESENT_FUTURE",
      cards: [
        revealed("19-the-sun", "PAST"),
        revealed("17-the-star", "PRESENT"),
        revealed("17-the-star", "FUTURE")
      ],
      theme: "SELF_GROWTH"
    }),
    revealedCards: [revealed("19-the-sun", "PAST"), revealed("17-the-star", "PRESENT")],
    tarotRules: TAROT_RULES
  });

  const emotions = context.preferences.emotionTags.join(",");
  assert.ok(emotions.includes("emotion:hope"));
  assert.ok(emotions.includes("emotion:joy"));
  // No duplicates from repeated cards.
  assert.equal(
    context.preferences.emotionTags.length,
    new Set(context.preferences.emotionTags).size
  );
});

test("tarot context records rule provenance in contextWeights", () => {
  const context = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: singleDrawSignals(STAR),
    revealedCards: [STAR],
    tarotRules: TAROT_RULES
  });

  const weights = Object.keys(context.contextWeights);
  assert.ok(weights.length >= 1);
  assert.ok(weights.every((key) => key.startsWith("tarot:")));
});

test("tarot context is deterministic across runs", () => {
  const run = (): RecommendationContext =>
    resolveTarotContext({
      wristCircumferenceMm: 160,
      signals: singleDrawSignals(STAR),
      revealedCards: [STAR],
      tarotRules: TAROT_RULES
    });

  const baseline = JSON.stringify(run());
  for (let index = 0; index < 50; index += 1) {
    assert.equal(JSON.stringify(run()), baseline);
  }
});

test("empty tarot rules still produce a valid soft context from signals", () => {
  const context = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: singleDrawSignals(SUN),
    revealedCards: [SUN],
    tarotRules: []
  });

  assert.ok(RecommendationContextSchema.safeParse(context).success);
  assert.deepEqual(context.sources, [
    { sourceType: "context-source:tarot", weight: 0.5 }
  ]);
  // Sun tone is amber -> warm canonical color:yellow via the tone map, and
  // her keywords (joy/vitality) map onto EMOTION terms.
  assert.deepEqual(context.preferences.colorPreferences, ["color:yellow"]);
  assert.deepEqual(context.preferences.emotionTags, ["emotion:joy", "emotion:vitality"]);
});

test("context id is content-addressed", () => {
  const first = resolveTarotContext({
    wristCircumferenceMm: 160,
    signals: singleDrawSignals(STAR),
    revealedCards: [STAR],
    tarotRules: TAROT_RULES
  });
  const second = resolveTarotContext({
    wristCircumferenceMm: 170,
    signals: singleDrawSignals(STAR),
    revealedCards: [STAR],
    tarotRules: TAROT_RULES
  });

  assert.notEqual(first.contextId, second.contextId);
  assert.match(first.contextId, /^ctx-[0-9a-f]{12}$/);
});
