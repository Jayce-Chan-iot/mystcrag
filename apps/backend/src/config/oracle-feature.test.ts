import assert from "node:assert/strict";
import test from "node:test";

import { resolveOracleFeatureEnabled } from "./oracle-feature.js";

test("Oracle feature flag enables only for the exact string true", () => {
  assert.equal(resolveOracleFeatureEnabled("true"), true);
  for (const value of [undefined, "false", "TRUE", "1", " true "]) {
    assert.equal(resolveOracleFeatureEnabled(value), false);
  }
});
