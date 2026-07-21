import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema, migrateDesignToV1 } from "../src/index";
import { legacyMigrationFixture, standardAiDesignFixture } from "../src/fixtures/index";

test("current DesignV1 migration is idempotent", () => {
  const first = migrateDesignToV1(standardAiDesignFixture);
  assert.equal(first.status, "MIGRATED");
  assert.deepEqual(first.warnings, []);
  assert.ok(first.design);

  const second = migrateDesignToV1(first.design);
  assert.equal(second.status, "MIGRATED");
  assert.deepEqual(second.design, first.design);
});

test("legacy migration is deterministic, immutable, and requires review", () => {
  const input = structuredClone(legacyMigrationFixture.data);
  const original = structuredClone(input);
  const first = migrateDesignToV1(input);
  const second = migrateDesignToV1(input);

  assert.deepEqual(input, original);
  assert.deepEqual(second, first);
  assert.equal(first.status, "REQUIRES_REVIEW");
  assert.ok(first.design);
  assert.equal(DesignV1Schema.safeParse(first.design).success, true);
  assert.equal(
    first.warnings.some((warning) => warning.code === "LEGACY_ORDER_NOT_RECOVERABLE"),
    true
  );
});

test("unknown major versions and malformed input are rejected", () => {
  const unknown = migrateDesignToV1({ schemaVersion: "2.0.0" });
  assert.equal(unknown.status, "REJECTED");
  assert.equal(unknown.warnings[0]?.code, "UNKNOWN_SCHEMA_VERSION");

  const invalid = migrateDesignToV1({ designName: "missing version" });
  assert.equal(invalid.status, "REJECTED");
  assert.equal(invalid.warnings[0]?.code, "INVALID_INPUT");
});
