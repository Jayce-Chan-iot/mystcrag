import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  STAR_PLATFORM_ASSETS,
  STAR_PLATFORM_ASSET_KEYS,
  STAR_PLATFORM_MIN_SIZE,
  STAR_PLATFORM_UPSTREAM_SOURCE_PATH,
  type StarPlatformAssetKey,
} from "./star-assets";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const STAR_DIR = path.join(PUBLIC_DIR, "star-platform");
const UPSTREAM_SOURCE = path.join(PUBLIC_DIR, STAR_PLATFORM_UPSTREAM_SOURCE_PATH.replace(/^\//, ""));
const CLEAN_ASSET_SOURCE = path.join(STAR_DIR, "CLEAN_ASSET_SOURCE.md");

/**
 * Curated clean kit (`TASK-UX-ASSET-001`). The mobile hero is portrait, so it
 * is gated separately instead of widening the landscape hero minimum.
 */
type CleanAssetKey =
  | "heroCleanDesktop"
  | "heroCleanMobile"
  | "entryAiClean"
  | "entryOracleClean"
  | "entryTarotClean"
  | "entryDiyClean";

const CLEAN_KEYS: readonly CleanAssetKey[] = [
  "heroCleanDesktop",
  "heroCleanMobile",
  "entryAiClean",
  "entryOracleClean",
  "entryTarotClean",
  "entryDiyClean",
];
const CLEAN_ENTRY_KEYS: readonly CleanAssetKey[] = [
  "entryAiClean",
  "entryOracleClean",
  "entryTarotClean",
  "entryDiyClean",
];

/** Independent portrait gate for the mobile hero; never lowers STAR_PLATFORM_MIN_SIZE. */
const MOBILE_HERO_PORTRAIT_MIN = { width: 1080, height: 1920 } as const;

const FILE_NAME: Record<StarPlatformAssetKey, string> = {
  heroObservatory: "hero-observatory.webp",
  entryAi: "entry-ai.webp",
  entryOracle: "entry-oracle.webp",
  entryDiy: "entry-diy.webp",
  entryTarot: "entry-tarot.webp",
  xuanPaperGrain: "xuan-paper-grain.webp",
  engravedStarMap: "engraved-star-map.webp",
  heroCleanDesktop: "hero-clean-desktop.webp",
  heroCleanMobile: "hero-clean-mobile.webp",
  entryAiClean: "entry-ai-clean.webp",
  entryOracleClean: "entry-oracle-clean.webp",
  entryTarotClean: "entry-tarot-clean.webp",
  entryDiyClean: "entry-diy-clean.webp",
};

function readWebpSize(buf: Buffer): { width: number; height: number } {
  assert.equal(buf.subarray(0, 4).toString("ascii"), "RIFF", "WebP must start with RIFF");
  assert.equal(buf.subarray(8, 12).toString("ascii"), "WEBP", "WebP must contain WEBP fourcc");

  const fourcc = buf.subarray(12, 16).toString("ascii");
  if (fourcc === "VP8X") {
    const width = 1 + buf.readUIntLE(24, 3);
    const height = 1 + buf.readUIntLE(27, 3);
    return { width, height };
  }
  if (fourcc === "VP8L") {
    const b0 = buf[21]!;
    const b1 = buf[22]!;
    const b2 = buf[23]!;
    const b3 = buf[24]!;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (fourcc === "VP8 ") {
    // Lossy bitstream: 3-byte frame tag then sync code 0x9d 0x01 0x2a.
    assert.equal(buf[23], 0x9d, "VP8 sync code");
    assert.equal(buf[24], 0x01, "VP8 sync code");
    assert.equal(buf[25], 0x2a, "VP8 sync code");
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  assert.fail(`Unsupported WebP chunk: ${fourcc}`);
}

function assertWebpFile(filePath: string): { width: number; height: number; bytes: Buffer } {
  assert.ok(existsSync(filePath), `missing asset: ${filePath}`);
  const bytes = readFileSync(filePath);
  assert.ok(bytes.length > 32, `asset too small: ${filePath}`);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", `not RIFF: ${filePath}`);
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", `not WEBP: ${filePath}`);
  return { ...readWebpSize(bytes), bytes };
}

test("all seven Star Platform WebP assets and the provenance document exist", () => {
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    assert.ok(existsSync(path.join(STAR_DIR, FILE_NAME[key])), `missing ${FILE_NAME[key]}`);
  }
  assert.ok(existsSync(UPSTREAM_SOURCE), `missing provenance: ${STAR_PLATFORM_UPSTREAM_SOURCE_PATH}`);
  assert.ok(UPSTREAM_SOURCE.endsWith(".md"));
});

test("every Star Platform image is a real WebP file", () => {
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    const filePath = path.join(STAR_DIR, FILE_NAME[key]);
    assertWebpFile(filePath);
  }
});

test("hero raster is at least 1920×1080 and matches the typed intrinsic size", () => {
  const hero = STAR_PLATFORM_ASSETS.heroObservatory;
  const { width, height } = assertWebpFile(path.join(STAR_DIR, FILE_NAME.heroObservatory));
  assert.ok(
    width >= STAR_PLATFORM_MIN_SIZE.hero.width && height >= STAR_PLATFORM_MIN_SIZE.hero.height,
    `hero ${width}×${height} below 1920×1080`
  );
  assert.equal(width, hero.width, "typed width must match delivered hero file");
  assert.equal(height, hero.height, "typed height must match delivered hero file");
  assert.ok(Math.abs(width / height - hero.aspectRatio) < 1e-6);
});

test("entry cards are at least 1200×900 and match typed intrinsic sizes", () => {
  const entryKeys: StarPlatformAssetKey[] = ["entryAi", "entryOracle", "entryDiy", "entryTarot"];
  for (const key of entryKeys) {
    const typed = STAR_PLATFORM_ASSETS[key];
    const { width, height } = assertWebpFile(path.join(STAR_DIR, FILE_NAME[key]));
    assert.ok(
      width >= STAR_PLATFORM_MIN_SIZE.entry.width && height >= STAR_PLATFORM_MIN_SIZE.entry.height,
      `${key} ${width}×${height} below 1200×900`
    );
    assert.equal(width, typed.width, `${key} width must match typed map`);
    assert.equal(height, typed.height, `${key} height must match typed map`);
    assert.ok(Math.abs(width / height - typed.aspectRatio) < 1e-6);
  }
});

test("texture rasters meet texture minimums and match typed intrinsic sizes", () => {
  const textureKeys: StarPlatformAssetKey[] = ["xuanPaperGrain", "engravedStarMap"];
  for (const key of textureKeys) {
    const typed = STAR_PLATFORM_ASSETS[key];
    const { width, height } = assertWebpFile(path.join(STAR_DIR, FILE_NAME[key]));
    assert.ok(
      width >= STAR_PLATFORM_MIN_SIZE.texture.width &&
        height >= STAR_PLATFORM_MIN_SIZE.texture.height,
      `${key} ${width}×${height} below texture minimum`
    );
    assert.equal(width, typed.width);
    assert.equal(height, typed.height);
  }
});

test("every asset key has non-empty Chinese alt intent or is explicitly decorative", () => {
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    const typed = STAR_PLATFORM_ASSETS[key];
    if (typed.decorative) {
      assert.equal(typed.alt, "", `${key} decorative assets must not claim alt intent`);
      continue;
    }
    assert.ok(typed.alt.trim().length > 0, `${key} needs non-empty alt intent`);
    assert.match(typed.alt, /[一-鿿]/, `${key} alt intent must include Chinese`);
  }
});

test("typed map exposes stable public URLs, role, surface, and intrinsic aspect", () => {
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    const typed = STAR_PLATFORM_ASSETS[key];
    assert.equal(typed.src, `/star-platform/${FILE_NAME[key]}`);
    assert.ok(["hero", "entry", "texture"].includes(typed.role));
    assert.ok(
      ["obsidian-night", "xuan-paper", "aged-brass", "amethyst", "moon-silver"].includes(
        typed.dominantSurface
      )
    );
    assert.equal(typed.aspectRatio, Number((typed.width / typed.height).toFixed(6)));
  }
  assert.equal(STAR_PLATFORM_ASSETS.heroObservatory.role, "hero");
  assert.equal(STAR_PLATFORM_ASSETS.heroObservatory.decorative, false);
});

test("provenance document records tool/model, purpose, license and SHA-256 for every asset", () => {
  assert.ok(existsSync(UPSTREAM_SOURCE), "provenance document missing");
  const text = readFileSync(UPSTREAM_SOURCE, "utf8");
  assert.match(text, /SHA-256/i);
  assert.match(text, /2026-09-28|generation date|生成日期/i);
  assert.match(text, /license|权属|License/i);
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    assert.ok(text.includes(FILE_NAME[key]), `provenance must name ${FILE_NAME[key]}`);
  }
  // Each delivered file's digest must appear in provenance.
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    const bytes = readFileSync(path.join(STAR_DIR, FILE_NAME[key]));
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.ok(
      text.includes(digest),
      `provenance must record SHA-256 for ${FILE_NAME[key]} (${digest})`
    );
  }
});

test("asset review report exists and cites one canonical contact sheet", () => {
  const reviewPath = path.resolve(
    process.cwd(),
    "../../docs/progress/2026-09-26_STAR_ASSET_REVIEW.md"
  );
  assert.ok(existsSync(reviewPath), "missing docs/progress/2026-09-26_STAR_ASSET_REVIEW.md");
  const text = readFileSync(reviewPath, "utf8");
  assert.match(text, /contact sheet|接触印样|对照图/i);
  assert.match(text, /1920×1080|1920x1080/);
  assert.match(text, /SHA-256|sha-256|sha256/i);
});

test("UI reference manifest documents the Star Platform runtime assets", () => {
  const manifestPath = path.resolve(process.cwd(), "../../docs/UI_REFERENCE_AND_ASSET_MANIFEST.md");
  assert.ok(existsSync(manifestPath));
  const text = readFileSync(manifestPath, "utf8");
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    assert.ok(text.includes(FILE_NAME[key]), `manifest must name ${FILE_NAME[key]}`);
  }
  assert.match(text, /STAR_PLATFORM_ASSETS/);
});

test("the seven legacy Star Platform assets stay on disk as rollback fallbacks", () => {
  for (const key of STAR_PLATFORM_ASSET_KEYS) {
    const legacyPath = path.join(STAR_DIR, FILE_NAME[key]);
    assert.ok(existsSync(legacyPath), `legacy fallback must be preserved: ${FILE_NAME[key]}`);
    assertWebpFile(legacyPath);
  }
});

test("clean kit registers six typed keys whose files exist and match intrinsic sizes", () => {
  for (const key of CLEAN_KEYS) {
    const typed = STAR_PLATFORM_ASSETS[key];
    assert.ok(typed, `STAR_PLATFORM_ASSETS must expose the new key ${key}`);
    const { width, height } = assertWebpFile(path.join(STAR_DIR, FILE_NAME[key]));
    assert.equal(typed.src, `/star-platform/${FILE_NAME[key]}`, `${key} src`);
    assert.equal(typed.width, width, `${key} typed width must match delivered file`);
    assert.equal(typed.height, height, `${key} typed height must match delivered file`);
    assert.equal(typed.aspectRatio, Number((width / height).toFixed(6)), `${key} aspect`);
    assert.ok(["hero", "entry"].includes(typed.role), `${key} role`);
    assert.equal(typed.decorative, false, `${key} clean kit images carry alt intent`);
  }
});

test("desktop clean hero meets the unchanged landscape hero minimum", () => {
  const { width, height } = assertWebpFile(path.join(STAR_DIR, FILE_NAME.heroCleanDesktop));
  assert.ok(
    width >= STAR_PLATFORM_MIN_SIZE.hero.width && height >= STAR_PLATFORM_MIN_SIZE.hero.height,
    `hero-clean-desktop ${width}×${height} below ${STAR_PLATFORM_MIN_SIZE.hero.width}×${STAR_PLATFORM_MIN_SIZE.hero.height}`
  );
  assert.ok(width > height, "desktop hero must stay landscape");
});

test("mobile clean hero passes its own portrait gate without touching the shared minimum", () => {
  const { width, height } = assertWebpFile(path.join(STAR_DIR, FILE_NAME.heroCleanMobile));
  assert.ok(height > width, "mobile hero must be portrait");
  assert.ok(
    width >= MOBILE_HERO_PORTRAIT_MIN.width && height >= MOBILE_HERO_PORTRAIT_MIN.height,
    `hero-clean-mobile ${width}×${height} below portrait ${MOBILE_HERO_PORTRAIT_MIN.width}×${MOBILE_HERO_PORTRAIT_MIN.height}`
  );
  assert.ok(
    height >= STAR_PLATFORM_MIN_SIZE.hero.width,
    `hero-clean-mobile height ${height} must still reach ${STAR_PLATFORM_MIN_SIZE.hero.width}`
  );
});

test("clean entry cards meet the unchanged entry minimum", () => {
  for (const key of CLEAN_ENTRY_KEYS) {
    const { width, height } = assertWebpFile(path.join(STAR_DIR, FILE_NAME[key]));
    assert.ok(
      width >= STAR_PLATFORM_MIN_SIZE.entry.width && height >= STAR_PLATFORM_MIN_SIZE.entry.height,
      `${key} ${width}×${height} below ${STAR_PLATFORM_MIN_SIZE.entry.width}×${STAR_PLATFORM_MIN_SIZE.entry.height}`
    );
  }
});

test("shared size contract is not weakened while the clean kit is added", () => {
  assert.equal(STAR_PLATFORM_MIN_SIZE.hero.width, 1920);
  assert.equal(STAR_PLATFORM_MIN_SIZE.hero.height, 1080);
  assert.equal(STAR_PLATFORM_MIN_SIZE.entry.width, 1200);
  assert.equal(STAR_PLATFORM_MIN_SIZE.entry.height, 900);
  assert.equal(STAR_PLATFORM_MIN_SIZE.texture.width, 1024);
  assert.equal(STAR_PLATFORM_MIN_SIZE.texture.height, 1024);
});

test("clean kit alt intent is Chinese and states the DIY empty tray and hooked needle", () => {
  for (const key of CLEAN_KEYS) {
    const typed = STAR_PLATFORM_ASSETS[key];
    assert.ok(typed.alt.trim().length > 0, `${key} needs non-empty alt intent`);
    assert.match(typed.alt, /[一-鿿]/, `${key} alt intent must include Chinese`);
  }
  assert.match(STAR_PLATFORM_ASSETS.entryDiyClean.alt, /空/, "DIY alt must state the empty tray");
  assert.match(STAR_PLATFORM_ASSETS.entryDiyClean.alt, /钩针/, "DIY alt must state the hook needle");
});

test("owner-selected Oracle and Tarot entries disclose decorative mood-image status in alt", () => {
  for (const key of ["entryOracleClean", "entryTarotClean"] as const) {
    const typed = STAR_PLATFORM_ASSETS[key];
    assert.match(typed.alt, /装饰|氛围/, `${key} must be labelled a decorative entry image`);
  }
  assert.match(
    STAR_PLATFORM_ASSETS.entryTarotClean.alt,
    /授权牌组|不代表/,
    "tarot entry alt must not imply the licensed deck faces"
  );
});

test("clean kit provenance records source, transform, purpose, size and SHA-256", () => {
  assert.ok(existsSync(CLEAN_ASSET_SOURCE), "missing apps/frontend/public/star-platform/CLEAN_ASSET_SOURCE.md");
  const text = readFileSync(CLEAN_ASSET_SOURCE, "utf8");
  for (const key of CLEAN_KEYS) {
    assert.ok(text.includes(FILE_NAME[key]), `provenance must name ${FILE_NAME[key]}`);
    const digest = createHash("sha256")
      .update(readFileSync(path.join(STAR_DIR, FILE_NAME[key])))
      .digest("hex");
    assert.ok(
      text.includes(digest),
      `provenance must record SHA-256 for ${FILE_NAME[key]} (${digest})`
    );
  }
  assert.match(text, /SHA-256/i);
  assert.match(text, /用途|purpose/i);
  assert.match(text, /来源|source/i);
});

test("clean kit provenance states the heroes are interpolated derivatives, not native capture", () => {
  const text = readFileSync(CLEAN_ASSET_SOURCE, "utf8");
  assert.match(text, /插值|interpolat/i, "must disclose interpolation");
  assert.match(text, /sips/, "must name the transform tool");
  assert.match(text, /1672×941/, "must cite the desktop source resolution");
  assert.match(text, /941×1672/, "must cite the mobile source resolution");
  assert.match(text, /非原生|not native/i, "must deny native high-resolution capture");
});

test("manifest documents the six clean assets and their owner-exception entries", () => {
  const manifestPath = path.resolve(process.cwd(), "../../docs/UI_REFERENCE_AND_ASSET_MANIFEST.md");
  const text = readFileSync(manifestPath, "utf8");
  for (const key of CLEAN_KEYS) {
    assert.ok(text.includes(FILE_NAME[key]), `manifest must name ${FILE_NAME[key]}`);
  }
  assert.match(text, /CLEAN_ASSET_SOURCE\.md/, "manifest must route to the clean provenance record");
  assert.match(text, /产品所有者|Product Owner/, "manifest must record the owner-selected exceptions");
});
