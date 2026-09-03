import sharp from "sharp";
import type { Metadata } from "sharp";

import { MAIN_CANVAS_PX, THUMB_CANVAS_PX, type ProcessingMeasurements } from "./image-processor.js";

export const QC_CHECK_IDS = [
  "subject-clipping",
  "interior-hollowing",
  "alpha-coverage",
  "edge-halo",
  "edge-aliasing",
  "blur",
  "effective-resolution",
  "color-delta",
  "output-webp-decode",
  "output-alpha-channel",
  "output-file-size"
] as const;

export type QcCheckId = (typeof QC_CHECK_IDS)[number];

export type AssetQcCheck = {
  id: string;
  passed: boolean;
  detail?: string | null;
  summary?: string | null;
};

export type AssetQcResult = {
  passed: boolean;
  checks: AssetQcCheck[];
  summary: string | null;
};

export const QC_THRESHOLDS = {
  minBlurScore: 15,
  minSubjectEdgePx: 410,
  minSubjectCanvasRatio: 0.35,
  maxSubjectCanvasRatio: 0.95,
  maxHoleRatio: 0.05,
  maxHaloFraction: 0.5,
  maxHardEdgeFraction: 0.1,
  maxColorDelta: 16,
  maxMainBytes: 1_572_864,
  maxThumbBytes: 393_216
} as const;

export type QcThresholds = { [Key in keyof typeof QC_THRESHOLDS]: number };

export type QcVariantInput = {
  bytes: Uint8Array;
  byteSize: number;
  widthPx: number;
  heightPx: number;
};

export type QualityCheckInput = {
  measurements: ProcessingMeasurements;
  main: QcVariantInput;
  thumb: QcVariantInput;
  thresholds?: Partial<QcThresholds>;
};

/**
 * Automatic quality control over processed bead outputs (spec §8.2). A failed
 * threshold never deletes the output and never silently approves it: the
 * result records per-check evidence and an overall verdict that the human
 * review gate consumes — QC_PASS still requires operator approval before
 * anything is publishable.
 */
export async function runQualityChecks(input: QualityCheckInput): Promise<AssetQcResult> {
  const thresholds: QcThresholds = { ...QC_THRESHOLDS, ...input.thresholds };
  const measurements = input.measurements;
  assertFiniteNumber(measurements.holeRatio, "holeRatio", 0, 1);
  assertFiniteNumber(measurements.blurScore, "blurScore", 0, Number.POSITIVE_INFINITY);
  assertFiniteNumber(measurements.colorDelta, "colorDelta", 0, 255);
  assertFiniteNumber(
    measurements.subjectEffectiveEdgePx,
    "subjectEffectiveEdgePx",
    0,
    Number.POSITIVE_INFINITY
  );
  if (typeof measurements.clipped !== "boolean") {
    throw new Error("QC measurements require a boolean clipped flag");
  }

  const mainScan = await scanVariant(input.main);
  const thumbScan = await scanVariant(input.thumb);

  const coverage = mainScan.opaqueRatio;
  const haloFraction = mainScan.haloFraction;
  const aliasingFraction = mainScan.hardEdgeFraction;

  const checks: AssetQcCheck[] = [
    {
      id: "subject-clipping",
      passed: !measurements.clipped,
      detail: measurements.clipped
        ? "The subject bounding box touches the source frame border; the bead is cut off and needs a re-shoot or a wider frame"
        : "The subject bounding box stays inside the source frame"
    },
    {
      id: "interior-hollowing",
      passed: measurements.holeRatio <= thresholds.maxHoleRatio,
      detail: `Interior hole ratio ${measurements.holeRatio.toFixed(4)} is ${
        measurements.holeRatio <= thresholds.maxHoleRatio ? "within" : "above"
      } the ${thresholds.maxHoleRatio} cap`
    },
    {
      id: "alpha-coverage",
      passed:
        coverage >= thresholds.minSubjectCanvasRatio && coverage <= thresholds.maxSubjectCanvasRatio,
      detail: `The subject covers ${(coverage * 100).toFixed(1)}% of the ${MAIN_CANVAS_PX}px canvas; accepted band is ${(
        thresholds.minSubjectCanvasRatio * 100
      ).toFixed(0)}%–${(thresholds.maxSubjectCanvasRatio * 100).toFixed(0)}%`
    },
    {
      id: "edge-halo",
      passed: haloFraction <= thresholds.maxHaloFraction,
      detail: `${(haloFraction * 100).toFixed(2)}% of the semi-transparent edge fringe is extreme white/black; cap is ${(
        thresholds.maxHaloFraction * 100
      ).toFixed(0)}%`
    },
    {
      id: "edge-aliasing",
      passed: aliasingFraction <= thresholds.maxHardEdgeFraction,
      detail: `${(aliasingFraction * 100).toFixed(2)}% of the subject edge is a hard opaque-to-transparent step; cap is ${(
        thresholds.maxHardEdgeFraction * 100
      ).toFixed(0)}%`
    },
    {
      id: "blur",
      passed: measurements.blurScore >= thresholds.minBlurScore,
      detail:
        measurements.blurScore >= thresholds.minBlurScore
          ? `Subject sharpness score ${measurements.blurScore.toFixed(2)} is at or above the minimum ${thresholds.minBlurScore}`
          : `Subject sharpness score ${measurements.blurScore.toFixed(
              2
            )} is below the minimum ${thresholds.minBlurScore}; recommend re-shooting the bead instead of synthesizing detail`
    },
    {
      id: "effective-resolution",
      passed: measurements.subjectEffectiveEdgePx >= thresholds.minSubjectEdgePx,
      detail:
        measurements.subjectEffectiveEdgePx >= thresholds.minSubjectEdgePx
          ? `The subject provides ${measurements.subjectEffectiveEdgePx}px per edge, enough for a ${MAIN_CANVAS_PX}px canvas at 80% without upscaling`
          : `The subject provides only ${measurements.subjectEffectiveEdgePx}px per edge; a ${MAIN_CANVAS_PX}px output at the 80% target would require upscaling, which is forbidden — the subject keeps its native size and needs a re-shoot`
    },
    {
      id: "color-delta",
      passed: measurements.colorDelta <= thresholds.maxColorDelta,
      detail: `Mean subject color delta ${measurements.colorDelta.toFixed(2)} is ${
        measurements.colorDelta <= thresholds.maxColorDelta ? "within" : "above"
      } the hard cap ${thresholds.maxColorDelta}`
    },
    {
      id: "output-webp-decode",
      passed:
        mainScan.decodeOk &&
        thumbScan.decodeOk &&
        mainScan.width === input.main.widthPx &&
        mainScan.height === input.main.heightPx &&
        thumbScan.width === input.thumb.widthPx &&
        thumbScan.height === input.thumb.heightPx,
      detail:
        mainScan.decodeOk && thumbScan.decodeOk
          ? `Main decodes as ${mainScan.width}×${mainScan.height} and thumb as ${thumbScan.width}×${thumbScan.height} WebP`
          : "The processed output does not decode as a WebP image with the expected dimensions"
    },
    {
      id: "output-alpha-channel",
      passed: mainScan.decodeOk && thumbScan.decodeOk && mainScan.hasAlpha && thumbScan.hasAlpha,
      detail:
        mainScan.hasAlpha && thumbScan.hasAlpha
          ? "Both variants keep an alpha channel"
          : "The cut-out outputs must carry a transparency channel"
    },
    {
      id: "output-file-size",
      passed:
        input.main.byteSize <= thresholds.maxMainBytes && input.thumb.byteSize <= thresholds.maxThumbBytes,
      detail: `Main is ${input.main.byteSize} bytes and thumb ${input.thumb.byteSize} bytes; caps are ${thresholds.maxMainBytes} and ${thresholds.maxThumbBytes}`
    }
  ];

  const passed = checks.every((check) => check.passed);
  const failedIds = checks.filter((check) => !check.passed).map((check) => check.id);
  const summary = passed
    ? `${checks.length}/${checks.length} QC checks passed; human review is still required before approval`
    : `${checks.length - failedIds.length}/${checks.length} QC checks passed; failed: ${failedIds.join(", ")}`;
  return { passed, checks, summary };
}

type VariantScan = {
  decodeOk: boolean;
  width: number;
  height: number;
  hasAlpha: boolean;
  opaqueRatio: number;
  haloFraction: number;
  hardEdgeFraction: number;
};

async function scanVariant(variant: QcVariantInput): Promise<VariantScan> {
  const failed: VariantScan = {
    decodeOk: false,
    width: 0,
    height: 0,
    hasAlpha: false,
    opaqueRatio: 0,
    haloFraction: 0,
    hardEdgeFraction: 0
  };
  let metadata: Metadata;
  try {
    metadata = await sharp(variant.bytes).metadata();
  } catch {
    return failed;
  }
  if (metadata.format !== "webp") return failed;
  const scan: VariantScan = {
    decodeOk: true,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    hasAlpha: metadata.hasAlpha === true,
    opaqueRatio: 0,
    haloFraction: 0,
    hardEdgeFraction: 0
  };
  if (!scan.hasAlpha || scan.width === 0 || scan.height === 0) return scan;

  const { data, info } = await sharp(variant.bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  let opaque = 0;
  let fringe = 0;
  let halo = 0;
  let hardEdges = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = y * info.width + x;
      const alpha = data[index * 4 + 3] ?? 0;
      if (alpha >= 128) opaque += 1;
      if (alpha > 8 && alpha < 247) {
        fringe += 1;
        const r = data[index * 4] ?? 0;
        const g = data[index * 4 + 1] ?? 0;
        const b = data[index * 4 + 2] ?? 0;
        if ((r >= 246 && g >= 246 && b >= 246) || (r <= 10 && g <= 10 && b <= 10)) halo += 1;
      }
      if (alpha >= 200 && x + 1 < info.width && (data[(index + 1) * 4 + 3] ?? 0) <= 20) hardEdges += 1;
      if (alpha >= 200 && y + 1 < info.height && (data[(index + info.width) * 4 + 3] ?? 0) <= 20) {
        hardEdges += 1;
      }
    }
  }
  scan.opaqueRatio = opaque / total;
  scan.haloFraction = fringe === 0 ? 0 : halo / fringe;
  scan.hardEdgeFraction = fringe === 0 ? 1 : hardEdges / fringe;
  return scan;
}

function assertFiniteNumber(value: number, field: string, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`QC measurement ${field} must be a finite number between ${min} and ${max}`);
  }
}
