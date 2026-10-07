import type { CatalogMaterialProduct, OraclePresentationResponse } from "@mystcrag/design-contract";

import { hasProhibitedOracleClaim } from "./oracle-copy.service.js";

/**
 * Reviewed, versioned display templates for the read-only Oracle presentation projection.
 * Every string here is original Mystcrag copy written for one display locale; nothing is
 * machine-translated at request time. Templates describe composition and observation only and
 * never assert an outcome, efficacy, or fortune.
 */
export const ORACLE_PRESENTATION_CONTENT_VERSION = "mystcrag-oracle-presentation-v1";

export type OraclePresentationLocale = OraclePresentationResponse["locale"];
export type OraclePresentationDirection = "BALANCED" | "CONTRAST" | "NEUTRAL_LED";

type LocaleCopy = Record<OraclePresentationLocale, string>;

const LIST_SEPARATOR: LocaleCopy = { "zh-CN": "、", "zh-TW": "、", "en-US": ", " };

const COLOR_LABELS: Record<string, LocaleCopy> = {
  "color:white": { "zh-CN": "月白", "zh-TW": "月白", "en-US": "moon white" },
  "color:purple": { "zh-CN": "淡紫", "zh-TW": "淡紫", "en-US": "soft purple" },
  "color:pink": { "zh-CN": "浅粉", "zh-TW": "淺粉", "en-US": "soft pink" },
  "color:red": { "zh-CN": "朱红", "zh-TW": "朱紅", "en-US": "vermilion" },
  "color:orange": { "zh-CN": "暖橙", "zh-TW": "暖橙", "en-US": "warm orange" },
  "color:yellow": { "zh-CN": "土黄", "zh-TW": "土黃", "en-US": "earth yellow" },
  "color:green": { "zh-CN": "青绿", "zh-TW": "青綠", "en-US": "mineral green" },
  "color:teal": { "zh-CN": "黛青", "zh-TW": "黛青", "en-US": "dark teal" },
  "color:blue": { "zh-CN": "深蓝", "zh-TW": "深藍", "en-US": "deep blue" },
  "color:gray": { "zh-CN": "岩灰", "zh-TW": "岩灰", "en-US": "stone gray" },
  "color:black": { "zh-CN": "墨黑", "zh-TW": "墨黑", "en-US": "ink black" },
  "color:brown": { "zh-CN": "沉木", "zh-TW": "沉木", "en-US": "dark wood" },
  "color:multicolor": { "zh-CN": "多色", "zh-TW": "多色", "en-US": "multicolor" }
};

const RHYTHM_LABELS: Record<string, LocaleCopy> = {
  "rhythm:steady": { "zh-CN": "均衡留白", "zh-TW": "均衡留白", "en-US": "measured spacing" },
  "rhythm:alternating": { "zh-CN": "交替节奏", "zh-TW": "交替節奏", "en-US": "alternating rhythm" },
  "rhythm:gradual": { "zh-CN": "渐变层次", "zh-TW": "漸變層次", "en-US": "graduated layers" },
  "rhythm:punctuated": { "zh-CN": "点状对比", "zh-TW": "點狀對比", "en-US": "punctuated contrast" }
};

const SHAPE_LABELS: Record<string, LocaleCopy> = {
  ROUND: { "zh-CN": "圆珠", "zh-TW": "圓珠", "en-US": "round bead" },
  OVAL: { "zh-CN": "椭圆珠", "zh-TW": "橢圓珠", "en-US": "oval bead" },
  FACETED: { "zh-CN": "刻面珠", "zh-TW": "刻面珠", "en-US": "faceted bead" },
  BAROQUE: { "zh-CN": "巴洛克珠", "zh-TW": "巴洛克珠", "en-US": "baroque bead" }
};

const GENERIC_COLOR_CUE: LocaleCopy = {
  "zh-CN": "以稳定配色与留白作为整体配色的观察线索。",
  "zh-TW": "以穩定配色與留白作為整體配色的觀察線索。",
  "en-US": "Observe the palette and spacing as the overall visual cue."
};

/**
 * Customer-facing headline. It names the three things a reader can actually see on the piece —
 * lead color, rhythm, and accent — and never exposes cast structure such as hexagram numbers,
 * moving-line positions, or the algorithm name.
 */
const HEADLINE: LocaleCopy = {
  "zh-CN": "主色、节奏与点睛：这组设计的观察线索",
  "zh-TW": "主色、節奏與點睛：這組設計的觀察線索",
  "en-US": "Lead color, rhythm, and accent: a design cue"
};

type SummaryTemplate = Record<OraclePresentationLocale, (primary: string, rhythm: string) => string>;

const SUMMARY_MOVING: SummaryTemplate = {
  "zh-CN": (primary, rhythm) => `这组设计以${primary}为主色，节奏${rhythm}，仅在点睛处作轻微转折。`,
  "zh-TW": (primary, rhythm) => `這組設計以${primary}為主色，節奏${rhythm}，僅在點睛處作輕微轉折。`,
  "en-US": (primary, rhythm) =>
    `This design leads with ${primary} and keeps ${rhythm}, reserving only a light accent.`
};

const SUMMARY_STATIC: SummaryTemplate = {
  "zh-CN": (primary, rhythm) => `这组设计以${primary}为主色，节奏${rhythm}，保持整体平静。`,
  "zh-TW": (primary, rhythm) => `這組設計以${primary}為主色，節奏${rhythm}，保持整體平靜。`,
  "en-US": (primary, rhythm) => `This design leads with ${primary} and keeps ${rhythm} in a calm overall balance.`
};

const SUMMARY_FALLBACK_PRIMARY: LocaleCopy = {
  "zh-CN": "稳定配色",
  "zh-TW": "穩定配色",
  "en-US": "a calm palette"
};

const SUMMARY_FALLBACK_RHYTHM: LocaleCopy = {
  "zh-CN": "稳定",
  "zh-TW": "穩定",
  "en-US": "a steady rhythm"
};

const CARD_TITLE: Record<OraclePresentationDirection, LocaleCopy> = {
  BALANCED: { "zh-CN": "均衡主序", "zh-TW": "均衡主序", "en-US": "Balanced order" },
  CONTRAST: { "zh-CN": "明暗对比", "zh-TW": "明暗對比", "en-US": "Light-dark contrast" },
  NEUTRAL_LED: { "zh-CN": "中性基调", "zh-TW": "中性基調", "en-US": "Neutral base" }
};

const CARD_DESCRIPTION: Record<
  OraclePresentationDirection,
  Record<OraclePresentationLocale, (beadCount: number) => string>
> = {
  BALANCED: {
    "zh-CN": (beadCount) => `以均衡方向展开，共${beadCount}颗珠子，沿用原推荐设计。`,
    "zh-TW": (beadCount) => `以均衡方向展開，共${beadCount}顆珠子，沿用原推薦設計。`,
    "en-US": (beadCount) => `Follows the balanced direction with ${beadCount} beads from the original recommendation.`
  },
  CONTRAST: {
    "zh-CN": (beadCount) => `以对比方向展开，共${beadCount}颗珠子，沿用原推荐设计。`,
    "zh-TW": (beadCount) => `以對比方向展開，共${beadCount}顆珠子，沿用原推薦設計。`,
    "en-US": (beadCount) => `Follows the contrast direction with ${beadCount} beads from the original recommendation.`
  },
  NEUTRAL_LED: {
    "zh-CN": (beadCount) => `以中性主调展开，共${beadCount}颗珠子，沿用原推荐设计。`,
    "zh-TW": (beadCount) => `以中性主調展開，共${beadCount}顆珠子，沿用原推薦設計。`,
    "en-US":
      (beadCount) => `Follows the neutral-led direction with ${beadCount} beads from the original recommendation.`
  }
};

const bounded = (value: string, maximum: number): string => value.slice(0, maximum).trim();

export function oracleColorLabel(locale: OraclePresentationLocale, tag: string): string | undefined {
  return COLOR_LABELS[tag]?.[locale];
}

export function oracleRhythmLabel(locale: OraclePresentationLocale, tag: string): string | undefined {
  return RHYTHM_LABELS[tag]?.[locale];
}

export function oracleHeadline(locale: OraclePresentationLocale): string {
  return bounded(HEADLINE[locale], 48);
}

export function oracleSummary(
  locale: OraclePresentationLocale,
  moving: boolean,
  primaryLabels: readonly string[],
  rhythmLabel: string | undefined
): string {
  const primary =
    primaryLabels.length > 0 ? primaryLabels.join(LIST_SEPARATOR[locale]) : SUMMARY_FALLBACK_PRIMARY[locale];
  const rhythm = rhythmLabel ?? SUMMARY_FALLBACK_RHYTHM[locale];
  return bounded((moving ? SUMMARY_MOVING : SUMMARY_STATIC)[locale](primary, rhythm), 240);
}

export function oracleGenericColorCue(locale: OraclePresentationLocale): string {
  return bounded(GENERIC_COLOR_CUE[locale], 120);
}

export function oracleColorCue(
  locale: OraclePresentationLocale,
  primaryLabels: readonly string[],
  supportLabels: readonly string[]
): string {
  const primary = primaryLabels.join(LIST_SEPARATOR[locale]);
  const support = supportLabels.join(LIST_SEPARATOR[locale]);

  if (locale === "en-US") {
    return bounded(
      support
        ? `Use ${primary} as the lead color with ${support} in support, as a visual cue for the palette.`
        : `Use ${primary} as the lead color, as a visual cue for the palette.`,
      120
    );
  }
  if (locale === "zh-TW") {
    return bounded(
      support
        ? `以${primary}為主色，以${support}為輔色，作為整體配色的觀察線索。`
        : `以${primary}為主色，作為整體配色的觀察線索。`,
      120
    );
  }
  return bounded(
    support
      ? `以${primary}为主色，以${support}为辅色，作为整体配色的观察线索。`
      : `以${primary}为主色，作为整体配色的观察线索。`,
    120
  );
}

export function oracleRhythmCue(locale: OraclePresentationLocale, rhythmLabel: string): string {
  if (locale === "en-US") {
    return bounded(`The bead sequence follows ${rhythmLabel} to keep a steady rhythm.`, 120);
  }
  if (locale === "zh-TW") {
    return bounded(`節奏以${rhythmLabel}展開，讓珠序保持穩定層次。`, 120);
  }
  return bounded(`节奏以${rhythmLabel}展开，让珠序保持稳定层次。`, 120);
}

/**
 * Accent cue. The moving-line positions are a structural fact used only to count the accents;
 * the positions themselves, the moving-line concept, and any cast structure stay out of the copy.
 */
export function oracleAccentCue(locale: OraclePresentationLocale, positions: readonly number[]): string {
  const count = positions.length;
  if (locale === "en-US") {
    return bounded(`Close the overall rhythm with ${count} restrained accent points.`, 120);
  }
  if (locale === "zh-TW") {
    return bounded(`以${count}處克制的點睛收束整體節奏。`, 120);
  }
  return bounded(`以${count}处克制的点睛收束整体节奏。`, 120);
}

export function oracleCardTitle(
  locale: OraclePresentationLocale,
  direction: OraclePresentationDirection
): string {
  return bounded(CARD_TITLE[direction][locale], 120);
}

export function oracleCardDescription(
  locale: OraclePresentationLocale,
  direction: OraclePresentationDirection,
  beadCount: number
): string {
  return bounded(CARD_DESCRIPTION[direction][locale](beadCount), 240);
}

/**
 * Human-reviewed Traditional Chinese crystal names, keyed by the stable catalog `crystalId`.
 * A `zh-TW` reader must never be shown the simplified `crystalNameCn` verbatim, so only names a
 * reviewer has confirmed for Traditional Chinese are listed here. This is a hand-checked display
 * map, not a runtime script conversion. It covers every crystal currently seeded by
 * `packages/database/prisma/seed.ts`; any future or unreviewed `crystalId` falls back to the
 * catalog's authoritative English name.
 */
const REVIEWED_TRADITIONAL_MATERIAL_NAMES: Record<string, string> = {
  "crystal-agate": "瑪瑙",
  "crystal-amazonite": "天河石",
  "crystal-amethyst": "紫水晶",
  "crystal-aquamarine": "海藍寶",
  "crystal-black-onyx": "黑瑪瑙",
  "crystal-citrine": "黃水晶",
  "crystal-clear-quartz": "白水晶",
  "crystal-fluorite": "螢石",
  "crystal-garnet": "石榴石",
  "crystal-gold": "黃金",
  "crystal-green-aventurine": "綠東陵石",
  "crystal-labradorite": "拉長石",
  "crystal-lapis-lazuli": "青金石",
  "crystal-moonstone": "月光石",
  "crystal-nephrite": "和田玉",
  "crystal-obsidian": "黑曜石",
  "crystal-prehnite": "葡萄石",
  "crystal-red-agate": "紅瑪瑙",
  "crystal-rhodonite": "薔薇輝石",
  "crystal-rose-quartz": "粉晶",
  "crystal-rutilated-quartz": "髮晶",
  "crystal-smoky-quartz": "煙晶",
  "crystal-sterling-silver": "純銀",
  "crystal-sunstone": "日光石",
  "crystal-tiger-eye": "虎眼石",
  "crystal-tourmaline": "碧璽"
};

/**
 * Material label for one catalog product.
 *
 * Fallback strategy, in order:
 * 1. `en-US` shows the catalog's English name; `zh-CN` shows the catalog's simplified name.
 * 2. `zh-TW` shows a reviewed Traditional name when the `crystalId` is covered.
 * 3. A `zh-TW` name with no reviewed entry falls back to the catalog's authoritative English
 *    `crystalNameEn` — an explicit, safe substitute that never guesses a conversion and never
 *    invents a product identity.
 * 4. If the resolved name still trips the shared prohibited-claim detector, the name is dropped and
 *    only the factual shape and diameter are shown, so no efficacy claim reaches any locale while
 *    the real `beadProductId` is preserved.
 */
export function oracleMaterialLabel(
  locale: OraclePresentationLocale,
  product: Pick<
    CatalogMaterialProduct,
    "crystalId" | "crystalNameCn" | "crystalNameEn" | "shape" | "diameterMm"
  >
): string {
  const candidateName =
    locale === "en-US"
      ? product.crystalNameEn
      : locale === "zh-TW"
        ? (REVIEWED_TRADITIONAL_MATERIAL_NAMES[product.crystalId] ?? product.crystalNameEn)
        : product.crystalNameCn;

  const name = hasProhibitedOracleClaim(candidateName) ? undefined : candidateName;
  const shape = SHAPE_LABELS[product.shape]?.[locale] ?? "";
  const parts = [name, shape, `${product.diameterMm}mm`].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );
  return bounded(parts.join(" "), 160);
}