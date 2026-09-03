import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  ImageProcessorError,
  MAIN_CANVAS_PX,
  PROCESSOR_VERSION,
  THUMB_CANVAS_PX,
  processBeadImage
} from "../src/image-processor.js";
import { sha256OfBytes } from "../src/hash.js";

const SOURCE_PX = 800;

type BeadSceneOptions = {
  bead: { color: string; cx: number; cy: number; r: number };
  highlight?: { color: string; cx: number; cy: number; r: number };
  interiorWindow?: { cx: number; cy: number; r: number };
  shadow?: { color: string; cx: number; cy: number; rx: number; ry: number };
  background?: string;
};

function beadSceneSvg(options: BeadSceneOptions): string {
  const background = options.background ?? "#f0f0f0";
  const highlight = options.highlight
    ? `<circle cx="${options.highlight.cx}" cy="${options.highlight.cy}" r="${options.highlight.r}" fill="${options.highlight.color}"/>`
    : "";
  const interiorWindow = options.interiorWindow
    ? `<circle cx="${options.interiorWindow.cx}" cy="${options.interiorWindow.cy}" r="${options.interiorWindow.r}" fill="${background}"/>`
    : "";
  const shadow = options.shadow
    ? `<ellipse cx="${options.shadow.cx}" cy="${options.shadow.cy}" rx="${options.shadow.rx}" ry="${options.shadow.ry}" fill="${options.shadow.color}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SOURCE_PX}" height="${SOURCE_PX}">
    <rect width="${SOURCE_PX}" height="${SOURCE_PX}" fill="${background}"/>
    ${shadow}
    <circle cx="${options.bead.cx}" cy="${options.bead.cy}" r="${options.bead.r}" fill="${options.bead.color}"/>
    ${interiorWindow}
    ${highlight}
  </svg>`;
}

async function renderSvg(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function decodeRgba(bytes: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function rgbaAt(
  image: { data: Buffer; width: number; height: number },
  x: number,
  y: number
): { r: number; g: number; b: number; a: number } {
  assert.ok(x >= 0 && x < image.width && y >= 0 && y < image.height, `point ${x},${y} out of bounds`);
  const offset = (y * image.width + x) * 4;
  return {
    r: image.data[offset] ?? 0,
    g: image.data[offset + 1] ?? 0,
    b: image.data[offset + 2] ?? 0,
    a: image.data[offset + 3] ?? 0
  };
}

function maxAlphaAround(
  image: { data: Buffer; width: number; height: number },
  x: number,
  y: number,
  radius = 4
): number {
  let max = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || px >= image.width || py < 0 || py >= image.height) continue;
      max = Math.max(max, rgbaAt(image, px, py).a);
    }
  }
  return max;
}

function opaqueWidth(image: { data: Buffer; width: number; height: number }): number {
  let minX = image.width;
  let maxX = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (rgbaAt(image, x, y).a >= 128) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  return maxX < 0 ? 0 : maxX - minX + 1;
}

function mapSourcePointToMain(
  bbox: { x: number; y: number; width: number; height: number },
  scale: number,
  point: { x: number; y: number }
): { x: number; y: number } {
  const outWidth = Math.round(bbox.width * scale);
  const left = Math.floor((MAIN_CANVAS_PX - outWidth) / 2);
  return {
    x: Math.round((point.x - bbox.x) * scale) + left,
    y: Math.round((point.y - bbox.y) * scale) + left
  };
}

test("produces deterministic 512 main and 256 thumb transparent WebP variants", async () => {
  const bytes = await renderSvg(beadSceneSvg({ bead: { color: "#c0392b", cx: 400, cy: 400, r: 300 } }));
  const first = await processBeadImage({ bytes });
  const second = await processBeadImage({ bytes });

  assert.equal(first.main.fileName, "bead-512.webp");
  assert.equal(first.main.widthPx, MAIN_CANVAS_PX);
  assert.equal(first.main.heightPx, MAIN_CANVAS_PX);
  assert.equal(first.main.contentType, "image/webp");
  assert.ok(first.main.byteSize > 0);
  assert.equal(first.main.sha256, sha256OfBytes(first.main.bytes));
  assert.equal(first.thumb.fileName, "thumb-256.webp");
  assert.equal(first.thumb.widthPx, THUMB_CANVAS_PX);
  assert.equal(first.thumb.heightPx, THUMB_CANVAS_PX);
  assert.equal(first.thumb.sha256, sha256OfBytes(first.thumb.bytes));

  assert.equal(first.main.sha256, second.main.sha256, "main output must be byte-deterministic");
  assert.equal(first.thumb.sha256, second.thumb.sha256, "thumb output must be byte-deterministic");

  const mainMeta = await sharp(first.main.bytes).metadata();
  assert.equal(mainMeta.format, "webp");
  assert.equal(mainMeta.width, MAIN_CANVAS_PX);
  assert.equal(mainMeta.height, MAIN_CANVAS_PX);
  assert.equal(mainMeta.hasAlpha, true);
  assert.match(PROCESSOR_VERSION, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
  assert.equal(first.parameters.processorVersion, PROCESSOR_VERSION);
});

test("removes border-connected background and shadows but keeps interior highlights", async () => {
  const bytes = await renderSvg(
    beadSceneSvg({
      bead: { color: "#c0392b", cx: 450, cy: 380, r: 280 },
      highlight: { color: "#ffffff", cx: 360, cy: 300, r: 40 },
      interiorWindow: { cx: 520, cy: 440, r: 30 },
      shadow: { color: "#a8a8a8", cx: 180, cy: 780, rx: 200, ry: 90 }
    })
  );
  const result = await processBeadImage({ bytes });

  const main = await decodeRgba(result.main.bytes);
  assert.equal(rgbaAt(main, 8, 8).a, 0, "top-left corner must be transparent background");
  assert.equal(rgbaAt(main, 40, 470).a, 0, "the border-connected shadow must be removed");

  const { subjectBbox, scaleApplied } = result.measurements;
  assert.ok(
    subjectBbox.width >= 540 && subjectBbox.width <= 580,
    `subject bbox width ${subjectBbox.width} must exclude the shadow`
  );
  assert.ok(
    subjectBbox.height >= 540 && subjectBbox.height <= 580,
    `subject bbox height ${subjectBbox.height} must exclude the shadow`
  );

  const highlightPoint = mapSourcePointToMain(subjectBbox, scaleApplied, { x: 360, y: 300 });
  assert.ok(
    maxAlphaAround(main, highlightPoint.x, highlightPoint.y) >= 250,
    "the interior specular highlight must stay opaque"
  );

  const windowPoint = mapSourcePointToMain(subjectBbox, scaleApplied, { x: 520, y: 440 });
  assert.ok(
    maxAlphaAround(main, windowPoint.x, windowPoint.y) >= 250,
    "an enclosed background-colored region inside the bead must not be hollowed out"
  );
  assert.ok(result.measurements.holeRatio < 0.02, `hole ratio ${result.measurements.holeRatio} must stay near zero`);
});

test("keeps subject color faithful and centered at roughly 80 percent of the canvas", async () => {
  const bytes = await renderSvg(beadSceneSvg({ bead: { color: "#c0392b", cx: 400, cy: 400, r: 300 } }));
  const result = await processBeadImage({ bytes });

  const main = await decodeRgba(result.main.bytes);
  const center = rgbaAt(main, MAIN_CANVAS_PX / 2, MAIN_CANVAS_PX / 2);
  assert.ok(center.a >= 250, "subject center must be opaque");
  assert.ok(center.r >= 120, `center red channel ${center.r} must stay red`);
  assert.ok(center.r - center.g >= 50, "subject hue must be preserved, not shifted to gray");
  assert.ok(center.r - center.b >= 50, "subject hue must be preserved, not shifted to blue");

  const width = opaqueWidth(main);
  const target = Math.round(0.8 * MAIN_CANVAS_PX);
  assert.ok(
    Math.abs(width - target) <= 16,
    `opaque subject width ${width} must stay near ${target} without stretching`
  );

  assert.ok(
    result.measurements.subjectCanvasRatio >= 0.4 && result.measurements.subjectCanvasRatio <= 0.6,
    `subject canvas ratio ${result.measurements.subjectCanvasRatio} must be near the 80% target footprint`
  );
  assert.ok(result.measurements.colorDelta <= 16, `color delta ${result.measurements.colorDelta} must stay bounded`);
  assert.ok(result.measurements.blurScore >= 40, `sharp input blur score ${result.measurements.blurScore} must be high`);
  assert.equal(result.measurements.clipped, false);
  assert.equal(result.measurements.upscaleRequired, false);
  assert.ok(result.measurements.subjectEffectiveEdgePx >= 410, "a 600px subject must not require upscaling");
});

test("does not upscale a small subject and reports insufficient effective resolution", async () => {
  const bytes = await renderSvg(beadSceneSvg({ bead: { color: "#c0392b", cx: 400, cy: 400, r: 80 } }));
  const result = await processBeadImage({ bytes });

  assert.equal(result.measurements.upscaleRequired, true);
  assert.equal(result.measurements.scaleApplied, 1, "upscaling is forbidden; the subject keeps native size");
  assert.ok(result.measurements.subjectEffectiveEdgePx <= 170, "effective edge must reflect the tiny source subject");

  const main = await decodeRgba(result.main.bytes);
  assert.equal(main.width, MAIN_CANVAS_PX);
  const width = opaqueWidth(main);
  assert.ok(
    Math.abs(width - 160) <= 8,
    `opaque subject width ${width} must stay near the native 160px instead of being upscaled`
  );
  const center = rgbaAt(main, MAIN_CANVAS_PX / 2, MAIN_CANVAS_PX / 2);
  assert.ok(center.a >= 250, "the small subject must still be centered and opaque");
});

test("flags subjects clipped at the source border but still produces the output", async () => {
  const bytes = await renderSvg(beadSceneSvg({ bead: { color: "#c0392b", cx: 400, cy: 400, r: 450 } }));
  const result = await processBeadImage({ bytes });

  assert.equal(result.measurements.clipped, true);
  assert.equal(result.main.widthPx, MAIN_CANVAS_PX);
  assert.ok(result.main.byteSize > 0, "QC failure must not delete the output");
});

test("rejects ARW bytes: RAW is archived only, never the processing input", async () => {
  const arwBytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  await assert.rejects(
    () => processBeadImage({ bytes: arwBytes }),
    (error: unknown) => {
      assert.ok(error instanceof ImageProcessorError);
      assert.equal(error.code, "UNSUPPORTED_SOURCE_KIND");
      return true;
    }
  );
});

test("rejects undecodable payloads with a typed decode failure", async () => {
  const garbage = new Uint8Array(64);
  for (let index = 0; index < garbage.length; index += 1) garbage[index] = index % 251;
  await assert.rejects(
    () => processBeadImage({ bytes: garbage }),
    (error: unknown) => {
      assert.ok(error instanceof ImageProcessorError);
      assert.equal(error.code, "DECODE_FAILED");
      return true;
    }
  );
});

test("rejects background-only images that contain no subject", async () => {
  const bytes = await renderSvg(
    beadSceneSvg({ bead: { color: "#c0392b", cx: 400, cy: 400, r: 0 }, background: "#f0f0f0" })
  );
  await assert.rejects(
    () => processBeadImage({ bytes }),
    (error: unknown) => {
      assert.ok(error instanceof ImageProcessorError);
      assert.equal(error.code, "NO_SUBJECT");
      return true;
    }
  );
});
