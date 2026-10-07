import type { TarotPresentationResponse, TarotSlot } from "@mystcrag/design-contract";

/**
 * Reviewed, versioned display templates for the read-only Tarot presentation projection.
 *
 * Every string here is original Mystcrag copy written for one display locale; nothing is
 * machine-translated at request time and nothing is copied from a session's stored interpretation.
 * Templates describe the spread, card orientation, and palette composition only and never assert an
 * outcome, efficacy, fortune, price, stock, or a second authoritative design.
 */
export const TAROT_PRESENTATION_CONTENT_VERSION = "mystcrag-tarot-presentation-v1";

export type TarotPresentationLocale = TarotPresentationResponse["locale"];
export type TarotPresentationOrientation = "UPRIGHT" | "REVERSED";

type LocaleCopy = Record<TarotPresentationLocale, string>;

const HEADLINE: LocaleCopy = {
  "zh-CN": "牌面意象与设计方向的观察线索",
  "zh-TW": "牌面意象與設計方向的觀察線索",
  "en-US": "Card imagery and design directions as a cue"
};

type CountTemplate = Record<TarotPresentationLocale, (first: number, second: number) => string>;

const SUMMARY_WITH_DIRECTIONS: CountTemplate = {
  "zh-CN": (cardCount, directionCount) =>
    `本次牌阵共${cardCount}张牌，已整理出${directionCount}个设计方向，可作为观察与搭配的参考。`,
  "zh-TW": (cardCount, directionCount) =>
    `本次牌陣共${cardCount}張牌，已整理出${directionCount}個設計方向，可作為觀察與搭配的參考。`,
  "en-US": (cardCount, directionCount) =>
    `This spread holds ${cardCount} cards and ${directionCount} design directions, offered as observation cues.`
};

const SUMMARY_WITHOUT_DIRECTIONS: CountTemplate = {
  "zh-CN": (cardCount) =>
    `本次牌阵共${cardCount}张牌，可作为自我反思与搭配灵感的参考。`,
  "zh-TW": (cardCount) =>
    `本次牌陣共${cardCount}張牌，可作為自我反思與搭配靈感的參考。`,
  "en-US": (cardCount) =>
    `This spread holds ${cardCount} cards, offered as a prompt for reflection and styling inspiration.`
};

const SLOT_REFLECTION: Record<TarotSlot, LocaleCopy> = {
  GUIDANCE: {
    "zh-CN": "把这张指引当作一面镜子，先观察此刻最想回应的主题。",
    "zh-TW": "把這張指引當作一面鏡子，先觀察此刻最想回應的主題。",
    "en-US": "Treat this single card as a mirror and notice the theme you most want to address."
  },
  PAST: {
    "zh-CN": "过去的位置提示你回看已有经验里稳定的部分。",
    "zh-TW": "過去的位置提示你回看已有經驗裡穩定的部分。",
    "en-US": "The past position invites you to review what has stayed steady in your experience."
  },
  PRESENT: {
    "zh-CN": "当下的位置邀请你留意此刻真实的状态与节奏。",
    "zh-TW": "當下的位置邀請你留意此刻真實的狀態與節奏。",
    "en-US": "The present position asks you to notice your real state and rhythm right now."
  },
  FUTURE: {
    "zh-CN": "未来的位置提醒你为变化预留开放的调整空间。",
    "zh-TW": "未來的位置提醒你為變化預留開放的調整空間。",
    "en-US": "The future position reminds you to leave open room for change."
  }
};

const ORIENTATION_REFLECTION: Record<TarotPresentationOrientation, LocaleCopy> = {
  UPRIGHT: {
    "zh-CN": "这张牌以正位呈现，可作为顺向的观察角度。",
    "zh-TW": "這張牌以正位呈現，可作為順向的觀察角度。",
    "en-US": "This card is upright, offering a forward-looking cue."
  },
  REVERSED: {
    "zh-CN": "这张牌以逆位呈现，可作为放慢与调整的观察角度。",
    "zh-TW": "這張牌以逆位呈現，可作為放慢與調整的觀察角度。",
    "en-US": "This card is reversed, offering a slower, readjusting cue."
  }
};

const COLOR_STORY_READY: LocaleCopy = {
  "zh-CN": "以主色、辅色与点睛色构成三层配色，作为整体视觉的观察线索。",
  "zh-TW": "以主色、輔色與點睛色構成三層配色，作為整體視覺的觀察線索。",
  "en-US": "A three-layer palette of lead, support, and accent tones forms the visual cue."
};

const COLOR_STORY_PENDING: LocaleCopy = {
  "zh-CN": "本次尚未生成配色方案，可先以牌面意象作为视觉灵感的起点。",
  "zh-TW": "本次尚未生成配色方案，可先以牌面意象作為視覺靈感的起點。",
  "en-US": "No palette has been generated yet; start from the card imagery as visual inspiration."
};

const DESIGN_RATIONALE_WITH_DIRECTIONS: CountTemplate = {
  "zh-CN": (directionCount, beadCount) =>
    `以${directionCount}个方向展开，共${beadCount}颗珠子，沿用原推荐设计，仅作观察与搭配参考。`,
  "zh-TW": (directionCount, beadCount) =>
    `以${directionCount}個方向展開，共${beadCount}顆珠子，沿用原推薦設計，僅作觀察與搭配參考。`,
  "en-US": (directionCount, beadCount) =>
    `Follows the ${directionCount} original directions with ${beadCount} beads, as an observation cue only.`
};

const DESIGN_RATIONALE_PENDING: LocaleCopy = {
  "zh-CN": "设计方向将在完成牌面解读后生成，本次仅呈现牌面观察。",
  "zh-TW": "設計方向將在完成牌面解讀後生成，本次僅呈現牌面觀察。",
  "en-US": "Design directions appear after the reading; this view shows only the card observation."
};

const DISCLAIMER: LocaleCopy = {
  "zh-CN": "内容仅供自我反思与设计灵感参考，不构成确定性建议，也不声称任何功效。",
  "zh-TW": "內容僅供自我反思與設計靈感參考，不構成確定性建議，也不聲稱任何功效。",
  "en-US": "For reflection and design inspiration only; not deterministic advice and not a claim of efficacy."
};

const bounded = (value: string, maximum: number): string => value.slice(0, maximum).trim();

const joinsWithSpace = (locale: TarotPresentationLocale): boolean => locale === "en-US";

export function tarotPresentationHeadline(locale: TarotPresentationLocale): string {
  return bounded(HEADLINE[locale], 48);
}

export function tarotPresentationSummary(
  locale: TarotPresentationLocale,
  cardCount: number,
  directionCount: number
): string {
  const template = directionCount > 0 ? SUMMARY_WITH_DIRECTIONS : SUMMARY_WITHOUT_DIRECTIONS;
  return bounded(template[locale](cardCount, directionCount), 240);
}

/**
 * Reflection for one spread slot. The reviewed slot copy is always present; the card orientation is
 * a real revealed-card fact used only to select a reviewed clause, so no card identity, keyword, or
 * stored interpretation text is ever echoed into the display copy.
 */
export function tarotCardReflection(
  locale: TarotPresentationLocale,
  slot: TarotSlot,
  orientation: TarotPresentationOrientation | undefined
): string {
  const base = SLOT_REFLECTION[slot][locale];
  if (orientation === undefined) return bounded(base, 240);
  const clause = ORIENTATION_REFLECTION[orientation][locale];
  return bounded(joinsWithSpace(locale) ? `${base} ${clause}` : `${base}${clause}`, 240);
}

export function tarotColorStory(locale: TarotPresentationLocale, hasPalette: boolean): string {
  return bounded((hasPalette ? COLOR_STORY_READY : COLOR_STORY_PENDING)[locale], 240);
}

export function tarotDesignRationale(
  locale: TarotPresentationLocale,
  directionCount: number,
  beadCount: number
): string {
  if (directionCount === 0) return bounded(DESIGN_RATIONALE_PENDING[locale], 240);
  return bounded(DESIGN_RATIONALE_WITH_DIRECTIONS[locale](directionCount, beadCount), 240);
}

export function tarotDisclaimer(locale: TarotPresentationLocale): string {
  return bounded(DISCLAIMER[locale], 240);
}
