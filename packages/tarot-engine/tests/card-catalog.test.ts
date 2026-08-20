import assert from "node:assert/strict";
import test from "node:test";

import {
  DESIGN_TAG_VERSION,
  PrivateDrawStateSchema,
  PublicDrawStateSchema,
  TAROT_CARD_CATALOG,
  TarotCardDefinitionSchema,
} from "../src/index";

test("exposes 78 safe, localized cards with versioned design metadata", () => {
  assert.equal(TAROT_CARD_CATALOG.length, 78);

  const ids = TAROT_CARD_CATALOG.map((card) => card.id);
  const assetFiles = TAROT_CARD_CATALOG.map((card) => card.assetFile);
  assert.equal(new Set(ids).size, 78);
  assert.equal(new Set(assetFiles).size, 78);

  for (const card of TAROT_CARD_CATALOG) {
    assert.ok(card.nameZh.length > 0);
    assert.ok(card.nameEn.length > 0);
    assert.ok(card.uprightKeywords.length > 0);
    assert.ok(card.reversedKeywords.length > 0);
    assert.ok(card.designTags.colors.length > 0);
    assert.ok(card.designTags.visual.length > 0);
    assert.ok(card.designTags.themes.length > 0);
    assert.equal(TarotCardDefinitionSchema.safeParse(card).success, true);
    for (const tag of [
      ...card.designTags.colors,
      ...card.designTags.visual,
      ...card.designTags.themes,
    ]) {
      assert.match(tag, new RegExp(`-v${DESIGN_TAG_VERSION.slice(1)}:`));
    }
    assert.match(card.assetFile, /^[^/\\]+$/);
    assert.equal(card.assetFile.includes(".."), false);
  }
});

test("gives every Minor Arcana rank distinct metadata within its suit", () => {
  for (const suit of ["wands", "cups", "swords", "pentacles"]) {
    const rankMetadata = TAROT_CARD_CATALOG
      .filter((card) => card.id.startsWith(`${suit}-`))
      .map((card) => JSON.stringify({
        uprightKeywords: card.uprightKeywords,
        reversedKeywords: card.reversedKeywords,
        designTags: card.designTags,
      }));

    assert.equal(rankMetadata.length, 14);
    assert.equal(new Set(rankMetadata).size, 14);
  }
});

test("rejects private state that violates canonical deck and spread invariants", () => {
  const valid = {
    spreadType: "PAST_PRESENT_FUTURE" as const,
    deckOrder: TAROT_CARD_CATALOG.map((card) => card.id),
    orientationOrder: Array.from({ length: 78 }, () => "UPRIGHT" as const),
    selections: [
      { slot: "PAST" as const, displayedPosition: 0, operationId: "past" },
      { slot: "PRESENT" as const, displayedPosition: 1, operationId: "present" },
    ],
    revision: 2,
    revealed: false,
  };

  assert.equal(PrivateDrawStateSchema.safeParse(valid).success, true);
  assert.equal(PrivateDrawStateSchema.safeParse({
    ...valid,
    deckOrder: [...valid.deckOrder.slice(0, 77), valid.deckOrder[0]],
  }).success, false);
  assert.equal(PrivateDrawStateSchema.safeParse({
    ...valid,
    deckOrder: [...valid.deckOrder.slice(0, 77), "not-a-tarot-card"],
  }).success, false);
  assert.equal(PrivateDrawStateSchema.safeParse({
    ...valid,
    selections: [valid.selections[0], { slot: "PRESENT", displayedPosition: 0, operationId: "present-duplicate-position" }],
  }).success, false);
  assert.equal(PrivateDrawStateSchema.safeParse({
    ...valid,
    selections: [valid.selections[0], { slot: "PRESENT", displayedPosition: 1, operationId: "past" }],
  }).success, false);
  assert.equal(PrivateDrawStateSchema.safeParse({
    ...valid,
    selections: [{ slot: "PRESENT", displayedPosition: 0, operationId: "present" }],
  }).success, false);
  assert.equal(PrivateDrawStateSchema.safeParse({ ...valid, revealed: true }).success, false);
});

test("rejects unrevealed public state that includes card identities", () => {
  const result = PublicDrawStateSchema.safeParse({
    spreadType: "SINGLE",
    selections: [],
    revision: 0,
    revealed: false,
    cards: [
      {
        ...TAROT_CARD_CATALOG[0],
        slot: "GUIDANCE",
        orientation: "UPRIGHT",
        displayedPosition: 0,
      },
    ],
  });

  assert.equal(result.success, false);
});
