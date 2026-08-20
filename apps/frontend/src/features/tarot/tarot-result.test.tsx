import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  PublicDesignV1,
  TarotPublicSession,
  TarotRecommendedSession,
  TarotRevealSession,
  TarotSavedSession
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import TarotResultPage from "../../../app/tarot/result/[sessionId]/page";
import { FrontendApiError } from "../../lib/api/frontend-api-error";
import {
  TarotResultView,
  createTarotResultCoordinator,
  type TarotResultClient
} from "./components/tarot-result";
import { TarotRecommendationCard } from "./components/tarot-recommendation-card";
import { createTarotQuestionDraftStore } from "./components/tarot-question-draft-provider";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const createdAt = "2026-08-20T08:00:00.000Z";

function design(rank: number): PublicDesignV1 {
  return {
    ...structuredClone(standardAiDesignFixture),
    designId: rank === 2 ? "design/selected two" : `tarot-design-${rank}`,
    designName: ["静心之境", "星河守护", "清泉新生"][rank - 1]!,
    designMode: "TAROT_GUIDED",
    bracelet: {
      ...standardAiDesignFixture.bracelet,
      wristCircumferenceMm: 145 + rank * 5
    },
    production: {
      ...structuredClone(standardAiDesignFixture.production),
      wristCircumferenceMm: 145 + rank * 5
    },
    pricing: {
      ...structuredClone(standardAiDesignFixture.pricing),
      totalPriceMinor: 10_000 + rank * 1_400
    }
  };
}

function drawnSession(): TarotRevealSession {
  return {
    sessionId: "session/with space",
    spreadType: "PAST_PRESENT_FUTURE",
    theme: "SELF_GROWTH",
    status: "DRAWN",
    revision: 5,
    slots: ["PAST", "PRESENT", "FUTURE"],
    acceptedSelections: [
      { slot: "PAST", displayedPosition: 4, operationId: "past-operation" },
      { slot: "PRESENT", displayedPosition: 21, operationId: "present-operation" },
      { slot: "FUTURE", displayedPosition: 58, operationId: "future-operation" }
    ],
    revealedCards: [
      {
        slot: "PAST", displayedPosition: 4, cardId: "major-09", number: 9,
        nameZh: "隐者", nameEn: "The Hermit", assetFile: "09-TheHermit.png",
        orientation: "UPRIGHT", keywords: ["reflection"]
      },
      {
        slot: "PRESENT", displayedPosition: 21, cardId: "major-17", number: 17,
        nameZh: "星星", nameEn: "The Star", assetFile: "17-TheStar.png",
        orientation: "UPRIGHT", keywords: ["hope"]
      },
      {
        slot: "FUTURE", displayedPosition: 58, cardId: "cups-01", number: 22,
        nameZh: "圣杯首牌", nameEn: "Ace of Cups", assetFile: "Cups01.png",
        orientation: "REVERSED", keywords: ["inward"]
      }
    ],
    createdAt,
    updatedAt: createdAt
  };
}

function recommendedSession(): TarotRecommendedSession;
function recommendedSession(status: "RECOMMENDED"): TarotRecommendedSession;
function recommendedSession(status: "SAVED"): TarotSavedSession;
function recommendedSession(status: "RECOMMENDED" | "SAVED" = "RECOMMENDED"): TarotRecommendedSession | TarotSavedSession {
  return {
    ...drawnSession(),
    status,
    revision: status === "SAVED" ? 7 : 6,
    interpretation: {
      headline: "释放心结，迎接新的选择",
      summary: "放下过去的负担，回归内在的平静，你正走向更清晰更自由的未来。",
      cardReflections: [
        { slot: "PAST", reflection: "沉静整理曾经的经验。" },
        { slot: "PRESENT", reflection: "保留希望与清晰的节奏。" },
        { slot: "FUTURE", reflection: "给新选择留下温和空间。" }
      ],
      designRationale: "以静谧蓝、希望紫与柔光白组成层次。",
      disclaimer: "塔罗解读仅供灵感与自我反思，不代表确定性预测。"
    },
    colorStory: {
      primaryColor: "#A8D8E8",
      supportColor: "#A98EC0",
      accentColor: "#F6F3EC",
      rationale: "清透蓝为主，希望紫承接，柔光白点亮。"
    },
    materialRecommendations: [
      {
        beadProductId: "product-aquamarine-round-8",
        displayName: "海蓝宝圆珠 8mm",
        crystalName: "海蓝宝",
        colorTags: ["blue", "clear"],
        reason: "作为清透主色。"
      },
      {
        beadProductId: "product-moonstone-round-6",
        displayName: "月光石圆珠 6mm",
        crystalName: "月光石",
        colorTags: ["white"],
        reason: "用柔光留出呼吸。"
      }
    ],
    recommendations: [1, 2, 3].map((rank) => ({ rank, design: design(rank) })),
    ...(status === "SAVED" ? { selectedDesignId: design(2).designId } : {})
  } as TarotRecommendedSession | TarotSavedSession;
}

function fakeClient(overrides: Partial<TarotResultClient> = {}): TarotResultClient {
  return {
    create: async (input) => ({
      requestId: input.requestId,
      session: {
        sessionId: "child/session",
        spreadType: input.spreadType,
        theme: input.theme,
        status: "DRAWING",
        revision: 1,
        slots: input.spreadType === "SINGLE" ? ["GUIDANCE"] : ["PAST", "PRESENT", "FUTURE"],
        acceptedSelections: [],
        parentSessionId: input.parentSessionId,
        createdAt,
        updatedAt: createdAt
      },
      cardBack: { assetFile: "CardBack.png", altText: "塔罗牌背" }
    }),
    get: async () => ({ requestId: "restore", session: recommendedSession() }),
    recommendations: async (_sessionId, input) => ({
      requestId: input.requestId,
      session: recommendedSession()
    }),
    save: async (_sessionId, input) => ({
      requestId: input.requestId,
      session: {
        ...recommendedSession("SAVED"),
        selectedDesignId: input.selectedDesignId
      }
    }),
    ...overrides
  };
}

function coordinator(overrides: Partial<Parameters<typeof createTarotResultCoordinator>[0]> = {}) {
  return createTarotResultCoordinator({
    sessionId: "session/with space",
    client: fakeClient(),
    draftStore: createTarotQuestionDraftStore(),
    navigate: () => undefined,
    requestId: (() => { let index = 0; return () => `request-${++index}`; })(),
    ...overrides
  });
}

test("result view keeps the authoritative card order and visibly rotates a reversed card", () => {
  const markup = renderToStaticMarkup(
    <TarotResultView
      error={null}
      generating={false}
      onRedraw={() => undefined}
      onSave={() => undefined}
      onSelect={() => undefined}
      onSelectAndEnterDiy={() => undefined}
      redrawing={false}
      saving={false}
      selectedDesignId={design(2).designId}
      session={recommendedSession()}
    />
  );

  assert.ok(markup.indexOf("<h2>过去</h2>") < markup.indexOf("<h2>现在</h2>"));
  assert.ok(markup.indexOf("<h2>现在</h2>") < markup.indexOf("<h2>未来</h2>"));
  assert.ok(markup.indexOf("09-TheHermit.png") < markup.indexOf("17-TheStar.png"));
  assert.ok(markup.indexOf("17-TheStar.png") < markup.indexOf("Cups01.png"));
  assert.match(markup, /data-orientation="REVERSED"/);
  assert.match(markup, /rotate\(180deg\)/);
  assert.match(markup, /隐者 · 正位/);
  assert.match(markup, /圣杯首牌 · 逆位/);
});

test("result view renders the reading, palette, materials, disclaimer, and fallback notice", () => {
  const markup = renderToStaticMarkup(
    <TarotResultView
      error={null} generating={false} onRedraw={() => undefined}
      onSave={() => undefined} onSelect={() => undefined}
      onSelectAndEnterDiy={() => undefined} redrawing={false} saving={false}
      selectedDesignId={design(1).designId} session={recommendedSession()}
    />
  );

  assert.match(markup, /释放心结，迎接新的选择/);
  assert.match(markup, /放下过去的负担/);
  assert.match(markup, /#A8D8E8/);
  assert.match(markup, /#A98EC0/);
  assert.match(markup, /海蓝宝圆珠 8mm/);
  assert.match(markup, /不代表确定性预测/);
  assert.match(markup, /服务不可用时会自动使用本地安全文案/);
});

test("exactly three real PublicDesign recommendations remain visible without a carousel", () => {
  const session = recommendedSession();
  const markup = renderToStaticMarkup(
    <TarotResultView
      error={null} generating={false} onRedraw={() => undefined}
      onSave={() => undefined} onSelect={() => undefined}
      onSelectAndEnterDiy={() => undefined} redrawing={false} saving={false}
      selectedDesignId={design(2).designId} session={session}
    />
  );

  assert.equal((markup.match(/data-tarot-recommendation=/g) ?? []).length, 3);
  assert.equal((markup.match(/aria-label="手串预览"/g) ?? []).length, 3);
  for (const expected of ["静心之境", "星河守护", "清泉新生", "¥114.00", "¥128.00", "¥142.00", "手围 15.0 cm", "手围 15.5 cm", "手围 16.0 cm"]) {
    assert.match(markup, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(markup, /data-design-selected="true"/);
  assert.match(markup, /data-results-layout="three-visible-no-carousel"/);
  assert.doesNotMatch(markup, /aria-roledescription="carousel"|swiper|slick/i);

  const css = readFileSync(new URL("./tarot.module.css", import.meta.url), "utf8");
  assert.match(css, /\.tarotRecommendationGrid[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(css, /@media\s*\(max-width:\s*767px\)[\s\S]*\.tarotRecommendationGrid[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.tarotResultPage[^}]*padding-bottom:[^;]*var\(--tarot-result-actions-height\)/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("recommendation card uses authoritative design materials, wrist size, and price", () => {
  const markup = renderToStaticMarkup(
    <TarotRecommendationCard
      design={design(1)}
      onSelect={() => undefined}
      rank={1}
      selected={false}
    />
  );
  assert.match(markup, /海蓝宝/);
  assert.match(markup, /月光石/);
  assert.match(markup, /白水晶/);
  assert.match(markup, /手围 15.0 cm/);
  assert.match(markup, /¥114.00/);
});

test("GET restore returns drawing sessions to the draw route", async () => {
  const navigation: string[] = [];
  const result = coordinator({
    client: fakeClient({ get: async () => ({ requestId: "restore", session: { ...drawnSession(), status: "DRAWING", revealedCards: undefined } as unknown as TarotPublicSession }) }),
    navigate: (path) => navigation.push(path)
  });
  await result.restore();
  assert.deepEqual(navigation, ["/tarot/draw/session%2Fwith%20space"]);
});

test("DRAWN restore generates recommendations once from the ephemeral draft", async () => {
  const requests: unknown[] = [];
  const draftStore = createTarotQuestionDraftStore();
  draftStore.set("session/with space", { question: "  我该如何整理下一步？  ", saveQuestion: true });
  const result = coordinator({
    draftStore,
    client: fakeClient({
      get: async () => ({ requestId: "restore", session: drawnSession() }),
      recommendations: async (_sessionId, input) => {
        requests.push(input);
        return { requestId: input.requestId, session: recommendedSession() };
      }
    })
  });

  await Promise.all([result.restore(), result.restore()]);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    requestId: "request-1",
    expectedRevision: 5,
    question: "我该如何整理下一步？",
    saveQuestion: true,
    locale: "zh-CN",
    currency: "CNY"
  });
  assert.equal(result.getState().session?.status, "RECOMMENDED");
});

test("refresh without a draft asks inline for an optional re-entry and supports skip", async () => {
  const requests: unknown[] = [];
  const result = coordinator({
    client: fakeClient({
      get: async () => ({ requestId: "restore", session: drawnSession() }),
      recommendations: async (_sessionId, input) => {
        requests.push(input);
        return { requestId: input.requestId, session: recommendedSession() };
      }
    })
  });
  await result.restore();
  assert.equal(result.getState().needsQuestionRecovery, true);
  assert.equal(requests.length, 0);

  const recoveryMarkup = renderToStaticMarkup(
    <TarotResultView
      error={null} generating={false} needsQuestionRecovery
      onContinueQuestion={() => undefined} onRedraw={() => undefined}
      onSave={() => undefined} onSelect={() => undefined}
      onSelectAndEnterDiy={() => undefined} onSkipQuestion={() => undefined}
      redrawing={false} saving={false} selectedDesignId="" session={drawnSession()}
    />
  );
  assert.match(recoveryMarkup, /想问的问题（可选）/);
  assert.match(recoveryMarkup, />跳过</);
  assert.match(recoveryMarkup, />继续</);
  assert.doesNotMatch(recoveryMarkup, /role="dialog"/);

  await result.continueWithoutQuestion();
  assert.deepEqual(requests[0], {
    requestId: "request-1", expectedRevision: 5, saveQuestion: false,
    locale: "zh-CN", currency: "CNY"
  });
});

test("inline recovery can submit a replacement question without persisting browser state", async () => {
  const requests: unknown[] = [];
  const draftStore = createTarotQuestionDraftStore();
  const result = coordinator({
    draftStore,
    client: fakeClient({
      get: async () => ({ requestId: "restore", session: drawnSession() }),
      recommendations: async (_sessionId, input) => {
        requests.push(input);
        return { requestId: input.requestId, session: recommendedSession() };
      }
    })
  });
  await result.restore();
  await result.continueWithQuestion("  我想重新梳理当下的方向  ");

  assert.deepEqual(requests[0], {
    requestId: "request-1",
    expectedRevision: 5,
    question: "我想重新梳理当下的方向",
    saveQuestion: false,
    locale: "zh-CN",
    currency: "CNY"
  });
  assert.equal(draftStore.get("session/with space"), undefined);
});

test("duplicate Continue input shares one recommendation request without invalidating its response", async () => {
  let calls = 0;
  let resolveRecommendations!: (value: Awaited<ReturnType<TarotResultClient["recommendations"]>>) => void;
  const result = coordinator({
    client: fakeClient({
      get: async () => ({ requestId: "restore", session: drawnSession() }),
      recommendations: async () => {
        calls += 1;
        return new Promise((resolve) => { resolveRecommendations = resolve; });
      }
    })
  });
  await result.restore();
  const first = result.continueWithoutQuestion();
  const duplicate = result.continueWithoutQuestion();
  resolveRecommendations({ requestId: "recommend", session: recommendedSession() });
  await Promise.all([first, duplicate]);

  assert.equal(calls, 1);
  assert.equal(result.getState().session?.status, "RECOMMENDED");
  assert.equal(result.getState().generating, false);
});

test("a rejected recommendation keeps an inline retry path instead of stranding the draw", async () => {
  let calls = 0;
  const draftStore = createTarotQuestionDraftStore();
  draftStore.set("session/with space", { question: "这次的问题", saveQuestion: false });
  const result = coordinator({
    draftStore,
    client: fakeClient({
      get: async () => ({ requestId: "restore", session: drawnSession() }),
      recommendations: async (_sessionId, input) => {
        calls += 1;
        if (calls === 1) throw new FrontendApiError("VALIDATION_ERROR", "retry safely");
        return { requestId: input.requestId, session: recommendedSession() };
      }
    })
  });
  await result.restore();
  assert.equal(result.getState().session?.status, "DRAWN");
  assert.equal(result.getState().needsQuestionRecovery, true);

  await result.continueWithoutQuestion();
  assert.equal(result.getState().session?.status, "RECOMMENDED");
});

test("persisted RECOMMENDED and SAVED sessions render immediately without regeneration", async () => {
  for (const status of ["RECOMMENDED", "SAVED"] as const) {
    let recommendationCalls = 0;
    const result = coordinator({
      client: fakeClient({
        get: async () => ({ requestId: "restore", session: status === "SAVED" ? recommendedSession("SAVED") : recommendedSession() }),
        recommendations: async () => { recommendationCalls += 1; throw new Error("must not regenerate"); }
      })
    });
    await result.restore();
    assert.equal(recommendationCalls, 0);
    assert.equal(result.getState().session?.status, status);
    assert.equal(result.getState().selectedDesignId, status === "SAVED" ? design(2).designId : design(1).designId);
  }
});

test("selection saves the current revision and navigates to encoded DIY only after success", async () => {
  let resolveSave!: (value: Awaited<ReturnType<TarotResultClient["save"]>>) => void;
  const requests: unknown[] = [];
  const navigation: string[] = [];
  const result = coordinator({
    client: fakeClient({
      save: async (_sessionId, input) => {
        requests.push(input);
        return new Promise((resolve) => { resolveSave = resolve; });
      }
    }),
    navigate: (path) => navigation.push(path)
  });
  await result.restore();
  result.selectDesign(design(2).designId);
  const first = result.saveAndEnterDiy();
  const duplicate = result.saveAndEnterDiy();
  assert.deepEqual(navigation, []);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    requestId: "request-1", expectedRevision: 6, selectedDesignId: "design/selected two"
  });
  resolveSave({
    requestId: "request-1",
    session: { ...recommendedSession("SAVED"), selectedDesignId: design(2).designId }
  });
  await Promise.all([first, duplicate]);
  assert.deepEqual(navigation, ["/diy/design%2Fselected%20two"]);
});

test("save action persists the selected design without navigating away", async () => {
  const requests: unknown[] = [];
  const navigation: string[] = [];
  const result = coordinator({
    client: fakeClient({
      save: async (_sessionId, input) => {
        requests.push(input);
        return {
          requestId: input.requestId,
          session: { ...recommendedSession("SAVED"), selectedDesignId: input.selectedDesignId }
        };
      }
    }),
    navigate: (path) => navigation.push(path)
  });
  await result.restore();
  result.selectDesign(design(3).designId);
  await result.saveSelected();

  assert.deepEqual(requests, [{
    requestId: "request-1", expectedRevision: 6, selectedDesignId: design(3).designId
  }]);
  assert.deepEqual(navigation, []);
  assert.equal(result.getState().session?.status, "SAVED");
});

test("save conflict restores the authoritative session and does not navigate to stale selection", async () => {
  const navigation: string[] = [];
  let getCalls = 0;
  const result = coordinator({
    client: fakeClient({
      get: async () => ({
        requestId: `get-${++getCalls}`,
        session: getCalls === 1 ? recommendedSession() : recommendedSession("SAVED")
      }),
      save: async () => { throw new FrontendApiError("CONFLICT", "stale"); }
    }),
    navigate: (path) => navigation.push(path)
  });
  await result.restore();
  result.selectDesign(design(1).designId);
  await result.saveAndEnterDiy();
  assert.deepEqual(navigation, []);
  assert.equal(result.getState().selectedDesignId, design(2).designId);
  assert.match(result.getState().error ?? "", /服务器已保存/);
});

test("redraw creates a child session and transfers the in-memory draft", async () => {
  const calls: unknown[] = [];
  const navigation: string[] = [];
  const draftStore = createTarotQuestionDraftStore();
  draftStore.set("session/with space", { question: "保留这次的问题", saveQuestion: false });
  const result = coordinator({
    draftStore,
    client: fakeClient({
      create: async (input) => {
        calls.push(input);
        return fakeClient().create(input);
      }
    }),
    navigate: (path) => navigation.push(path)
  });
  await result.restore();
  await result.redraw();
  assert.deepEqual(calls, [{
    requestId: "request-1", spreadType: "PAST_PRESENT_FUTURE",
    theme: "SELF_GROWTH", parentSessionId: "session/with space"
  }]);
  assert.deepEqual(draftStore.get("child/session"), { question: "保留这次的问题", saveQuestion: false });
  assert.deepEqual(navigation, ["/tarot/draw/child%2Fsession"]);
});

test("disposed coordinators suppress stale recommendation, save, and redraw effects", async () => {
  let resolveRecommendations!: (value: Awaited<ReturnType<TarotResultClient["recommendations"]>>) => void;
  const navigation: string[] = [];
  const draftStore = createTarotQuestionDraftStore();
  draftStore.set("session/with space", { question: "短暂的问题", saveQuestion: false });
  const result = coordinator({
    draftStore,
    client: fakeClient({
      get: async () => ({ requestId: "restore", session: drawnSession() }),
      recommendations: async () => new Promise((resolve) => { resolveRecommendations = resolve; })
    }),
    navigate: (path) => navigation.push(path)
  });
  const restore = result.restore();
  await new Promise((resolve) => setImmediate(resolve));
  result.dispose();
  resolveRecommendations({ requestId: "recommend", session: recommendedSession() });
  await restore;
  assert.equal(result.getState().session?.status, "DRAWN");
  assert.deepEqual(navigation, []);
});

test("dynamic result page preserves the route session identity", async () => {
  const element = await TarotResultPage({ params: Promise.resolve({ sessionId: "session%2Fencoded" }) });
  assert.equal((element as React.ReactElement<{ sessionId: string }>).props.sessionId, "session%2Fencoded");
});
