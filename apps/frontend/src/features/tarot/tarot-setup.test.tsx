import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage from "../../../app/page";
import TarotLayout from "../../../app/tarot/layout";
import TarotIndexPage from "../../../app/tarot/page";
import TarotSetupPage from "../../../app/tarot/setup/page";
import {
  TarotSetup,
  TarotSetupFields,
  TAROT_THEMES,
  createTarotSetupSubmitter
} from "./components/tarot-setup";
import { createTarotQuestionDraftStore } from "./components/tarot-question-draft-provider";
import { useTarotQuestionDraftStore } from "./components/tarot-question-draft-provider";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function withTarotFlag<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.MYSTCRAG_TAROT_ENABLED;
  try {
    if (value === undefined) delete process.env.MYSTCRAG_TAROT_ENABLED;
    else process.env.MYSTCRAG_TAROT_ENABLED = value;
    return run();
  } finally {
    if (previous === undefined) delete process.env.MYSTCRAG_TAROT_ENABLED;
    else process.env.MYSTCRAG_TAROT_ENABLED = previous;
  }
}

test("enabled landing renders equal AI, Tarot, and DIY creation paths", () => {
  const markup = withTarotFlag("true", () => renderToStaticMarkup(<HomePage />));

  assert.equal((markup.match(/data-creation-path=/g) ?? []).length, 3);
  assert.match(markup, /data-creation-path="ai"/);
  assert.match(markup, /href="\/ai-design"/);
  assert.match(markup, /五行意象/);
  assert.match(markup, /文化与设计灵感/);
  assert.match(markup, /data-creation-path="tarot"/);
  assert.match(markup, /href="\/tarot\/setup"/);
  assert.match(markup, /塔罗水晶引导/);
  assert.match(markup, /不代表事实预测/);
  assert.match(markup, /data-creation-path="diy"/);
  assert.match(markup, /href="\/diy"/);
  assert.match(markup, /从光泽、色彩与排列中，自由创作只属于你的手串。/);
});

test("disabled landing omits only the Tarot entry", () => {
  const landing = withTarotFlag(undefined, () => renderToStaticMarkup(<HomePage />));

  assert.equal((landing.match(/data-creation-path=/g) ?? []).length, 2);
  assert.doesNotMatch(landing, /href="\/tarot\/setup"/);
  assert.match(landing, /href="\/ai-design"/);
  assert.match(landing, /href="\/diy"/);
});

test("main navigation places Tarot beside AI and DIY only when enabled", async () => {
  const navigationModulePath = "../../../app/navigation";
  const navigationModule = await import(navigationModulePath) as {
    getMainNavigation: (tarotEnabled: boolean) => Array<{ href: string; label: string }>;
  };

  assert.deepEqual(navigationModule.getMainNavigation(true).slice(0, 3), [
    { href: "/ai-design", label: "AI 设计" },
    { href: "/tarot/setup", label: "塔罗引导" },
    { href: "/diy", label: "DIY 创作" }
  ]);
  assert.deepEqual(navigationModule.getMainNavigation(false), [
    { href: "/ai-design", label: "AI 设计" },
    { href: "/diy", label: "DIY 创作" },
    { href: "/#inspiration", label: "设计灵感" }
  ]);
});

test("setup renders all approved themes, both spreads, and visible privacy and safety guidance", () => {
  const markup = renderToStaticMarkup(
    <TarotSetupFields
      error={null}
      isSubmitting={false}
      onQuestionChange={() => undefined}
      onSaveQuestionChange={() => undefined}
      onSpreadChange={() => undefined}
      onSubmit={() => undefined}
      onThemeChange={() => undefined}
      question=""
      saveQuestion={false}
      spreadType="PAST_PRESENT_FUTURE"
      theme="SELF_GROWTH"
    />
  );

  assert.deepEqual(TAROT_THEMES.map(({ value }) => value), [
    "RELATIONSHIPS",
    "CAREER",
    "SELF_GROWTH",
    "NEW_BEGINNINGS",
    "FINANCIAL_PLANNING"
  ]);
  for (const label of ["关系与相处", "事业与方向", "自我成长", "新的开始", "财务规划"]) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /value="SINGLE"/);
  assert.match(markup, /value="PAST_PRESENT_FUTURE"/);
  assert.match(markup, /单张指引/);
  assert.match(markup, /三张牌阵/);
  assert.match(markup, /问题不会被保存/);
  assert.match(markup, /自我反思与设计灵感/);
  assert.match(markup, /不构成事实预测、医疗或投资建议/);
});

test("setup exposes the 120-character boundary and an inline non-modal error", () => {
  const question = "问".repeat(120);
  const markup = renderToStaticMarkup(
    <TarotSetupFields
      error="暂时无法创建牌阵，请检查网络后重试。"
      isSubmitting={false}
      onQuestionChange={() => undefined}
      onSaveQuestionChange={() => undefined}
      onSpreadChange={() => undefined}
      onSubmit={() => undefined}
      onThemeChange={() => undefined}
      question={question}
      saveQuestion={true}
      spreadType="SINGLE"
      theme="RELATIONSHIPS"
    />
  );

  assert.match(markup, /maxLength="120"/);
  assert.match(markup, /120 \/ 120/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /暂时无法创建牌阵，请检查网络后重试。/);
  assert.doesNotMatch(markup, /role="dialog"/);
});

test("question draft store is memory-only and scoped by returned session ID", () => {
  const store = createTarotQuestionDraftStore();
  store.set("session-one", { question: "我想整理下一步", saveQuestion: false });
  store.set("session-two", { question: "新的问题", saveQuestion: true });

  assert.deepEqual(store.get("session-one"), { question: "我想整理下一步", saveQuestion: false });
  assert.deepEqual(store.get("session-two"), { question: "新的问题", saveQuestion: true });
  store.clear("session-one");
  assert.equal(store.get("session-one"), undefined);
  assert.deepEqual(store.get("session-two"), { question: "新的问题", saveQuestion: true });
});

test("session creation excludes the question, stores its draft after success, then navigates", async () => {
  let resolveCreate!: (value: { session: { sessionId: string } }) => void;
  const createCalls: unknown[] = [];
  const events: string[] = [];
  const store = createTarotQuestionDraftStore();
  const submit = createTarotSetupSubmitter({
    create: async (request) => {
      createCalls.push(request);
      return new Promise((resolve) => { resolveCreate = resolve; });
    },
    draftStore: {
      ...store,
      set(sessionId, draft) {
        events.push(`draft:${sessionId}`);
        store.set(sessionId, draft);
      }
    },
    navigate(path) {
      events.push(`navigate:${path}`);
    },
    requestId: () => "tarot-setup-request"
  });

  const pending = submit({
    question: "  我该如何整理新的方向？  ",
    saveQuestion: true,
    spreadType: "PAST_PRESENT_FUTURE",
    theme: "NEW_BEGINNINGS"
  });
  await Promise.resolve();

  assert.deepEqual(createCalls, [{
    requestId: "tarot-setup-request",
    spreadType: "PAST_PRESENT_FUTURE",
    theme: "NEW_BEGINNINGS"
  }]);
  assert.deepEqual(events, []);

  resolveCreate({ session: { sessionId: "session/with space" } });
  await pending;

  assert.deepEqual(store.get("session/with space"), {
    question: "我该如何整理新的方向？",
    saveQuestion: true
  });
  assert.deepEqual(events, [
    "draft:session/with space",
    "navigate:/tarot/draw/session%2Fwith%20space"
  ]);
});

test("failed or duplicate setup submissions never navigate or create twice", async () => {
  let rejectCreate!: (error: Error) => void;
  let calls = 0;
  const paths: string[] = [];
  const submit = createTarotSetupSubmitter({
    create: async () => {
      calls += 1;
      return new Promise((_, reject) => { rejectCreate = reject; });
    },
    draftStore: createTarotQuestionDraftStore(),
    navigate: (path) => paths.push(path),
    requestId: () => "tarot-setup-request"
  });
  const input = {
    question: "",
    saveQuestion: false,
    spreadType: "SINGLE" as const,
    theme: "CAREER" as const
  };

  const first = submit(input);
  const duplicate = submit(input);
  assert.equal(calls, 1);
  rejectCreate(new Error("network unavailable"));
  await assert.rejects(first, /network unavailable/);
  await assert.rejects(duplicate, /network unavailable/);
  assert.deepEqual(paths, []);
});

test("Tarot route root redirects to setup", () => {
  assert.throws(
    () => TarotIndexPage(),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof error.digest === "string" &&
      /NEXT_REDIRECT;replace;\/tarot\/setup;/.test(error.digest)
  );
});

test("Tarot route layout owns the ephemeral draft provider", () => {
  function DraftProbe() {
    const store = useTarotQuestionDraftStore();
    store.set("layout-session", { question: "只存在于当前路由树", saveQuestion: false });
    return <span>{store.get("layout-session")?.question}</span>;
  }

  const markup = renderToStaticMarkup(<TarotLayout><DraftProbe /></TarotLayout>);
  assert.match(markup, /只存在于当前路由树/);
  assert.equal((TarotSetupPage() as React.ReactElement).type, TarotSetup);
});
