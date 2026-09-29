import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import {
  OracleQuestionProvider,
  createOracleQuestionStore
} from "../../features/oracle/oracle-question-provider";
import { isOracleFeatureEnabled, resolveOracleFeatureEnabled } from "./api-runtime";
import { FrontendApiError } from "./frontend-api-error";
import { createOracleApiClient } from "./oracle-api";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const createdAt = "2026-09-29T08:00:00.000Z";
const updatedAt = "2026-09-29T08:00:01.000Z";
const sessionId = "oracle/session 1";

const cast = {
  lines: [7, 8, 9, 6, 7, 8],
  movingLineIndices: [3, 4],
  primaryHexagram: { number: 39, nameZh: "蹇", lowerTrigram: "WATER", upperTrigram: "MOUNTAIN" },
  transformedHexagram: { number: 31, nameZh: "咸", lowerTrigram: "MOUNTAIN", upperTrigram: "LAKE" },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
} as const;

const signal = {
  ruleVersion: "oracle-design-rules-v1",
  primaryColorTags: ["color:black", "color:blue"],
  supportColorTags: ["color:white"],
  styleTags: ["style:eastern-contemporary"],
  rhythmTags: ["rhythm:steady"],
  accentLinePositions: [3, 4]
} as const;

const interpretation = {
  headline: "先稳住节奏，再观察转折",
  summary: "这组结构可作为观察当下节奏的一个角度，设计以沉静层次承接变化。",
  keywords: ["沉静", "节奏", "转折"],
  designRationale: "深色主调配一处克制点睛，让动爻只成为视觉转折而非命运判断。",
  disclaimer: "内容仅作文化观察与设计灵感，不构成预测、医疗建议或水晶功效承诺。",
  source: { kind: "MYSTCRAG_ORIGINAL", version: "oracle-copy-v1" }
} as const;

const directions = ["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const;

const oracleDesigns = directions.map((direction, index) => {
  const design = structuredClone(standardAiDesignFixture);
  design.designId = `oracle-design-${index + 1}`;
  design.designMode = "ORACLE_GUIDED" as typeof design.designMode;
  design.provenance.oracleCandidate = {
    sessionId,
    ruleVersion: signal.ruleVersion,
    rank: index + 1,
    direction
  };
  return design;
});

const castSession = {
  sessionId,
  status: "CAST",
  revision: 1,
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 155,
  cast,
  signal,
  interpretation,
  createdAt,
  updatedAt
} as const;

const recommendations = oracleDesigns.map((design, index) => ({
  rank: index + 1,
  direction: directions[index]!,
  design
}));

const recommendedSession = {
  ...castSession,
  status: "RECOMMENDED",
  revision: 2,
  recommendations,
  updatedAt: "2026-09-29T08:00:02.000Z"
} as const;

const savedSession = {
  ...recommendedSession,
  status: "SAVED",
  revision: 3,
  selectedDesignId: "oracle-design-1",
  updatedAt: "2026-09-29T08:00:03.000Z"
} as const;

const createRequest = {
  requestId: "request-oracle-create-1",
  operationId: "operation-oracle-create-1",
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 165,
  question: "只应存在于本次请求里的问题"
} as const;

const recommendationRequest = {
  requestId: "request-oracle-recommend-1",
  operationId: "operation-oracle-recommend-1",
  expectedRevision: 1
} as const;

const saveRequest = {
  requestId: "request-oracle-save-1",
  operationId: "operation-oracle-save-1",
  expectedRevision: 2,
  selectedDesignId: "oracle-design-1"
} as const;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("Oracle operations use canonical protected routes with encoded session IDs", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const responses = [
    { requestId: "request-oracle-create-1", session: castSession },
    { requestId: "request-oracle-recommend-1", session: recommendedSession },
    { requestId: "request-oracle-get-1", session: recommendedSession },
    { requestId: "request-oracle-save-1", session: savedSession }
  ];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), ...(init ? { init } : {}) });
    return jsonResponse(responses[calls.length - 1]);
  }) as typeof fetch;
  const client = createOracleApiClient({ fetcher });

  const created = await client.create(createRequest);
  const recommended = await client.recommendations(sessionId, recommendationRequest);
  const restored = await client.get(sessionId);
  const saved = await client.save(sessionId, saveRequest);

  assert.deepEqual(calls.map((call) => call.input), [
    "/api/oracle/sessions",
    `/api/oracle/sessions/${encodeURIComponent(sessionId)}/recommendations`,
    `/api/oracle/sessions/${encodeURIComponent(sessionId)}`,
    `/api/oracle/sessions/${encodeURIComponent(sessionId)}/save`
  ]);
  assert.deepEqual(calls.map((call) => call.init?.method), ["POST", "POST", "GET", "POST"]);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), createRequest);
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), recommendationRequest);
  assert.equal(calls[2]?.init?.body, undefined);
  assert.deepEqual(JSON.parse(String(calls[3]?.init?.body)), saveRequest);

  // The BFF proxy attaches the server-side bearer credential; the client never handles it.
  for (const call of calls) {
    const headers = (call.init?.headers ?? {}) as Record<string, unknown>;
    assert.equal(Object.hasOwn(headers, "authorization"), false);
    assert.equal(Object.hasOwn(headers, "x-actor-id"), false);
  }

  assert.equal(created.session.status, "CAST");
  assert.equal(recommended.session.recommendations?.length, 3);
  assert.equal(restored.session.status, "RECOMMENDED");
  assert.equal(saved.session.selectedDesignId, "oracle-design-1");
});

test("no Oracle response exposes the ephemeral question", async () => {
  const responses = [
    { requestId: "request-oracle-create-1", session: castSession },
    { requestId: "request-oracle-recommend-1", session: recommendedSession }
  ];
  const fetcher = (async () => jsonResponse(responses.shift())) as typeof fetch;
  const client = createOracleApiClient({ fetcher });

  const created = await client.create(createRequest);
  const recommended = await client.recommendations(sessionId, recommendationRequest);

  for (const result of [created, recommended]) {
    assert.equal(Object.hasOwn(result as object, "question"), false);
    assert.equal(Object.hasOwn(result.session as object, "question"), false);
    assert.equal(JSON.stringify(result).includes(createRequest.question), false);
  }
});

test("the Oracle client maps a missing BFF session cookie to UNAUTHORIZED", async () => {
  const client = createOracleApiClient({
    fetcher: (async () =>
      jsonResponse(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required.", requestId: "req-1" } },
        401
      )) as typeof fetch
  });

  await assert.rejects(
    client.get("oracle-session-1"),
    (error: unknown) => error instanceof FrontendApiError && error.code === "UNAUTHORIZED"
  );
});

test("invalid successful Oracle payloads are rejected at the response boundary", async () => {
  const responses = [
    { requestId: "request-oracle-create-1", session: { ...castSession, question: "不得泄漏" } },
    { requestId: "request-oracle-get-1", session: { ...castSession, recommendations: [] } },
    { requestId: "request-oracle-get-1", session: castSession, unexpected: true }
  ];
  const fetcher = (async () => jsonResponse(responses.shift())) as typeof fetch;
  const client = createOracleApiClient({ fetcher });

  for (const call of [
    () => client.create(createRequest),
    () => client.get("oracle-session-1"),
    () => client.get("oracle-session-1")
  ]) {
    await assert.rejects(
      call(),
      (error: unknown) => error instanceof FrontendApiError && error.code === "INTERNAL_ERROR"
    );
  }
});

for (const code of ["CONFLICT", "INVENTORY_CHANGED", "PRICE_CHANGED", "COMPLIANCE_BLOCKED"] as const) {
  test(`${code} Oracle errors remain stable Frontend states`, async () => {
    const client = createOracleApiClient({
      fetcher: (async () =>
        jsonResponse({ error: { code, message: code, requestId: "request-oracle-error" } }, 409)) as typeof fetch
    });

    await assert.rejects(
      client.get("oracle-session-1"),
      (error: unknown) =>
        error instanceof FrontendApiError &&
        error.code === code &&
        error.requestId === "request-oracle-error"
    );
  });
}

test("a disabled Oracle rollout preserves the NOT_IMPLEMENTED state", async () => {
  const client = createOracleApiClient({
    fetcher: (async () =>
      jsonResponse(
        {
          error: {
            code: "NOT_IMPLEMENTED",
            message: "Oracle session creation is disabled.",
            requestId: "request-oracle-create-1"
          }
        },
        501
      )) as typeof fetch
  });

  await assert.rejects(
    client.create(createRequest),
    (error: unknown) =>
      error instanceof FrontendApiError &&
      error.code === "NOT_IMPLEMENTED" &&
      error.requestId === "request-oracle-create-1"
  );
});

test("the Oracle question is sent ephemerally without browser persistence", async () => {
  let localWrites = 0;
  let sessionWrites = 0;
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: () => { localWrites += 1; } }
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { setItem: () => { sessionWrites += 1; } }
  });
  try {
    const client = createOracleApiClient({
      fetcher: (async () => jsonResponse({ requestId: "request-oracle-create-1", session: castSession })) as typeof fetch
    });
    const store = createOracleQuestionStore();
    store.set(createRequest.question);
    assert.equal(store.get(), createRequest.question);

    await client.create({ ...createRequest, question: store.get() });

    const markup = renderToStaticMarkup(
      React.createElement(OracleQuestionProvider, null, React.createElement("span", null, "child"))
    );
    assert.match(markup, /child/);

    store.clear();
    assert.equal(store.get(), "");
    assert.equal(localWrites, 0);
    assert.equal(sessionWrites, 0);
  } finally {
    if (originalLocalStorage) Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalSessionStorage) Object.defineProperty(globalThis, "sessionStorage", originalSessionStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("Oracle client sources never reach browser storage, URLs, analytics, or logs", () => {
  const sources = [
    readFileSync(new URL("./oracle-api.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../features/oracle/oracle-question-provider.tsx", import.meta.url), "utf8")
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /document\.cookie|sendBeacon|window\.location|location\.(?:search|href)/);
    assert.doesNotMatch(source, /history\.(?:pushState|replaceState)|URLSearchParams/);
    assert.doesNotMatch(source, /analytics|console\./);
  }
});

test("the Oracle rollout flag is server-only and matches the exact Backend matrix", () => {
  const originalServerFlag = process.env.MYSTCRAG_ORACLE_ENABLED;
  const originalPublicFlag = process.env.NEXT_PUBLIC_MYSTCRAG_ORACLE_ENABLED;
  try {
    delete process.env.MYSTCRAG_ORACLE_ENABLED;
    process.env.NEXT_PUBLIC_MYSTCRAG_ORACLE_ENABLED = "true";
    assert.equal(isOracleFeatureEnabled(), false);

    for (const { value, expected } of [
      { value: undefined, expected: false },
      { value: "", expected: false },
      { value: "false", expected: false },
      { value: "TRUE", expected: false },
      { value: " true ", expected: false },
      { value: "1", expected: false },
      { value: "true", expected: true }
    ] as const) {
      assert.equal(resolveOracleFeatureEnabled(value), expected);
    }

    process.env.MYSTCRAG_ORACLE_ENABLED = "true";
    assert.equal(isOracleFeatureEnabled(), true);
  } finally {
    if (originalServerFlag === undefined) delete process.env.MYSTCRAG_ORACLE_ENABLED;
    else process.env.MYSTCRAG_ORACLE_ENABLED = originalServerFlag;
    if (originalPublicFlag === undefined) delete process.env.NEXT_PUBLIC_MYSTCRAG_ORACLE_ENABLED;
    else process.env.NEXT_PUBLIC_MYSTCRAG_ORACLE_ENABLED = originalPublicFlag;
  }
});
