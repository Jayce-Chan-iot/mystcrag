import assert from "node:assert/strict";
import test from "node:test";

import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { bigintToMinor, minorToBigInt } from "./money.mapper.js";
import { parseDesignSnapshot } from "./snapshot.mapper.js";

test("minor-unit mapper accepts CNY fen and TWD whole-dollar integers", () => {
  assert.equal(minorToBigInt(5_500, "cnyTotal"), 5_500n);
  assert.equal(minorToBigInt(1_280, "twdTotal"), 1_280n);
  assert.equal(bigintToMinor(5_500n, "cnyTotal"), 5_500);
});

test("minor-unit mapper rejects unsafe, fractional, and negative amounts", () => {
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => minorToBigInt(value, "amount"), PersistenceError);
  }
  assert.throws(
    () => bigintToMinor(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "amount"),
    (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
  );
});

test("persisted design JSON is validated after read and rejects unknown majors", () => {
  assert.equal(parseDesignSnapshot(structuredClone(standardAiDesignFixture)).schemaVersion, "1.0.0");
  assert.throws(
    () => parseDesignSnapshot({ ...structuredClone(standardAiDesignFixture), schemaVersion: "2.0.0" }),
    (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
  );
});

test("database errors are translated without exposing Prisma errors", () => {
  assert.throws(
    () => rethrowPersistenceError({ code: "P2002", message: "raw database details" }),
    (error: unknown) =>
      error instanceof PersistenceError &&
      error.code === "CONFLICT" &&
      !error.message.includes("raw database details")
  );
});
