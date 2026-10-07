import type { TarotPresentationResponse, TarotSlot } from "@mystcrag/design-contract";

/**
 * Reviewed, versioned display templates for the read-only Tarot presentation projection.
 *
 * Every string here is original Mystcrag copy written for one display locale; nothing is
 * machine-translated at request time and nothing is copied from a session's stored interpretation,
 * color rationale, or material reason. Each template is a function of the persisted facts the
 * projection is allowed to read — the revealed card identity and orientation, the persisted palette
 * colors, and the persisted recommendation/material facts — so two different cards, palettes, or
 * material sets never collapse onto the same sentence. Templates describe the spread, the revealed
 * card, and the palette composition only and never assert an outcome, efficacy, fortune, price,
 * stock, or a second authoritative design.
 */
export const TAROT_PRESENTATION_CONTENT_VERSION = "mystcrag-tarot-presentation-v2";

export type TarotPresentationLocale = TarotPresentationResponse["locale"];
export type TarotPresentationOrientation = "UPRIGHT" | "REVERSED";

type LocaleCopy = Record<TarotPresentationLocale, string>;

/** Real persisted facts about one revealed card. */
export interface TarotPresentationCardFact {
  readonly cardId: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly orientation: TarotPresentationOrientation;
}

/** Real persisted palette colors for a session that has generated recommendations. */
export interface TarotPresentationPaletteFact {
  readonly primaryColor: string;
  readonly supportColor: string;
  readonly accentColor: string;
}

/** Real persisted design facts for the session's recommendation and material state. */
export interface TarotPresentationDesignFacts {
  readonly directionCount: number;
  readonly beadCount: number;
  readonly revealed: boolean;
  readonly materialColorTags: readonly string[];
}

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

/** Clause that follows the revealed card name, keyed by spread slot. */
const SLOT_CUE: Record<TarotSlot, LocaleCopy> = {
  GUIDANCE: {
    "zh-CN": "可作为一面镜子，先观察此刻最想回应的主题。",
    "zh-TW": "可作為一面鏡子，先觀察此刻最想回應的主題。",
    "en-US": "it can serve as a mirror for the theme you most want to address."
  },
  PAST: {
    "zh-CN": "提示你回看已有经验里稳定的部分。",
    "zh-TW": "提示你回看已有經驗裡穩定的部分。",
    "en-US": "it points to what has stayed steady in your experience."
  },
  PRESENT: {
    "zh-CN": "邀请你留意此刻真实的状态与节奏。",
    "zh-TW": "邀請你留意此刻真實的狀態與節奏。",
    "en-US": "it invites you to notice your real state and rhythm right now."
  },
  FUTURE: {
    "zh-CN": "提醒你为变化预留开放的调整空间。",
    "zh-TW": "提醒你為變化預留開放的調整空間。",
    "en-US": "it reminds you to leave open room for change."
  }
};

const ORIENTATION_WORD: Record<TarotPresentationOrientation, LocaleCopy> = {
  UPRIGHT: { "zh-CN": "正位", "zh-TW": "正位", "en-US": "upright" },
  REVERSED: { "zh-CN": "逆位", "zh-TW": "逆位", "en-US": "reversed" }
};

/**
 * Reflection for a spread slot whose card has not been revealed. It states the pending state
 * explicitly so an un-revealed slot is never written as an observation of a turned-over card.
 */
const PENDING_REFLECTION: LocaleCopy = {
  "zh-CN": "此位置尚未揭牌，完成揭牌后可查看对应的观察线索。",
  "zh-TW": "此位置尚未揭牌，完成揭牌後可查看對應的觀察線索。",
  "en-US": "This position is not revealed yet; its observation cue appears once the cards are turned over."
};

const COLOR_STORY_PENDING: LocaleCopy = {
  "zh-CN": "本次尚未生成配色方案，可先以牌面意象作为视觉灵感的起点。",
  "zh-TW": "本次尚未生成配色方案，可先以牌面意象作為視覺靈感的起點。",
  "en-US": "No palette has been generated yet; start from the card imagery as visual inspiration."
};

type ToneTemplate = Record<TarotPresentationLocale, (directionCount: number, beadCount: number, tones: string) => string>;

const DESIGN_RATIONALE_WITH_TONES: ToneTemplate = {
  "zh-CN": (directionCount, beadCount, tones) =>
    `以${directionCount}个方向展开，共${beadCount}颗珠子，材质色调为${tones}，沿用原推荐设计，仅作观察与搭配参考。`,
  "zh-TW": (directionCount, beadCount, tones) =>
    `以${directionCount}個方向展開，共${beadCount}顆珠子，材質色調為${tones}，沿用原推薦設計，僅作觀察與搭配參考。`,
  "en-US": (directionCount, beadCount, tones) =>
    `Follows the ${directionCount} original directions with ${beadCount} beads; the material tones are ${tones}, as an observation cue only.`
};

const DESIGN_RATIONALE_WITH_DIRECTIONS: CountTemplate = {
  "zh-CN": (directionCount, beadCount) =>
    `以${directionCount}个方向展开，共${beadCount}颗珠子，沿用原推荐设计，仅作观察与搭配参考。`,
  "zh-TW": (directionCount, beadCount) =>
    `以${directionCount}個方向展開，共${beadCount}顆珠子，沿用原推薦設計，僅作觀察與搭配參考。`,
  "en-US": (directionCount, beadCount) =>
    `Follows the ${directionCount} original directions with ${beadCount} beads, as an observation cue only.`
};

/** Revealed cards but no recommendations yet: the reading is not complete, so no directions exist. */
const DESIGN_RATIONALE_AWAITING: LocaleCopy = {
  "zh-CN": "牌面已呈现，设计方向将在生成推荐后补充，本次仅呈现牌面观察。",
  "zh-TW": "牌面已呈現，設計方向將在生成推薦後補充，本次僅呈現牌面觀察。",
  "en-US":
    "The cards are revealed; design directions will follow once recommendations are generated, so this view shows the card observation only."
};

/** No revealed cards: the reading has not started, so it is never described as finished. */
const DESIGN_RATIONALE_UNREVEALED: LocaleCopy = {
  "zh-CN": "牌面尚未揭牌，设计方向将在完成揭牌与推荐后呈现，本次仅呈现牌面观察。",
  "zh-TW": "牌面尚未揭牌，設計方向將在完成揭牌與推薦後呈現，本次僅呈現牌面觀察。",
  "en-US":
    "The cards are not revealed yet; design directions appear after the cards are turned over, so this view shows the card observation only."
};

const DISCLAIMER: LocaleCopy = {
  "zh-CN": "内容仅供自我反思与设计灵感参考，不构成确定性建议，也不声称任何功效。",
  "zh-TW": "內容僅供自我反思與設計靈感參考，不構成確定性建議，也不聲稱任何功效。",
  "en-US": "For reflection and design inspiration only; not deterministic advice and not a claim of efficacy."
};

const LIST_SEPARATOR: LocaleCopy = { "zh-CN": "、", "zh-TW": "、", "en-US": ", " };

/** Reviewed display words for the catalog's persisted material color tags. */
const MATERIAL_TONE_LABELS: Record<string, LocaleCopy> = {
  white: { "zh-CN": "月白", "zh-TW": "月白", "en-US": "off-white" },
  gray: { "zh-CN": "岩灰", "zh-TW": "岩灰", "en-US": "stone gray" },
  black: { "zh-CN": "墨黑", "zh-TW": "墨黑", "en-US": "ink black" },
  brown: { "zh-CN": "沉木", "zh-TW": "沉木", "en-US": "wood brown" },
  red: { "zh-CN": "朱红", "zh-TW": "朱紅", "en-US": "vermilion" },
  orange: { "zh-CN": "暖橙", "zh-TW": "暖橙", "en-US": "warm orange" },
  yellow: { "zh-CN": "暖金", "zh-TW": "暖金", "en-US": "warm gold" },
  gold: { "zh-CN": "金调", "zh-TW": "金調", "en-US": "golden" },
  green: { "zh-CN": "青绿", "zh-TW": "青綠", "en-US": "mineral green" },
  teal: { "zh-CN": "黛青", "zh-TW": "黛青", "en-US": "dark teal" },
  blue: { "zh-CN": "深蓝", "zh-TW": "深藍", "en-US": "deep blue" },
  purple: { "zh-CN": "淡紫", "zh-TW": "淡紫", "en-US": "soft purple" },
  pink: { "zh-CN": "浅粉", "zh-TW": "淺粉", "en-US": "soft pink" },
  clear: { "zh-CN": "清透", "zh-TW": "清透", "en-US": "clear" },
  translucent: { "zh-CN": "半透", "zh-TW": "半透", "en-US": "translucent" },
  iridescent: { "zh-CN": "虹彩", "zh-TW": "虹彩", "en-US": "iridescent" },
  cool: { "zh-CN": "冷调", "zh-TW": "冷調", "en-US": "cool" },
  warm: { "zh-CN": "暖调", "zh-TW": "暖調", "en-US": "warm" },
  neutral: { "zh-CN": "中性", "zh-TW": "中性", "en-US": "neutral" },
  soft: { "zh-CN": "柔和", "zh-TW": "柔和", "en-US": "soft" },
  deep: { "zh-CN": "浓郁", "zh-TW": "濃郁", "en-US": "deep" },
  natural: { "zh-CN": "天然", "zh-TW": "天然", "en-US": "natural" }
};

/**
 * Human-reviewed Traditional Chinese names for the canonical Major Arcana, keyed by the stable
 * catalog `cardId`. A `zh-TW` reader must never be shown the simplified catalog name, so only names
 * a reviewer has confirmed for Traditional Chinese are listed here. This is a hand-checked display
 * map, not a runtime script conversion.
 */
const REVIEWED_TRADITIONAL_MAJOR_NAMES: Record<string, string> = {
  "00-the-fool": "愚者",
  "01-the-magician": "魔術師",
  "02-the-high-priestess": "女祭司",
  "03-the-empress": "皇后",
  "04-the-emperor": "皇帝",
  "05-the-hierophant": "教皇",
  "06-the-lovers": "戀人",
  "07-the-chariot": "戰車",
  "08-strength": "力量",
  "09-the-hermit": "隱者",
  "10-wheel-of-fortune": "命運之輪",
  "11-justice": "正義",
  "12-the-hanged-man": "倒吊人",
  "13-death": "死神",
  "14-temperance": "節制",
  "15-the-devil": "惡魔",
  "16-the-tower": "高塔",
  "17-the-star": "星星",
  "18-the-moon": "月亮",
  "19-the-sun": "太陽",
  "20-judgement": "審判",
  "21-the-world": "世界"
};

/** Reviewed Traditional suit and rank names; minors compose as `<rank><suit>` like the catalog. */
const REVIEWED_TRADITIONAL_SUIT_NAMES: Record<string, string> = {
  wands: "權杖",
  cups: "聖杯",
  swords: "寶劍",
  pentacles: "星幣"
};

const REVIEWED_TRADITIONAL_RANK_NAMES: readonly string[] = [
  "王牌", "二", "三", "四", "五", "六", "七", "八", "九", "十", "侍從", "騎士", "皇后", "國王"
];

const bounded = (value: string, maximum: number): string => value.slice(0, maximum).trim();

/**
 * Traditional name for a revealed card, derived only from the canonical card id. Majors use the
 * reviewed map; minors compose the reviewed rank and suit names from the `suit-rank` id shape. Any
 * id outside the canonical catalog shape falls back to the catalog's authoritative English name
 * rather than guessing a conversion.
 */
function traditionalCardName(card: TarotPresentationCardFact): string {
  const major = REVIEWED_TRADITIONAL_MAJOR_NAMES[card.cardId];
  if (major !== undefined) return major;

  const separator = card.cardId.lastIndexOf("-");
  if (separator > 0) {
    const suit = REVIEWED_TRADITIONAL_SUIT_NAMES[card.cardId.slice(0, separator)];
    const rankIndex = Number(card.cardId.slice(separator + 1));
    const rank = Number.isInteger(rankIndex)
      ? REVIEWED_TRADITIONAL_RANK_NAMES[rankIndex - 1]
      : undefined;
    if (suit !== undefined && rank !== undefined) return `${rank}${suit}`;
  }

  return card.nameEn;
}

function localizedCardName(locale: TarotPresentationLocale, card: TarotPresentationCardFact): string {
  if (locale === "en-US") return card.nameEn;
  if (locale === "zh-TW") return traditionalCardName(card);
  return card.nameZh;
}

const materialToneWords = (
  locale: TarotPresentationLocale,
  tags: readonly string[]
): string[] => {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const tag of tags) {
    const label = MATERIAL_TONE_LABELS[tag]?.[locale];
    if (label === undefined || seen.has(label)) continue;
    seen.add(label);
    words.push(label);
  }
  return words;
};

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
 * Reflection for one spread slot, built from the real revealed-card fact: the localized catalog
 * name and the persisted orientation. The stored interpretation text is never read, so a different
 * revealed card always yields a different reflection. An un-revealed slot states that it is pending.
 */
export function tarotCardReflection(
  locale: TarotPresentationLocale,
  slot: TarotSlot,
  card: TarotPresentationCardFact | undefined
): string {
  if (card === undefined) return bounded(PENDING_REFLECTION[locale], 240);

  const name = localizedCardName(locale, card);
  const word = ORIENTATION_WORD[card.orientation][locale];
  const cue = SLOT_CUE[slot][locale];
  const text =
    locale === "en-US"
      ? `${name} appears ${word}: ${cue}`
      : locale === "zh-TW"
        ? `「${name}」以${word}出現，${cue}`
        : `「${name}」以${word}出现，${cue}`;
  return bounded(text, 240);
}

/**
 * Palette observation built from the persisted `colorStory` colors. The stored rationale free text
 * is never read; the real hex colors are the facts, so two different palettes always differ.
 */
export function tarotColorStory(
  locale: TarotPresentationLocale,
  palette: TarotPresentationPaletteFact | undefined
): string {
  if (palette === undefined) return bounded(COLOR_STORY_PENDING[locale], 240);

  const { primaryColor, supportColor, accentColor } = palette;
  if (locale === "en-US") {
    return bounded(
      `A three-layer palette of lead ${primaryColor}, support ${supportColor}, and accent ${accentColor} forms the visual cue.`,
      240
    );
  }
  if (locale === "zh-TW") {
    return bounded(
      `以主色 ${primaryColor}、輔色 ${supportColor} 與點睛色 ${accentColor} 構成三層配色，作為整體視覺的觀察線索。`,
      240
    );
  }
  return bounded(
    `以主色 ${primaryColor}、辅色 ${supportColor} 与点睛色 ${accentColor} 构成三层配色，作为整体视觉的观察线索。`,
    240
  );
}

/**
 * Design observation built from the persisted recommendation and material facts. The stored design
 * rationale free text is never read; direction count, bead count, and the real material color tags
 * are the facts, so different recommendations or materials always differ.
 */
export function tarotDesignRationale(
  locale: TarotPresentationLocale,
  facts: TarotPresentationDesignFacts
): string {
  const { directionCount, beadCount, revealed, materialColorTags } = facts;
  if (directionCount === 0) {
    return bounded((revealed ? DESIGN_RATIONALE_AWAITING : DESIGN_RATIONALE_UNREVEALED)[locale], 240);
  }

  const tones = materialToneWords(locale, materialColorTags);
  if (tones.length === 0) {
    return bounded(DESIGN_RATIONALE_WITH_DIRECTIONS[locale](directionCount, beadCount), 240);
  }
  return bounded(
    DESIGN_RATIONALE_WITH_TONES[locale](directionCount, beadCount, tones.join(LIST_SEPARATOR[locale])),
    240
  );
}

export function tarotDisclaimer(locale: TarotPresentationLocale): string {
  return bounded(DISCLAIMER[locale], 240);
}
