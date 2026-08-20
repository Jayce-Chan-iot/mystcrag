import assert from "node:assert/strict";
import test from "node:test";

import { PublicDrawStateSchema, TAROT_CARD_CATALOG } from "../src/index";

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
    assert.match(card.assetFile, /^[^/\\]+$/);
    assert.equal(card.assetFile.includes(".."), false);
  }
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
