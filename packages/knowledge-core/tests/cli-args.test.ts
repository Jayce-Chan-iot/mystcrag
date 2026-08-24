import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewCliArgs } from "../src/cli/args.js";

test("parses list command with status and limit options", () => {
  assert.deepEqual(parseReviewCliArgs(["list", "--status", "NEEDS_REVIEW", "--limit", "20"]), {
    command: "list",
    status: "NEEDS_REVIEW",
    limit: 20
  });
});

test("parses rule id commands", () => {
  assert.deepEqual(parseReviewCliArgs(["approve", "krule-color-01"]), {
    command: "approve",
    ruleId: "krule-color-01"
  });
  assert.deepEqual(parseReviewCliArgs(["show", "cand-abc"]), {
    command: "show",
    ruleId: "cand-abc"
  });
});

test("parses publish with a version", () => {
  assert.deepEqual(parseReviewCliArgs(["publish", "2026-08-21.1"]), {
    command: "publish",
    version: "2026-08-21.1"
  });
});

test("import-fixtures accepts an optional publish version", () => {
  assert.deepEqual(parseReviewCliArgs(["import-fixtures"]), {
    command: "import-fixtures",
    publishVersion: undefined
  });
  assert.deepEqual(parseReviewCliArgs(["import-fixtures", "--publish", "seed-v1"]), {
    command: "import-fixtures",
    publishVersion: "seed-v1"
  });
});

test("unknown commands and missing arguments are rejected", () => {
  assert.equal(parseReviewCliArgs(["explode"]), null);
  assert.equal(parseReviewCliArgs([]), null);
  assert.equal(parseReviewCliArgs(["approve"]), null);
  assert.equal(parseReviewCliArgs(["publish"]), null);
  assert.equal(parseReviewCliArgs(["list", "--status", "BOGUS_STATUS"]), null);
  assert.equal(parseReviewCliArgs(["list", "--limit", "not-a-number"]), null);
});
