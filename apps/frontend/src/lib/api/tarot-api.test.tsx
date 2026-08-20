import assert from "node:assert/strict";
import test from "node:test";

import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { isTarotFeatureEnabled } from "./api-runtime";
import { FrontendApiError } from "./frontend-api-error";
import { createTarotApiClient } from "./tarot-api";

const createdAt = "2026-08-20T08:00:00.000Z";
const updatedAt = "2026-08-20T08:05:00.000Z";

const drawingSession = {
  sessionId: "tarot/session 1",
  spreadType: "PAST_PRESENT_FUTURE",
  theme: "SELF_GROWTH",
  status: "DRAWING",
  revision: 1,
  slots: ["PAST", "PRESENT", "FUTURE"],
  acceptedSelections: [],
  createdAt,
  updatedAt
} as const;

const selectedSession = {
  ...drawingSession,
  revision: 2,
  acceptedSelections: [
    { slot: "PAST", displayedPosition: 4, operationId: "select-past-1" }
  ]
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

const designs = ["balanced", "contrast", "neutral"].map((suffix) => ({
  ...structuredClone(standardAiDesignFixture),
  designId: `tarot-design-${suffix}`,
  designMode: "TAROT_GUIDED" as const
}));

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
  recommendations: designs.map((design, index) => ({ rank: index + 1, design }))
} as const;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("all Tarot operations send the canonical protected routes and bodies", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const responses = [
    { requestId: "request-create", session: drawingSession, cardBack: { assetFile: "tarot-card-back.webp", altText: "Tarot card back" } },
    { requestId: "request-select", session: selectedSession },
    { requestId: "request-reveal", session: drawnSession },
    { requestId: "request-recommend", session: recommendedSession },
    { requestId: "request-get", session: recommendedSession },
    { requestId: "request-save", session: { ...recommendedSession, status: "SAVED", selectedDesignId: designs[0]!.designId } }
  ];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), ...(init ? { init } : {}) });
    return jsonResponse(responses[calls.length - 1]);
  }) as typeof fetch;
  const client = createTarotApiClient({ accessToken: "verified-test-token", fetcher });

  const createRequest = { requestId: "request-create", spreadType: "PAST_PRESENT_FUTURE", theme: "SELF_GROWTH" } as const;
  const selectRequest = { requestId: "request-select", slot: "PAST", displayedPosition: 4, expectedRevision: 1, operationId: "select-past-1" } as const;
  const revealRequest = { requestId: "request-reveal", expectedRevision: 4 } as const;
  const recommendationRequest = { requestId: "request-recommend", expectedRevision: 5, question: "我如何整理下一步？", saveQuestion: false, locale: "zh-CN", currency: "CNY" } as const;
  const saveRequest = { requestId: "request-save", expectedRevision: 6, selectedDesignId: designs[0]!.designId } as const;

  await client.create(createRequest);
  await client.select(drawingSession.sessionId, selectRequest);
  await client.reveal(drawingSession.sessionId, revealRequest);
  await client.recommendations(drawingSession.sessionId, recommendationRequest);
  const restored = await client.get(drawingSession.sessionId);
  await client.save(drawingSession.sessionId, saveRequest);

  assert.deepEqual(calls.map((call) => call.input), [
    "/api/tarot/sessions",
    "/api/tarot/sessions/tarot%2Fsession%201/select",
    "/api/tarot/sessions/tarot%2Fsession%201/reveal",
    "/api/tarot/sessions/tarot%2Fsession%201/recommendations",
    "/api/tarot/sessions/tarot%2Fsession%201",
    "/api/tarot/sessions/tarot%2Fsession%201/save"
  ]);
  assert.deepEqual(calls.map((call) => call.init?.method), ["POST", "POST", "POST", "POST", "GET", "POST"]);
  assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer verified-test-token");
  assert.equal((calls[4]?.init?.headers as Record<string, string>).authorization, "Bearer verified-test-token");
  assert.equal(Object.hasOwn(calls[0]?.init?.headers as object, "x-actor-id"), false);
  assert.deepEqual(JSON.parse(String(calls[3]?.init?.body)), recommendationRequest);
  assert.equal(calls[4]?.init?.body, undefined);
  assert.equal(restored.session.status, "RECOMMENDED");
  assert.equal(restored.session.recommendations?.length, 3);
});

test("missing verified credential fails before network traffic", async () => {
  let called = false;
  const client = createTarotApiClient({
    accessToken: "",
    fetcher: (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch
  });

  await assert.rejects(
    client.get("tarot-session-1"),
    (error: unknown) => error instanceof FrontendApiError && error.code === "UNAUTHORIZED"
  );
  assert.equal(called, false);
});

test("invalid successful Backend payload is rejected at the response boundary", async () => {
  const client = createTarotApiClient({
    accessToken: "verified-test-token",
    fetcher: (async () => jsonResponse({ requestId: "request-get", session: { ...drawingSession, privateDeckState: {} } })) as typeof fetch
  });

  await assert.rejects(
    client.get(drawingSession.sessionId),
    (error: unknown) => error instanceof FrontendApiError && error.code === "INTERNAL_ERROR"
  );
});

for (const code of ["CONFLICT", "INVENTORY_CHANGED", "PRICE_CHANGED", "COMPLIANCE_BLOCKED"] as const) {
  test(`${code} Backend errors remain stable Frontend states`, async () => {
    const client = createTarotApiClient({
      accessToken: "verified-test-token",
      fetcher: (async () => jsonResponse({ error: { code, message: code, requestId: "request-error" } }, 409)) as typeof fetch
    });

    await assert.rejects(
      client.get(drawingSession.sessionId),
      (error: unknown) => error instanceof FrontendApiError && error.code === code && error.requestId === "request-error"
    );
  });
}

test("recommendation questions are sent ephemerally without browser persistence", async () => {
  let localWrites = 0;
  let sessionWrites = 0;
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: () => { localWrites += 1; } } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { setItem: () => { sessionWrites += 1; } } });
  try {
    const client = createTarotApiClient({
      accessToken: "verified-test-token",
      fetcher: (async () => jsonResponse({ requestId: "request-recommend", session: recommendedSession })) as typeof fetch
    });
    await client.recommendations(drawingSession.sessionId, {
      requestId: "request-recommend",
      expectedRevision: 5,
      question: "这个问题只应出现在本次请求中。",
      saveQuestion: false,
      locale: "zh-CN",
      currency: "CNY"
    });
    assert.equal(localWrites, 0);
    assert.equal(sessionWrites, 0);
  } finally {
    if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalSessionStorage) Object.defineProperty(globalThis, "sessionStorage", originalSessionStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("Tarot feature flag is server-only and defaults to disabled", () => {
  const originalServerFlag = process.env.MYSTCRAG_TAROT_ENABLED;
  const originalPublicFlag = process.env.NEXT_PUBLIC_MYSTCRAG_TAROT_ENABLED;
  try {
    delete process.env.MYSTCRAG_TAROT_ENABLED;
    process.env.NEXT_PUBLIC_MYSTCRAG_TAROT_ENABLED = "true";
    assert.equal(isTarotFeatureEnabled(), false);

    process.env.MYSTCRAG_TAROT_ENABLED = "false";
    assert.equal(isTarotFeatureEnabled(), false);

    process.env.MYSTCRAG_TAROT_ENABLED = "true";
    assert.equal(isTarotFeatureEnabled(), true);
  } finally {
    if (originalServerFlag === undefined) delete process.env.MYSTCRAG_TAROT_ENABLED;
    else process.env.MYSTCRAG_TAROT_ENABLED = originalServerFlag;
    if (originalPublicFlag === undefined) delete process.env.NEXT_PUBLIC_MYSTCRAG_TAROT_ENABLED;
    else process.env.NEXT_PUBLIC_MYSTCRAG_TAROT_ENABLED = originalPublicFlag;
  }
});
