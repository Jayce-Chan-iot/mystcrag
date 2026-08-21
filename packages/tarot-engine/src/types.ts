/**
 * 塔罗引擎公共类型定义。
 *
 * 数据约定：
 * - TarotArcana 覆盖大阿卡纳（major）与四个小阿卡纳花色（wands/cups/swords/pentacles），
 *   花色与四要素一一对应：wands=Fire、cups=Water、swords=Air、pentacles=Earth。
 * - designTags 各字段取值必须严格使用 design-contract 的 canonical taxonomy id（带域前缀），
 *   不得自造 id；金色调按规范归入 color:yellow（其别名含 gold）。
 * - culturalNote 仅描述文化意象，口径为"仅作设计灵感参考"；
 *   不得出现医疗、功效承诺或确定性命运类表述。
 */
export type TarotArcana = "major" | "wands" | "cups" | "swords" | "pentacles";
export type TarotOrientation = "UPRIGHT" | "REVERSED";

export type TarotDesignTags = {
  /** Canonical color taxonomy ids, e.g. "color:blue" (subset of color:white/purple/pink/red/orange/yellow/green/teal/blue/gray/black/brown/multicolor). */
  colors: string[];
  /** Visual taxonomy ids from the texture:*, luster:*, transparency:*, temperature:*, saturation-level:*, lightness-level:* domains. */
  visual: string[];
  /** Emotion taxonomy ids (emotion:calm/focus/confidence/joy/connection/renewal/hope/love/courage/grounding/vitality/protection) and/or style taxonomy ids (style:minimal/eastern-contemporary/romantic/natural/modern/vintage/ethereal/delicate). */
  themes: string[];
};

export type TarotCardDefinition = {
  id: string;
  nameZh: string;
  nameEn: string;
  arcana: TarotArcana;
  number: number;
  element: "Fire" | "Water" | "Air" | "Earth";
  uprightKeywords: string[];
  reversedKeywords: string[];
  designTags: TarotDesignTags;
  /** Cultural imagery note; must stay design-inspiration-only, never a fortune/effect claim. */
  culturalNote: string;
};
