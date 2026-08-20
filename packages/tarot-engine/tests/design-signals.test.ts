import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveDesignSignals,
  scoreTarotMaterials,
  tarotCardById,
  type RevealedTarotCard,
} from "../src/index";

const revealed = (
  id: string,
  slot: RevealedTarotCard["slot"],
  orientation: RevealedTarotCard["orientation"] = "UPRIGHT",
): RevealedTarotCard => {
  const card = tarotCardById(id);
  assert.ok(card);
  return { ...card, slot, orientation, displayedPosition: 0 };
};

test("uses Present, Past, and Future cards as primary, support, and accent", () => {
  const signals = deriveDesignSignals({
    spreadType: "PAST_PRESENT_FUTURE",
    cards: [
      revealed("00-the-fool", "PAST"),
      revealed("01-the-magician", "PRESENT"),
      revealed("02-the-high-priestess", "FUTURE"),
    ],
    theme: "SELF_GROWTH",
  });

  assert.deepEqual(signals.palette, {
    primary: "violet",
    support: "amber",
    accent: "blue",
  });
  assert.deepEqual(signals.directions, ["BALANCED", "CONTRAST", "NEUTRAL_LED"]);
  assert.equal(signals.ruleVersion, "tarot-design-rules-v1");
});

test("completes a single-card palette with restrained neutral colors", () => {
  const signals = deriveDesignSignals({
    spreadType: "SINGLE",
    cards: [revealed("00-the-fool", "GUIDANCE")],
    theme: "NEW_BEGINNINGS",
  });

  assert.deepEqual(signals.palette, {
    primary: "amber",
    support: "ivory",
    accent: "ink",
  });
});

test("includes reversed-card tags in deterministic structured signals", () => {
  const signals = deriveDesignSignals({
    spreadType: "SINGLE",
    cards: [revealed("01-the-magician", "GUIDANCE", "REVERSED")],
    theme: "CAREER",
  });

  assert.ok(signals.styleTags.includes("orientation-v1:reversed"));
  assert.ok(signals.styleTags.includes("keyword-v1:planning"));
  assert.ok(signals.themeTags.includes("theme-v1:career"));
});

test("scores active catalog products with explicit 40/25/15/10/10 dimensions", () => {
  const signals = deriveDesignSignals({
    spreadType: "SINGLE",
    cards: [revealed("01-the-magician", "GUIDANCE")],
    theme: "CAREER",
  });

  const scored = scoreTarotMaterials({
    signals,
    products: [
      {
        productId: "product-full-match",
        colorTags: ["violet"],
        visualStyleTags: ["focused"],
        themeTags: ["career"],
        active: true,
        unitPriceMinor: 500,
      },
      {
        productId: "product-color-only",
        colorTags: ["violet"],
        visualStyleTags: [],
        themeTags: [],
        active: true,
        unitPriceMinor: 500,
      },
      {
        productId: "product-style-only",
        colorTags: [],
        visualStyleTags: ["visual-v1:focused"],
        themeTags: [],
        active: true,
        unitPriceMinor: 500,
      },
      {
        productId: "product-theme-only",
        colorTags: [],
        visualStyleTags: [],
        themeTags: ["theme-v1:career"],
        active: true,
        unitPriceMinor: 500,
      },
    ],
    budget: { minMinor: 100, maxMinor: 1_000 },
  });

  assert.deepEqual(
    scored.map(({ productId, totalScore, scores }) => ({ productId, totalScore, scores })),
    [
      {
        productId: "product-full-match",
        totalScore: 100,
        scores: { color: 40, visualStyle: 25, theme: 15, availability: 10, budget: 10 },
      },
      {
        productId: "product-color-only",
        totalScore: 60,
        scores: { color: 40, visualStyle: 0, theme: 0, availability: 10, budget: 10 },
      },
      {
        productId: "product-style-only",
        totalScore: 45,
        scores: { color: 0, visualStyle: 25, theme: 0, availability: 10, budget: 10 },
      },
      {
        productId: "product-theme-only",
        totalScore: 35,
        scores: { color: 0, visualStyle: 0, theme: 15, availability: 10, budget: 10 },
      },
    ],
  );
});

test("excludes inactive products and sorts exact score ties by product ID", () => {
  const signals = deriveDesignSignals({
    spreadType: "SINGLE",
    cards: [revealed("00-the-fool", "GUIDANCE")],
    theme: "NEW_BEGINNINGS",
  });

  const scored = scoreTarotMaterials({
    signals,
    products: [
      {
        productId: "product-zeta",
        colorTags: [],
        visualStyleTags: [],
        themeTags: [],
        active: true,
        unitPriceMinor: 2_000,
      },
      {
        productId: "product-inactive-perfect",
        colorTags: ["amber"],
        visualStyleTags: ["light"],
        themeTags: ["new-beginnings"],
        active: false,
        unitPriceMinor: 500,
      },
      {
        productId: "product-alpha",
        colorTags: [],
        visualStyleTags: [],
        themeTags: [],
        active: true,
        unitPriceMinor: 2_000,
      },
    ],
  });

  assert.deepEqual(scored.map(({ productId }) => productId), [
    "product-alpha",
    "product-zeta",
  ]);
  assert.ok(scored.every(({ scores }) => scores.availability === 10 && scores.budget === 10));
});

test("keeps budget as a scored dimension instead of filtering products", () => {
  const signals = deriveDesignSignals({
    spreadType: "SINGLE",
    cards: [revealed("00-the-fool", "GUIDANCE")],
    theme: "NEW_BEGINNINGS",
  });

  const scored = scoreTarotMaterials({
    signals,
    products: [
      {
        productId: "product-over-budget",
        colorTags: ["amber"],
        visualStyleTags: ["light"],
        themeTags: ["new-beginnings"],
        active: true,
        unitPriceMinor: 2_000,
      },
    ],
    budget: { maxMinor: 1_000 },
  });

  assert.equal(scored.length, 1);
  assert.equal(scored[0]?.scores.budget, 0);
  assert.equal(scored[0]?.totalScore, 90);
});
