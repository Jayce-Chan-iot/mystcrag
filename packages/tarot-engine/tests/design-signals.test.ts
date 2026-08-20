import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveDesignSignals,
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
