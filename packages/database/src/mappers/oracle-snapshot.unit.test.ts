import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError } from "../errors/persistence-errors.js";
import {
  parseOracleCastSnapshot,
  parseOracleInterpretationSnapshot,
  parseOracleSignalSnapshot,
  validateOracleCastSnapshotForWrite,
  validateOracleInterpretationSnapshotForWrite,
  validateOracleSignalSnapshotForWrite
} from "./oracle-snapshot.mapper.js";

const oracleCastFixture = {
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

const oracleSignalFixture = {
  ruleVersion: "oracle-design-rules-v1",
  primaryColorTags: ["color:black", "color:blue"],
  supportColorTags: ["color:white"],
  styleTags: ["style:eastern-contemporary"],
  rhythmTags: ["rhythm:steady"],
  accentLinePositions: [3, 4]
} as const;

const oracleInterpretationFixture = {
  headline: "先稳住节奏",
  summary: "这组结构可作为观察当下节奏的一个角度。",
  keywords: ["沉静", "节奏", "转折"],
  designRationale: "深色主调以一处克制点睛承接变化。",
  disclaimer: "内容仅作文化观察与设计灵感。",
  source: { kind: "MYSTCRAG_ORIGINAL", version: "oracle-copy-v1" }
} as const;

test("Oracle snapshots validate strictly before write and after read", () => {
  assert.deepEqual(validateOracleCastSnapshotForWrite(oracleCastFixture), oracleCastFixture);
  assert.deepEqual(validateOracleSignalSnapshotForWrite(oracleSignalFixture), oracleSignalFixture);
  assert.deepEqual(
    validateOracleInterpretationSnapshotForWrite(oracleInterpretationFixture),
    oracleInterpretationFixture
  );
  assert.deepEqual(parseOracleCastSnapshot(oracleCastFixture), oracleCastFixture);
  assert.deepEqual(parseOracleSignalSnapshot(oracleSignalFixture), oracleSignalFixture);
  assert.deepEqual(parseOracleInterpretationSnapshot(oracleInterpretationFixture), oracleInterpretationFixture);
});

test("Oracle snapshot writes reject question fields before database access", () => {
  assert.throws(
    () => validateOracleCastSnapshotForWrite({ ...oracleCastFixture, question: "private" }),
    (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );
});

test("corrupt persisted Oracle JSON is a data integrity error", () => {
  for (const parse of [parseOracleCastSnapshot, parseOracleSignalSnapshot, parseOracleInterpretationSnapshot]) {
    assert.throws(
      () => parse({ question: "must-not-exist" }),
      (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
    );
  }
});
