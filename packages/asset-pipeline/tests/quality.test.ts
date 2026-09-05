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

test("a sharp 3x3 black dot cannot rescue a defocused subject's blur score", async () => {
  // The blur metric must measure the subject edge band, not a single peak
  // Laplacian: one tiny sharp dot on a severely defocused bead must not
  // flip the blur verdict to pass.
  const defocused = await renderBeadPng({ blurSigma: 12 });
  const dot = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
      <rect x="398" y="398" width="3" height="3" fill="#000000"/>
    </svg>`)
  )
    .png()
    .toBuffer();
  const bytes = await sharp(defocused).composite([{ input: dot }]).png().toBuffer();
  const processed = await processBeadImage({ bytes });
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: processed.main,
    thumb: processed.thumb
  });

  assert.equal(outcome.passed, false);
  assert.ok(failedChecks(outcome).includes("blur"), `failed checks: ${failedChecks(outcome).join(", ")}`);
});

test("a donut-shaped subject fails the interior-hollowing check", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
    <rect width="800" height="800" fill="#f0f0f0"/>
    <circle cx="400" cy="400" r="300" fill="#c0392b"/>
    <circle cx="400" cy="400" r="150" fill="#f0f0f0"/>
  </svg>`;
  const processed = await processBeadImage({ bytes: await sharp(Buffer.from(svg)).png().toBuffer() });
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: processed.main,
    thumb: processed.thumb
  });

  assert.equal(outcome.passed, false);
  assert.ok(
    failedChecks(outcome).includes("interior-hollowing"),
    `failed checks: ${failedChecks(outcome).join(", ")}`
  );
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

test("a main variant off the fixed 512px canvas fails output-webp-decode", async () => {
  // The canvas contract is fixed: main is 512x512 and thumb is 256x256 WebP.
  // A self-consistent but off-canvas declaration (bytes, byteSize and
  // widthPx/heightPx all agreeing on 400x400) must still fail.
  const processed = await goodPipeline();
  const offCanvas = await sharp(processed.main.bytes).resize(400, 400, { fit: "fill" }).webp().toBuffer();
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: {
      ...processed.main,
      bytes: new Uint8Array(offCanvas),
      byteSize: offCanvas.byteLength,
      widthPx: 400,
      heightPx: 400
    },
    thumb: processed.thumb
  });
  assert.equal(outcome.passed, false);
  assert.ok(
    failedChecks(outcome).includes("output-webp-decode"),
    `failed checks: ${failedChecks(outcome).join(", ")}`
  );
});

test("a thumb variant off the fixed 256px canvas fails output-webp-decode", async () => {
  const processed = await goodPipeline();
  const offCanvas = await sharp(processed.thumb.bytes).resize(300, 300, { fit: "fill" }).webp().toBuffer();
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: processed.main,
    thumb: {
      ...processed.thumb,
      bytes: new Uint8Array(offCanvas),
      byteSize: offCanvas.byteLength,
      widthPx: 300,
      heightPx: 300
    }
  });
  assert.equal(outcome.passed, false);
  assert.ok(
    failedChecks(outcome).includes("output-webp-decode"),
    `failed checks: ${failedChecks(outcome).join(", ")}`
  );
});

test("a declared byteSize that disagrees with the actual bytes fails output-file-size", async () => {
  const processed = await goodPipeline();
  const outcome = await runQualityChecks({
    measurements: processed.measurements,
    main: { ...processed.main, byteSize: processed.main.byteSize + 1 },
    thumb: processed.thumb
  });
  assert.equal(outcome.passed, false);
  assert.ok(
    failedChecks(outcome).includes("output-file-size"),
    `failed checks: ${failedChecks(outcome).join(", ")}`
  );
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
