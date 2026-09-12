import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

// TASK-BE-ARCH-001: accepted TASK-BE-002 retired the `community` and `order`
// module shell directories, but the root architecture scanner kept both as scan
// roots (readdir ENOENT) and kept their deleted service files as boundary
// exclusions. This meta-gate reads tests/architecture.test.mjs and enforces
// (a) no reference to the retired paths and (b) retention of the real
// design/observability/validation boundary protections.
const ARCH_GATE_PATH = "tests/architecture.test.mjs";

const RETIRED_PATH_REFS = [
  "apps/backend/src/modules/community",
  "apps/backend/src/modules/order",
];

const RETAINED_SCAN_ROOTS = [
  "apps/backend/src/contracts",
  "apps/backend/src/modules/design",
  "apps/backend/src/observability",
  "apps/backend/src/validation",
];

const RETAINED_EXCLUSIONS = [
  "apps/backend/src/modules/design/design.service.ts",
  "apps/backend/src/modules/design/recommendation.service.ts",
  "apps/backend/src/observability/knowledge-usage-recorder.ts",
];

test("architecture gate stops referencing retired community/order paths", async () => {
  const source = await readFile(ARCH_GATE_PATH, "utf8");
  const refs = RETIRED_PATH_REFS.filter((p) => source.includes(p));
  assert.deepEqual(
    refs,
    [],
    `tests/architecture.test.mjs must not reference retired module paths: ${refs.join(", ")}`
  );
});

test("architecture gate retains real design/observability/validation boundary scans", async () => {
  const source = await readFile(ARCH_GATE_PATH, "utf8");
  for (const p of RETAINED_SCAN_ROOTS) {
    assert.ok(source.includes(p), `architecture gate must keep scanning ${p}`);
  }
  for (const p of RETAINED_EXCLUSIONS) {
    assert.ok(source.includes(p), `architecture gate must keep excluding ${p}`);
  }
});