import assert from "node:assert/strict";
import test from "node:test";

import { parseReviewCliArgs } from "../src/cli/args.js";
import { runCollectDryRun } from "../src/cli/collect.js";

test("collect parses with and without --dry-run", () => {
  assert.deepEqual(parseReviewCliArgs(["collect", "--dry-run"]), {
    command: "collect",
    dryRun: true
  });
  assert.deepEqual(parseReviewCliArgs(["collect"]), {
    command: "collect",
    dryRun: false
  });
});

test("collect rejects unknown flags", () => {
  assert.equal(parseReviewCliArgs(["collect", "--bogus"]), null);
  assert.equal(parseReviewCliArgs(["collect", "extra"]), null);
});

test("dry-run coverage analysis reports phase, domains, sources, batches without DB", () => {
  // No DATABASE_URL set: runCollectDryRun is a pure function of the embedded
  // coverage matrix and must not touch the database or the filesystem.
  const report = runCollectDryRun();

  assert.equal(report.phase, "coverage-analysis");
  assert.equal(report.dryRun, true);

  // 20 knowledge domains from the embedded coverage matrix.
  assert.equal(report.domains.length, 20);
  for (const domain of report.domains) {
    assert.equal(typeof domain.domain, "string");
    assert.equal(typeof domain.target, "number");
    assert.equal(typeof domain.current, "number");
    assert.equal(typeof domain.missing, "number");
  }

  // Distinct APPROVED sources deduped across all domains.
  assert.equal(report.sources.length, 31);
  assert.equal(report.sourceCount, report.sources.length);
  assert.equal(new Set(report.sources).size, report.sources.length);

  // 4 estimated batches (Batch A/B/C/D).
  assert.equal(report.batches.length, 4);
  assert.equal(report.batchCount, report.batches.length);
  for (const batch of report.batches) {
    assert.equal(typeof batch.name, "string");
    assert.equal(typeof batch.sourceCount, "number");
    assert.ok(batch.sourceCount > 0);
  }
});
