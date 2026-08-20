import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateTarotSessionRequestSchema,
  CreateTarotSessionResponseSchema,
  GenerateTarotRecommendationsRequestSchema,
  GenerateTarotRecommendationsResponseSchema,
  GetTarotSessionResponseSchema,
  RevealTarotSessionRequestSchema,
  RevealTarotSessionResponseSchema,
  SaveTarotSessionRequestSchema,
  SaveTarotSessionResponseSchema,
  SelectTarotCardRequestSchema,
  SelectTarotCardResponseSchema,
  TarotPublicSessionSchema
} from "../src/index";
import { standardAiDesignFixture } from "../src/fixtures/index";

const createdAt = "2026-08-20T08:00:00.000Z";
const updatedAt = "2026-08-20T08:05:00.000Z";

const recommendationDesigns = ["tarot-design-balanced", "tarot-design-contrast", "tarot-design-neutral"].map(
  (designId) => ({ ...structuredClone(standardAiDesignFixture), designId, designMode: "TAROT_GUIDED" })
);

const drawingSession = {
  sessionId: "tarot-session-1",
  spreadType: "PAST_PRESENT_FUTURE",
  theme: "SELF_GROWTH",
  status: "DRAWING",
  revision: 1,
  slots: ["PAST", "PRESENT", "FUTURE"],
  acceptedSelections: [],
  createdAt,
  updatedAt
} as const;

const drawnSession = {
  ...drawingSession,
  status: "DRAWN",
  revision: 5,
  acceptedSelections: [
    { slot: "PAST", displayedPosition: 4, operationId: "select-past-1" },
    { slot: "PRESENT", displayedPosition: 21, operationId: "select-present-1" },
    { slot: "FUTURE", displayedPosition: 63, operationId: "select-future-1" }
  ],
  revealedCards: [
    {
      slot: "PAST",
      displayedPosition: 4,
      cardId: "the-hermit",
      number: 9,
      nameZh: "隐者",
      nameEn: "The Hermit",
      assetFile: "the-hermit.webp",
      orientation: "UPRIGHT",
      keywords: ["reflection", "patience"]
    },
    {
      slot: "PRESENT",
      displayedPosition: 21,
      cardId: "the-star",
      number: 17,
      nameZh: "星星",
      nameEn: "The Star",
      assetFile: "the-star.webp",
      orientation: "UPRIGHT",
      keywords: ["hope", "clarity"]
    },
    {
      slot: "FUTURE",
      displayedPosition: 63,
      cardId: "the-world",
      number: 21,
      nameZh: "世界",
      nameEn: "The World",
      assetFile: "the-world.webp",
      orientation: "REVERSED",
      keywords: ["integration", "perspective"]
    }
  ]
} as const;

const recommendedSession = {
  ...drawnSession,
  status: "RECOMMENDED",
  revision: 6,
  interpretation: {
    headline: "把注意力放回当下的节奏",
    summary: "这组牌面邀请你从已有经验中整理出更清晰的下一步。",
    cardReflections: [
      { slot: "PAST", reflection: "过去的沉淀可以成为稳定的参考。" },
      { slot: "PRESENT", reflection: "当下适合保留清晰而温和的选择。" },
      { slot: "FUTURE", reflection: "未来可用更开放的视角调整节奏。" }
    ],
    designRationale: "蓝白色调和清透材质呼应这次反思与整理的主题。",
    disclaimer: "内容仅供自我反思与设计灵感参考，不构成确定性建议或功效承诺。"
  },
  colorStory: {
    primaryColor: "#8BC6D9",
    supportColor: "#E9E4D8",
    accentColor: "#C9A86A",
    rationale: "清透蓝为主，柔和中性色承托，金色作为克制点缀。"
  },
  materialRecommendations: [
    {
      beadProductId: "product-aquamarine-round-8",
      displayName: "海蓝宝圆珠 8mm",
      crystalName: "海蓝宝",
      colorTags: ["blue", "clear"],
      reason: "作为主色材质，呈现清透而平衡的视觉节奏。"
    }
  ],
  recommendations: recommendationDesigns.map((design, index) => ({ rank: index + 1, design }))
} as const;

test("Tarot API requests and all six endpoint responses accept public-safe payloads", () => {
  assert.equal(
    CreateTarotSessionRequestSchema.safeParse({
      requestId: "request-create-1",
      spreadType: "PAST_PRESENT_FUTURE",
      theme: "SELF_GROWTH",
      parentSessionId: "tarot-session-parent-1"
    }).success,
    true
  );
  assert.equal(
    CreateTarotSessionResponseSchema.safeParse({
      requestId: "request-create-1",
      session: drawingSession,
      cardBack: { assetFile: "tarot-card-back.webp", altText: "Tarot card back" }
    }).success,
    true
  );

  assert.equal(
    SelectTarotCardRequestSchema.safeParse({
      requestId: "request-select-1",
      slot: "PAST",
      displayedPosition: 4,
      expectedRevision: 1,
      operationId: "select-past-1"
    }).success,
    true
  );
  assert.equal(
    SelectTarotCardResponseSchema.safeParse({ requestId: "request-select-1", session: drawingSession })
      .success,
    true
  );

  assert.equal(
    RevealTarotSessionRequestSchema.safeParse({ requestId: "request-reveal-1", expectedRevision: 4 })
      .success,
    true
  );
  assert.equal(
    RevealTarotSessionResponseSchema.safeParse({ requestId: "request-reveal-1", session: drawnSession })
      .success,
    true
  );

  assert.equal(
    GenerateTarotRecommendationsRequestSchema.safeParse({
      requestId: "request-recommend-1",
      expectedRevision: 5,
      question: "接下来我可以如何安排自己的节奏？",
      saveQuestion: false,
      locale: "zh-CN",
      currency: "CNY"
    }).success,
    true
  );
  assert.equal(
    GenerateTarotRecommendationsResponseSchema.safeParse({
      requestId: "request-recommend-1",
      session: recommendedSession
    }).success,
    true
  );
  assert.equal(
    GetTarotSessionResponseSchema.safeParse({ requestId: "request-get-1", session: recommendedSession })
      .success,
    true
  );

  assert.equal(
    SaveTarotSessionRequestSchema.safeParse({
      requestId: "request-save-1",
      expectedRevision: 6,
      selectedDesignId: "tarot-design-balanced"
    }).success,
    true
  );
  assert.equal(
    SaveTarotSessionResponseSchema.safeParse({
      requestId: "request-save-1",
      session: { ...recommendedSession, status: "SAVED", selectedDesignId: "tarot-design-balanced" }
    }).success,
    true
  );
});

test("Tarot public schemas reject private state and unknown fields", () => {
  assert.equal(
    TarotPublicSessionSchema.safeParse({ ...drawingSession, privateDeckState: { deckOrder: ["the-fool"] } })
      .success,
    false
  );
  assert.equal(
    TarotPublicSessionSchema.safeParse({ ...drawingSession, questionCiphertext: "private" }).success,
    false
  );
  assert.equal(
    CreateTarotSessionRequestSchema.safeParse({
      requestId: "request-create-private",
      spreadType: "SINGLE",
      theme: "CAREER",
      orientationOrder: ["UPRIGHT"]
    }).success,
    false
  );
  assert.equal(
    CreateTarotSessionResponseSchema.safeParse({
      requestId: "request-create-extra",
      session: drawingSession,
      cardBack: { assetFile: "tarot-card-back.webp", altText: "Tarot card back" },
      inventoryQuantity: 12
    }).success,
    false
  );
});

test("Tarot contracts enforce public request bounds and state ordering", () => {
  assert.equal(
    GenerateTarotRecommendationsRequestSchema.safeParse({
      requestId: "request-question-too-long",
      expectedRevision: 1,
      question: "x".repeat(121),
      locale: "zh-CN",
      currency: "CNY"
    }).success,
    false
  );
  assert.equal(
    SelectTarotCardRequestSchema.safeParse({
      requestId: "request-negative-position",
      slot: "GUIDANCE",
      displayedPosition: -1,
      expectedRevision: 1,
      operationId: "select-guidance-1"
    }).success,
    false
  );
  assert.equal(
    TarotPublicSessionSchema.safeParse({ ...drawingSession, slots: ["PRESENT", "PAST", "FUTURE"] })
      .success,
    false
  );
  assert.equal(
    TarotPublicSessionSchema.safeParse({ ...drawnSession, revealedCards: drawnSession.revealedCards.slice(0, 2) })
      .success,
    false
  );
});

test("Tarot recommendations require ranks one through three and PublicDesignV1 values", () => {
  assert.equal(
    TarotPublicSessionSchema.safeParse({ ...recommendedSession, recommendations: recommendedSession.recommendations.slice(0, 2) })
      .success,
    false
  );
  assert.equal(
    TarotPublicSessionSchema.safeParse({
      ...recommendedSession,
      recommendations: [...recommendedSession.recommendations, recommendedSession.recommendations[2]]
    }).success,
    false
  );
  assert.equal(
    TarotPublicSessionSchema.safeParse({
      ...recommendedSession,
      recommendations: [
        { ...recommendedSession.recommendations[0], rank: 1 },
        { ...recommendedSession.recommendations[1], rank: 1 },
        { ...recommendedSession.recommendations[2], rank: 3 }
      ]
    }).success,
    false
  );
  assert.equal(
    TarotPublicSessionSchema.safeParse({
      ...recommendedSession,
      recommendations: [
        {
          rank: 1,
          design: { ...recommendationDesigns[0], unitCostMinor: 400 }
        },
        ...recommendedSession.recommendations.slice(1)
      ]
    }).success,
    false
  );
});
