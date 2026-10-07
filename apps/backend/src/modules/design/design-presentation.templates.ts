import { hasProhibitedOracleClaim } from "@mystcrag/ai-agent/oracle";
import type { DesignPresentationResponse } from "@mystcrag/design-contract";

/**
 * Reviewed, versioned display templates for the read-only Design presentation projection.
 *
 * Every string here is original Mystcrag copy written for one display locale; nothing is
 * machine-translated at request time and nothing is copied from a saved design's free text.
 * Templates describe composition and observation only and never assert an outcome, efficacy,
 * fortune, price, stock, or product identity.
 */
export const DESIGN_PRESENTATION_CONTENT_VERSION = "mystcrag-design-presentation-v1";

export type DesignPresentationLocale = DesignPresentationResponse["locale"];

type LocaleCopy = Record<DesignPresentationLocale, string>;

const TITLE: LocaleCopy = {
  "zh-CN": "这组设计的材质与配色观察",
  "zh-TW": "這組設計的材質與配色觀察",
  "en-US": "Materials and palette cues for this design"
};

const STORY: Record<DesignPresentationLocale, (beadCount: number) => string> = {
  "zh-CN": (beadCount) =>
    `这组设计以${beadCount}颗珠子组成，强调材质层次与留白节奏，作为整体造型的观察线索。`,
  "zh-TW": (beadCount) =>
    `這組設計以${beadCount}顆珠子組成，強調材質層次與留白節奏，作為整體造型的觀察線索。`,
  "en-US": (beadCount) =>
    `This design arranges ${beadCount} beads to highlight material layering and measured spacing as an overall visual cue.`
};

const SHAPE_LABELS: Record<string, LocaleCopy> = {
  ROUND: { "zh-CN": "圆珠", "zh-TW": "圓珠", "en-US": "round bead" },
  OVAL: { "zh-CN": "椭圆珠", "zh-TW": "橢圓珠", "en-US": "oval bead" },
  FACETED: { "zh-CN": "刻面珠", "zh-TW": "刻面珠", "en-US": "faceted bead" },
  BAROQUE: { "zh-CN": "巴洛克珠", "zh-TW": "巴洛克珠", "en-US": "baroque bead" }
};

/**
 * Human-reviewed Traditional Chinese crystal names, keyed by the stable catalog `crystalId`.
 * A `zh-TW` reader must never be shown the simplified `crystalNameCn` verbatim, so only names a
 * reviewer has confirmed for Traditional Chinese are listed here. This is a hand-checked display
 * map, not a runtime script conversion; an unreviewed `crystalId` falls back to the catalog's
 * authoritative English name rather than guessing a conversion.
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

const bounded = (value: string, maximum: number): string => value.slice(0, maximum).trim();

export function designPresentationTitle(locale: DesignPresentationLocale): string {
  return bounded(TITLE[locale], 120);
}

export function designPresentationStory(locale: DesignPresentationLocale, beadCount: number): string {
  return bounded(STORY[locale](beadCount), 2_000);
}

export type DesignMaterialFacts = {
  readonly crystalId?: string;
  readonly crystalNameCn?: string;
  readonly crystalNameEn?: string;
  readonly shape: string;
  readonly diameterMm: number;
};

/**
 * Material label for one bead, built from real facts only.
 *
 * Fallback strategy, in order:
 * 1. `en-US` shows the catalog's English name; `zh-CN` shows the catalog's simplified name.
 * 2. `zh-TW` shows a reviewed Traditional name when the `crystalId` is covered, otherwise the
 *    catalog's authoritative English `crystalNameEn`.
 * 3. With no catalog name (a bead whose product is no longer listed) only the real shape and
 *    diameter are shown, so no product identity is ever invented.
 * 4. If the resolved name still trips the shared prohibited-claim detector, the name is dropped and
 *    only the factual shape and diameter are shown, so no efficacy claim reaches any locale while
 *    the real `beadProductId` is preserved by the caller.
 */
export function designMaterialLabel(locale: DesignPresentationLocale, facts: DesignMaterialFacts): string {
  const candidateName =
    locale === "en-US"
      ? facts.crystalNameEn
      : locale === "zh-TW"
        ? facts.crystalId === undefined
          ? facts.crystalNameEn
          : (REVIEWED_TRADITIONAL_MATERIAL_NAMES[facts.crystalId] ?? facts.crystalNameEn)
        : facts.crystalNameCn;

  const name =
    candidateName !== undefined && !hasProhibitedOracleClaim(candidateName) ? candidateName : undefined;
  const shape = SHAPE_LABELS[facts.shape]?.[locale] ?? "";
  const parts = [name, shape, `${facts.diameterMm}mm`].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );
  return bounded(parts.join(" "), 160);
}