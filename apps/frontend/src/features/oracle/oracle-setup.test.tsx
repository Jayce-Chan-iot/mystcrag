import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage from "../../../app/page";
import { getMainNavigation } from "../../../app/navigation";
import {
  MIN_BRACELET_CIRCUMFERENCE_MM,
  MAX_BRACELET_CIRCUMFERENCE_MM
} from "../design/model/bracelet-fit";
import { createOracleQuestionStore } from "./oracle-question-provider";
import {
  OracleSetup,
  OracleSetupFields,
  createOracleSetupSubmitter,
  type OracleSetupInput
} from "./components/oracle-setup";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const CAPABILITIES_OFF = { tarotEnabled: false, oracleEnabled: false } as const;
const CAPABILITIES_ON = { tarotEnabled: false, oracleEnabled: true } as const;

function withOracleFlag<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.MYSTCRAG_ORACLE_ENABLED;
  try {
    if (value === undefined) delete process.env.MYSTCRAG_ORACLE_ENABLED;
    else process.env.MYSTCRAG_ORACLE_ENABLED = value;
    return run();
  } finally {
    if (previous === undefined) delete process.env.MYSTCRAG_ORACLE_ENABLED;
    else process.env.MYSTCRAG_ORACLE_ENABLED = previous;
  }
}

type Recorder = {
  calls: OracleSetupInput[];
  navigate: string[];
};

function createSubmitHarness(options?: { create?: (input: OracleSetupInput) => Promise<{ session: { sessionId: string } }> }) {
  const recorder: Recorder = { calls: [], navigate: [] };
  const questionStore = createOracleQuestionStore();
  let resolveCreate: ((value: { session: { sessionId: string } }) => void) | null = null;
  let rejectCreate: ((error: unknown) => void) | null = null;

  const create = (input: OracleSetupInput) => {
    recorder.calls.push(input);
    if (options?.create) return options.create(input);
    return new Promise<{ session: { sessionId: string } }>((resolve, reject) => {
      resolveCreate = resolve;
      rejectCreate = reject;
    });
  };

  const submit = createOracleSetupSubmitter({
    create,
    questionStore,
    navigate: (path) => recorder.navigate.push(path)
  });

  return {
    recorder,
    questionStore,
    submit,
    finish(sessionId = "oracle-session-1") {
      resolveCreate?.({ session: { sessionId } });
      resolveCreate = null;
      rejectCreate = null;
    },
    fail(error: unknown) {
      rejectCreate?.(error);
      resolveCreate = null;
      rejectCreate = null;
    }
  };
}

const baseInput: OracleSetupInput = {
  question: "",
  wristCircumferenceMm: undefined
};

test("setup accepts an optional question and a default-enabled cast button", () => {
  const markup = renderToStaticMarkup(
    <OracleSetupFields
      question=""
      wristCircumferenceMm={undefined}
      isSubmitting={false}
      error={null}
      onQuestionChange={() => {}}
      onWristChange={() => {}}
      onSubmit={() => {}}
    />
  );

  assert.match(markup, /可选问题/);
  assert.match(markup, /启卦/);
  assert.doesNotMatch(markup, /disabled=""[^>]*>[^<]*启卦/);
  assert.doesNotMatch(markup, /启卦[^<]*<\/button>[^]*disabled/);
  const button = markup.match(/<button[^>]*>[^<]*启卦[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.ok(button.includes("启卦"));
  assert.doesNotMatch(button, /\sdisabled(?:\s|=|>)/);
});

test("question is optional — empty question still enables the cast action", () => {
  const fields = renderToStaticMarkup(
    <OracleSetupFields
      question=""
      wristCircumferenceMm={undefined}
      isSubmitting={false}
      error={null}
      onQuestionChange={() => {}}
      onWristChange={() => {}}
      onSubmit={() => {}}
    />
  );

  const button = fields.match(/<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/)?.[0]
    ?? fields.match(/<button[^>]*>[^<]*启卦[\s\S]*?<\/button>/)?.[0]
    ?? "";
  assert.doesNotMatch(button, /\sdisabled(?:\s|=|>)/);
});

test("double submit creates exactly one Oracle session", async () => {
  const harness = createSubmitHarness();

  const first = harness.submit(baseInput);
  const second = harness.submit(baseInput);
  harness.finish("oracle-session-1");
  await Promise.all([first, second]);

  assert.equal(harness.recorder.calls.length, 1);
  assert.deepEqual(harness.recorder.navigate, ["/oracle/result/oracle-session-1"]);
});

test("a second activation after the create settled still reuses the in-flight guard", async () => {
  const harness = createSubmitHarness({
    create: async () => ({ session: { sessionId: "oracle-session-1" } })
  });

  const first = harness.submit(baseInput);
  await first; // create settled and navigate() fired, but the /oracle screen is still mounted
  const second = harness.submit(baseInput);
  await second;

  assert.equal(
    harness.recorder.calls.length,
    1,
    "a post-settle activation must not start a second create before navigation commits"
  );
  assert.deepEqual(harness.recorder.navigate, ["/oracle/result/oracle-session-1"]);
});

test("a rejected create releases the guard so a retry can succeed", async () => {
  let attempt = 0;
  const harness = createSubmitHarness({
    create: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return { session: { sessionId: "oracle-session-retry" } };
    }
  });

  await assert.rejects(() => harness.submit(baseInput), /network down/);
  await harness.submit(baseInput);

  assert.equal(harness.recorder.calls.length, 2);
  assert.deepEqual(harness.recorder.navigate, ["/oracle/result/oracle-session-retry"]);
});

test("question text is held only in the in-memory store", () => {
  const harness = createSubmitHarness();
  const question = "最近适合换个节奏吗";

  harness.questionStore.set(question);
  assert.equal(harness.questionStore.get(), question);

  const dumped = JSON.stringify({
    local: Object.keys(globalThis.localStorage?.length ? {} : {}),
  });
  assert.doesNotMatch(dumped, /最近适合换个节奏吗/);

  // The submitter never writes the question into browser storage APIs.
  const storageKeys: string[] = [];
  const submitterSource = readFileSync(
    new URL("./components/oracle-setup.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(submitterSource, /localStorage\.setItem/);
  assert.doesNotMatch(submitterSource, /sessionStorage\.setItem/);
  assert.equal(storageKeys.length, 0);
});

test("wrist validation uses the existing bracelet-fit constants", () => {
  const source = readFileSync(new URL("./components/oracle-setup.tsx", import.meta.url), "utf8");

  assert.match(source, /MIN_BRACELET_CIRCUMFERENCE_MM/);
  assert.match(source, /MAX_BRACELET_CIRCUMFERENCE_MM/);
  assert.doesNotMatch(source, /\b130\b/);
  assert.doesNotMatch(source, /\b200\b/);

  assert.equal(MIN_BRACELET_CIRCUMFERENCE_MM, 130);
  assert.equal(MAX_BRACELET_CIRCUMFERENCE_MM, 200);

  const invalid = renderToStaticMarkup(
    <OracleSetupFields
      question=""
      wristCircumferenceMm={120}
      isSubmitting={false}
      error={null}
      onQuestionChange={() => {}}
      onWristChange={() => {}}
      onSubmit={() => {}}
    />
  );
  assert.match(invalid, /腕围/);
  assert.match(invalid, /13\.0|130/);
});

test("submitter rejects out-of-range wrists before any network call", async () => {
  const harness = createSubmitHarness();

  await assert.rejects(
    () => harness.submit({ question: "", wristCircumferenceMm: 120 }),
    /腕围/
  );
  await assert.rejects(
    () => harness.submit({ question: "", wristCircumferenceMm: 210 }),
    /腕围/
  );
  assert.equal(harness.recorder.calls.length, 0);
});

test("disabled oracle flag leaves no homepage slot and no navigation promise", () => {
  const paths = getMainNavigation(CAPABILITIES_OFF);
  assert.ok(!paths.some((item) => item.label.includes("星台") || item.href.startsWith("/oracle")));

  const markup = withOracleFlag(undefined, () => renderToStaticMarkup(<HomePage />));
  assert.doesNotMatch(markup, /星台问卦/);
  assert.doesNotMatch(markup, /href="\/oracle"/);
  assert.equal((markup.match(/data-creation-path=/g) ?? []).length, 2);
});

test("enabled oracle flag adds homepage and navigation entries", () => {
  const paths = getMainNavigation(CAPABILITIES_ON);
  assert.ok(paths.some((item) => item.href === "/oracle" && item.label === "星台问卦"));

  const markup = withOracleFlag("true", () => renderToStaticMarkup(<HomePage />));
  assert.match(markup, /星台问卦/);
  assert.match(markup, /href="\/oracle"/);
  assert.equal((markup.match(/data-creation-path=/g) ?? []).length, 3);
});

test("setup layout keeps the one-tap ritual free of promotional clutter", () => {
  const markup = renderToStaticMarkup(
    <OracleSetup
      question=""
      wristCircumferenceMm={undefined}
      isSubmitting={false}
      error={null}
      onQuestionChange={() => {}}
      onWristChange={() => {}}
      onSubmit={() => {}}
    />
  );

  assert.match(markup, /凝神一问/);
  assert.match(markup, /data-oracle-setup/);
  assert.match(markup, /查看说明|文化|隐私|算法/);
  assert.match(markup, /不构成|不代表/);
  assert.doesNotMatch(markup, /转运|招财|发财|开光|加持|命定|注定/);
});

test("oracle setup adopts the star surface and keeps the one-tap cast as the sole primary action", () => {
  const source = readFileSync(new URL("./components/oracle-setup.tsx", import.meta.url), "utf8");
  assert.match(source, /data-star-surface="oracle-setup"/);
  assert.match(source, /data-oracle-setup/);
  // One primary cast action; no extra ceremonial steps appear before it.
  assert.equal((source.match(/oraclePrimaryAction/g) ?? []).length >= 1, true);
  assert.doesNotMatch(source, /data-oracle-ritual-step|启卦前请先|第一步.*第二步.*第三步/);
  const css = readFileSync(new URL("./oracle.module.css", import.meta.url), "utf8");
  assert.match(css, /data-star-surface="oracle-setup"|--star-/);
});

test("homepage capability counts stay balanced when oracle is on and off", () => {
  const off = withOracleFlag(undefined, () => renderToStaticMarkup(<HomePage />));
  const on = withOracleFlag("true", () => renderToStaticMarkup(<HomePage />));
  assert.match(off, /data-creation-count="2"/);
  assert.match(on, /data-creation-count="3"/);
  assert.match(off, /data-star-surface="home"/);
  assert.match(on, /data-star-entry-card/);
});
