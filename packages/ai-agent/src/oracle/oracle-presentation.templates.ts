import type { CatalogMaterialProduct, OraclePresentationResponse } from "@mystcrag/design-contract";

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
const POSITION_SEPARATOR: LocaleCopy = { "zh-CN": "、", "zh-TW": "、", "en-US": ", " };

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

const HEADLINE: Record<OraclePresentationLocale, (hexagramNumber: number) => string> = {
  "zh-CN": (hexagramNumber) => `第${hexagramNumber}卦的设计线索`,
  "zh-TW": (hexagramNumber) => `第${hexagramNumber}卦的設計線索`,
  "en-US": (hexagramNumber) => `Hexagram ${hexagramNumber} as a design cue`
};

const SUMMARY_MOVING: LocaleCopy = {
  "zh-CN": "从本卦到变卦的变化仅作为构图提示：先建立稳定主序，再在动爻位置加入轻重转折。",
  "zh-TW": "從本卦到變卦的變化僅作為構圖提示：先建立穩定主序，再在動爻位置加入輕重轉折。",
  "en-US":
    "Use the shift from the primary to the transformed structure only as a composition cue: establish a calm base, then mark the moving positions with measured contrast."
};

const SUMMARY_STATIC: LocaleCopy = {
  "zh-CN": "此卦可作为观察当前节奏的一个角度：以稳定秩序展开色彩与材质，不预设任何现实结果。",
  "zh-TW": "此卦可作為觀察當下節奏的一個角度：以穩定秩序展開色彩與材質，不預設任何現實結果。",
  "en-US":
    "Use this structure as one way to observe the present rhythm: build color and material with steady order, without predicting an outcome."
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

export function oracleHeadline(locale: OraclePresentationLocale, hexagramNumber: number): string {
  return bounded(HEADLINE[locale](hexagramNumber), 48);
}

export function oracleSummary(locale: OraclePresentationLocale, moving: boolean): string {
  return bounded(moving ? SUMMARY_MOVING[locale] : SUMMARY_STATIC[locale], 240);
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

export function oracleAccentCue(locale: OraclePresentationLocale, positions: readonly number[]): string {
  const joined = positions.join(POSITION_SEPARATOR[locale]);
  if (locale === "en-US") {
    return bounded(`Moving lines at positions ${joined} mark restrained accent points only.`, 120);
  }
  if (locale === "zh-TW") {
    return bounded(`動爻位於第${joined}爻，僅作為克制的點睛位置。`, 120);
  }
  return bounded(`动爻位于第${joined}爻，仅作为克制的点睛位置。`, 120);
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

export function oracleMaterialLabel(
  locale: OraclePresentationLocale,
  product: Pick<CatalogMaterialProduct, "crystalNameCn" | "crystalNameEn" | "shape" | "diameterMm">
): string {
  const name = locale === "en-US" ? product.crystalNameEn : product.crystalNameCn;
  const shape = SHAPE_LABELS[product.shape]?.[locale] ?? "";
  return bounded([name, shape, `${product.diameterMm}mm`].filter((part) => part.length > 0).join(" "), 160);
}