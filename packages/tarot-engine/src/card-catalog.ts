import type { TarotCardDefinition } from "./types";

export const DESIGN_TAG_VERSION = "v1";

type MajorCardSeed = Omit<TarotCardDefinition, "designTags"> & {
  readonly tone: "violet" | "amber" | "blue" | "rose" | "ink";
  readonly visual: string;
  readonly themes: readonly string[];
};

const tags = (tone: MajorCardSeed["tone"], visual: string, themes: readonly string[]) => ({
  colors: [`color-${DESIGN_TAG_VERSION}:${tone}`],
  visual: [`visual-${DESIGN_TAG_VERSION}:${visual}`],
  themes: themes.map((theme) => `theme-${DESIGN_TAG_VERSION}:${theme}`),
});

// Adapted card identifiers, English names, and asset basenames from the authorized
// upstream snapshot (commit e4d3a20265dd8a8b7e14e9ec980685fe20a79040).
const MAJOR_SEEDS: readonly MajorCardSeed[] = [
  { id: "00-the-fool", number: 0, nameZh: "愚者", nameEn: "The Fool", assetFile: "00-TheFool.png", uprightKeywords: ["beginnings", "innocence", "adventure"], reversedKeywords: ["naivety", "caution", "pause"], tone: "amber", visual: "light", themes: ["new-beginnings", "self-growth"] },
  { id: "01-the-magician", number: 1, nameZh: "魔术师", nameEn: "The Magician", assetFile: "01-TheMagician.png", uprightKeywords: ["willpower", "skill", "mastery"], reversedKeywords: ["planning", "focus", "integrity"], tone: "violet", visual: "focused", themes: ["career", "self-growth"] },
  { id: "02-the-high-priestess", number: 2, nameZh: "女祭司", nameEn: "The High Priestess", assetFile: "02-TheHighPriestess.png", uprightKeywords: ["intuition", "mystery", "reflection"], reversedKeywords: ["silence", "distance", "clarity"], tone: "blue", visual: "luminous", themes: ["self-growth", "relationships"] },
  { id: "03-the-empress", number: 3, nameZh: "皇后", nameEn: "The Empress", assetFile: "03-TheEmpress.png", uprightKeywords: ["abundance", "nurturing", "nature"], reversedKeywords: ["boundaries", "renewal", "care"], tone: "rose", visual: "organic", themes: ["relationships", "self-growth"] },
  { id: "04-the-emperor", number: 4, nameZh: "皇帝", nameEn: "The Emperor", assetFile: "04-TheEmperor.png", uprightKeywords: ["authority", "structure", "stability"], reversedKeywords: ["flexibility", "balance", "restraint"], tone: "ink", visual: "structured", themes: ["career", "financial-planning"] },
  { id: "05-the-hierophant", number: 5, nameZh: "教皇", nameEn: "The Hierophant", assetFile: "05-TheHierophant.png", uprightKeywords: ["tradition", "wisdom", "learning"], reversedKeywords: ["independence", "questions", "adaptation"], tone: "amber", visual: "classic", themes: ["self-growth", "career"] },
  { id: "06-the-lovers", number: 6, nameZh: "恋人", nameEn: "The Lovers", assetFile: "06-TheLovers.png", uprightKeywords: ["love", "union", "choice"], reversedKeywords: ["alignment", "communication", "balance"], tone: "rose", visual: "paired", themes: ["relationships", "self-growth"] },
  { id: "07-the-chariot", number: 7, nameZh: "战车", nameEn: "The Chariot", assetFile: "07-TheChariot.png", uprightKeywords: ["determination", "action", "direction"], reversedKeywords: ["patience", "recenter", "pace"], tone: "ink", visual: "dynamic", themes: ["career", "new-beginnings"] },
  { id: "08-strength", number: 8, nameZh: "力量", nameEn: "Strength", assetFile: "08-Strength.png", uprightKeywords: ["courage", "patience", "compassion"], reversedKeywords: ["confidence", "gentleness", "restore"], tone: "amber", visual: "warm", themes: ["self-growth", "relationships"] },
  { id: "09-the-hermit", number: 9, nameZh: "隐者", nameEn: "The Hermit", assetFile: "09-TheHermit.png", uprightKeywords: ["solitude", "introspection", "guidance"], reversedKeywords: ["connection", "perspective", "return"], tone: "blue", visual: "quiet", themes: ["self-growth", "career"] },
  { id: "10-wheel-of-fortune", number: 10, nameZh: "命运之轮", nameEn: "Wheel of Fortune", assetFile: "10-WheelOfFortune.png", uprightKeywords: ["cycles", "change", "turning-point"], reversedKeywords: ["adaptation", "agency", "timing"], tone: "violet", visual: "circular", themes: ["new-beginnings", "career"] },
  { id: "11-justice", number: 11, nameZh: "正义", nameEn: "Justice", assetFile: "11-Justice.png", uprightKeywords: ["fairness", "truth", "balance"], reversedKeywords: ["accountability", "context", "repair"], tone: "ink", visual: "balanced", themes: ["career", "relationships"] },
  { id: "12-the-hanged-man", number: 12, nameZh: "倒吊人", nameEn: "The Hanged Man", assetFile: "12-TheHangedMan.png", uprightKeywords: ["pause", "perspective", "surrender"], reversedKeywords: ["release", "movement", "reframe"], tone: "blue", visual: "suspended", themes: ["self-growth", "new-beginnings"] },
  { id: "13-death", number: 13, nameZh: "死神", nameEn: "Death", assetFile: "13-Death.png", uprightKeywords: ["transformation", "endings", "transition"], reversedKeywords: ["acceptance", "release", "renewal"], tone: "ink", visual: "transformative", themes: ["new-beginnings", "self-growth"] },
  { id: "14-temperance", number: 14, nameZh: "节制", nameEn: "Temperance", assetFile: "14-Temperance.png", uprightKeywords: ["balance", "moderation", "harmony"], reversedKeywords: ["adjustment", "patience", "blend"], tone: "blue", visual: "flowing", themes: ["self-growth", "relationships"] },
  { id: "15-the-devil", number: 15, nameZh: "恶魔", nameEn: "The Devil", assetFile: "15-TheDevil.png", uprightKeywords: ["shadow", "attachment", "materialism"], reversedKeywords: ["awareness", "choice", "release"], tone: "ink", visual: "contrasting", themes: ["financial-planning", "self-growth"] },
  { id: "16-the-tower", number: 16, nameZh: "高塔", nameEn: "The Tower", assetFile: "16-TheTower.png", uprightKeywords: ["upheaval", "revelation", "change"], reversedKeywords: ["rebuild", "grounding", "prepare"], tone: "amber", visual: "striking", themes: ["new-beginnings", "career"] },
  { id: "17-the-star", number: 17, nameZh: "星星", nameEn: "The Star", assetFile: "17-TheStar.png", uprightKeywords: ["hope", "renewal", "inspiration"], reversedKeywords: ["trust", "restore", "patience"], tone: "blue", visual: "sparkling", themes: ["self-growth", "new-beginnings"] },
  { id: "18-the-moon", number: 18, nameZh: "月亮", nameEn: "The Moon", assetFile: "18-TheMoon.png", uprightKeywords: ["intuition", "illusion", "subconscious"], reversedKeywords: ["clarity", "discernment", "ground"], tone: "violet", visual: "misty", themes: ["self-growth", "relationships"] },
  { id: "19-the-sun", number: 19, nameZh: "太阳", nameEn: "The Sun", assetFile: "19-TheSun.png", uprightKeywords: ["joy", "success", "vitality"], reversedKeywords: ["simplicity", "warmth", "rest"], tone: "amber", visual: "radiant", themes: ["new-beginnings", "relationships"] },
  { id: "20-judgement", number: 20, nameZh: "审判", nameEn: "Judgement", assetFile: "20-Judgement.png", uprightKeywords: ["awakening", "calling", "reflection"], reversedKeywords: ["forgiveness", "review", "readiness"], tone: "violet", visual: "resonant", themes: ["self-growth", "career"] },
  { id: "21-the-world", number: 21, nameZh: "世界", nameEn: "The World", assetFile: "21-TheWorld.png", uprightKeywords: ["completion", "wholeness", "integration"], reversedKeywords: ["closure", "continuity", "patience"], tone: "blue", visual: "complete", themes: ["new-beginnings", "self-growth"] },
];

const MINOR_RANKS = [
  { nameEn: "Ace", nameZh: "王牌", visual: "seed", upright: ["seed", "possibility"], reversed: ["hesitation", "untapped"], theme: "new-beginnings" },
  { nameEn: "Two", nameZh: "二", visual: "paired", upright: ["balance", "choice"], reversed: ["indecision", "tension"], theme: "relationships" },
  { nameEn: "Three", nameZh: "三", visual: "layered", upright: ["collaboration", "expression"], reversed: ["misalignment", "scattered"], theme: "relationships" },
  { nameEn: "Four", nameZh: "四", visual: "settled", upright: ["foundation", "pause"], reversed: ["rigidity", "restlessness"], theme: "self-growth" },
  { nameEn: "Five", nameZh: "五", visual: "contrasting", upright: ["challenge", "resilience"], reversed: ["friction", "recovery"], theme: "self-growth" },
  { nameEn: "Six", nameZh: "六", visual: "exchanging", upright: ["exchange", "generosity"], reversed: ["imbalance", "boundaries"], theme: "relationships" },
  { nameEn: "Seven", nameZh: "七", visual: "reflective", upright: ["assessment", "patience"], reversed: ["impatience", "uncertainty"], theme: "career" },
  { nameEn: "Eight", nameZh: "八", visual: "crafted", upright: ["practice", "dedication"], reversed: ["repetition", "overwork"], theme: "career" },
  { nameEn: "Nine", nameZh: "九", visual: "abundant", upright: ["fruition", "independence"], reversed: ["excess", "isolation"], theme: "self-growth" },
  { nameEn: "Ten", nameZh: "十", visual: "complete", upright: ["culmination", "legacy"], reversed: ["pressure", "release"], theme: "financial-planning" },
  { nameEn: "Page", nameZh: "侍从", visual: "curious", upright: ["curiosity", "discovery"], reversed: ["inexperience", "distraction"], theme: "new-beginnings" },
  { nameEn: "Knight", nameZh: "骑士", visual: "moving", upright: ["momentum", "pursuit"], reversed: ["haste", "direction"], theme: "career" },
  { nameEn: "Queen", nameZh: "皇后", visual: "assured", upright: ["stewardship", "confidence"], reversed: ["self-doubt", "boundaries"], theme: "self-growth" },
  { nameEn: "King", nameZh: "国王", visual: "commanding", upright: ["leadership", "responsibility"], reversed: ["control", "accountability"], theme: "financial-planning" },
] as const;

const createMinorCards = (input: {
  readonly suit: "wands" | "cups" | "swords" | "pentacles";
  readonly suitZh: string;
  readonly assetPrefix: "Wands" | "Cups" | "Swords" | "Pentacles";
  readonly tone: MajorCardSeed["tone"];
  readonly visual: string;
  readonly uprightKeywords: readonly string[];
  readonly reversedKeywords: readonly string[];
  readonly themes: readonly string[];
}): readonly TarotCardDefinition[] =>
  MINOR_RANKS.map((rank, index) => ({
    id: `${input.suit}-${String(index + 1).padStart(2, "0")}`,
    number: index + 1,
    nameZh: `${rank.nameZh}${input.suitZh}`,
    nameEn: `${rank.nameEn} of ${input.suit[0]?.toUpperCase()}${input.suit.slice(1)}`,
    assetFile: `${input.assetPrefix}${String(index + 1).padStart(2, "0")}.png`,
    uprightKeywords: [...input.uprightKeywords, ...rank.upright],
    reversedKeywords: [...input.reversedKeywords, ...rank.reversed],
    designTags: tags(input.tone, `${input.visual}-${rank.visual}`, [...input.themes, rank.theme]),
  }));

export const TAROT_CARD_CATALOG: readonly TarotCardDefinition[] = [
  ...MAJOR_SEEDS.map((card) => ({
    id: card.id,
    number: card.number,
    nameZh: card.nameZh,
    nameEn: card.nameEn,
    assetFile: card.assetFile,
    uprightKeywords: card.uprightKeywords,
    reversedKeywords: card.reversedKeywords,
    designTags: tags(card.tone, card.visual, card.themes),
  })),
  ...createMinorCards({ suit: "wands", suitZh: "权杖", assetPrefix: "Wands", tone: "amber", visual: "energetic", uprightKeywords: ["fire", "passion", "creativity"], reversedKeywords: ["pace", "focus", "restraint"], themes: ["career", "new-beginnings"] }),
  ...createMinorCards({ suit: "cups", suitZh: "圣杯", assetPrefix: "Cups", tone: "rose", visual: "flowing", uprightKeywords: ["emotion", "love", "intuition"], reversedKeywords: ["boundaries", "clarity", "restore"], themes: ["relationships", "self-growth"] }),
  ...createMinorCards({ suit: "swords", suitZh: "宝剑", assetPrefix: "Swords", tone: "blue", visual: "precise", uprightKeywords: ["intellect", "truth", "perspective"], reversedKeywords: ["reframe", "calm", "discernment"], themes: ["career", "self-growth"] }),
  ...createMinorCards({ suit: "pentacles", suitZh: "星币", assetPrefix: "Pentacles", tone: "ink", visual: "grounded", uprightKeywords: ["material", "stability", "craft"], reversedKeywords: ["review", "balance", "adapt"], themes: ["financial-planning", "career"] }),
];

export const tarotCardById = (id: string): TarotCardDefinition | undefined =>
  TAROT_CARD_CATALOG.find((card) => card.id === id);
