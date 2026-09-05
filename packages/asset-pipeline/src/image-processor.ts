import sharp from "sharp";
import type { Metadata } from "sharp";

import { detectAssetSourceKind } from "./content-type.js";
import { sha256OfBytes } from "./hash.js";

export const PROCESSOR_VERSION = "faithful-v1";
export const MAIN_CANVAS_PX = 512;
export const THUMB_CANVAS_PX = 256;
export const SUBJECT_CANVAS_TARGET = 0.8;
const SUBJECT_TARGET_PX = Math.round(SUBJECT_CANVAS_TARGET * MAIN_CANVAS_PX);
const MIN_SUBJECT_EDGE_PX = 24;

export type ImageProcessorErrorCode = "DECODE_FAILED" | "UNSUPPORTED_SOURCE_KIND" | "NO_SUBJECT";

export class ImageProcessorError extends Error {
  readonly code: ImageProcessorErrorCode;

  constructor(code: ImageProcessorErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export type RasterSourceKind = "JPEG" | "PNG" | "WEBP";

const RASTER_FORMAT_BY_KIND: Record<RasterSourceKind, string> = {
  JPEG: "jpeg",
  PNG: "png",
  WEBP: "webp"
};

export type RasterDecodeVerification =
  | { ok: true; format: string }
  | { ok: false; reason: "corrupt" | "kind-mismatch"; detail: string };

/**
 * Full-decode gate for raster originals. detectAssetSourceKind only sniffs
 * magic bytes, so on its own it would archive 3-byte `ff d8 ff` stubs. This
 * check forces Sharp to parse the container (metadata) AND walk every pixel
 * (stats), so truncated or corrupt payloads fail before anything is archived.
 * A payload whose decoded format disagrees with the sniffed kind is reported
 * separately: that is a mislabeled container, not a broken one.
 */
export async function verifyRasterFullyDecodable(
  bytes: Uint8Array,
  expectedKind: RasterSourceKind
): Promise<RasterDecodeVerification> {
  const image = sharp(bytes);
  let format: string | undefined;
  try {
    const metadata = await image.metadata();
    format = metadata.format;
    await image.stats();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "corrupt", detail };
  }
  const expectedFormat = RASTER_FORMAT_BY_KIND[expectedKind];
  if (format !== expectedFormat) {
    return {
      ok: false,
      reason: "kind-mismatch",
      detail: `content decodes as ${format ?? "an unknown format"}, expected ${expectedFormat}`
    };
  }
  return { ok: true, format };
}

export const DEFAULT_PROCESSING_OPTIONS = {
  workingMaxEdge: 1024,
  fullResMaxEdge: 4096,
  backgroundTolerance: 30,
  shadowMaxSaturation: 0.15,
  shadowMinLuminanceRatio: 0.45,
  whiteBalanceMaxGain: 1.1,
  contrastSlope: 1.03,
  contrastIntercept: -4,
  sharpenSigma: 1,
  maskFeatherSigma: 1.2,
  webpQuality: 90,
  thumbWebpQuality: 85
} as const;

export type ProcessingOptions = typeof DEFAULT_PROCESSING_OPTIONS;

export type ProcessedVariant = {
  fileName: "bead-512.webp" | "thumb-256.webp";
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
  contentType: "image/webp";
  widthPx: number;
  heightPx: number;
};

export type ProcessingMeasurements = {
  sourceWidthPx: number;
  sourceHeightPx: number;
  workingWidthPx: number;
  workingHeightPx: number;
  subjectBbox: { x: number; y: number; width: number; height: number };
  subjectEffectiveEdgePx: number;
  subjectCanvasRatio: number;
  scaleApplied: number;
  upscaleRequired: boolean;
  clipped: boolean;
  holeRatio: number;
  blurScore: number;
  colorDelta: number;
  whiteBalanceGains: { r: number; g: number; b: number };
};

export type ProcessedBeadImage = {
  main: ProcessedVariant;
  thumb: ProcessedVariant;
  measurements: ProcessingMeasurements;
  parameters: Record<string, unknown> & { processorVersion: string };
};

type Bbox = { x: number; y: number; width: number; height: number };

/**
 * Faithful bead cut-out (spec §8.1). Every transform is conservative and
 * reversible-in-spirit: the background is removed through a border-seeded
 * flood fill (so enclosed interior highlights are never hollowed out), the
 * white balance is bounded by a hard gain cap, enhancement is limited to
 * median denoise, mild sharpening and a gentle contrast slope, and the
 * subject is never upscaled — a subject too small for the 80% canvas target
 * keeps its native size and is flagged for review instead.
 */
export async function processBeadImage(input: {
  bytes: Uint8Array;
  options?: Partial<ProcessingOptions>;
}): Promise<ProcessedBeadImage> {
  const options: ProcessingOptions = { ...DEFAULT_PROCESSING_OPTIONS, ...input.options };
  assertPositiveInt(options.workingMaxEdge, "workingMaxEdge");
  assertPositiveInt(options.fullResMaxEdge, "fullResMaxEdge");

  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new ImageProcessorError("DECODE_FAILED", "Processing requires non-empty image bytes");
  }
  const kind = detectAssetSourceKind(bytes);
  if (kind === "ARW") {
    throw new ImageProcessorError(
      "UNSUPPORTED_SOURCE_KIND",
      "ARW is archived only; the processing input must be the paired JPEG/PNG/WebP image"
    );
  }

  const metadata = await decodeMetadata(bytes);
  if (!["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new ImageProcessorError(
      "UNSUPPORTED_SOURCE_KIND",
      `Format ${String(metadata.format)} cannot be processed; only JPEG, PNG and WebP sources are supported`
    );
  }

  const working = await decodeWorking(bytes, options.workingMaxEdge);
  const { background, backgroundColored, backgroundRgb, backgroundLuma } = floodFillBackground(working, options);

  const bbox = subjectBbox(background, working.width, working.height);
  const subjectPx = countSubjectInBbox(background, working.width, bbox);
  if (subjectPx === 0 || Math.min(bbox.width, bbox.height) < MIN_SUBJECT_EDGE_PX) {
    throw new ImageProcessorError(
      "NO_SUBJECT",
      "No bead subject was detected above the background; the frame needs a re-shoot"
    );
  }

  const holeRatio =
    countInteriorHoles(working, background, backgroundColored, bbox, backgroundLuma) / subjectPx;
  const clipped =
    bbox.x <= 1 ||
    bbox.y <= 1 ||
    bbox.x + bbox.width >= working.width - 1 ||
    bbox.y + bbox.height >= working.height - 1;

  const gray = grayscale(working);
  const blurScore = edgeBandBlurScore(gray, working.width, working.height, background, bbox);

  const gains = whiteBalanceGains(backgroundRgb, options.whiteBalanceMaxGain);
  const colorDelta = await measureColorDelta(working, background, gains, options);

  const orientation = metadata.orientation ?? 1;
  const swapped = orientation >= 5;
  const fullWidth = swapped ? (metadata.height ?? working.width) : (metadata.width ?? working.width);
  const fullHeight = swapped ? (metadata.width ?? working.height) : (metadata.height ?? working.height);
  const preScale = Math.min(1, options.fullResMaxEdge / Math.max(fullWidth, fullHeight));
  const preWidth = preScale < 1 ? Math.max(1, Math.round(fullWidth * preScale)) : fullWidth;
  const preHeight = preScale < 1 ? Math.max(1, Math.round(fullHeight * preScale)) : fullHeight;
  const scaleX = fullWidth / working.width;
  const scaleY = fullHeight / working.height;

  const region = {
    left: clamp(Math.floor(bbox.x * scaleX), 0, fullWidth - 1),
    top: clamp(Math.floor(bbox.y * scaleY), 0, fullHeight - 1),
    width: 0,
    height: 0
  };
  region.width = clamp(
    Math.ceil((bbox.x + bbox.width) * scaleX) - region.left,
    1,
    fullWidth - region.left
  );
  region.height = clamp(
    Math.ceil((bbox.y + bbox.height) * scaleY) - region.top,
    1,
    fullHeight - region.top
  );
  const subjectEffectiveEdgePx = Math.min(region.width, region.height);

  const extracted = {
    left: clamp(Math.floor(region.left * (preWidth / fullWidth)), 0, preWidth - 1),
    top: clamp(Math.floor(region.top * (preHeight / fullHeight)), 0, preHeight - 1),
    width: 1,
    height: 1
  };
  extracted.width = clamp(
    Math.min(preWidth - extracted.left, Math.max(1, Math.ceil(region.width * (preWidth / fullWidth)))),
    1,
    preWidth - extracted.left
  );
  extracted.height = clamp(
    Math.min(preHeight - extracted.top, Math.max(1, Math.ceil(region.height * (preHeight / fullHeight)))),
    1,
    preHeight - extracted.top
  );

  const targetScale = SUBJECT_TARGET_PX / Math.max(extracted.width, extracted.height);
  const scaleApplied = Math.min(targetScale, 1);
  const outWidth = Math.max(1, Math.round(extracted.width * scaleApplied));
  const outHeight = Math.max(1, Math.round(extracted.height * scaleApplied));

  const regionRgb = await extractRegionRgb(bytes, extracted, preScale < 1, preWidth, preHeight);
  const gained = applyChannelGains(regionRgb, extracted, gains);
  const enhancedRgb = await enhanceRgb(gained, extracted, outWidth, outHeight, options);
  const maskBytes = await renderSubjectMask(background, working, bbox, outWidth, outHeight, options);

  const left = Math.floor((MAIN_CANVAS_PX - outWidth) / 2);
  const top = Math.floor((MAIN_CANVAS_PX - outHeight) / 2);
  const mainBytes = await sharp(enhancedRgb, {
    raw: { width: outWidth, height: outHeight, channels: 3 }
  })
    .joinChannel(maskBytes, { raw: { width: outWidth, height: outHeight, channels: 1 } })
    .extend({
      top,
      bottom: MAIN_CANVAS_PX - outHeight - top,
      left,
      right: MAIN_CANVAS_PX - outWidth - left,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality: options.webpQuality, alphaQuality: 100, effort: 6 })
    .toBuffer();

  const thumbBytes = await sharp(mainBytes)
    .resize(THUMB_CANVAS_PX, THUMB_CANVAS_PX, { fit: "fill" })
    .webp({ quality: options.thumbWebpQuality, alphaQuality: 100, effort: 6 })
    .toBuffer();

  // subjectPx and bbox both live in working resolution, and outWidth/outHeight
  // are the rendered size of that same bbox content, so the ratio stays
  // scale-consistent no matter how the working/full-resolution split lands.
  const subjectCanvasRatio =
    (subjectPx * (outWidth / bbox.width) * (outHeight / bbox.height)) / (MAIN_CANVAS_PX * MAIN_CANVAS_PX);

  const measurements: ProcessingMeasurements = {
    sourceWidthPx: fullWidth,
    sourceHeightPx: fullHeight,
    workingWidthPx: working.width,
    workingHeightPx: working.height,
    subjectBbox: bbox,
    subjectEffectiveEdgePx,
    subjectCanvasRatio,
    scaleApplied,
    upscaleRequired: targetScale > 1,
    clipped,
    holeRatio,
    blurScore,
    colorDelta,
    whiteBalanceGains: gains
  };

  return {
    main: toVariant("bead-512.webp", mainBytes, MAIN_CANVAS_PX),
    thumb: toVariant("thumb-256.webp", thumbBytes, THUMB_CANVAS_PX),
    measurements,
    parameters: {
      processorVersion: PROCESSOR_VERSION,
      options: { ...options },
      mainCanvasPx: MAIN_CANVAS_PX,
      thumbCanvasPx: THUMB_CANVAS_PX,
      subjectCanvasTarget: SUBJECT_CANVAS_TARGET,
      measurements
    }
  };
}

type WorkingImage = { data: Buffer; width: number; height: number };

async function decodeMetadata(bytes: Uint8Array): Promise<Metadata> {
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.format || metadata.width === undefined || metadata.height === undefined) {
      throw new Error("metadata is incomplete");
    }
    return metadata;
  } catch (error) {
    throw new ImageProcessorError("DECODE_FAILED", "The payload could not be decoded as an image", {
      cause: error
    });
  }
}

async function decodeWorking(bytes: Uint8Array, maxEdge: number): Promise<WorkingImage> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function floodFillBackground(
  working: WorkingImage,
  options: ProcessingOptions
): {
  background: Uint8Array;
  backgroundColored: Uint8Array;
  backgroundRgb: { r: number; g: number; b: number };
  backgroundLuma: number;
} {
  const { data, width, height } = working;
  const ring = Math.max(2, Math.round(Math.min(width, height) / 200));
  const samples: number[][] = [[], [], []];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const onRing = x < ring || y < ring || x >= width - ring || y >= height - ring;
      if (!onRing) continue;
      const offset = (y * width + x) * 4;
      samples[0]!.push(data[offset] ?? 0);
      samples[1]!.push(data[offset + 1] ?? 0);
      samples[2]!.push(data[offset + 2] ?? 0);
    }
  }
  const backgroundRgb = {
    r: median(samples[0]!),
    g: median(samples[1]!),
    b: median(samples[2]!)
  };
  const backgroundLuma = 0.299 * backgroundRgb.r + 0.587 * backgroundRgb.g + 0.114 * backgroundRgb.b;
  const channelMax = Math.max(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);
  const channelMin = Math.min(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);
  const backgroundSaturation = channelMax === 0 ? 0 : (channelMax - channelMin) / channelMax;
  const backgroundNeutral = backgroundSaturation <= options.shadowMaxSaturation;
  const toleranceSquared = options.backgroundTolerance * options.backgroundTolerance;

  const isBackground = (index: number): boolean => {
    const offset = index * 4;
    const alpha = data[offset + 3] ?? 0;
    if (alpha < 16) return true;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const dr = r - backgroundRgb.r;
    const dg = g - backgroundRgb.g;
    const db = b - backgroundRgb.b;
    if (dr * dr + dg * dg + db * db <= toleranceSquared) return true;
    if (backgroundNeutral) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (
        saturation <= options.shadowMaxSaturation &&
        luma <= backgroundLuma + 8 &&
        luma >= backgroundLuma * options.shadowMinLuminanceRatio
      ) {
        return true;
      }
    }
    return false;
  };

  // The color test over every pixel, separate from reachability: the pixels
  // that pass it but the border-seeded fill below never reaches are exactly
  // the enclosed background-colored regions the interior-hole metric counts.
  const backgroundColored = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    backgroundColored[index] = isBackground(index) ? 1 : 0;
  }

  const background = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (index: number): void => {
    if (background[index] === 1 || backgroundColored[index] === 0) return;
    background[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head]!;
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }
  return { background, backgroundColored, backgroundRgb, backgroundLuma };
}

function subjectBbox(background: Uint8Array, width: number, height: number): Bbox {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (background[y * width + x] === 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function countSubjectInBbox(background: Uint8Array, width: number, bbox: Bbox): number {
  let count = 0;
  for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
    for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
      if (background[y * width + x] === 0) count += 1;
    }
  }
  return count;
}

/**
 * Enclosed background-colored regions inside the subject bbox: pixels that
 * pass the background color test but no border-seeded fill reached, so the
 * cut-out keeps them opaque. Regions brighter than the background are
 * excluded — those are specular highlights, genuine subject detail — while a
 * plugged hole (a donut bead's center, a scratched-out window) shows the
 * background color or darker.
 */
function countInteriorHoles(
  working: WorkingImage,
  background: Uint8Array,
  backgroundColored: Uint8Array,
  bbox: Bbox,
  backgroundLuma: number
): number {
  const { data, width } = working;
  let holes = 0;
  for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
    for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
      const index = y * width + x;
      if (backgroundColored[index] !== 1 || background[index] === 1) continue;
      const offset = index * 4;
      const luma =
        0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
      if (luma <= backgroundLuma + 8) holes += 1;
    }
  }
  return holes;
}

function grayscale(working: WorkingImage): Float64Array {
  const { data, width, height } = working;
  const gray = new Float64Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    gray[index] =
      0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
  }
  return gray;
}

/**
 * 90th percentile of the absolute Laplacian over the subject's edge band —
 * subject pixels within a small radius of a background pixel. Focus shows in
 * the edge band, and a percentile instead of a single peak makes the score
 * immune to tiny sharp artifacts such as a dust spot on a defocused frame.
 */
function edgeBandBlurScore(
  gray: Float64Array,
  width: number,
  height: number,
  background: Uint8Array,
  bbox: Bbox
): number {
  const bandRadius = 2;
  const x0 = clamp(bbox.x, 1, width - 2);
  const y0 = clamp(bbox.y, 1, height - 2);
  const x1 = clamp(bbox.x + bbox.width, x0 + 1, width - 1);
  const y1 = clamp(bbox.y + bbox.height, y0 + 1, height - 1);
  const values: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * width + x;
      if (background[index] === 1) continue;
      let nearBackground = false;
      for (let dy = -bandRadius; dy <= bandRadius && !nearBackground; dy += 1) {
        for (let dx = -bandRadius; dx <= bandRadius; dx += 1) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || px >= width || py < 0 || py >= height) continue;
          if (background[py * width + px] === 1) {
            nearBackground = true;
            break;
          }
        }
      }
      if (!nearBackground) continue;
      const center = gray[index]!;
      const laplacian =
        4 * center -
        gray[(y - 1) * width + x]! -
        gray[(y + 1) * width + x]! -
        gray[y * width + x - 1]! -
        gray[y * width + x + 1]!;
      values.push(Math.abs(laplacian));
    }
  }
  if (values.length === 0) return 0;
  values.sort((left, right) => left - right);
  const percentileIndex = Math.floor(0.9 * (values.length - 1));
  return Math.round(values[percentileIndex]! * 100) / 100;
}

function whiteBalanceGains(
  backgroundRgb: { r: number; g: number; b: number },
  maxGain: number
): { r: number; g: number; b: number } {
  const luma = 0.299 * backgroundRgb.r + 0.587 * backgroundRgb.g + 0.114 * backgroundRgb.b;
  const channelMax = Math.max(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);
  const channelMin = Math.min(backgroundRgb.r, backgroundRgb.g, backgroundRgb.b);
  const saturation = channelMax === 0 ? 0 : (channelMax - channelMin) / channelMax;
  if (luma < 40 || saturation > 0.15) return { r: 1, g: 1, b: 1 };
  const gain = (channel: number): number =>
    Math.min(maxGain, Math.max(1 / maxGain, luma / Math.max(1, channel)));
  return {
    r: Math.round(gain(backgroundRgb.r) * 10_000) / 10_000,
    g: Math.round(gain(backgroundRgb.g) * 10_000) / 10_000,
    b: Math.round(gain(backgroundRgb.b) * 10_000) / 10_000
  };
}

/**
 * Mean per-channel difference between the original subject pixels and the
 * enhanced pixels at identical geometry — the hard cap the QC color-delta
 * check enforces against material hue shifts.
 */
async function measureColorDelta(
  working: WorkingImage,
  background: Uint8Array,
  gains: { r: number; g: number; b: number },
  options: ProcessingOptions
): Promise<number> {
  const { data, width, height } = working;
  const original = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    original[index * 3] = data[offset] ?? 0;
    original[index * 3 + 1] = data[offset + 1] ?? 0;
    original[index * 3 + 2] = data[offset + 2] ?? 0;
  }
  const gained = applyChannelGains(original, { width, height }, gains);
  const enhanced = await sharp(gained, { raw: { width, height, channels: 3 } })
    .median(3)
    .sharpen({ sigma: options.sharpenSigma, m1: 0.4, m2: 0.6 })
    .linear(options.contrastSlope, options.contrastIntercept)
    .raw()
    .toBuffer();

  let deltaSum = 0;
  let pixelCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (background[index] === 1) continue;
      const eroded =
        background[index - 1] === 0 &&
        background[index + 1] === 0 &&
        background[index - width] === 0 &&
        background[index + width] === 0;
      if (!eroded) continue;
      const rgbOffset = index * 3;
      deltaSum +=
        (Math.abs(original[rgbOffset]! - enhanced[rgbOffset]!) +
          Math.abs(original[rgbOffset + 1]! - enhanced[rgbOffset + 1]!) +
          Math.abs(original[rgbOffset + 2]! - enhanced[rgbOffset + 2]!)) /
        3;
      pixelCount += 1;
    }
  }
  if (pixelCount === 0) return 0;
  return Math.round((deltaSum / pixelCount) * 100) / 100;
}

async function extractRegionRgb(
  bytes: Uint8Array,
  region: { left: number; top: number; width: number; height: number },
  prescaled: boolean,
  preWidth: number,
  preHeight: number
): Promise<Buffer> {
  let pipeline = sharp(bytes).rotate();
  if (prescaled) {
    pipeline = pipeline.resize(preWidth, preHeight, { fit: "fill", kernel: "lanczos3" });
  }
  return pipeline
    .extract({ left: region.left, top: region.top, width: region.width, height: region.height })
    .removeAlpha()
    .raw()
    .toBuffer();
}

function applyChannelGains(
  regionRgb: Buffer,
  region: { width: number; height: number },
  gains: { r: number; g: number; b: number }
): Buffer {
  const gained = Buffer.alloc(regionRgb.byteLength);
  for (let index = 0; index < regionRgb.byteLength; index += 3) {
    gained[index] = clampChannel(regionRgb[index]! * gains.r);
    gained[index + 1] = clampChannel(regionRgb[index + 1]! * gains.g);
    gained[index + 2] = clampChannel(regionRgb[index + 2]! * gains.b);
  }
  return gained;
}

async function enhanceRgb(
  gained: Buffer,
  region: { width: number; height: number },
  outWidth: number,
  outHeight: number,
  options: ProcessingOptions
): Promise<Buffer> {
  return sharp(gained, { raw: { width: region.width, height: region.height, channels: 3 } })
    .resize(outWidth, outHeight, { fit: "fill", kernel: "lanczos3" })
    .median(3)
    .sharpen({ sigma: options.sharpenSigma, m1: 0.4, m2: 0.6 })
    .linear(options.contrastSlope, options.contrastIntercept)
    .raw()
    .toBuffer();
}

async function renderSubjectMask(
  background: Uint8Array,
  working: WorkingImage,
  bbox: Bbox,
  outWidth: number,
  outHeight: number,
  options: ProcessingOptions
): Promise<Buffer> {
  const mask = Buffer.alloc(bbox.width * bbox.height);
  for (let y = 0; y < bbox.height; y += 1) {
    for (let x = 0; x < bbox.width; x += 1) {
      mask[y * bbox.width + x] = background[(bbox.y + y) * working.width + (bbox.x + x)] === 1 ? 0 : 255;
    }
  }
  // resize() expands the single-band mask to a 3-band sRGB buffer; squeeze
  // it back to one band so joinChannel receives true alpha samples.
  const blurred = await sharp(mask, { raw: { width: bbox.width, height: bbox.height, channels: 1 } })
    .resize(outWidth, outHeight, { fit: "fill", kernel: "mitchell" })
    .blur(options.maskFeatherSigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const single = Buffer.alloc(outWidth * outHeight);
  for (let index = 0; index < single.length; index += 1) {
    single[index] = blurred.data[index * blurred.info.channels] ?? 0;
  }
  return single;
}

function toVariant(fileName: "bead-512.webp" | "thumb-256.webp", bytes: Buffer, canvas: number): ProcessedVariant {
  return {
    fileName,
    bytes: new Uint8Array(bytes),
    byteSize: bytes.byteLength,
    sha256: sha256OfBytes(new Uint8Array(bytes)),
    contentType: "image/webp",
    widthPx: canvas,
    heightPx: canvas
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function assertPositiveInt(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Processing option ${field} must be a positive integer`);
  }
}
