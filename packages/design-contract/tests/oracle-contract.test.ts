import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CreateOracleSessionRequestSchema,
  CreateOracleSessionResponseSchema,
  GenerateOracleRecommendationsRequestSchema,
  GenerateOracleRecommendationsResponseSchema,
  GetOracleSessionResponseSchema,
  OracleCastDtoSchema,
  OracleDesignSignalSchema,
  OraclePublicSessionSchema,
  SaveOracleSessionRequestSchema,
  SaveOracleSessionResponseSchema
} from "../src/index";
import { standardAiDesignFixture } from "../src/fixtures/index";

const createdAt = "2026-09-29T08:00:00.000Z";
const updatedAt = "2026-09-29T08:00:01.000Z";

const cast = {
  lines: [7, 8, 9, 6, 7, 8],
  movingLineIndices: [3, 4],
  primaryHexagram: {
    number: 39,
    nameZh: "蹇",
    lowerTrigram: "WATER",
    upperTrigram: "MOUNTAIN"
  },
  transformedHexagram: {
    number: 31,
    nameZh: "咸",
    lowerTrigram: "MOUNTAIN",
    upperTrigram: "LAKE"
  },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
} as const;

const signal = {
  ruleVersion: "oracle-design-rules-v1",
  primaryColorTags: ["color:ink", "color:blue"],
  supportColorTags: ["color:ivory"],
  styleTags: ["style:eastern-contemporary"],
  rhythmTags: ["rhythm:measured"],
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

const oracleDesigns = (["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const).map((direction, index) => {
  const design = structuredClone(standardAiDesignFixture);
  design.designId = `oracle-design-${index + 1}`;
  design.designMode = "ORACLE_GUIDED" as typeof design.designMode;
  design.provenance.oracleCandidate = {
    sessionId: "oracle-session-1",
    ruleVersion: "oracle-design-rules-v1",
    rank: index + 1,
    direction
  };
  return design;
});

const castSession = {
  sessionId: "oracle-session-1",
  status: "CAST",
  revision: 1,
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 165,
  parentSessionId: "oracle-session-parent-1",
  cast,
  signal,
  interpretation,
  createdAt,
  updatedAt
} as const;

const recommendedSession = {
  ...castSession,
  status: "RECOMMENDED",
  revision: 2,
  recommendations: oracleDesigns.map((design, index) => ({
    rank: index + 1,
    direction: (["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const)[index],
    design
  })),
  updatedAt: "2026-09-29T08:00:02.000Z"
} as const;

test("Oracle cast fixes six bottom-to-top lines and moving-line consistency", () => {
  assert.equal(OracleCastDtoSchema.safeParse(cast).success, true);

  assert.equal(OracleCastDtoSchema.safeParse({ ...cast, lines: [7, 8, 9, 6, 7] }).success, false);
  assert.equal(OracleCastDtoSchema.safeParse({ ...cast, movingLineIndices: [3] }).success, false);
  assert.equal(OracleCastDtoSchema.safeParse({ ...cast, movingLineIndices: [4, 3] }).success, false);
  assert.equal(OracleCastDtoSchema.safeParse({ ...cast, transformedHexagram: undefined }).success, false);

  const staticCast = {
    ...cast,
    lines: [7, 8, 7, 8, 7, 8],
    movingLineIndices: [],
    transformedHexagram: undefined
  };
  assert.equal(OracleCastDtoSchema.safeParse(staticCast).success, true);
  assert.equal(
    OracleCastDtoSchema.safeParse({ ...staticCast, transformedHexagram: cast.transformedHexagram }).success,
    false
  );
});

test("Oracle design signals are strict versioned preferences only", () => {
  assert.equal(OracleDesignSignalSchema.safeParse(signal).success, true);
  assert.equal(
    OracleDesignSignalSchema.safeParse({ ...signal, accentLinePositions: [3, 3] }).success,
    false
  );
  assert.equal(
    OracleDesignSignalSchema.safeParse({ ...signal, guaranteedOutcome: "wealth" }).success,
    false
  );
});

test("Oracle requests accept the approved one-tap inputs and reject unknown fields", () => {
  const create = {
    requestId: "request-oracle-create-1",
    operationId: "operation-oracle-create-1",
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 165,
    question: "我可以如何安排接下来的节奏？",
    parentSessionId: "oracle-session-parent-1"
  };
  assert.equal(CreateOracleSessionRequestSchema.safeParse(create).success, true);
  assert.equal(CreateOracleSessionRequestSchema.safeParse({ ...create, question: "" }).success, false);
  assert.equal(CreateOracleSessionRequestSchema.safeParse({ ...create, question: "问".repeat(121) }).success, false);
  assert.equal(CreateOracleSessionRequestSchema.safeParse({ ...create, saveQuestion: true }).success, false);

  assert.equal(
    GenerateOracleRecommendationsRequestSchema.safeParse({
      requestId: "request-oracle-recommend-1",
      operationId: "operation-oracle-recommend-1",
      expectedRevision: 1
    }).success,
    true
  );
  assert.equal(
    SaveOracleSessionRequestSchema.safeParse({
      requestId: "request-oracle-save-1",
      operationId: "operation-oracle-save-1",
      expectedRevision: 2,
      selectedDesignId: "oracle-design-1"
    }).success,
    true
  );
});

test("Oracle responses expose no question and enforce lifecycle-specific fields", () => {
  assert.equal(
    CreateOracleSessionResponseSchema.safeParse({
      requestId: "request-oracle-create-1",
      session: castSession
    }).success,
    true
  );
  assert.equal(
    CreateOracleSessionResponseSchema.safeParse({
      requestId: "request-oracle-create-1",
      session: { ...castSession, question: "must not leak" }
    }).success,
    false
  );
  assert.equal(OraclePublicSessionSchema.safeParse({ ...castSession, recommendations: [] }).success, false);

  assert.equal(
    GenerateOracleRecommendationsResponseSchema.safeParse({
      requestId: "request-oracle-recommend-1",
      session: recommendedSession
    }).success,
    true
  );
  assert.equal(
    GenerateOracleRecommendationsResponseSchema.safeParse({
      requestId: "request-oracle-recommend-1",
      session: castSession
    }).success,
    false
  );
  assert.equal(
    GetOracleSessionResponseSchema.safeParse({
      requestId: "request-oracle-get-1",
      session: recommendedSession
    }).success,
    true
  );
});

test("Oracle recommendations require exact ranks, directions and distinct Design IDs", () => {
  assert.equal(OraclePublicSessionSchema.safeParse(recommendedSession).success, true);

  const duplicateRank = structuredClone(recommendedSession);
  duplicateRank.recommendations[1]!.rank = 1;
  assert.equal(OraclePublicSessionSchema.safeParse(duplicateRank).success, false);

  const duplicateDirection = structuredClone(recommendedSession);
  duplicateDirection.recommendations[1]!.direction = "BALANCED";
  assert.equal(OraclePublicSessionSchema.safeParse(duplicateDirection).success, false);

  const duplicateDesign = structuredClone(recommendedSession);
  duplicateDesign.recommendations[1]!.design.designId = duplicateDesign.recommendations[0]!.design.designId;
  assert.equal(OraclePublicSessionSchema.safeParse(duplicateDesign).success, false);
});

test("Oracle save requires a selected recommendation and is strict", () => {
  const savedSession = {
    ...recommendedSession,
    status: "SAVED",
    revision: 3,
    selectedDesignId: "oracle-design-1",
    updatedAt: "2026-09-29T08:00:03.000Z"
  };
  assert.equal(
    SaveOracleSessionResponseSchema.safeParse({
      requestId: "request-oracle-save-1",
      session: savedSession
    }).success,
    true
  );
  assert.equal(
    SaveOracleSessionResponseSchema.safeParse({
      requestId: "request-oracle-save-1",
      session: { ...savedSession, selectedDesignId: "not-a-recommendation" }
    }).success,
    false
  );
  assert.equal(OraclePublicSessionSchema.safeParse({ ...savedSession, selectedDesignId: undefined }).success, false);
});

test("the public contract exports OracleCastDto but no ambiguous OracleCast type", () => {
  const oracleSource = readFileSync(new URL("../src/schemas/oracle.schema.ts", import.meta.url), "utf8");
  const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(indexSource, /export \* from "\.\/schemas\/oracle\.schema"/);
  assert.match(oracleSource, /export type OracleCastDto\s*=/);
  assert.doesNotMatch(oracleSource, /export type OracleCast\s*=/);
});
