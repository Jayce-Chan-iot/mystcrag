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
      cardId: "the-hermit",
      number: 9,
      nameZh: "隐者",
      nameEn: "The Hermit",
      assetFile: "TheHermit.png",
      orientation: "UPRIGHT",
      keywords: ["reflection"]
    },
    {
      slot: "PRESENT",
      displayedPosition: 11,
      cardId: "wheel-of-fortune",
      number: 10,
      nameZh: "命运之轮",
      nameEn: "Wheel of Fortune",
      assetFile: "WheelOfFortune.png",
      orientation: "REVERSED",
      keywords: ["change"]
    },
    {
      slot: "FUTURE",
      displayedPosition: 27,
      cardId: "the-star",
      number: 17,
      nameZh: "星星",
      nameEn: "The Star",
      assetFile: "TheStar.png",
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
      cardId: "the-hermit",
      number: 9,
      nameZh: "隐者",
      nameEn: "The Hermit",
      assetFile: "TheHermit.png",
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

test("card reflections stay in canonical slot order and never expose a second draw", () => {
  const projection = projectTarotPresentation(recommendedSession, "zh-TW");

  assert.deepEqual(
    projection.cardReflections.map((reflection) => reflection.slot),
    ["PAST", "PRESENT", "FUTURE"]
  );

  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes("revealedCards"), false);
  assert.equal(serialized.includes("cardId"), false);
  assert.equal(serialized.includes("the-hermit"), false);
  assert.equal(serialized.includes("Wheel of Fortune"), false);
  assert.equal(serialized.includes("keywords"), false);
  assert.equal(serialized.includes("displayedPosition"), false);
});

test("the projection is deterministic, read-only, and never reuses stored free text", () => {
  const sessionSnapshot = structuredClone(recommendedSession);

  assert.deepEqual(
    projectTarotPresentation(recommendedSession, "zh-CN"),
    projectTarotPresentation(recommendedSession, "zh-CN")
  );
  assert.deepEqual(recommendedSession, sessionSnapshot, "the source session must never be mutated");
  assert.deepEqual(recommendedSession.interpretation, sessionSnapshot.interpretation);

  for (const locale of LOCALES) {
    const projection = projectTarotPresentation(recommendedSession, locale);
    assert.notEqual(projection.summary, recommendedSession.interpretation!.summary);
    assert.notEqual(projection.designRationale, recommendedSession.interpretation!.designRationale);
    assert.notEqual(projection.colorStory, recommendedSession.colorStory!.rationale);
    assert.equal(projectionTexts(projection).includes(recommendedSession.interpretation!.summary), false);
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
  assert.match(traditional.cardReflections[0]!.text, /過去/u);
  assert.match(simplified.cardReflections[0]!.text, /过去/u);
  assert.equal(traditional.cardReflections[0]!.text.includes("过去"), false);
});

test("an unsupported display locale is rejected before any projection", () => {
  assert.throws(() => projectTarotPresentation(recommendedSession, "ja-JP" as never));
  assert.throws(() => projectTarotPresentation(recommendedSession, "zh" as never));
});
