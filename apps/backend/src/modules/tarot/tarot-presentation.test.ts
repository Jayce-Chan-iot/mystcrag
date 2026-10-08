import assert from "node:assert/strict";
import test from "node:test";

import { hasProhibitedOracleClaim } from "@mystcrag/ai-agent/oracle";
import {
  DesignV1Schema,
  TarotPresentationResponseSchema,
  TarotPublicSessionSchema,
  type TarotPublicSession
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { projectTarotPresentation } from "./tarot-presentation.js";

const LOCALES = ["zh-CN", "zh-TW", "en-US"] as const;
const CREATED_AT = "2026-08-20T12:00:00.000Z";
const UPDATED_AT = "2026-08-20T12:05:00.000Z";

const PENDING_MARKER: Record<(typeof LOCALES)[number], RegExp> = {
  "zh-CN": /尚未揭牌/u,
  "zh-TW": /尚未揭牌/u,
  "en-US": /not revealed/iu
};

const COMPLETION_CLAIM: Record<(typeof LOCALES)[number], RegExp> = {
  "zh-CN": /已完成/u,
  "zh-TW": /已完成/u,
  "en-US": /completed/iu
};

/** Reviewed readable names for the established palette used by the recommended session fixture. */
const REVIEWED_PALETTE_NAMES: Record<(typeof LOCALES)[number], readonly string[]> = {
  "zh-CN": ["雾蓝", "象牙白", "琥珀"],
  "zh-TW": ["霧藍", "象牙白", "琥珀"],
  "en-US": ["soft blue", "ivory", "amber"]
};

const tarotDesign = (rank: number) =>
  DesignV1Schema.parse({
    ...structuredClone(standardAiDesignFixture),
    designId: `tarot-presentation-design-${rank}`,
    designName: `Tarot presentation direction ${rank}`,
    designMode: "TAROT_GUIDED"
  });

const recommendationSnapshot = {
  interpretation: {
    headline: "把注意力放回當下的節奏",
    summary: "這組牌面邀請你從已有經驗中整理出更清晰的下一步。",
    cardReflections: [
      { slot: "PAST", reflection: "過去的沉澱可以成為穩定的參考。" },
      { slot: "PRESENT", reflection: "當下適合保留清晰而溫和的選擇。" },
      { slot: "FUTURE", reflection: "未來可用更開放的視角調整節奏。" }
    ],
    designRationale: "藍白色調和清透材質呼應這次反思與整理的主題。",
    disclaimer: "內容僅供自我反思與設計靈感參考，不構成確定性建議或功效承諾。"
  },
  colorStory: {
    primaryColor: "#6F95B5",
    supportColor: "#F2EEE5",
    accentColor: "#C8954C",
    rationale: "清透藍為主，柔和中性色承托，金色作為克制點綴。"
  },
  materialRecommendations: [
    {
      beadProductId: "product-aquamarine-round-8",
      displayName: "Aquamarine round bead",
      crystalName: "Aquamarine",
      colorTags: ["blue"],
      reason: "Its blue tone supports the visual palette."
    }
  ]
} as const;

const recommendedSession: TarotPublicSession = TarotPublicSessionSchema.parse({
  sessionId: "tarot-session-recommended",
  spreadType: "PAST_PRESENT_FUTURE",
  theme: "SELF_GROWTH",
  status: "RECOMMENDED",
  revision: 6,
  slots: ["PAST", "PRESENT", "FUTURE"],
  acceptedSelections: [
    { slot: "PAST", displayedPosition: 3, operationId: "op-past" },
    { slot: "PRESENT", displayedPosition: 11, operationId: "op-present" },
    { slot: "FUTURE", displayedPosition: 27, operationId: "op-future" }
  ],
  revealedCards: [
    {
      slot: "PAST",
      displayedPosition: 3,
      cardId: "09-the-hermit",
      number: 9,
      nameZh: "隐者",
      nameEn: "The Hermit",
      assetFile: "09-TheHermit.png",
      orientation: "UPRIGHT",
      keywords: ["reflection"]
    },
    {
      slot: "PRESENT",
      displayedPosition: 11,
      cardId: "10-wheel-of-fortune",
      number: 10,
      nameZh: "命运之轮",
      nameEn: "Wheel of Fortune",
      assetFile: "10-WheelOfFortune.png",
      orientation: "REVERSED",
      keywords: ["change"]
    },
    {
      slot: "FUTURE",
      displayedPosition: 27,
      cardId: "17-the-star",
      number: 17,
      nameZh: "星星",
      nameEn: "The Star",
      assetFile: "17-TheStar.png",
      orientation: "UPRIGHT",
      keywords: ["hope"]
    }
  ],
  interpretation: recommendationSnapshot.interpretation,
  colorStory: recommendationSnapshot.colorStory,
  materialRecommendations: [...recommendationSnapshot.materialRecommendations],
  recommendations: [1, 2, 3].map((rank) => ({
    rank,
    design: tarotDesign(rank)
  })),
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT
});

/** Same spread, palette, and materials as the recommended session, but a different past card. */
const swappedPastCardSession: TarotPublicSession = TarotPublicSessionSchema.parse({
  ...structuredClone(recommendedSession),
  revealedCards: recommendedSession.revealedCards!.map((card) =>
    card.slot === "PAST"
      ? {
          slot: "PAST",
          displayedPosition: card.displayedPosition,
          cardId: "18-the-moon",
          number: 18,
          nameZh: "月亮",
          nameEn: "The Moon",
          assetFile: "18-TheMoon.png",
          orientation: "UPRIGHT",
          keywords: ["intuition"]
        }
      : card
  )
});

/** Same spread and materials, but a different persisted palette. */
const warmPaletteSession: TarotPublicSession = TarotPublicSessionSchema.parse({
  ...structuredClone(recommendedSession),
  colorStory: {
    primaryColor: "#C0504D",
    supportColor: "#F7E7CE",
    accentColor: "#3B5B7A",
    rationale: "stored color rationale that must never be echoed"
  }
});

/** Same spread and palette, but a different persisted material recommendation. */
const redMaterialSession: TarotPublicSession = TarotPublicSessionSchema.parse({
  ...structuredClone(recommendedSession),
  materialRecommendations: [
    {
      beadProductId: "product-garnet-round-8",
      displayName: "Garnet round bead",
      crystalName: "Garnet",
      colorTags: ["red"],
      reason: "stored material reason that must never be echoed"
    }
  ]
});

/** Same palette and the same `blue` color tag as the recommended session, but a different real material. */
const sameColorMaterialSession: TarotPublicSession = TarotPublicSessionSchema.parse({
  ...structuredClone(recommendedSession),
  materialRecommendations: [
    {
      beadProductId: "product-blue-lace-agate-round-8",
      displayName: "Blue lace agate round bead",
      crystalName: "Blue Lace Agate",
      colorTags: ["blue"],
      reason: "stored material reason that must never be echoed"
    }
  ]
});

const drawnSingleSession: TarotPublicSession = TarotPublicSessionSchema.parse({
  sessionId: "tarot-session-drawn-single",
  spreadType: "SINGLE",
  theme: "SELF_GROWTH",
  status: "DRAWN",
  revision: 3,
  slots: ["GUIDANCE"],
  acceptedSelections: [{ slot: "GUIDANCE", displayedPosition: 12, operationId: "op-guidance" }],
  revealedCards: [
    {
      slot: "GUIDANCE",
      displayedPosition: 12,
      cardId: "09-the-hermit",
      number: 9,
      nameZh: "隐者",
      nameEn: "The Hermit",
      assetFile: "09-TheHermit.png",
      orientation: "UPRIGHT",
      keywords: ["reflection"]
    }
  ],
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT
});

const historicalDrawingSession: TarotPublicSession = TarotPublicSessionSchema.parse({
  sessionId: "tarot-session-historical",
  spreadType: "PAST_PRESENT_FUTURE",
  theme: "NEW_BEGINNINGS",
  status: "DRAWING",
  revision: 1,
  slots: ["PAST", "PRESENT", "FUTURE"],
  acceptedSelections: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z"
});

const projectionTexts = (projection: ReturnType<typeof projectTarotPresentation>): string[] => [
  projection.headline,
  projection.summary,
  ...projection.cardReflections.map((reflection) => reflection.text),
  projection.colorStory,
  projection.designRationale,
  projection.disclaimer
];

test("a recommended spread projects into all three display locales with distinct reviewed copy", () => {
  const headlines = new Set<string>();

  for (const locale of LOCALES) {
    const projection = projectTarotPresentation(recommendedSession, locale);

    assert.equal(TarotPresentationResponseSchema.safeParse(projection).success, true);
    assert.equal(projection.sessionId, recommendedSession.sessionId);
    assert.equal(projection.sourceRevision, recommendedSession.revision);
    assert.equal(projection.locale, locale);
    assert.deepEqual(
      projection.cardReflections.map((reflection) => reflection.slot),
      [...recommendedSession.slots]
    );
    assert.ok(projection.headline.length > 0 && projection.headline.length <= 48);
    assert.ok(projection.summary.length > 0 && projection.summary.length <= 240);

    headlines.add(projection.headline);
  }

  assert.equal(headlines.size, 3, "each locale must render distinct reviewed copy");
});

test("different revealed cards never share the same per-card reflection", () => {
  for (const locale of LOCALES) {
    const hermit = projectTarotPresentation(recommendedSession, locale).cardReflections[0]!.text;
    const moon = projectTarotPresentation(swappedPastCardSession, locale).cardReflections[0]!.text;

    assert.notEqual(
      hermit,
      moon,
      `${locale}: a different revealed card must not reuse the same reflection`
    );
  }
});

test("each revealed card in one spread gets its own reflection", () => {
  for (const locale of LOCALES) {
    const texts = projectTarotPresentation(recommendedSession, locale).cardReflections.map(
      (reflection) => reflection.text
    );

    assert.equal(new Set(texts).size, texts.length, `${locale}: reflections must be distinct per card`);
  }
});

test("different persisted palettes never share the same color story", () => {
  for (const locale of LOCALES) {
    const cool = projectTarotPresentation(recommendedSession, locale).colorStory;
    const warm = projectTarotPresentation(warmPaletteSession, locale).colorStory;

    assert.notEqual(cool, warm, `${locale}: a different palette must not reuse the same color story`);
    assert.equal(warm.includes("#C0504D"), true, `${locale}: the real primary color must be named`);
  }
});

test("different persisted materials never share the same design rationale", () => {
  for (const locale of LOCALES) {
    const blue = projectTarotPresentation(recommendedSession, locale).designRationale;
    const red = projectTarotPresentation(redMaterialSession, locale).designRationale;

    assert.notEqual(blue, red, `${locale}: different materials must not reuse the same rationale`);
  }
});

test("the same color from a different real material never shares the same design rationale", () => {
  for (const locale of LOCALES) {
    const aquamarine = projectTarotPresentation(recommendedSession, locale).designRationale;
    const agate = projectTarotPresentation(sameColorMaterialSession, locale).designRationale;

    assert.notEqual(
      aquamarine,
      agate,
      `${locale}: the same tone from a different material must not reuse the same rationale`
    );
  }
});

test("the design rationale names the real persisted material and invents no name", () => {
  for (const locale of LOCALES) {
    const projection = projectTarotPresentation(recommendedSession, locale);

    assert.equal(
      projection.designRationale.includes("Aquamarine"),
      true,
      `${locale}: the persisted material name must appear in ${projection.designRationale}`
    );
    assert.equal(
      projection.designRationale.includes("product-aquamarine-round-8"),
      false,
      `${locale}: an internal product id must not stand in for a material name`
    );
    assert.equal(
      projection.designRationale.includes(recommendedSession.materialRecommendations![0]!.reason),
      false,
      `${locale}: the stored material reason must never be echoed`
    );
  }
});

test("the established palette renders reviewed three-language color names", () => {
  for (const locale of LOCALES) {
    const colorStory = projectTarotPresentation(recommendedSession, locale).colorStory;

    for (const word of REVIEWED_PALETTE_NAMES[locale]) {
      assert.equal(colorStory.includes(word), true, `${locale}: expected ${word} in ${colorStory}`);
    }
    for (const hex of ["#6F95B5", "#F2EEE5", "#C8954C"]) {
      assert.equal(
        colorStory.includes(hex),
        false,
        `${locale}: a known palette color must be named, not shown as ${hex}`
      );
    }
  }
});

test("an unknown historical color value falls back to its raw hex without borrowing a name", () => {
  for (const locale of LOCALES) {
    const colorStory = projectTarotPresentation(warmPaletteSession, locale).colorStory;

    for (const hex of ["#C0504D", "#F7E7CE", "#3B5B7A"]) {
      assert.equal(colorStory.includes(hex), true, `${locale}: unknown color must fall back to ${hex}`);
    }
    for (const word of REVIEWED_PALETTE_NAMES[locale]) {
      assert.equal(
        colorStory.includes(word),
        false,
        `${locale}: an unknown color must not borrow the reviewed name ${word}`
      );
    }
  }
});

test("an un-revealed session is never written as a completed reading", () => {
  for (const locale of LOCALES) {
    const projection = projectTarotPresentation(historicalDrawingSession, locale);

    assert.equal(projection.cardReflections.length, historicalDrawingSession.slots.length);
    for (const reflection of projection.cardReflections) {
      assert.match(reflection.text, PENDING_MARKER[locale], `${locale}: ${reflection.text}`);
      assert.doesNotMatch(reflection.text, COMPLETION_CLAIM[locale], `${locale}: ${reflection.text}`);
    }
    assert.match(projection.designRationale, PENDING_MARKER[locale]);
    assert.doesNotMatch(projection.designRationale, COMPLETION_CLAIM[locale]);
    assert.doesNotMatch(projection.summary, COMPLETION_CLAIM[locale]);
    assert.doesNotMatch(projection.colorStory, COMPLETION_CLAIM[locale]);
  }
});

test("card reflections stay in canonical slot order and never expose raw draw internals", () => {
  const projection = projectTarotPresentation(recommendedSession, "zh-TW");

  assert.deepEqual(
    projection.cardReflections.map((reflection) => reflection.slot),
    ["PAST", "PRESENT", "FUTURE"]
  );
  assert.match(projection.cardReflections[0]!.text, /隱者/u);

  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    "revealedCards",
    "cardId",
    "the-hermit",
    "Wheel of Fortune",
    "keywords",
    "displayedPosition",
    "operationId"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("the projection is deterministic, read-only, and never reuses stored free text", () => {
  const sessionSnapshot = structuredClone(recommendedSession);

  assert.deepEqual(
    projectTarotPresentation(recommendedSession, "zh-CN"),
    projectTarotPresentation(recommendedSession, "zh-CN")
  );
  assert.deepEqual(recommendedSession, sessionSnapshot, "the source session must never be mutated");
  assert.deepEqual(recommendedSession.interpretation, sessionSnapshot.interpretation);

  const storedSummary = recommendedSession.interpretation!.summary;
  const storedDesignRationale = recommendedSession.interpretation!.designRationale;
  const storedColorRationale = recommendedSession.colorStory!.rationale;
  const storedMaterialReason = recommendedSession.materialRecommendations![0]!.reason;

  for (const locale of LOCALES) {
    const projection = projectTarotPresentation(recommendedSession, locale);
    assert.notEqual(projection.summary, storedSummary);
    assert.notEqual(projection.designRationale, storedDesignRationale);
    assert.notEqual(projection.colorStory, storedColorRationale);

    for (const text of projectionTexts(projection)) {
      assert.equal(text.includes(storedSummary), false, `${locale}: ${text}`);
      assert.equal(text.includes(storedDesignRationale), false, `${locale}: ${text}`);
      assert.equal(text.includes(storedColorRationale), false, `${locale}: ${text}`);
      assert.equal(text.includes(storedMaterialReason), false, `${locale}: ${text}`);
    }
  }
});

test("a historical drawing session stays readable without a second draw", () => {
  for (const locale of LOCALES) {
    const projection = projectTarotPresentation(historicalDrawingSession, locale);

    assert.equal(TarotPresentationResponseSchema.safeParse(projection).success, true);
    assert.equal(projection.sourceRevision, historicalDrawingSession.revision);
    assert.equal(projection.cardReflections.length, historicalDrawingSession.slots.length);
    assert.equal(JSON.stringify(projection).includes("revealedCards"), false);
    assert.ok(projection.colorStory.length > 0);
    assert.ok(projection.designRationale.length > 0);
  }

  const single = projectTarotPresentation(drawnSingleSession, "en-US");
  assert.equal(single.cardReflections.length, 1);
  assert.equal(single.cardReflections[0]!.slot, "GUIDANCE");
});

test("the projection carries no design identifier, price, stock, currency, or question", () => {
  const projection = projectTarotPresentation(recommendedSession, "zh-CN");
  const serialized = JSON.stringify(projection);

  assert.equal("designId" in projection, false);
  for (const forbidden of [
    "designId",
    "tarot-presentation-design-1",
    "unitPriceMinor",
    "totalPriceMinor",
    "availableQuantity",
    "currency",
    "sku",
    "questionCiphertext",
    "questionSavedAt"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("en-US copy is free of Han text and every string passes the prohibited-claim detector", () => {
  for (const locale of LOCALES) {
    const projection = projectTarotPresentation(recommendedSession, locale);
    for (const text of projectionTexts(projection)) {
      assert.equal(hasProhibitedOracleClaim(text), false, `${locale}: ${text}`);
    }
  }

  const english = projectionTexts(projectTarotPresentation(recommendedSession, "en-US")).join(" ");
  assert.equal(/[\u3400-\u9fff\uf900-\ufaff]/u.test(english), false, "en-US copy must not mix Han text");
});

test("simplified and traditional reflections use distinct reviewed scripts", () => {
  const simplified = projectTarotPresentation(recommendedSession, "zh-CN");
  const traditional = projectTarotPresentation(recommendedSession, "zh-TW");

  assert.notEqual(traditional.headline, simplified.headline);
  assert.match(traditional.cardReflections[0]!.text, /隱者/u);
  assert.match(simplified.cardReflections[0]!.text, /隐者/u);
  assert.equal(traditional.cardReflections[0]!.text.includes("隐者"), false);
  assert.match(traditional.cardReflections[0]!.text, /經驗/u);
  assert.match(simplified.cardReflections[0]!.text, /经验/u);
});

test("an unsupported display locale is rejected before any projection", () => {
  assert.throws(() => projectTarotPresentation(recommendedSession, "ja-JP" as never));
  assert.throws(() => projectTarotPresentation(recommendedSession, "zh" as never));
});
