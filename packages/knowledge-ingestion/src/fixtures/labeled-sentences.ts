import type {
  ExtractionRelation,
  KnowledgeType
} from "@mystcrag/design-contract";

/**
 * Labeled sentence set for extraction quality regression (Quality Phase Q2).
 * 40 positives — at least three per canonical relation, bilingual — plus 10
 * negatives (subjects or plain prose without any relation signal) that keep
 * precision honest. `bench:extraction` and tests/extraction-eval.test.ts run
 * extractors over this set; the pattern extractor's baseline is F1 = 1.00 by
 * construction (the set is authored against the pattern vocabulary), so any
 * drop below it is a regression, and the same set scores future semantic
 * extractors on identical ground truth.
 */
export type LabeledSentence = {
  id: string;
  sentence: string;
  expected?: { knowledgeType: KnowledgeType; relation: ExtractionRelation };
};

export const LABELED_SENTENCES: readonly LabeledSentence[] = [
  // pairs-well-with
  { id: "pw-01", sentence: "Amethyst purple pairs well with citrine yellow on the color wheel.", expected: { knowledgeType: "COLOR_THEORY", relation: "pairs-well-with" } },
  { id: "pw-02", sentence: "紫水晶搭配月光长石非常协调。", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "pairs-well-with" } },
  { id: "pw-03", sentence: "Quartz pairs gently with rhodonite in one strand.", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "pairs-well-with" } },
  { id: "pw-04", sentence: "蓝与蓝绿在色环上相邻，搭配起来很和谐。", expected: { knowledgeType: "COLOR_THEORY", relation: "pairs-well-with" } },
  { id: "pw-05", sentence: "Turquoise beads complement silver spacers nicely.", expected: { knowledgeType: "COLOR_THEORY", relation: "pairs-well-with" } },
  { id: "pw-06", sentence: "粉水晶和黄水晶串在一条手串里可以很协调。", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "pairs-well-with" } },
  // conflicts-with
  { id: "cf-01", sentence: "一条手串不宜同时出现多个抢眼的焦点。", expected: { knowledgeType: "NEGATIVE_RULE", relation: "conflicts-with" } },
  { id: "cf-02", sentence: "黄铁矿与较软的玉石串在一起容易被刮花，不宜混串。", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "conflicts-with" } },
  { id: "cf-03", sentence: "大红与大绿并置容易冲突。", expected: { knowledgeType: "COLOR_THEORY", relation: "conflicts-with" } },
  { id: "cf-04", sentence: "Labradorite clashes with too many flashy focal beads.", expected: { knowledgeType: "NEGATIVE_RULE", relation: "conflicts-with" } },
  // avoid-exposure
  { id: "ae-01", sentence: "Selenite 避免接触水，遇水会溶解雾化。", expected: { knowledgeType: "NEGATIVE_RULE", relation: "avoid-exposure" } },
  { id: "ae-02", sentence: "Amethyst should avoid sunlight to keep its purple saturation.", expected: { knowledgeType: "NEGATIVE_RULE", relation: "avoid-exposure" } },
  { id: "ae-03", sentence: "萤石忌长期暴晒与高温。", expected: { knowledgeType: "NEGATIVE_RULE", relation: "avoid-exposure" } },
  { id: "ae-04", sentence: "Turquoise jewelry should avoid chemicals and ultrasonic cleaners.", expected: { knowledgeType: "NEGATIVE_RULE", relation: "avoid-exposure" } },
  // care-instruction
  { id: "ci-01", sentence: "月光长石日常保养用软布轻拭并单独存放。", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "care-instruction" } },
  { id: "ci-02", sentence: "银饰清洁后应彻底擦干再收纳。", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "care-instruction" } },
  { id: "ci-03", sentence: "Store jade bracelets in separate pouches to prevent scratches.", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "care-instruction" } },
  { id: "ci-04", sentence: "石榴石手串每年换线一次。", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "care-instruction" } },
  { id: "ci-05", sentence: "青金石需要定期用软布清洁。", expected: { knowledgeType: "MATERIAL_COMPATIBILITY", relation: "care-instruction" } },
  // symbolizes
  { id: "sy-01", sentence: "透明石英象征纯净与清明。", expected: { knowledgeType: "CULTURAL_SYMBOLISM", relation: "symbolizes" } },
  { id: "sy-02", sentence: "Clear quartz symbolizes clarity and pure intention.", expected: { knowledgeType: "CULTURAL_SYMBOLISM", relation: "symbolizes" } },
  { id: "sy-03", sentence: "黑曜石在许多文化中寓意守护与辟邪。", expected: { knowledgeType: "CULTURAL_SYMBOLISM", relation: "symbolizes" } },
  { id: "sy-04", sentence: "The Moon card stands for illusion and the subconscious.", expected: { knowledgeType: "CULTURAL_SYMBOLISM", relation: "symbolizes" } },
  // suits-style
  { id: "ss-01", sentence: "银隔珠极简风格适合日常叠戴。", expected: { knowledgeType: "STYLE_RULE", relation: "suits-style" } },
  { id: "ss-02", sentence: "Baroque pearls suit a vintage aesthetic.", expected: { knowledgeType: "STYLE_RULE", relation: "suits-style" } },
  { id: "ss-03", sentence: "黄铜隔珠很适配波西米亚风。", expected: { knowledgeType: "STYLE_RULE", relation: "suits-style" } },
  { id: "ss-04", sentence: "Minimal chains match the delicate fine-jewelry style.", expected: { knowledgeType: "STYLE_RULE", relation: "suits-style" } },
  // proportion-of
  { id: "po-01", sentence: "主石与陪衬珠的比例接近黄金比例最耐看。", expected: { knowledgeType: "PROPORTION_RULE", relation: "proportion-of" } },
  { id: "po-02", sentence: "焦点珠 sizing anchors the proportion of the whole strand.", expected: { knowledgeType: "FOCAL_RULE", relation: "proportion-of" } },
  { id: "po-03", sentence: "主珠、隔珠与焦点珠的组合需要考虑整体比例。", expected: { knowledgeType: "COMPOSITION_RULE", relation: "proportion-of" } },
  { id: "po-04", sentence: "The 8mm focal bead anchors the proportion of the design.", expected: { knowledgeType: "FOCAL_RULE", relation: "proportion-of" } },
  // transitions-to
  { id: "tr-01", sentence: "直径渐变过渡让整串视觉更顺滑。", expected: { knowledgeType: "TRANSITION_RULE", relation: "transitions-to" } },
  { id: "tr-02", sentence: "Use a diameter gradient to transition between sections.", expected: { knowledgeType: "TRANSITION_RULE", relation: "transitions-to" } },
  { id: "tr-03", sentence: "4-5-6-8-6-5-4mm 的尺寸渐变是一种经典排布。", expected: { knowledgeType: "TRANSITION_RULE", relation: "transitions-to" } },
  { id: "tr-04", sentence: "珠径从大到小的过渡在扣头处收尾更自然。", expected: { knowledgeType: "TRANSITION_RULE", relation: "transitions-to" } },
  // trending-in
  { id: "ti-01", sentence: "莫兰迪灰粉手串今年在年轻群体中流行度上升。", expected: { knowledgeType: "MARKET_OBSERVATION", relation: "trending-in" } },
  { id: "ti-02", sentence: "多圈叠戴的 minimal 风格在社交媒体上持续走红。", expected: { knowledgeType: "MARKET_OBSERVATION", relation: "trending-in" } },
  { id: "ti-03", sentence: "Bridal bead pieces dominate wedding-season demand this year.", expected: { knowledgeType: "MARKET_OBSERVATION", relation: "trending-in" } },
  { id: "ti-04", sentence: "虎眼石手串的搜索量最近有明显上升趋势。", expected: { knowledgeType: "MARKET_OBSERVATION", relation: "trending-in" } },
  { id: "ti-05", sentence: "复古金色链条今年在婚庆市场很流行。", expected: { knowledgeType: "MARKET_OBSERVATION", relation: "trending-in" } },
  // negatives: subjects or prose without any relation signal
  { id: "ng-01", sentence: "Purple amethyst and blue lapis sit quietly on the shelf." },
  { id: "ng-02", sentence: "今天天气很好。" },
  { id: "ng-03", sentence: "The museum opens at nine in the morning." },
  { id: "ng-04", sentence: "石英的莫氏硬度是七。" },
  { id: "ng-05", sentence: "作者在这一章回顾了色彩研究的历史脉络。" },
  { id: "ng-06", sentence: "She wore her favorite bracelet to the party." },
  { id: "ng-07", sentence: "这条手串一共二十一颗珠子。" },
  { id: "ng-08", sentence: "月光长石产于斯里兰卡和马达加斯加。" },
  { id: "ng-09", sentence: "Both beads are six millimeters in diameter." },
  { id: "ng-10", sentence: "包装礼盒与保修卡随附在盒内。" }
];

export function relationCoverage(
  sentences: readonly LabeledSentence[]
): Partial<Record<ExtractionRelation, number>> {
  const coverage: Partial<Record<ExtractionRelation, number>> = {};
  for (const entry of sentences) {
    if (entry.expected === undefined) continue;
    coverage[entry.expected.relation] = (coverage[entry.expected.relation] ?? 0) + 1;
  }
  return coverage;
}
