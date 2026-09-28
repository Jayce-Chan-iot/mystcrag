import assert from "node:assert/strict";
import test from "node:test";

import {
  OracleCastDtoSchema,
  OracleDesignSignalSchema,
  OracleInterpretationSchema
} from "@mystcrag/design-contract";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { OracleSessionRepositoryImpl } from "./oracle-session.repository.js";

const oracleCastFixture = OracleCastDtoSchema.parse({
  lines: [7, 8, 9, 6, 7, 8],
  movingLineIndices: [3, 4],
  primaryHexagram: { number: 39, nameZh: "蹇", lowerTrigram: "WATER", upperTrigram: "MOUNTAIN" },
  transformedHexagram: { number: 31, nameZh: "咸", lowerTrigram: "MOUNTAIN", upperTrigram: "LAKE" },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
});

const oracleSignalFixture = OracleDesignSignalSchema.parse({
  ruleVersion: "oracle-design-rules-v1",
  primaryColorTags: ["color:black", "color:blue"],
  supportColorTags: ["color:white"],
  styleTags: ["style:eastern-contemporary"],
  rhythmTags: ["rhythm:steady"],
  accentLinePositions: [3, 4]
});

const oracleInterpretationFixture = OracleInterpretationSchema.parse({
  headline: "先稳住节奏",
  summary: "这组结构可作为观察当下节奏的一个角度。",
  keywords: ["沉静", "节奏", "转折"],
  designRationale: "深色主调以一处克制点睛承接变化。",
  disclaimer: "内容仅作文化观察与设计灵感。",
  source: { kind: "MYSTCRAG_ORIGINAL", version: "oracle-copy-v1" }
});

const now = new Date("2026-09-29T08:00:00.000Z");
const row = {
  id: "oracle-session-1",
  ownerId: "owner-1",
  operationId: "create-operation-1",
  status: "CAST" as const,
  stateRevision: 1,
  locale: "zh-CN",
  currency: "CNY" as const,
  wristCircumferenceMm: 155,
  castSnapshot: oracleCastFixture,
  signalSnapshot: oracleSignalFixture,
  interpretationSnapshot: oracleInterpretationFixture,
  algorithmVersion: "three-coin-v1",
  ruleVersion: "oracle-design-rules-v1",
  recommendationOperationId: null,
  saveOperationId: null,
  selectedDesignId: null,
  parentSessionId: null,
  createdAt: now,
  updatedAt: now,
  recommendations: [],
  parentSession: null
};

const createInput = {
  ownerId: "owner-1",
  operationId: "create-operation-1",
  locale: "zh-CN" as const,
  currency: "CNY" as const,
  wristCircumferenceMm: 155,
  cast: oracleCastFixture,
  signal: oracleSignalFixture,
  interpretation: oracleInterpretationFixture
};

class ExistingSessionClient {
  constructor(private readonly ownedRow: typeof row | null = row) {}

  readonly oracleSession = {
    findUnique: async () => row,
    findFirst: async () => this.ownedRow,
    count: async () => 0,
    create: async () => row,
    updateMany: async () => ({ count: 0 })
  };
  readonly design = { count: async () => 3 };
  readonly oracleDesignRecommendation = { createMany: async () => ({ count: 3 }) };
  async $transaction<T>(callback: (client: ExistingSessionClient) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

test("createOrGet replays one operation and rejects durable-field reuse", async () => {
  const repository = new OracleSessionRepositoryImpl(
    new ExistingSessionClient() as unknown as PrismaClient
  );
  const replay = await repository.createOrGet(createInput);
  assert.equal(replay.id, row.id);

  await assert.rejects(
    () => repository.createOrGet({ ...createInput, wristCircumferenceMm: 160 }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("owner-scoped reads do not reveal another owner's session", async () => {
  const repository = new OracleSessionRepositoryImpl(
    new ExistingSessionClient(null) as unknown as PrismaClient
  );
  await assert.rejects(
    () => repository.getOwned("owner-2", row.id),
    (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
  );
});

test("recommendations require three unique ranks and the current revision", async () => {
  const repository = new OracleSessionRepositoryImpl(
    new ExistingSessionClient() as unknown as PrismaClient
  );
  const command = {
    ownerId: "owner-1",
    sessionId: row.id,
    operationId: "recommend-operation-1",
    expectedRevision: 2,
    recommendations: [
      { rank: 1, designId: "design-1" },
      { rank: 1, designId: "design-2" },
      { rank: 3, designId: "design-3" }
    ]
  };
  await assert.rejects(
    () => repository.saveRecommendations(command),
    (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );

  await assert.rejects(
    () => repository.saveRecommendations({
      ...command,
      recommendations: [1, 2, 3].map((rank) => ({ rank, designId: `design-${rank}` }))
    }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});
