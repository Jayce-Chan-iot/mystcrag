import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  TarotDrawingSession,
  TarotRevealSession
} from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import TarotDrawPage from "../../../app/tarot/draw/[sessionId]/page";
import { FrontendApiError } from "../../lib/api/frontend-api-error";
import {
  DISPLAYED_TAROT_POSITIONS,
  TarotFan,
  getFanCardTransform
} from "./components/tarot-fan";
import {
  TarotDrawView,
  createTarotDrawCoordinator,
  type TarotDrawClient
} from "./components/tarot-draw";
import { TarotSlots, getRequiredTarotSlots } from "./components/tarot-slots";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const createdAt = "2026-08-20T08:00:00.000Z";

function drawingSession(
  acceptedSelections: TarotDrawingSession["acceptedSelections"] = []
): TarotDrawingSession {
  return {
    sessionId: "session/with space",
    spreadType: "PAST_PRESENT_FUTURE",
    theme: "SELF_GROWTH",
    status: "DRAWING",
    revision: acceptedSelections.length + 1,
    slots: ["PAST", "PRESENT", "FUTURE"],
    acceptedSelections,
    createdAt,
    updatedAt: createdAt
  };
}

function revealedSession(): TarotRevealSession {
  return {
    ...drawingSession([
      { slot: "PAST", displayedPosition: 4, operationId: "operation-one" },
      { slot: "PRESENT", displayedPosition: 21, operationId: "operation-two" },
      { slot: "FUTURE", displayedPosition: 58, operationId: "operation-three" }
    ]),
    status: "DRAWN",
    revision: 5,
    revealedCards: [
      {
        slot: "PAST",
        displayedPosition: 4,
        cardId: "major-09",
        number: 9,
        nameZh: "隐者",
        nameEn: "The Hermit",
        assetFile: "09-TheHermit.png",
        orientation: "UPRIGHT",
        keywords: ["reflection"]
      },
      {
        slot: "PRESENT",
        displayedPosition: 21,
        cardId: "major-17",
        number: 17,
        nameZh: "星星",
        nameEn: "The Star",
        assetFile: "17-TheStar.png",
        orientation: "UPRIGHT",
        keywords: ["hope"]
      },
      {
        slot: "FUTURE",
        displayedPosition: 58,
        cardId: "cups-01",
        number: 22,
        nameZh: "圣杯首牌",
        nameEn: "Ace of Cups",
        assetFile: "Cups01.png",
        orientation: "REVERSED",
        keywords: ["inward"]
      }
    ]
  };
}

function fakeClient(overrides: Partial<TarotDrawClient> = {}): TarotDrawClient {
  return {
    create: async () => ({
      requestId: "create-redraw",
      session: drawingSession(),
      cardBack: { assetFile: "CardBack.png", altText: "塔罗牌背" }
    }),
    get: async () => ({ requestId: "restore-session", session: drawingSession() }),
    reveal: async () => ({ requestId: "reveal-session", session: revealedSession() }),
    select: async (_sessionId, input) => ({
      requestId: input.requestId,
      session: drawingSession([
        { slot: input.slot, displayedPosition: input.displayedPosition, operationId: input.operationId }
      ])
    }),
    ...overrides
  };
}

test("fan renders all 78 unique selectable positions with one stable card-back visual", () => {
  const markup = renderToStaticMarkup(
    <TarotFan
      acceptedPositions={new Set([4])}
      cardBackAssetFile="CardBack.png"
      disabled={false}
      onSelect={() => undefined}
      pendingPosition={21}
    />
  );

  assert.equal(DISPLAYED_TAROT_POSITIONS.length, 78);
  assert.equal(new Set(DISPLAYED_TAROT_POSITIONS).size, 78);
  assert.equal((markup.match(/data-tarot-position=/g) ?? []).length, 78);
  assert.equal((markup.match(/src="\/tarot\/cards\/CardBack\.png"/g) ?? []).length, 78);
  assert.match(markup, /data-pending="true"/);
  assert.match(markup, /data-selected="true"/);
  assert.doesNotMatch(markup, /draggable="true"/);
});

test("fan geometry stays bounded on desktop and becomes a scrollable half-fan on mobile", () => {
  const left = getFanCardTransform(0, 78);
  const middle = getFanCardTransform(39, 78);
  const right = getFanCardTransform(77, 78);

  assert.deepEqual(left, { xPercent: -50, yPx: 82, rotateDeg: -18 });
  assert.deepEqual(middle, { xPercent: 0.649350649350644, yPx: 0.01383032551863698, rotateDeg: 0.23376623376623185 });
  assert.deepEqual(right, { xPercent: 50, yPx: 82, rotateDeg: 18 });

  const css = readFileSync(new URL("./tarot.module.css", import.meta.url), "utf8");
  assert.match(css, /\.tarotFanViewport[^}]*overflow:\s*hidden/s);
  assert.match(css, /max-width:\s*100vw/);
  assert.match(css, /@media\s*\(max-width:\s*639px\)[\s\S]*\.tarotFanViewport[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.tarotDrawPage[^}]*overflow-x:\s*clip/s);
  assert.match(css, /\.tarotActionFooter[^}]*position:\s*sticky/s);
  assert.match(css, /padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)/);
});

test("slot order is Guidance for single and Past, Present, Future for three-card readings", () => {
  assert.deepEqual(getRequiredTarotSlots("SINGLE"), ["GUIDANCE"]);
  assert.deepEqual(getRequiredTarotSlots("PAST_PRESENT_FUTURE"), ["PAST", "PRESENT", "FUTURE"]);

  const markup = renderToStaticMarkup(
    <TarotSlots pendingPosition={undefined} session={drawingSession()} />
  );
  assert.ok(markup.indexOf("过去") < markup.indexOf("现在"));
  assert.ok(markup.indexOf("现在") < markup.indexOf("未来"));
});

test("pending selection remains in the fan and only confirms after the server responds", async () => {
  let resolveSelect!: (value: Awaited<ReturnType<TarotDrawClient["select"]>>) => void;
  const requestBodies: unknown[] = [];
  const states: Array<ReturnType<ReturnType<typeof createTarotDrawCoordinator>["getState"]>> = [];
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session/with space",
    client: fakeClient({
      select: async (_sessionId, input) => {
        requestBodies.push(input);
        return new Promise((resolve) => { resolveSelect = resolve; });
      }
    }),
    navigate: () => undefined,
    requestId: (() => {
      const ids = ["request-select", "operation-select"];
      return () => ids.shift() ?? "unexpected-id";
    })(),
    prefersReducedMotion: () => false,
    wait: async () => undefined
  });
  coordinator.subscribe((state) => states.push(state));
  await coordinator.restore();

  const pending = coordinator.select(21);
  assert.equal(coordinator.getState().pendingPosition, 21);
  assert.deepEqual(coordinator.getState().session?.acceptedSelections, []);
  assert.deepEqual(requestBodies, [{
    requestId: "request-select",
    slot: "PAST",
    displayedPosition: 21,
    expectedRevision: 1,
    operationId: "operation-select"
  }]);

  resolveSelect({
    requestId: "request-select",
    session: drawingSession([
      { slot: "PAST", displayedPosition: 21, operationId: "operation-select" }
    ])
  });
  await pending;
  assert.equal(coordinator.getState().pendingPosition, undefined);
  assert.deepEqual(coordinator.getState().session?.acceptedSelections.map(({ displayedPosition }) => displayedPosition), [21]);
  assert.ok(states.some((state) => state.pendingPosition === 21 && state.session?.acceptedSelections.length === 0));
});

test("duplicate, out-of-order, pointer-repeat choices cannot send another selection", async () => {
  let calls = 0;
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session",
    client: fakeClient({
      get: async () => ({
        requestId: "restore",
        session: drawingSession([
          { slot: "PAST", displayedPosition: 4, operationId: "operation-one" }
        ])
      }),
      select: async () => {
        calls += 1;
        throw new Error("must not be called");
      }
    }),
    navigate: () => undefined,
    requestId: () => "unused",
    prefersReducedMotion: () => false,
    wait: async () => undefined
  });
  await coordinator.restore();

  await coordinator.select(4);
  const first = coordinator.select(15);
  const repeatedPointer = coordinator.select(15);
  await Promise.allSettled([first, repeatedPointer]);
  assert.equal(calls, 1);
});

test("semantic card buttons expose click, mouse/touch pointer, Enter, and Space activation", () => {
  const markup = renderToStaticMarkup(
    <TarotFan
      acceptedPositions={new Set()}
      cardBackAssetFile="CardBack.png"
      disabled={false}
      onSelect={() => undefined}
      pendingPosition={undefined}
    />
  );
  assert.equal((markup.match(/<button/g) ?? []).length, 78);
  assert.match(markup, /data-inputs="click pointer-mouse pointer-touch Enter Space"/);
  assert.match(markup, /aria-label="选择第 1 张塔罗牌"/);
});

test("non-conflict failure rolls the card back with an inline error", async () => {
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session",
    client: fakeClient({ select: async () => { throw new FrontendApiError("NETWORK_ERROR", "offline"); } }),
    navigate: () => undefined,
    requestId: (() => { let index = 0; return () => `id-${++index}`; })(),
    prefersReducedMotion: () => false,
    wait: async () => undefined
  });
  await coordinator.restore();
  await coordinator.select(8);

  assert.equal(coordinator.getState().pendingPosition, undefined);
  assert.deepEqual(coordinator.getState().session?.acceptedSelections, []);
  assert.match(coordinator.getState().error ?? "", /网络连接中断/);
});

test("revision conflict restores authoritative selections before allowing another choice", async () => {
  let getCalls = 0;
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session",
    client: fakeClient({
      get: async () => {
        getCalls += 1;
        return {
          requestId: `restore-${getCalls}`,
          session: getCalls === 1
            ? drawingSession()
            : drawingSession([{ slot: "PAST", displayedPosition: 11, operationId: "remote-operation" }])
        };
      },
      select: async () => { throw new FrontendApiError("CONFLICT", "stale revision"); }
    }),
    navigate: () => undefined,
    requestId: (() => { let index = 0; return () => `id-${++index}`; })(),
    prefersReducedMotion: () => false,
    wait: async () => undefined
  });
  await coordinator.restore();
  await coordinator.select(7);

  assert.equal(getCalls, 2);
  assert.deepEqual(coordinator.getState().session?.acceptedSelections.map(({ displayedPosition }) => displayedPosition), [11]);
  assert.match(coordinator.getState().error ?? "", /已同步/);
});

test("reveal stays locked until every selection is confirmed", async () => {
  let revealCalls = 0;
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session",
    client: fakeClient({ reveal: async () => { revealCalls += 1; return { requestId: "reveal", session: revealedSession() }; } }),
    navigate: () => undefined,
    requestId: () => "request-reveal",
    prefersReducedMotion: () => false,
    wait: async () => undefined
  });
  await coordinator.restore();
  await coordinator.reveal();
  assert.equal(revealCalls, 0);
  assert.match(coordinator.getState().error ?? "", /还需要选择 3 张牌/);
});

test("server reveal shows slot-ordered faces, rotates reversed art, then navigates", async () => {
  const events: string[] = [];
  const complete = drawingSession([
    { slot: "PAST", displayedPosition: 4, operationId: "operation-one" },
    { slot: "PRESENT", displayedPosition: 21, operationId: "operation-two" },
    { slot: "FUTURE", displayedPosition: 58, operationId: "operation-three" }
  ]);
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session/with space",
    client: fakeClient({
      get: async () => ({ requestId: "restore", session: complete }),
      reveal: async (_sessionId, input) => {
        assert.deepEqual(input, { requestId: "request-reveal", expectedRevision: 4 });
        return { requestId: "request-reveal", session: revealedSession() };
      }
    }),
    navigate: (path) => events.push(`navigate:${path}`),
    requestId: () => "request-reveal",
    prefersReducedMotion: () => false,
    wait: async (milliseconds) => { events.push(`wait:${milliseconds}`); }
  });
  await coordinator.restore();
  await coordinator.reveal();

  assert.deepEqual(events, ["wait:1040", "navigate:/tarot/result/session%2Fwith%20space"]);
  const markup = renderToStaticMarkup(<TarotSlots pendingPosition={undefined} session={revealedSession()} />);
  assert.ok(markup.indexOf("09-TheHermit.png") < markup.indexOf("17-TheStar.png"));
  assert.ok(markup.indexOf("17-TheStar.png") < markup.indexOf("Cups01.png"));
  assert.match(markup, /data-orientation="REVERSED"/);
  assert.match(markup, /rotate\(180deg\)/);
});

test("reduced motion reveals and navigates immediately without waiting", async () => {
  let waitCalls = 0;
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session",
    client: fakeClient({
      get: async () => ({
        requestId: "restore",
        session: drawingSession([
          { slot: "PAST", displayedPosition: 4, operationId: "operation-one" },
          { slot: "PRESENT", displayedPosition: 21, operationId: "operation-two" },
          { slot: "FUTURE", displayedPosition: 58, operationId: "operation-three" }
        ])
      })
    }),
    navigate: () => undefined,
    requestId: () => "request-reveal",
    prefersReducedMotion: () => true,
    wait: async () => { waitCalls += 1; }
  });
  await coordinator.restore();
  await coordinator.reveal();
  assert.equal(waitCalls, 0);
});

test("redraw creates a child session and transfers only the route-memory question draft", async () => {
  const calls: unknown[] = [];
  const navigation: string[] = [];
  const coordinator = createTarotDrawCoordinator({
    sessionId: "parent/session",
    client: fakeClient({
      get: async () => ({
        requestId: "restore",
        session: { ...revealedSession(), sessionId: "parent/session" }
      }),
      create: async (input) => {
        calls.push(input);
        return {
          requestId: input.requestId,
          session: { ...drawingSession(), sessionId: "child/session", parentSessionId: "parent/session" },
          cardBack: { assetFile: "CardBack.png", altText: "塔罗牌背" }
        };
      }
    }),
    navigate: (path) => navigation.push(path),
    onRedrawSession: (parent, child) => calls.push({ parent, child, draftTransfer: true }),
    requestId: () => "request-redraw",
    prefersReducedMotion: () => false,
    wait: async () => undefined
  });
  await coordinator.restore();
  navigation.length = 0;
  await coordinator.redraw();

  assert.deepEqual(calls, [
    {
      requestId: "request-redraw",
      spreadType: "PAST_PRESENT_FUTURE",
      theme: "SELF_GROWTH",
      parentSessionId: "parent/session"
    },
    { parent: "parent/session", child: "child/session", draftTransfer: true }
  ]);
  assert.deepEqual(navigation, ["/tarot/draw/child%2Fsession"]);
});

test("refresh restore treats GET as authoritative and never invents local selections", async () => {
  const restored = drawingSession([
    { slot: "PAST", displayedPosition: 33, operationId: "remote-operation" }
  ]);
  const coordinator = createTarotDrawCoordinator({
    sessionId: "session",
    client: fakeClient({ get: async () => ({ requestId: "restore", session: restored }) }),
    navigate: () => undefined,
    requestId: () => "unused",
    prefersReducedMotion: () => false,
    wait: async () => undefined
  });
  await coordinator.restore();
  assert.deepEqual(coordinator.getState().session, restored);
});

test("draw composition follows the selected cream-and-purple hierarchy without a modal", () => {
  const markup = renderToStaticMarkup(
    <TarotDrawView
      error={null}
      onBack={() => undefined}
      onRedraw={() => undefined}
      onReveal={() => undefined}
      onSelect={() => undefined}
      pendingPosition={undefined}
      revealing={false}
      session={drawingSession()}
    />
  );
  assert.match(markup, /data-tarot-draw-layout="desktop-fan-mobile-half-fan"/);
  assert.match(markup, /塔罗指引 · 抽牌/);
  assert.match(markup, /当前主题/);
  assert.match(markup, /凭直觉，选择三张牌/);
  assert.match(markup, /返回修改问题/);
  assert.match(markup, /查看解读/);
  assert.doesNotMatch(markup, /role="dialog"/);
});

test("dynamic page keeps the encoded route identity inside the draw component boundary", async () => {
  const element = await TarotDrawPage({ params: Promise.resolve({ sessionId: "session%2Fencoded" }) });
  assert.equal((element as React.ReactElement<{ sessionId: string }>).props.sessionId, "session%2Fencoded");
});
