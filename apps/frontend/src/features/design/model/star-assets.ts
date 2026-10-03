/**
 * Star Platform visual kit contract (`TASK-ASSET-STAR-001`).
 *
 * Stable public URLs for the licensed Star Platform imagery. Downstream UI
 * tasks must consume this map instead of hard-coding paths so aspect ratio,
 * dominant surface, and Chinese alt intent stay single-sourced.
 */

export type StarPlatformSurface =
  | "obsidian-night"
  | "xuan-paper"
  | "aged-brass"
  | "amethyst"
  | "moon-silver";

export type StarPlatformAssetRole = "hero" | "entry" | "texture";

export type StarPlatformAsset = {
  /** Stable same-origin public URL under `apps/frontend/public`. */
  readonly src: string;
  /** Intrinsic pixel width of the delivered WebP. */
  readonly width: number;
  /** Intrinsic pixel height of the delivered WebP. */
  readonly height: number;
  /** width / height, for intrinsic layout without layout shift. */
  readonly aspectRatio: number;
  readonly dominantSurface: StarPlatformSurface;
  readonly role: StarPlatformAssetRole;
  /**
   * Chinese alt intent for meaningful imagery. Empty only when
   * `decorative` is true (presentation texture, not content).
   */
  readonly alt: string;
  readonly decorative: boolean;
};

export type StarPlatformAssetKey =
  | "heroObservatory"
  | "entryAi"
  | "entryOracle"
  | "entryDiy"
  | "entryTarot"
  | "xuanPaperGrain"
  | "engravedStarMap"
  | "heroCleanDesktop"
  | "heroCleanMobile"
  | "entryAiClean"
  | "entryOracleClean"
  | "entryTarotClean"
  | "entryDiyClean";

/**
 * 2026-09 delivery kit. Kept on disk as the rollback set and as the scope of
 * `UPSTREAM_SOURCE.md`; the curated 2026-10 kit is listed separately below.
 */
export const STAR_PLATFORM_ASSET_KEYS = [
  "heroObservatory",
  "entryAi",
  "entryOracle",
  "entryDiy",
  "entryTarot",
  "xuanPaperGrain",
  "engravedStarMap",
] as const satisfies readonly StarPlatformAssetKey[];

/**
 * Curated clean kit (`TASK-UX-ASSET-001`). Provenance for these six files is
 * recorded in `CLEAN_ASSET_SOURCE.md`, not in `UPSTREAM_SOURCE.md`.
 */
export const STAR_PLATFORM_CLEAN_ASSET_KEYS = [
  "heroCleanDesktop",
  "heroCleanMobile",
  "entryAiClean",
  "entryOracleClean",
  "entryTarotClean",
  "entryDiyClean",
] as const satisfies readonly StarPlatformAssetKey[];

/** Runtime file name for every key in the kit. */
export const STAR_PLATFORM_ASSET_FILE_NAME: Record<StarPlatformAssetKey, string> = {
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

/** Minimum delivered raster sizes enforced by `star-assets.test.tsx`. */
export const STAR_PLATFORM_MIN_SIZE = {
  hero: { width: 1920, height: 1080 },
  entry: { width: 1200, height: 900 },
  texture: { width: 1024, height: 1024 },
} as const;

const asset = (
  key: StarPlatformAssetKey,
  value: Omit<StarPlatformAsset, "src" | "aspectRatio"> & { src?: string }
): StarPlatformAsset => {
  const width = value.width;
  const height = value.height;
  return {
    src: value.src ?? `/star-platform/${STAR_PLATFORM_ASSET_FILE_NAME[key]}`,
    width,
    height,
    aspectRatio: Number((width / height).toFixed(6)),
    dominantSurface: value.dominantSurface,
    role: value.role,
    alt: value.alt,
    decorative: value.decorative,
  };
};

/**
 * Intrinsic sizes match the reviewed delivery set. Tests re-read the files on
 * disk and must agree with these values before the kit may ship.
 */
export const STAR_PLATFORM_ASSETS = {
  heroObservatory: asset("heroObservatory", {
    width: 2048,
    height: 1152,
    dominantSurface: "obsidian-night",
    role: "hero",
    alt: "玄圭星台主视觉：墨靛夜空下的浑仪与星轨，前景静置一串未染色水晶手串",
    decorative: false,
  }),
  entryAi: asset("entryAi", {
    width: 1280,
    height: 960,
    dominantSurface: "obsidian-night",
    role: "entry",
    alt: "AI 问卷入口：暖玄纸案面与星图刻度，旁置数枚天然水晶裸珠",
    decorative: false,
  }),
  entryOracle: asset("entryOracle", {
    width: 1280,
    height: 960,
    dominantSurface: "aged-brass",
    role: "entry",
    alt: "星台问卦入口：旧黄铜三钱与玉璧，衬以深靛夜空和细镌星轨",
    decorative: false,
  }),
  entryDiy: asset("entryDiy", {
    width: 1280,
    height: 960,
    dominantSurface: "xuan-paper",
    role: "entry",
    alt: "DIY 手作入口：暖玄纸上的圆形制作托盘，散放未穿线的天然水晶裸珠与克制工具",
    decorative: false,
  }),
  entryTarot: asset("entryTarot", {
    width: 1280,
    height: 960,
    dominantSurface: "moon-silver",
    role: "entry",
    alt: "Tarot 入口：月银与墨黑漆面案台上的纸牌与细金属刻度，无神秘学符号",
    decorative: false,
  }),
  xuanPaperGrain: asset("xuanPaperGrain", {
    width: 1024,
    height: 1024,
    dominantSurface: "xuan-paper",
    role: "texture",
    alt: "",
    decorative: true,
  }),
  engravedStarMap: asset("engravedStarMap", {
    width: 1024,
    height: 1024,
    dominantSurface: "obsidian-night",
    role: "texture",
    alt: "",
    decorative: true,
  }),
  heroCleanDesktop: asset("heroCleanDesktop", {
    width: 1920,
    height: 1080,
    dominantSurface: "xuan-paper",
    role: "hero",
    alt: "玄圭星台首页横版主视觉：哑光米白台面上立着一张镌有星盘刻度的深色牌卡，旁置天然水晶散珠与一串成品手串，左侧留出安静的标题区域",
    decorative: false,
  }),
  heroCleanMobile: asset("heroCleanMobile", {
    width: 1080,
    height: 1920,
    dominantSurface: "xuan-paper",
    role: "hero",
    alt: "玄圭星台首页竖版主视觉：哑光米白台面上的星盘刻度牌卡、白晶与紫晶簇和水晶手串，下方留出安静的文字区域",
    decorative: false,
  }),
  entryAiClean: asset("entryAiClean", {
    width: 1448,
    height: 1086,
    dominantSurface: "xuan-paper",
    role: "entry",
    alt: "AI 设计方向入口：哑光米白台面上五颗未穿线的天然水晶裸珠，旁放一张五色色卡与磨砂石器",
    decorative: false,
  }),
  entryOracleClean: asset("entryOracleClean", {
    width: 1448,
    height: 1086,
    dominantSurface: "aged-brass",
    role: "entry",
    alt: "星台问卦入口装饰氛围图：暗色石面上三枚旧化方孔铜钱与粗石、生晶，仅作卡片配图，不表示任何卦象或结果",
    decorative: false,
  }),
  entryTarotClean: asset("entryTarotClean", {
    width: 1447,
    height: 1087,
    dominantSurface: "obsidian-night",
    role: "entry",
    alt: "Tarot 入口装饰氛围图：暗色石面上两张插画牌卡与一张月相牌背，不代表运行时授权牌组的牌面或抽牌结果",
    decorative: false,
  }),
  entryDiyClean: asset("entryDiyClean", {
    width: 1448,
    height: 1086,
    dominantSurface: "xuan-paper",
    role: "entry",
    alt: "DIY 手作入口：哑光台面上的完全空的白色圆形托盘，右侧一支带小弯钩的串珠钩针，旁放少量未穿线散珠与透明弹力线",
    decorative: false,
  }),
} as const satisfies Record<StarPlatformAssetKey, StarPlatformAsset>;

export function getStarPlatformAsset(key: StarPlatformAssetKey): StarPlatformAsset {
  return STAR_PLATFORM_ASSETS[key];
}

/** Runtime path of the provenance document shipped beside the kit. */
export const STAR_PLATFORM_UPSTREAM_SOURCE_PATH =
  "/star-platform/UPSTREAM_SOURCE.md" as const;
