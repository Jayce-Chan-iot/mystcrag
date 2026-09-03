import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { processBeadImage, type ProcessedBeadImage } from "../src/image-processor.js";
import { QC_CHECK_IDS, QC_THRESHOLDS, runQualityChecks } from "../src/quality.js";

async function renderBeadPng(options: { blurSigma?: number } = {}): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <rect width="800" height="800" fill="#f0f0f0"/>
    <circle cx="400" cy="400" r="300" fill="#c0392b"/>
    <circle cx="330" cy="330" r="40" fill="#ffffff"/>
  </svg>`;
  let pipeline = sharp(Buffer.from(svg));
  if (options.blurSigma) pipeline = pipeline.blur(options.blurSigma);
  return pipeline.png().toBuffer();
}

async function goodPipeline(): Promise<ProcessedBeadImage> {
  return processBeadImage({ bytes: await renderBeadPng() });
}

function failedChecks(outcome: { checks: { id: string; passed: boolean }[] }): string[] {
  return outcome.checks.filter((check) => !check.passed).map((check) => check.id);
}

test("a faithful bead pipeline passes every QC check with a DB-compatible shape", async () => {
  const processed = await goodPipeline();
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: processed.main,
    thumb: processed.thumb
  });

  assert.equal(outcome.passed, true);
  assert.deepEqual(
    outcome.checks.map((check) => check.id),
    QC_CHECK_IDS
  );
  assert.deepEqual(failedChecks(outcome), []);

  for (const check of outcome.checks) {
    const keys = Object.keys(check).sort();
    for (const key of keys) assert.ok(["id", "passed", "detail", "summary"].includes(key), `unexpected key ${key}`);
    assert.ok(typeof check.id === "string" && check.id.length > 0 && check.id.length <= 120);
    assert.equal(typeof check.passed, "boolean");
    if (check.detail !== undefined && check.detail !== null) {
      assert.ok(check.detail.length <= 2000);
    }
    assert.ok(typeof check.summary === "undefined" || check.summary === null || check.summary.length <= 2000);
  }
  assert.ok(outcome.summary === null || outcome.summary.length <= 2000);
  assert.deepEqual(JSON.parse(JSON.stringify(outcome)), outcome, "QC result must be JSON-serializable");
});

test("heavily blurred input fails the blur check and suggests re-shooting instead of synthesizing detail", async () => {
  const processed = await processBeadImage({ bytes: await renderBeadPng({ blurSigma: 12 }) });
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: processed.main,
    thumb: processed.thumb
  });

  assert.equal(outcome.passed, false);
  const blurCheck = outcome.checks.find((check) => check.id === "blur");
  assert.ok(blurCheck);
  assert.equal(blurCheck.passed, false);
  assert.match(blurCheck.detail ?? "", /re-?shoot/i);
  assert.ok(failedChecks(outcome).includes("blur"));
});

test("border-clipped subjects fail only the subject-clipping check", async () => {
  const processed = await goodPipeline();
  const outcome = await runQualityChecks({
    measurements: { ...processed.measurements, clipped: true },
    main: processed.main,
    thumb: processed.thumb
  });
  assert.equal(outcome.passed, false);
  assert.deepEqual(failedChecks(outcome), ["subject-clipping"]);
});

test("interior hollowing fails only the interior-hollowing check", async () => {
  const processed = await goodPipeline();
  const outcome = await runQualityChecks({
    measurements: { ...processed.measurements, holeRatio: 0.2 },
    main: processed.main,
    thumb: processed.thumb
  });
  assert.equal(outcome.passed, false);
  assert.deepEqual(failedChecks(outcome), ["interior-hollowing"]);
});

test("a color shift beyond the hard cap fails only the color-delta check", async () => {
  const processed = await goodPipeline();
  const outcome = await runQualityChecks({
    measurements: { ...processed.measurements, colorDelta: QC_THRESHOLDS.maxColorDelta + 1 },
    main: processed.main,
    thumb: processed.thumb
  });
  assert.equal(outcome.passed, false);
  assert.deepEqual(failedChecks(outcome), ["color-delta"]);
});

test("a subject smaller than the 80 percent canvas target fails effective-resolution and alpha-coverage", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <rect width="800" height="800" fill="#f0f0f0"/>
    <circle cx="400" cy="400" r="80" fill="#c0392b"/>
  </svg>`;
  const processed = await processBeadImage({ bytes: await sharp(Buffer.from(svg)).png().toBuffer() });
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: processed.main,
    thumb: processed.thumb
  });

  assert.equal(outcome.passed, false);
  assert.deepEqual(failedChecks(outcome), ["alpha-coverage", "effective-resolution"]);
  const effective = outcome.checks.find((check) => check.id === "effective-resolution");
  assert.match(effective?.detail ?? "", /native|upscal/i);
});

test("oversized encoded outputs fail the output-file-size check via thresholds", async () => {
  const processed = await goodPipeline();
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: processed.main,
    thumb: processed.thumb,
    thresholds: { maxMainBytes: 100 }
  });
  assert.equal(outcome.passed, false);
  assert.deepEqual(failedChecks(outcome), ["output-file-size"]);
});

test("a corrupted main variant fails the output decode checks instead of passing silently", async () => {
  const processed = await goodPipeline();
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: { ...processed.main, bytes: new Uint8Array(32) },
    thumb: processed.thumb
  });
  assert.equal(outcome.passed, false);
  assert.ok(failedChecks(outcome).includes("output-webp-decode"));
  assert.ok(failedChecks(outcome).includes("output-alpha-channel"));
});

test("rejects measurements that are not finite numbers instead of inventing a verdict", async () => {
  const processed = await goodPipeline();
  await assert.rejects(
    () =>
      runQualityChecks({
        measurements: { ...processed.measurements, colorDelta: Number.NaN },
        main: processed.main,
        thumb: processed.thumb
      }),
    /colorDelta/
  );
});
