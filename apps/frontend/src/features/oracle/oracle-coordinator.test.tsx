import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OracleCastSessionSchema,
  OracleRecommendedSessionSchema,
  OracleSavedSessionSchema,
  type CreateOracleSessionRequest,
  type GenerateOracleRecommendationsRequest,
  type SaveOracleSessionRequest
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { FrontendApiError } from "../../lib/api/frontend-api-error";
import type { OracleApiClient } from "../../lib/api/oracle-api";
import { createOracleCoordinator, type OracleCoordinatorSnapshot } from "./oracle-coordinator";

const createdAt = "2026-09-29T08:00:00.000Z";
const sessionId = "oracle-session-1";
const ruleVersion = "oracle-design-rules-v1";

const directions = ["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const;

const oracleDesigns = directions.map((direction, index) => {
  const design = structuredClone(standardAiDesignFixture);
  design.designId = `oracle-design-${index + 1}`;
  design.designMode = "ORACLE_GUIDED" as typeof design.designMode;
  design.provenance.oracleCandidate = { sessionId, ruleVersion, rank: index + 1, direction };
  return design;
});

const interpretation = {
  headline: "先稳住节奏，再观察转折",
  summary: "这组结构可作为观察当下节奏的一个角度，设计以沉静层次承接变化。",
  keywords: ["沉静", "节奏", "转折"],
  designRationale: "深色主调配一处克制点睛，让动爻只成为视觉转折而非命运判断。",
  disclaimer: "内容仅作文化观察与设计灵感，不构成预测、医疗建议或水晶功效承诺。",
  source: { kind: "MYSTCRAG_ORIGINAL", version: "oracle-copy-v1" }
};

const castSession = OracleCastSessionSchema.parse({
  sessionId,
  status: "CAST",
  revision: 1,
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 155,
  cast: {
    lines: [7, 8, 9, 6, 7, 8],
    movingLineIndices: [3, 4],
    primaryHexagram: { number: 39, nameZh: "蹇", lowerTrigram: "WATER", upperTrigram: "MOUNTAIN" },
    transformedHexagram: { number: 31, nameZh: "咸", lowerTrigram: "MOUNTAIN", upperTrigram: "LAKE" },
    algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
  },
  signal: {
    ruleVersion,
    primaryColorTags: ["color:black", "color:blue"],
    supportColorTags: ["color:white"],
    styleTags: ["style:eastern-contemporary"],
    rhythmTags: ["rhythm:steady"],
    accentLinePositions: [3, 4]
  },
  interpretation,
  createdAt,
  updatedAt: createdAt
});

const staticCastSession = OracleCastSessionSchema.parse({
  ...castSession,
  cast: {
    lines: [7, 8, 7, 8, 7, 8],
    movingLineIndices: [],
    primaryHexagram: { number: 29, nameZh: "坎", lowerTrigram: "WATER", upperTrigram: "WATER" },
    algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
  },
  signal: { ...castSession.signal, accentLinePositions: [] }
});

const recommendedSession = OracleRecommendedSessionSchema.parse({
  ...castSession,
  status: "RECOMMENDED",
  revision: 2,
  recommendations: oracleDesigns.map((design, index) => ({
    rank: index + 1,
    direction: directions[index]!,
    design
  })),
  updatedAt: "2026-09-29T08:00:02.000Z"
});

const staticRecommendedSession = OracleRecommendedSessionSchema.parse({
  ...staticCastSession,
  status: "RECOMMENDED",
  revision: 2,
  recommendations: oracleDesigns.map((design, index) => ({
    rank: index + 1,
    direction: directions[index]!,
    design
  })),
  updatedAt: "2026-09-29T08:00:02.000Z"
});

const savedSession = OracleSavedSessionSchema.parse({
  ...recommendedSession,
  status: "SAVED",
  revision: 3,
  selectedDesignId: "oracle-design-3",
  updatedAt: "2026-09-29T08:00:03.000Z"
});

type RecordedCalls = {
  create: CreateOracleSessionRequest[];
  recommendations: Array<{ sessionId: string; input: GenerateOracleRecommendationsRequest }>;
  get: string[];
  save: Array<{ sessionId: string; input: SaveOracleSessionRequest }>;
};

function makeApi(handlers: Partial<OracleApiClient> = {}) {
  const calls: RecordedCalls = { create: [], recommendations: [], get: [], save: [] };
  const api: OracleApiClient = {
    async create(input) {
      calls.create.push(input);
      return handlers.create ? handlers.create(input) : { requestId: input.requestId, session: castSession };
    },
    async recommendations(id, input) {
      calls.recommendations.push({ sessionId: id, input });
      return handlers.recommendations
        ? handlers.recommendations(id, input)
        : { requestId: input.requestId, session: recommendedSession };
    },
    async get(id) {
      calls.get.push(id);
      return handlers.get ? handlers.get(id) : { requestId: "request-oracle-get-1", session: recommendedSession };
    },
    async save(id, input) {
      calls.save.push({ sessionId: id, input });
      return handlers.save ? handlers.save(id, input) : { requestId: input.requestId, session: savedSession };
    }
  };
  return { api, calls };
}

function makeCoordinator(api: OracleApiClient) {
  const navigations: string[] = [];
  const snapshots: OracleCoordinatorSnapshot[] = [];
  let clock = 1_000;
  const coordinator = createOracleCoordinator({
    api,
    navigate: (id) => navigations.push(id),
    now: () => (clock += 1)
  });
  coordinator.subscribe(() => snapshots.push(coordinator.getSnapshot()));
  return { coordinator, navigations, snapshots };
}

test("one tap creates once, redirects to the returned session, and reads the cast immediately", async () => {
  let releaseCreate: (() => void) | undefined;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const { api, calls } = makeApi({
    create: async (input) => {
      await createGate;
      return { requestId: input.requestId, session: castSession };
    }
  });
  const { coordinator, navigations, snapshots } = makeCoordinator(api);

  const first = coordinator.start({ locale: "zh-CN", currency: "CNY", wristCircumferenceMm: 165, question: "双击只应创建一次" });
  const second = coordinator.start({ locale: "zh-CN", currency: "CNY" });
  releaseCreate?.();
  await Promise.all([first, second]);

  assert.equal(calls.create.length, 1);
  assert.deepEqual(navigations, [sessionId]);
  assert.equal(calls.recommendations.length, 1);
  assert.equal(calls.recommendations[0]?.sessionId, sessionId);
  assert.equal(calls.recommendations[0]?.input.expectedRevision, 1);
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().session?.status, "RECOMMENDED");

  const revealing = snapshots.find((snapshot) => snapshot.state === "revealing");
  assert.ok(revealing, "the cast must be readable during the reveal state");
  assert.deepEqual(revealing?.session?.cast.lines, [7, 8, 9, 6, 7, 8]);
  assert.equal(revealing?.error, null);
  assert.equal(revealing?.session?.recommendations, undefined);
});

test("a failed recommendation keeps the cast readable and retries recommendations only", async () => {
  let failing = true;
  const { api, calls } = makeApi({
    recommendations: async (id, input) => {
      if (failing) throw new FrontendApiError("INVENTORY_CHANGED", "three in-stock materials are required");
      return { requestId: input.requestId, session: recommendedSession };
    }
  });
  const { coordinator } = makeCoordinator(api);

  await coordinator.start({ locale: "zh-CN", currency: "CNY" });
  const failed = coordinator.getSnapshot();
  assert.equal(failed.state, "error");
  assert.equal(failed.error?.code, "INVENTORY_CHANGED");
  assert.deepEqual(failed.session?.cast.lines, [7, 8, 9, 6, 7, 8]);
  assert.equal(failed.session?.status, "CAST");

  failing = false;
  await coordinator.retryRecommendations();

  assert.equal(calls.create.length, 1, "retry must never create a second session");
  assert.equal(calls.recommendations.length, 2);
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().error, null);
});

test("restore reads the authoritative session and never creates", async () => {
  const { api, calls } = makeApi({
    get: async () => ({ requestId: "request-oracle-get-1", session: recommendedSession })
  });
  const { coordinator, navigations } = makeCoordinator(api);

  await coordinator.restore(sessionId);

  assert.deepEqual(calls.get, [sessionId]);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.recommendations.length, 0);
  assert.deepEqual(navigations, []);
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().session?.status, "RECOMMENDED");
});

test("restoring a CAST session resumes recommendations without creating", async () => {
  const { api, calls } = makeApi({
    get: async () => ({ requestId: "request-oracle-get-1", session: castSession })
  });
  const { coordinator } = makeCoordinator(api);

  await coordinator.restore(sessionId);

  assert.equal(calls.create.length, 0);
  assert.deepEqual(calls.get, [sessionId]);
  assert.equal(calls.recommendations.length, 1);
  assert.equal(calls.recommendations[0]?.input.expectedRevision, 1);
  assert.equal(coordinator.getSnapshot().state, "recommended");
});

test("all-static casts never invent a transformed hexagram", async () => {
  const { api } = makeApi({
    create: async (input) => ({ requestId: input.requestId, session: staticCastSession }),
    recommendations: async (id, input) => ({ requestId: input.requestId, session: staticRecommendedSession })
  });
  const { coordinator, snapshots } = makeCoordinator(api);

  await coordinator.start({ locale: "zh-CN", currency: "CNY" });

  const revealed = snapshots.filter((snapshot) => snapshot.session !== null);
  assert.ok(revealed.length > 0);
  for (const snapshot of revealed) {
    assert.equal(snapshot.session?.cast.transformedHexagram, undefined);
    assert.deepEqual(snapshot.session?.cast.movingLineIndices, []);
  }
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().session?.cast.transformedHexagram, undefined);
});

test("an ambiguous create reconciles through an idempotent replay and GET", async () => {
  let attempts = 0;
  const { api, calls } = makeApi({
    create: async (input) => {
      attempts += 1;
      if (attempts === 1) throw new FrontendApiError("NETWORK_ERROR", "connection reset");
      return { requestId: input.requestId, session: castSession };
    },
    get: async () => ({ requestId: "request-oracle-get-1", session: castSession })
  });
  const { coordinator, navigations } = makeCoordinator(api);

  await coordinator.start({ locale: "zh-CN", currency: "CNY", question: "歧义创建" });

  assert.equal(calls.create.length, 2);
  assert.equal(calls.create[0]?.operationId, calls.create[1]?.operationId);
  assert.equal(calls.create[0]?.question, calls.create[1]?.question);
  assert.deepEqual(calls.get, [sessionId]);
  assert.deepEqual(navigations, [sessionId]);
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().error, null);
});

test("an ambiguous recommendation reconciles through GET", async () => {
  const { api, calls } = makeApi({
    recommendations: async () => {
      throw new FrontendApiError("NETWORK_ERROR", "gateway timeout");
    },
    get: async () => ({ requestId: "request-oracle-get-1", session: recommendedSession })
  });
  const { coordinator } = makeCoordinator(api);

  await coordinator.start({ locale: "zh-CN", currency: "CNY" });

  assert.equal(calls.create.length, 1);
  assert.equal(calls.recommendations.length, 1);
  assert.deepEqual(calls.get, [sessionId]);
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().error, null);
});

test("an ambiguous save keeps the selected design when the backend has not saved it", async () => {
  const { api, calls } = makeApi({
    save: async () => {
      throw new FrontendApiError("NETWORK_ERROR", "gateway timeout");
    },
    get: async () => ({ requestId: "request-oracle-get-1", session: recommendedSession })
  });
  const { coordinator } = makeCoordinator(api);

  await coordinator.start({ locale: "zh-CN", currency: "CNY" });
  await coordinator.save("oracle-design-2");

  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0]?.input.selectedDesignId, "oracle-design-2");
  assert.deepEqual(calls.get, [sessionId]);
  assert.equal(coordinator.getSnapshot().state, "error");
  assert.equal(coordinator.getSnapshot().selectedDesignId, "oracle-design-2");
  assert.equal(coordinator.getSnapshot().session?.status, "RECOMMENDED");
  assert.deepEqual(coordinator.getSnapshot().session?.cast.lines, [7, 8, 9, 6, 7, 8]);
});

test("an ambiguous save adopts the saved session from GET", async () => {
  const { api, calls } = makeApi({
    save: async () => {
      throw new FrontendApiError("NETWORK_ERROR", "gateway timeout");
    },
    get: async () => ({ requestId: "request-oracle-get-1", session: savedSession })
  });
  const { coordinator } = makeCoordinator(api);

  await coordinator.start({ locale: "zh-CN", currency: "CNY" });
  await coordinator.save("oracle-design-3");

  assert.equal(calls.save.length, 1);
  assert.deepEqual(calls.get, [sessionId]);
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().selectedDesignId, "oracle-design-3");
  assert.equal(coordinator.getSnapshot().session?.status, "SAVED");
});

test("a successful save keeps the authoritative selection", async () => {
  const { api, calls } = makeApi();
  const { coordinator } = makeCoordinator(api);

  await coordinator.start({ locale: "zh-CN", currency: "CNY" });
  await coordinator.save("oracle-design-3");

  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0]?.input.expectedRevision, 2);
  assert.equal(coordinator.getSnapshot().state, "recommended");
  assert.equal(coordinator.getSnapshot().session?.status, "SAVED");
  assert.equal(coordinator.getSnapshot().selectedDesignId, "oracle-design-3");
});

test("the coordinator owns transitions and never touches storage, URLs, analytics, or logs", () => {
  const source = readFileSync(new URL("./oracle-coordinator.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /from "react"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.|window\./);
  assert.doesNotMatch(source, /analytics|console\.|URLSearchParams|history\./);
  assert.match(source, /reconcile/i);
});
