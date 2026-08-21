/**
 * 塔罗牌目录数据：共 78 张（22 张大阿卡纳 + 56 张小阿卡纳）。
 *
 * 数据约定：
 * 1. id 规则：
 *    - 大阿卡纳："major-{00..21}-{kebab-case 英文名}"，如 "major-00-the-fool" ~ "major-21-the-world"。
 *    - 小阿卡纳："{wands|cups|swords|pentacles}-{01..14}"；1=王牌（Ace），2-10=数字牌，
 *      11=侍从（Page）、12=骑士（Knight）、13=王后（Queen）、14=国王（King）。
 * 2. 花色元素对应（传统四要素）：wands=Fire、cups=Water、swords=Air、pentacles=Earth；
 *    大阿卡纳元素沿用传统对应表，见下方逐张数据。
 * 3. designTags 只允许使用 design-contract 的 canonical taxonomy id（带域前缀）：
 *    - colors：color:white / color:purple / color:pink / color:red / color:orange / color:yellow /
 *      color:green / color:teal / color:blue / color:gray / color:black / color:brown / color:multicolor
 *      （金色调按规范归入 color:yellow，其别名含 gold）。
 *    - visual：texture:*、luster:*、transparency:*、temperature:*、saturation-level:*、
 *      lightness-level:* 六个域内的合法 id。
 *    - themes：emotion:*（情绪域）与 style:*（风格域）内的合法 id。
 * 4. 小阿卡纳关键词按花色主题（wands=热情/创造/行动；cups=情感/直觉/连结；swords=思辨/真相/
 *    冲突；pentacles=物质/事业/稳定）叠加数字程度变化；designTags 的 colors/visual 按数字段位
 *    （1-5 起步 / 6-10 展开 / 11-14 宫廷）微调，宫廷牌的 themes 替换为"花色基调 + 对应情绪"组合。
 * 5. 关键词与 designTags 仅作为"设计灵感 + 情绪意象"的推荐信号；culturalNote 统一保持
 *    "文化意象、仅作设计灵感参考"口径，不得出现医疗、功效承诺或确定性命运类表述。
 */
import type { TarotArcana, TarotCardDefinition } from "./types";

/**
 * 大阿卡纳（22 张，编号 0 愚人 ~ 21 世界），逐张手写。
 * 元素沿用传统对应：愚人=Air、魔术师=Air、女祭司=Water、皇后=Earth、皇帝=Fire、教皇=Earth、
 * 恋人=Air、战车=Water、力量=Fire、隐士=Earth、命运之轮=Water、正义=Air、吊人=Water、
 * 死神=Water、节制=Water、恶魔=Earth、塔=Fire、星星=Water、月亮=Water、太阳=Fire、
 * 审判=Fire、世界=Earth。
 */
const MAJOR_ARCANA: readonly TarotCardDefinition[] = [
  {
    id: "major-00-the-fool",
    nameZh: "愚人",
    nameEn: "The Fool",
    arcana: "major",
    number: 0,
    element: "Air",
    uprightKeywords: ["new beginnings", "spontaneity", "adventure", "openness"],
    reversedKeywords: ["recklessness", "hesitation", "aimlessness"],
    designTags: {
      colors: ["color:yellow", "color:white"],
      visual: ["luster:bright", "lightness-level:high"],
      themes: ["emotion:joy", "emotion:courage", "style:modern"],
    },
    culturalNote:
      "The Fool is read as a design inspiration for fresh, open-hearted beginnings; cultural reference only, not a prediction.",
  },
  {
    id: "major-01-the-magician",
    nameZh: "魔术师",
    nameEn: "The Magician",
    arcana: "major",
    number: 1,
    element: "Air",
    uprightKeywords: ["manifestation", "creativity", "focused skill"],
    reversedKeywords: ["scattered energy", "untapped talent", "illusion"],
    designTags: {
      colors: ["color:purple", "color:white"],
      visual: ["luster:bright", "transparency:translucent"],
      themes: ["emotion:confidence", "emotion:focus", "style:modern"],
    },
    culturalNote:
      "The Magician is read as a design inspiration for focused, inventive compositions; cultural reference only, not a prediction.",
  },
  {
    id: "major-02-the-high-priestess",
    nameZh: "女祭司",
    nameEn: "The High Priestess",
    arcana: "major",
    number: 2,
    element: "Water",
    uprightKeywords: ["intuition", "mystery", "inner voice"],
    reversedKeywords: ["ignored intuition", "hidden depths", "confusion"],
    designTags: {
      colors: ["color:blue", "color:purple"],
      visual: ["transparency:translucent", "lightness-level:low"],
      themes: ["emotion:calm", "emotion:focus", "style:ethereal"],
    },
    culturalNote:
      "The High Priestess is read as a design inspiration for quiet, contemplative palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-03-the-empress",
    nameZh: "皇后",
    nameEn: "The Empress",
    arcana: "major",
    number: 3,
    element: "Earth",
    uprightKeywords: ["abundance", "nurture", "creativity"],
    reversedKeywords: ["smothering", "creative block", "neglected self-care"],
    designTags: {
      colors: ["color:green", "color:pink"],
      visual: ["texture:banded", "saturation-level:high"],
      themes: ["emotion:love", "emotion:vitality", "style:natural"],
    },
    culturalNote:
      "The Empress is read as a design inspiration for lush, nurturing tones; cultural reference only, not a prediction.",
  },
  {
    id: "major-04-the-emperor",
    nameZh: "皇帝",
    nameEn: "The Emperor",
    arcana: "major",
    number: 4,
    element: "Fire",
    uprightKeywords: ["structure", "authority", "stability"],
    reversedKeywords: ["rigidity", "domination", "control issues"],
    designTags: {
      colors: ["color:red", "color:orange"],
      visual: ["luster:bright", "transparency:opaque"],
      themes: ["emotion:confidence", "emotion:protection", "style:modern"],
    },
    culturalNote:
      "The Emperor is read as a design inspiration for structured, authoritative palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-05-the-hierophant",
    nameZh: "教皇",
    nameEn: "The Hierophant",
    arcana: "major",
    number: 5,
    element: "Earth",
    uprightKeywords: ["tradition", "guidance", "shared values"],
    reversedKeywords: ["dogma", "rebellion", "unconventional path"],
    designTags: {
      colors: ["color:red", "color:white"],
      visual: ["texture:banded", "transparency:opaque"],
      themes: ["emotion:grounding", "emotion:protection", "style:vintage"],
    },
    culturalNote:
      "The Hierophant is read as a design inspiration for heritage-inspired pairings; cultural reference only, not a prediction.",
  },
  {
    id: "major-06-the-lovers",
    nameZh: "恋人",
    nameEn: "The Lovers",
    arcana: "major",
    number: 6,
    element: "Air",
    uprightKeywords: ["love", "harmony", "conscious choice"],
    reversedKeywords: ["misalignment", "imbalance", "tension"],
    designTags: {
      colors: ["color:pink", "color:white"],
      visual: ["luster:soft", "lightness-level:high"],
      themes: ["emotion:love", "emotion:connection", "style:romantic"],
    },
    culturalNote:
      "The Lovers is read as a design inspiration for harmonious, affectionate palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-07-the-chariot",
    nameZh: "战车",
    nameEn: "The Chariot",
    arcana: "major",
    number: 7,
    element: "Water",
    uprightKeywords: ["determination", "direction", "willpower"],
    reversedKeywords: ["scattered focus", "resistance", "drift"],
    designTags: {
      colors: ["color:blue", "color:black"],
      visual: ["luster:bright", "transparency:opaque"],
      themes: ["emotion:courage", "emotion:focus", "style:modern"],
    },
    culturalNote:
      "The Chariot is read as a design inspiration for dynamic, forward-moving compositions; cultural reference only, not a prediction.",
  },
  {
    id: "major-08-strength",
    nameZh: "力量",
    nameEn: "Strength",
    arcana: "major",
    number: 8,
    element: "Fire",
    uprightKeywords: ["courage", "patience", "inner strength"],
    reversedKeywords: ["self-doubt", "raw impulse", "insecurity"],
    designTags: {
      colors: ["color:orange", "color:yellow"],
      visual: ["saturation-level:high", "luster:soft"],
      themes: ["emotion:courage", "emotion:vitality", "style:natural"],
    },
    culturalNote:
      "Strength is read as a design inspiration for warm, resilient palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-09-the-hermit",
    nameZh: "隐士",
    nameEn: "The Hermit",
    arcana: "major",
    number: 9,
    element: "Earth",
    uprightKeywords: ["introspection", "solitude", "sought wisdom"],
    reversedKeywords: ["isolation", "withdrawal", "avoidance"],
    designTags: {
      colors: ["color:gray", "color:yellow"],
      visual: ["lightness-level:low", "luster:bright"],
      themes: ["emotion:focus", "emotion:calm", "style:vintage"],
    },
    culturalNote:
      "The Hermit is read as a design inspiration for subdued, reflective palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-10-wheel-of-fortune",
    nameZh: "命运之轮",
    nameEn: "Wheel of Fortune",
    arcana: "major",
    number: 10,
    element: "Water",
    uprightKeywords: ["cycles", "turning point", "adaptability"],
    reversedKeywords: ["resistance to change", "setback", "delay"],
    designTags: {
      colors: ["color:multicolor", "color:blue"],
      visual: ["texture:banded", "luster:bright"],
      themes: ["emotion:renewal", "emotion:hope", "style:vintage"],
    },
    culturalNote:
      "The Wheel of Fortune is read as a design inspiration for cyclical, multicolor accents; cultural reference only, not a prediction.",
  },
  {
    id: "major-11-justice",
    nameZh: "正义",
    nameEn: "Justice",
    arcana: "major",
    number: 11,
    element: "Air",
    uprightKeywords: ["fairness", "truth", "clarity"],
    reversedKeywords: ["bias", "avoidance", "imbalance"],
    designTags: {
      colors: ["color:white", "color:gray"],
      visual: ["transparency:transparent", "luster:bright"],
      themes: ["emotion:focus", "emotion:confidence", "style:minimal"],
    },
    culturalNote:
      "Justice is read as a design inspiration for balanced, precise compositions; cultural reference only, not a prediction.",
  },
  {
    id: "major-12-the-hanged-man",
    nameZh: "吊人",
    nameEn: "The Hanged Man",
    arcana: "major",
    number: 12,
    element: "Water",
    uprightKeywords: ["pause", "new perspective", "release"],
    reversedKeywords: ["stalling", "martyrdom", "stagnation"],
    designTags: {
      colors: ["color:blue", "color:gray"],
      visual: ["transparency:translucent", "lightness-level:low"],
      themes: ["emotion:calm", "emotion:renewal", "style:ethereal"],
    },
    culturalNote:
      "The Hanged Man is read as a design inspiration for inverted, contemplative accents; cultural reference only, not a prediction.",
  },
  {
    id: "major-13-death",
    nameZh: "死神",
    nameEn: "Death",
    arcana: "major",
    number: 13,
    element: "Water",
    uprightKeywords: ["endings", "transformation", "release"],
    reversedKeywords: ["clinging", "resistance", "delayed transition"],
    designTags: {
      colors: ["color:black", "color:white"],
      visual: ["lightness-level:low", "texture:banded"],
      themes: ["emotion:renewal", "emotion:courage", "style:minimal"],
    },
    culturalNote:
      "Death is read as a design inspiration for transitional, high-contrast palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-14-temperance",
    nameZh: "节制",
    nameEn: "Temperance",
    arcana: "major",
    number: 14,
    element: "Water",
    uprightKeywords: ["balance", "moderation", "patience"],
    reversedKeywords: ["excess", "impatience", "discord"],
    designTags: {
      colors: ["color:teal", "color:white"],
      visual: ["transparency:translucent", "luster:soft"],
      themes: ["emotion:calm", "emotion:renewal", "style:ethereal"],
    },
    culturalNote:
      "Temperance is read as a design inspiration for balanced, blended tones; cultural reference only, not a prediction.",
  },
  {
    id: "major-15-the-devil",
    nameZh: "恶魔",
    nameEn: "The Devil",
    arcana: "major",
    number: 15,
    element: "Earth",
    uprightKeywords: ["attachment", "shadow", "temptation"],
    reversedKeywords: ["release", "awakening", "reclaimed freedom"],
    designTags: {
      colors: ["color:black", "color:red"],
      visual: ["luster:bright", "lightness-level:low"],
      themes: ["emotion:courage", "emotion:protection", "style:vintage"],
    },
    culturalNote:
      "The Devil is read as a design inspiration for deep, dramatic palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-16-the-tower",
    nameZh: "塔",
    nameEn: "The Tower",
    arcana: "major",
    number: 16,
    element: "Fire",
    uprightKeywords: ["sudden change", "revelation", "upheaval"],
    reversedKeywords: ["feared change", "delayed disruption", "avoidance"],
    designTags: {
      colors: ["color:red", "color:orange"],
      visual: ["saturation-level:high", "texture:crackled"],
      themes: ["emotion:courage", "emotion:renewal", "style:modern"],
    },
    culturalNote:
      "The Tower is read as a design inspiration for striking, energized accents; cultural reference only, not a prediction.",
  },
  {
    id: "major-17-the-star",
    nameZh: "星星",
    nameEn: "The Star",
    arcana: "major",
    number: 17,
    element: "Water",
    uprightKeywords: ["hope", "renewal", "serenity"],
    reversedKeywords: ["discouragement", "doubt", "dimmed faith"],
    designTags: {
      colors: ["color:blue", "color:white"],
      visual: ["transparency:transparent", "lightness-level:high"],
      themes: ["emotion:hope", "emotion:calm", "style:ethereal"],
    },
    culturalNote:
      "The Star is read as a design inspiration for hopeful, light-filled palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-18-the-moon",
    nameZh: "月亮",
    nameEn: "The Moon",
    arcana: "major",
    number: 18,
    element: "Water",
    uprightKeywords: ["intuition", "dreams", "uncertainty"],
    reversedKeywords: ["clearing illusion", "anxiety", "released fear"],
    designTags: {
      colors: ["color:gray", "color:white"],
      visual: ["transparency:translucent", "texture:included"],
      themes: ["emotion:calm", "emotion:renewal", "style:ethereal"],
    },
    culturalNote:
      "The Moon is read as a design inspiration for dreamlike, softly luminous palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-19-the-sun",
    nameZh: "太阳",
    nameEn: "The Sun",
    arcana: "major",
    number: 19,
    element: "Fire",
    uprightKeywords: ["joy", "vitality", "optimism"],
    reversedKeywords: ["dimmed enthusiasm", "delay", "clouded mood"],
    designTags: {
      colors: ["color:yellow", "color:orange"],
      visual: ["saturation-level:high", "luster:bright"],
      themes: ["emotion:joy", "emotion:vitality", "style:modern"],
    },
    culturalNote:
      "The Sun is read as a design inspiration for radiant, joyful palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-20-judgement",
    nameZh: "审判",
    nameEn: "Judgement",
    arcana: "major",
    number: 20,
    element: "Fire",
    uprightKeywords: ["awakening", "reflection", "renewal"],
    reversedKeywords: ["self-doubt", "avoidance", "harsh self-judgment"],
    designTags: {
      colors: ["color:orange", "color:white"],
      visual: ["luster:bright", "transparency:translucent"],
      themes: ["emotion:renewal", "emotion:hope", "style:ethereal"],
    },
    culturalNote:
      "Judgement is read as a design inspiration for awakening, luminous palettes; cultural reference only, not a prediction.",
  },
  {
    id: "major-21-the-world",
    nameZh: "世界",
    nameEn: "The World",
    arcana: "major",
    number: 21,
    element: "Earth",
    uprightKeywords: ["completion", "wholeness", "integration"],
    reversedKeywords: ["incompletion", "loose ends", "delayed closure"],
    designTags: {
      colors: ["color:green", "color:multicolor"],
      visual: ["texture:banded", "saturation-level:high"],
      themes: ["emotion:joy", "emotion:connection", "style:natural"],
    },
    culturalNote:
      "The World is read as a design inspiration for complete, celebratory palettes; cultural reference only, not a prediction.",
  },
];

/** 小阿卡纳花色种子：命名、元素、文化意象模板句、分段设计画像与逐张关键词表。 */
type MinorSuitSeed = {
  readonly suit: Exclude<TarotArcana, "major">;
  readonly suitZh: string;
  readonly suitEn: string;
  readonly element: TarotCardDefinition["element"];
  /** 花色级文化意象模板句（全花色共用，仅作设计灵感参考）。 */
  readonly culturalNote: string;
  /** 数字牌（1-10）的花色基础 themes（情绪 + 风格基调）。 */
  readonly baseThemes: readonly string[];
  /** 按数字段位微调的 colors 与 visual：索引 0 = 1-5（起步），1 = 6-10（展开），2 = 11-14（宫廷）。 */
  readonly tiers: readonly {
    readonly colors: readonly string[];
    readonly visual: readonly string[];
  }[];
  /** 宫廷牌（11-14）各自 themes：花色基调叠加对应情绪，索引 0 = 侍从，1 = 骑士，2 = 王后，3 = 国王。 */
  readonly courtThemes: readonly [
    readonly string[],
    readonly string[],
    readonly string[],
    readonly string[],
  ];
  /** 逐张关键词（1-14），正/逆位各 3 个，按花色主题叠加数字程度变化。 */
  readonly keywords: readonly {
    readonly upright: readonly string[];
    readonly reversed: readonly string[];
  }[];
};

/** 小阿卡纳中文位阶名：1=王牌、2-10=数字、11-14=宫廷。 */
const MINOR_RANK_ZH: readonly string[] = [
  "王牌",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "侍从",
  "骑士",
  "王后",
  "国王",
];

/** 小阿卡纳英文位阶名：Ace、Two..Ten、Page、Knight、Queen、King。 */
const MINOR_RANK_EN: readonly string[] = [
  "Ace",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Page",
  "Knight",
  "Queen",
  "King",
];

/** 权杖（火）：热情、创造、行动；暖色系 + 活力/勇气 + 现代风。 */
const WANDS_SEED: MinorSuitSeed = {
  suit: "wands",
  suitZh: "权杖",
  suitEn: "Wands",
  element: "Fire",
  culturalNote:
    "Wands imagery is used purely as a design inspiration for warm, energetic palettes; cultural reference only, not a prediction.",
  baseThemes: ["emotion:vitality", "emotion:courage", "style:modern"],
  tiers: [
    {
      colors: ["color:red", "color:orange"],
      visual: ["temperature:warm", "saturation-level:high"],
    },
    {
      colors: ["color:orange", "color:yellow"],
      visual: ["temperature:warm", "luster:bright"],
    },
    {
      colors: ["color:red", "color:yellow"],
      visual: ["temperature:warm", "texture:crackled"],
    },
  ],
  courtThemes: [
    ["emotion:vitality", "emotion:renewal", "style:modern"],
    ["emotion:courage", "emotion:vitality", "style:modern"],
    ["emotion:vitality", "emotion:joy", "style:modern"],
    ["emotion:courage", "emotion:confidence", "style:modern"],
  ],
  keywords: [
    {
      upright: ["inspiration", "new venture", "spark"],
      reversed: ["delay", "hesitation", "scattered energy"],
    },
    {
      upright: ["planning", "vision", "discovery"],
      reversed: ["fear of the unknown", "lack of planning", "held back"],
    },
    {
      upright: ["expansion", "progress", "foresight"],
      reversed: ["delayed growth", "limited view", "obstacles"],
    },
    {
      upright: ["celebration", "homecoming", "harmony"],
      reversed: ["instability", "postponed celebration", "restlessness"],
    },
    {
      upright: ["competition", "friction", "rivalry"],
      reversed: ["avoided conflict", "inner tension", "compromise"],
    },
    {
      upright: ["recognition", "victory", "earned pride"],
      reversed: ["deferred praise", "self-doubt", "ego strain"],
    },
    {
      upright: ["defense", "perseverance", "standing firm"],
      reversed: ["overwhelm", "giving up", "defensiveness"],
    },
    {
      upright: ["momentum", "swiftness", "alignment"],
      reversed: ["delays", "scattered energy", "friction"],
    },
    {
      upright: ["resilience", "boundaries", "endurance"],
      reversed: ["burnout", "guardedness", "fatigue"],
    },
    {
      upright: ["burden", "overload", "responsibility"],
      reversed: ["release", "delegation", "recovering balance"],
    },
    {
      upright: ["curiosity", "exploration", "enthusiasm"],
      reversed: ["restlessness", "flakiness", "scattered focus"],
    },
    {
      upright: ["boldness", "impulse", "adventure"],
      reversed: ["rashness", "frustration", "haste"],
    },
    {
      upright: ["confidence", "warmth", "magnetism"],
      reversed: ["self-doubt", "jealousy", "dimmed warmth"],
    },
    {
      upright: ["leadership", "vision", "bold direction"],
      reversed: ["impulsiveness", "domination", "rigid ego"],
    },
  ],
};

/** 圣杯（水）：情感、直觉、连结；蓝/蓝绿/白 + 爱/连结/平静 + 浪漫风。 */
const CUPS_SEED: MinorSuitSeed = {
  suit: "cups",
  suitZh: "圣杯",
  suitEn: "Cups",
  element: "Water",
  culturalNote:
    "Cups imagery is used purely as a design inspiration for tender, flowing palettes; cultural reference only, not a prediction.",
  baseThemes: ["emotion:love", "emotion:connection", "style:romantic"],
  tiers: [
    {
      colors: ["color:blue", "color:white"],
      visual: ["temperature:cool", "transparency:translucent"],
    },
    {
      colors: ["color:teal", "color:white"],
      visual: ["temperature:cool", "luster:soft"],
    },
    {
      colors: ["color:blue", "color:teal"],
      visual: ["temperature:cool", "transparency:transparent"],
    },
  ],
  courtThemes: [
    ["emotion:connection", "emotion:renewal", "style:romantic"],
    ["emotion:love", "emotion:connection", "style:romantic"],
    ["emotion:love", "emotion:calm", "style:romantic"],
    ["emotion:connection", "emotion:calm", "style:romantic"],
  ],
  keywords: [
    {
      upright: ["new feelings", "openness", "emotional spark"],
      reversed: ["guarded heart", "emotional block", "withdrawal"],
    },
    {
      upright: ["mutual attraction", "partnership", "bond"],
      reversed: ["imbalance", "disconnection", "tension"],
    },
    {
      upright: ["friendship", "community", "celebration"],
      reversed: ["isolation", "overindulgence", "gossip"],
    },
    {
      upright: ["contemplation", "reevaluation", "apathy"],
      reversed: ["acceptance", "new interest", "awakening"],
    },
    {
      upright: ["grief", "loss", "focus on hurt"],
      reversed: ["acceptance", "moving on", "forgiveness"],
    },
    {
      upright: ["nostalgia", "innocence", "reunion"],
      reversed: ["stuck in the past", "idealized memory", "letting go"],
    },
    {
      upright: ["choices", "fantasy", "imagination"],
      reversed: ["clarity", "focus", "reality check"],
    },
    {
      upright: ["walking away", "deeper meaning", "transition"],
      reversed: ["staying put", "fear of leaving", "drift"],
    },
    {
      upright: ["contentment", "satisfaction", "gratitude"],
      reversed: ["hollow pleasure", "unmet wish", "smugness"],
    },
    {
      upright: ["harmony", "shared joy", "alignment"],
      reversed: ["discord", "strained bonds", "unrealistic ideals"],
    },
    {
      upright: ["creative message", "sensitivity", "playfulness"],
      reversed: ["moodiness", "escapism", "blocked intuition"],
    },
    {
      upright: ["romance", "idealism", "grace"],
      reversed: ["moodiness", "empty promises", "escapism"],
    },
    {
      upright: ["compassion", "intuition", "emotional depth"],
      reversed: ["overwhelm", "codependence", "suppressed feeling"],
    },
    {
      upright: ["emotional maturity", "calm authority", "diplomacy"],
      reversed: ["repression", "volatility", "coldness"],
    },
  ],
};

/** 宝剑（风）：思辨、真相、冲突；灰/白/蓝 + 专注/自信 + 极简风。 */
const SWORDS_SEED: MinorSuitSeed = {
  suit: "swords",
  suitZh: "宝剑",
  suitEn: "Swords",
  element: "Air",
  culturalNote:
    "Swords imagery is used purely as a design inspiration for crisp, precise palettes; cultural reference only, not a prediction.",
  baseThemes: ["emotion:focus", "emotion:confidence", "style:minimal"],
  tiers: [
    {
      colors: ["color:gray", "color:white"],
      visual: ["luster:bright", "transparency:transparent"],
    },
    {
      colors: ["color:blue", "color:gray"],
      visual: ["lightness-level:high", "luster:bright"],
    },
    {
      colors: ["color:blue", "color:white"],
      visual: ["luster:matte", "transparency:opaque"],
    },
  ],
  courtThemes: [
    ["emotion:focus", "emotion:renewal", "style:minimal"],
    ["emotion:focus", "emotion:courage", "style:minimal"],
    ["emotion:confidence", "emotion:focus", "style:minimal"],
    ["emotion:confidence", "emotion:grounding", "style:minimal"],
  ],
  keywords: [
    {
      upright: ["clarity", "breakthrough", "truth"],
      reversed: ["confusion", "clouded judgment", "misinformation"],
    },
    {
      upright: ["stalemate", "difficult choice", "avoidance"],
      reversed: ["decision made", "revealed truth", "broken deadlock"],
    },
    {
      upright: ["heartbreak", "painful truth", "grief"],
      reversed: ["healing", "release", "forgiveness"],
    },
    {
      upright: ["rest", "recovery", "contemplation"],
      reversed: ["burnout", "restlessness", "forced pause"],
    },
    {
      upright: ["conflict", "hollow victory", "tension"],
      reversed: ["reconciliation", "lingering resentment", "letting go"],
    },
    {
      upright: ["transition", "moving on", "calmer waters"],
      reversed: ["resistance to change", "unfinished business", "reluctance"],
    },
    {
      upright: ["strategy", "stealth", "deception"],
      reversed: ["exposure", "coming clean", "conscience"],
    },
    {
      upright: ["restriction", "self-imposed limits", "feeling trapped"],
      reversed: ["release", "new perspective", "reclaimed agency"],
    },
    {
      upright: ["anxiety", "worry", "sleeplessness"],
      reversed: ["relief", "facing fear", "support"],
    },
    {
      upright: ["ending", "betrayal", "collapse"],
      reversed: ["recovery", "worst is past", "renewal"],
    },
    {
      upright: ["curiosity", "vigilance", "new ideas"],
      reversed: ["gossip", "haste", "scattered thoughts"],
    },
    {
      upright: ["ambition", "fast action", "directness"],
      reversed: ["impulsiveness", "aggression", "burnout"],
    },
    {
      upright: ["clear boundaries", "objectivity", "independent thought"],
      reversed: ["coldness", "harsh judgment", "bitterness"],
    },
    {
      upright: ["intellect", "authority", "truth"],
      reversed: ["dogma", "coldness", "misused logic"],
    },
  ],
};

/**
 * 星币（土）：物质、事业、稳定；绿/棕/金（金按规范归入 color:yellow）
 * + 沉稳/守护 + 自然风。
 */
const PENTACLES_SEED: MinorSuitSeed = {
  suit: "pentacles",
  suitZh: "星币",
  suitEn: "Pentacles",
  element: "Earth",
  culturalNote:
    "Pentacles imagery is used purely as a design inspiration for earthy, grounded palettes; cultural reference only, not a prediction.",
  baseThemes: ["emotion:grounding", "emotion:protection", "style:natural"],
  tiers: [
    {
      colors: ["color:green", "color:brown"],
      visual: ["texture:veined", "luster:matte"],
    },
    {
      colors: ["color:green", "color:yellow"],
      visual: ["texture:speckled", "luster:soft"],
    },
    {
      colors: ["color:brown", "color:yellow"],
      visual: ["texture:banded", "luster:bright"],
    },
  ],
  courtThemes: [
    ["emotion:grounding", "emotion:renewal", "style:natural"],
    ["emotion:grounding", "emotion:vitality", "style:natural"],
    ["emotion:grounding", "emotion:love", "style:natural"],
    ["emotion:grounding", "emotion:protection", "style:natural"],
  ],
  keywords: [
    {
      upright: ["opportunity", "seed of stability", "new resource"],
      reversed: ["missed chance", "instability", "scarcity mindset"],
    },
    {
      upright: ["balance", "adaptability", "juggling"],
      reversed: ["overwhelm", "dropped priorities", "disarray"],
    },
    {
      upright: ["teamwork", "craft", "collaboration"],
      reversed: ["misalignment", "poor planning", "ego friction"],
    },
    {
      upright: ["security", "saving", "control"],
      reversed: ["hoarding", "letting go", "loosened grip"],
    },
    {
      upright: ["hardship", "exclusion", "worry"],
      reversed: ["recovery", "support arrives", "improving outlook"],
    },
    {
      upright: ["generosity", "exchange", "fairness"],
      reversed: ["imbalance", "strings attached", "dependence"],
    },
    {
      upright: ["patience", "long-term view", "investment"],
      reversed: ["impatience", "wasted effort", "short-term thinking"],
    },
    {
      upright: ["mastery", "diligence", "skill-building"],
      reversed: ["perfectionism", "cutting corners", "drudgery"],
    },
    {
      upright: ["self-sufficiency", "refinement", "reward"],
      reversed: ["overwork", "loneliness", "dependence"],
    },
    {
      upright: ["legacy", "lasting wealth", "foundation"],
      reversed: ["family strain", "short-term focus", "instability"],
    },
    {
      upright: ["study", "new skill", "manifestation"],
      reversed: ["procrastination", "distraction", "unrealistic plan"],
    },
    {
      upright: ["reliability", "routine", "steady effort"],
      reversed: ["stagnation", "boredom", "stubbornness"],
    },
    {
      upright: ["nurture", "practicality", "abundance"],
      reversed: ["over-giving", "neglected self-care", "worry"],
    },
    {
      upright: ["prosperity", "stewardship", "reliability"],
      reversed: ["rigidity", "materialism", "control"],
    },
  ],
};

/** 依据花色种子生成该花色 14 张小阿卡纳牌面定义。 */
function buildMinorSuitCards(seed: MinorSuitSeed): readonly TarotCardDefinition[] {
  return seed.keywords.map((keywords, index): TarotCardDefinition => {
    const number = index + 1;
    const tier = seed.tiers[number <= 5 ? 0 : number <= 10 ? 1 : 2]!;
    const themes = number >= 11 ? seed.courtThemes[number - 11]! : seed.baseThemes;
    return {
      id: `${seed.suit}-${String(number).padStart(2, "0")}`,
      nameZh: `${seed.suitZh}${MINOR_RANK_ZH[index]!}`,
      nameEn: `${MINOR_RANK_EN[index]!} of ${seed.suitEn}`,
      arcana: seed.suit,
      number,
      element: seed.element,
      uprightKeywords: [...keywords.upright],
      reversedKeywords: [...keywords.reversed],
      designTags: {
        colors: [...tier.colors],
        visual: [...tier.visual],
        themes: [...themes],
      },
      culturalNote: seed.culturalNote,
    };
  });
}

/** 小阿卡纳（56 张）：权杖 / 圣杯 / 宝剑 / 星币 各 14 张。 */
const MINOR_ARCANA: readonly TarotCardDefinition[] = [
  ...buildMinorSuitCards(WANDS_SEED),
  ...buildMinorSuitCards(CUPS_SEED),
  ...buildMinorSuitCards(SWORDS_SEED),
  ...buildMinorSuitCards(PENTACLES_SEED),
];

/** 塔罗牌全目录（78 张）：22 张大阿卡纳 + 56 张小阿卡纳，按目录顺序排列。 */
export const TAROT_CARDS: readonly TarotCardDefinition[] = [
  ...MAJOR_ARCANA,
  ...MINOR_ARCANA,
];

/** id -> 牌面定义索引，供 getTarotCardById 做 O(1) 查找。 */
const CARD_INDEX: ReadonlyMap<string, TarotCardDefinition> = new Map(
  TAROT_CARDS.map((card) => [card.id, card])
);

/** 按 id 精确查找塔罗牌定义；未命中时返回 null。 */
export function getTarotCardById(id: string): TarotCardDefinition | null {
  return CARD_INDEX.get(id) ?? null;
}

/** 按阿卡纳（major 或四个花色之一）列出全部牌面，保持目录顺序。 */
export function listTarotCardsByArcana(arcana: TarotArcana): readonly TarotCardDefinition[] {
  return TAROT_CARDS.filter((card) => card.arcana === arcana);
}
