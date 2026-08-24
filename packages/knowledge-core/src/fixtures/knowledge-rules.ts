import { createHash } from "node:crypto";

import type { KnowledgeRule } from "@mystcrag/design-contract";

export type KnowledgeRuleSeed = KnowledgeRule & { sourceId: string };

const FIXTURE_TIMESTAMP = "2026-08-20T08:00:00+08:00";

const HANDBOOK_SOURCE_REF = {
  sourceId: "source-fixture-handbook",
  documentId: "doc-fixture-handbook"
} as const;

const MARKET_SOURCE_REF = {
  sourceId: "source-fixture-market",
  documentId: "doc-fixture-market"
} as const;

type FixtureRuleInput = {
  readonly id: string;
  readonly knowledgeType: KnowledgeRule["knowledgeType"];
  readonly knowledgeDomain: KnowledgeRule["knowledgeDomain"];
  readonly subject: string;
  readonly relation: string;
  readonly payload: KnowledgeRule["payload"];
  readonly confidence: number;
  readonly conditions?: KnowledgeRule["conditions"];
  readonly includeMarketSource?: boolean;
};

function fixtureRule(input: FixtureRuleInput): KnowledgeRuleSeed {
  return {
    id: input.id,
    knowledgeType: input.knowledgeType,
    knowledgeDomain: input.knowledgeDomain,
    subject: input.subject,
    relation: input.relation,
    payload: input.payload,
    conditions: input.conditions ?? {},
    confidence: input.confidence,
    status: "APPROVED",
    sourceRefs:
      input.includeMarketSource === true
        ? [HANDBOOK_SOURCE_REF, MARKET_SOURCE_REF]
        : [HANDBOOK_SOURCE_REF],
    version: 1,
    fingerprint: createHash("sha256").update(`a1${input.id}`).digest("hex"),
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    sourceId: HANDBOOK_SOURCE_REF.sourceId
  };
}

export const KNOWLEDGE_RULE_FIXTURES: readonly KnowledgeRuleSeed[] = [
  // COLOR_THEORY — 邻近色和谐
  fixtureRule({
    id: "krule-color-01",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:blue",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:teal"],
      rule: "analogous-harmony",
      note: "蓝与蓝绿为色环邻近色，相邻排列形成和谐渐变"
    },
    confidence: 0.9
  }),
  fixtureRule({
    id: "krule-color-02",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:teal",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:blue", "color:green"],
      rule: "analogous-harmony",
      note: "蓝绿可向蓝或绿两侧延展，保持邻近色和谐"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-color-03",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:purple",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:blue"],
      rule: "analogous-harmony",
      note: "紫与蓝相邻排列呈现宁静的冷色渐变"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-color-04",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:pink",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:red"],
      rule: "analogous-harmony",
      note: "粉与红为邻近暖色，适合浪漫主题的渐变过渡"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-color-05",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:red",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:orange"],
      rule: "analogous-harmony",
      note: "红与橙相邻暖色过渡自然，适合活力主题"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-color-06",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:orange",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:yellow"],
      rule: "analogous-harmony",
      note: "橙与黄相邻排列呈现日暖氛围"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-color-07",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:green",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:teal"],
      rule: "analogous-harmony",
      note: "绿与蓝绿相邻形成自然系过渡"
    },
    confidence: 0.87
  }),
  fixtureRule({
    id: "krule-color-08",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:gray",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:white", "color:black"],
      rule: "neutral-gradation",
      note: "灰介于黑白的明度梯度，可作中性过渡"
    },
    confidence: 0.82
  }),
  // COLOR_THEORY — 互补对比
  fixtureRule({
    id: "krule-color-09",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:blue",
    relation: "contrasts-with",
    payload: {
      companionColors: ["color:orange"],
      rule: "complementary-contrast",
      note: "蓝橙互补对比鲜明，适合作为焦点强调"
    },
    confidence: 0.9
  }),
  fixtureRule({
    id: "krule-color-10",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:orange",
    relation: "contrasts-with",
    payload: {
      companionColors: ["color:blue"],
      rule: "complementary-contrast",
      note: "橙蓝互补，建议控制对比面积避免冲突"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-color-11",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:purple",
    relation: "contrasts-with",
    payload: {
      companionColors: ["color:yellow"],
      rule: "complementary-contrast",
      note: "紫黄互补对比强烈，宜以小面积点缀"
    },
    confidence: 0.87
  }),
  fixtureRule({
    id: "krule-color-12",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:yellow",
    relation: "contrasts-with",
    payload: {
      companionColors: ["color:purple"],
      rule: "complementary-contrast",
      note: "黄紫互补，黄色宜作辅珠点缀紫色主珠"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-color-13",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:red",
    relation: "contrasts-with",
    payload: {
      companionColors: ["color:green"],
      rule: "complementary-contrast",
      note: "红绿互补对比强烈，建议降低其中一方的饱和度"
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-color-14",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:green",
    relation: "contrasts-with",
    payload: {
      companionColors: ["color:red"],
      rule: "complementary-contrast",
      note: "绿红互补节日感强，日常搭配需谨慎控制比例"
    },
    confidence: 0.8
  }),
  // COLOR_THEORY — 温度统一
  fixtureRule({
    id: "krule-color-15",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "temperature:cool",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:blue", "color:teal", "color:purple"],
      rule: "temperature-unity",
      note: "冷色系统一温度，蓝、蓝绿、紫可自由组合"
    },
    confidence: 0.9
  }),
  fixtureRule({
    id: "krule-color-16",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "temperature:warm",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:red", "color:orange", "color:yellow"],
      rule: "temperature-unity",
      note: "暖色系统一温度，红橙黄组合呈现温暖氛围"
    },
    confidence: 0.9
  }),
  fixtureRule({
    id: "krule-color-17",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "temperature:neutral",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:white", "color:gray", "color:brown"],
      rule: "temperature-unity",
      note: "中性色黑白灰棕可与任意温度色系搭配"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-color-18",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "temperature:cool",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:white", "color:teal"],
      rule: "cool-light-palette",
      note: "冷色与高明度白组合呈现清透浅色系，适合空灵风格"
    },
    confidence: 0.85,
    conditions: { appliesToStyleTags: ["style:ethereal"] }
  }),
  fixtureRule({
    id: "krule-color-19",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "temperature:warm",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:brown", "color:orange"],
      rule: "warm-earth-palette",
      note: "暖色与大地棕组合呈现秋日暖调"
    },
    confidence: 0.84
  }),
  // COLOR_THEORY — 低饱和搭配
  fixtureRule({
    id: "krule-color-20",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:purple",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:gray"],
      rule: "low-saturation-pairs-with-neutral",
      note: "低饱和紫（雾紫、灰紫）与灰色搭配柔和耐看"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-color-21",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:pink",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:gray"],
      rule: "low-saturation-pairs-with-neutral",
      note: "低饱和粉与灰色搭配避免甜腻感"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-color-22",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:blue",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:gray"],
      rule: "low-saturation-pairs-with-neutral",
      note: "低饱和蓝（雾霾蓝）与灰色搭配沉稳干净"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-color-23",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:green",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:gray"],
      rule: "low-saturation-pairs-with-neutral",
      note: "低饱和绿（灰绿）与灰色搭配自然雅致"
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-color-24",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:teal",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:gray", "color:white"],
      rule: "low-saturation-pairs-with-neutral",
      note: "低饱和蓝绿与灰白中性色搭配清爽干净"
    },
    confidence: 0.84
  }),
  // COLOR_THEORY — 无彩色与多色锚定
  fixtureRule({
    id: "krule-color-25",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:black",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:gray", "color:white"],
      rule: "monochrome-gradation",
      note: "黑白灰明度渐变构成无彩色层次"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-color-26",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:multicolor",
    relation: "harmonizes-with",
    payload: {
      companionColors: ["color:white", "color:gray"],
      rule: "multicolor-anchored-by-neutral",
      note: "多色珠需以白或灰中性色锚定，避免视觉杂乱"
    },
    confidence: 0.82
  }),
  // MATERIAL_COMPATIBILITY — 硬度相近
  fixtureRule({
    id: "krule-material-01",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:quartz",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:feldspar"],
      rule: "hardness-adjacent-compatibility",
      note: "石英莫氏硬度约 7，与长石（6-6.5）接近，相邻佩戴磨损风险低"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-material-02",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:quartz",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:chalcedony"],
      rule: "silica-family-compatibility",
      note: "石英与玉髓同属二氧化硅家族，质感与硬度相容"
    },
    confidence: 0.9
  }),
  fixtureRule({
    id: "krule-material-03",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:beryl",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:quartz", "material:topaz"],
      rule: "hardness-adjacent-compatibility",
      note: "绿柱石（7.5-8）与托帕石（8）、石英（7）硬度接近，适合相邻排布"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-material-04",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:chalcedony",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:agate"],
      rule: "silica-family-compatibility",
      note: "玛瑙是玉髓的条带变种，两者搭配质感统一"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-material-05",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:garnet",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:quartz"],
      rule: "hardness-adjacent-compatibility",
      note: "石榴石族硬度 6.5-7.5，与石英相邻磨损风险低"
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-material-06",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:tourmaline",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:quartz"],
      rule: "hardness-adjacent-compatibility",
      note: "碧玺硬度 7-7.5，与石英相邻排布相容"
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-material-07",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:jade",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:chalcedony", "material:quartz"],
      rule: "hardness-adjacent-compatibility",
      note: "玉石硬度 6-7，与玉髓、石英相邻整体耐用"
    },
    confidence: 0.82
  }),
  // MATERIAL_COMPATIBILITY — 金属配件搭配
  fixtureRule({
    id: "krule-material-08",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:quartz",
    relation: "pairs-with",
    payload: {
      companionMaterials: ["material:sterling-silver"],
      rule: "cool-materials-pair-with-silver",
      note: "清透冷色水晶与纯银配件搭配协调统一"
    },
    confidence: 0.9
  }),
  fixtureRule({
    id: "krule-material-09",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:topaz",
    relation: "pairs-with",
    payload: {
      companionMaterials: ["material:sterling-silver"],
      rule: "cool-materials-pair-with-silver",
      note: "蓝色系托帕石与银色金属配件冷调统一"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-material-10",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:lapis-lazuli",
    relation: "pairs-with",
    payload: {
      companionMaterials: ["material:sterling-silver"],
      rule: "cool-materials-pair-with-silver",
      note: "青金石深蓝与纯银配件是经典搭配"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-material-11",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:obsidian",
    relation: "pairs-with",
    payload: {
      companionMaterials: ["material:sterling-silver"],
      rule: "modern-contrast-pairing",
      note: "黑曜石哑光黑与抛光银形成现代感对比"
    },
    confidence: 0.85,
    conditions: { appliesToStyleTags: ["style:modern"] }
  }),
  // MATERIAL_COMPATIBILITY — 软石保护性设置
  fixtureRule({
    id: "krule-material-12",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:fluorite",
    relation: "requires-protective-setting",
    payload: {
      companionMaterials: ["material:sterling-silver"],
      rule: "soft-stone-requires-spacer",
      note: "萤石莫氏硬度仅约 4，与高硬度主珠相邻时需以银隔珠分隔防止刮伤"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-material-13",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:calcite",
    relation: "requires-protective-setting",
    payload: {
      companionMaterials: ["material:sterling-silver"],
      rule: "soft-stone-requires-spacer",
      note: "方解石莫氏硬度约 3，必须以隔珠与高硬度材质分隔"
    },
    confidence: 0.85
  }),
  // MATERIAL_COMPATIBILITY — 其他搭配
  fixtureRule({
    id: "krule-material-14",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:hematite",
    relation: "pairs-with",
    payload: {
      companionMaterials: ["material:sterling-silver"],
      rule: "metallic-luster-pairing",
      note: "赤铁矿金属灰光泽与银配件光泽呼应"
    },
    confidence: 0.8
  }),
  fixtureRule({
    id: "krule-material-15",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:rhodonite",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:chalcedony"],
      rule: "soft-contrast-pairing",
      note: "蔷薇辉石粉红与白玉髓形成柔和的明度对比"
    },
    confidence: 0.8
  }),
  fixtureRule({
    id: "krule-material-16",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:agate",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:jade"],
      rule: "eastern-classic-pairing",
      note: "玛瑙与玉石搭配常见于东方当代风格"
    },
    confidence: 0.82,
    conditions: { appliesToStyleTags: ["style:eastern-contemporary"] }
  }),
  fixtureRule({
    id: "krule-material-17",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:pyrite",
    relation: "pairs-with",
    payload: {
      companionMaterials: ["material:obsidian"],
      rule: "bold-contrast-pairing",
      note: "黄铁矿金色光泽点缀黑曜石，形成大胆的现代对比"
    },
    confidence: 0.78,
    conditions: { appliesToStyleTags: ["style:modern"] }
  }),
  fixtureRule({
    id: "krule-material-18",
    knowledgeType: "MATERIAL_COMPATIBILITY",
    knowledgeDomain: "knowledge-domain:material-compatibility",
    subject: "material:feldspar",
    relation: "compatible-with",
    payload: {
      companionMaterials: ["material:chalcedony"],
      rule: "hardness-adjacent-compatibility",
      note: "长石（6-6.5）与玉髓（6.5-7）硬度接近，相邻排布耐用"
    },
    confidence: 0.83
  }),
  // STYLE_RULE
  fixtureRule({
    id: "krule-style-01",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "style:minimal",
    relation: "prefers-materials",
    payload: {
      prefers: ["material:quartz", "material:sterling-silver"],
      rule: "minimal-material-restraint",
      note: "极简风格建议控制在 3 种材质以内，以清透石英与纯银为主",
      constraints: { maxMaterialCount: 3 }
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-style-02",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "style:ethereal",
    relation: "prefers-colors",
    payload: {
      prefers: ["color:white", "color:blue", "transparency:transparent"],
      rule: "ethereal-light-cool",
      note: "空灵风格偏好白色与蓝色系浅色，并搭配透明质感珠体",
      constraints: {}
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-style-03",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "emotion:calm",
    relation: "prefers-temperature",
    payload: {
      prefers: ["temperature:cool"],
      rule: "calm-cool-palette",
      note: "平静主题偏好冷色系统一温度",
      constraints: {}
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-style-04",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "emotion:vitality",
    relation: "prefers-temperature",
    payload: {
      prefers: ["temperature:warm"],
      rule: "vitality-warm-palette",
      note: "活力主题偏好暖色系统一温度",
      constraints: {}
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-style-05",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "emotion:grounding",
    relation: "prefers-colors",
    payload: {
      prefers: ["color:brown", "color:black", "color:gray"],
      rule: "grounding-earth-palette",
      note: "沉稳安定主题偏好大地色与深色系",
      constraints: {}
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-style-06",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "emotion:love",
    relation: "prefers-colors",
    payload: {
      prefers: ["color:pink", "color:red"],
      rule: "love-warm-pink",
      note: "爱意主题偏好粉红色系暖调",
      constraints: {}
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-style-07",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "emotion:hope",
    relation: "prefers-colors",
    payload: {
      prefers: ["color:green", "color:teal"],
      rule: "hope-fresh-green",
      note: "希望主题偏好清新的绿与蓝绿色系",
      constraints: {}
    },
    confidence: 0.82
  }),
  fixtureRule({
    id: "krule-style-08",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "emotion:courage",
    relation: "prefers-colors",
    payload: {
      prefers: ["color:red", "color:orange"],
      rule: "courage-bold-warm",
      note: "勇气主题偏好饱和暖色表达力量感",
      constraints: {}
    },
    confidence: 0.82
  }),
  fixtureRule({
    id: "krule-style-09",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "style:vintage",
    relation: "prefers-materials",
    payload: {
      prefers: ["material:jade", "material:agate", "material:garnet"],
      rule: "vintage-classic-materials",
      note: "复古风格偏好玉石、玛瑙、石榴石等经典材质",
      constraints: {}
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-style-10",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "style:romantic",
    relation: "prefers-colors",
    payload: {
      prefers: ["color:pink", "color:purple"],
      rule: "romantic-soft-pink-purple",
      note: "浪漫风格偏好粉紫柔色调",
      constraints: {}
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-style-11",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "style:natural",
    relation: "prefers-materials",
    payload: {
      prefers: ["material:chalcedony", "material:jade", "material:agate"],
      rule: "natural-organic-materials",
      note: "自然风格偏好玉髓、玉石、玛瑙等温润天然材质",
      constraints: {}
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-style-12",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "style:modern",
    relation: "prefers-materials",
    payload: {
      prefers: ["material:obsidian", "material:hematite", "material:sterling-silver"],
      rule: "modern-contrast-materials",
      note: "现代风格偏好黑曜石、赤铁矿与银的高对比组合",
      constraints: {}
    },
    confidence: 0.83
  }),
  fixtureRule({
    id: "krule-style-13",
    knowledgeType: "STYLE_RULE",
    knowledgeDomain: "knowledge-domain:style-rule",
    subject: "style:eastern-contemporary",
    relation: "prefers-colors",
    payload: {
      prefers: ["color:red", "color:teal"],
      rule: "eastern-contemporary-palette",
      note: "东方当代风格偏好传统朱红与青绿的当代演绎",
      constraints: {}
    },
    confidence: 0.8
  }),
  // PROPORTION_RULE
  fixtureRule({
    id: "krule-proportion-01",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:main",
    relation: "suggests-proportion",
    payload: {
      minShare: 0.6,
      maxShare: 0.8,
      beadCount: { min: 15, max: 21 },
      rule: "main-dominant-share",
      note: "主珠建议占整串 60%-80%，以常规 15-21 颗手串为基准"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-proportion-02",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:main",
    relation: "suggests-proportion",
    payload: {
      minShare: 0.7,
      maxShare: 0.85,
      beadCount: { min: 15, max: 21 },
      rule: "minimal-main-dominance",
      note: "极简风格主珠占比更高、辅珠更少"
    },
    confidence: 0.84,
    conditions: { appliesToStyleTags: ["style:minimal"] }
  }),
  fixtureRule({
    id: "krule-proportion-03",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:main",
    relation: "suggests-proportion",
    payload: {
      minShare: 0.55,
      maxShare: 0.75,
      beadCount: { min: 15, max: 21 },
      rule: "eastern-main-with-spacers",
      note: "东方当代风格常以隔珠节奏降低主珠占比"
    },
    confidence: 0.8,
    conditions: { appliesToStyleTags: ["style:eastern-contemporary"] }
  }),
  fixtureRule({
    id: "krule-proportion-04",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:accent",
    relation: "suggests-proportion",
    payload: {
      minShare: 0.15,
      maxShare: 0.3,
      beadCount: { min: 15, max: 21 },
      rule: "accent-supporting-share",
      note: "辅珠建议占整串 15%-30%，起衬托而不喧宾夺主"
    },
    confidence: 0.87
  }),
  fixtureRule({
    id: "krule-proportion-05",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:accent",
    relation: "suggests-proportion",
    payload: {
      minShare: 0.25,
      maxShare: 0.3,
      beadCount: { min: 15, max: 21 },
      rule: "romantic-accent-richness",
      note: "浪漫风格可取辅珠占比上限，层次更丰富"
    },
    confidence: 0.78,
    conditions: { appliesToStyleTags: ["style:romantic"] }
  }),
  fixtureRule({
    id: "krule-proportion-06",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:accent",
    relation: "suggests-proportion",
    payload: {
      minShare: 0.15,
      maxShare: 0.2,
      beadCount: { min: 15, max: 21 },
      rule: "minimal-accent-restraint",
      note: "极简风格辅珠克制，取占比区间下限"
    },
    confidence: 0.82,
    conditions: { appliesToStyleTags: ["style:minimal"] }
  }),
  fixtureRule({
    id: "krule-proportion-07",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:focal",
    relation: "suggests-proportion",
    payload: {
      minCount: 1,
      maxCount: 3,
      rule: "focal-count-limit",
      note: "焦点珠建议 1-3 颗，超过 3 颗会分散视觉焦点"
    },
    confidence: 0.9
  }),
  fixtureRule({
    id: "krule-proportion-08",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:focal",
    relation: "suggests-proportion",
    payload: {
      minCount: 1,
      maxCount: 1,
      rule: "single-focal-for-delicate",
      note: "精致轻珠宝风格建议单一焦点，保持轻盈"
    },
    confidence: 0.8,
    conditions: { appliesToStyleTags: ["style:delicate", "style:ethereal"] }
  }),
  fixtureRule({
    id: "krule-proportion-09",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:spacer",
    relation: "suggests-proportion",
    payload: {
      intervalMin: 4,
      intervalMax: 6,
      rule: "spacer-interval",
      note: "每隔 4-6 颗主珠设置一颗隔珠，形成呼吸节奏"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-proportion-10",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:spacer",
    relation: "suggests-proportion",
    payload: {
      intervalMin: 3,
      intervalMax: 5,
      rule: "eastern-spacer-rhythm",
      note: "东方当代风格隔珠更密集，形成传统串珠节奏"
    },
    confidence: 0.78,
    conditions: { appliesToStyleTags: ["style:eastern-contemporary"] }
  }),
  fixtureRule({
    id: "krule-proportion-11",
    knowledgeType: "PROPORTION_RULE",
    knowledgeDomain: "knowledge-domain:proportion-rule",
    subject: "composition-role:spacer",
    relation: "suggests-proportion",
    payload: {
      intervalMin: 5,
      intervalMax: 6,
      rule: "minimal-spacer-sparsity",
      note: "极简风格隔珠更稀疏，保持整体干净"
    },
    confidence: 0.8,
    conditions: { appliesToStyleTags: ["style:minimal", "style:modern"] }
  }),
  // COMPOSITION_RULE
  fixtureRule({
    id: "krule-composition-01",
    knowledgeType: "COMPOSITION_RULE",
    knowledgeDomain: "knowledge-domain:composition-rule",
    subject: "composition-role:main",
    relation: "prefers-layout",
    payload: {
      layout: "REPEAT_RHYTHM",
      rule: "main-repeat-rhythm",
      note: "主珠以重复节奏排列，形成整串视觉基调"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-composition-02",
    knowledgeType: "COMPOSITION_RULE",
    knowledgeDomain: "knowledge-domain:composition-rule",
    subject: "composition-role:accent",
    relation: "prefers-layout",
    payload: {
      layout: "SYMMETRIC_BALANCE",
      rule: "accent-symmetric-balance",
      note: "辅珠建议左右对称分布，保持整体平衡"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-composition-03",
    knowledgeType: "COMPOSITION_RULE",
    knowledgeDomain: "knowledge-domain:composition-rule",
    subject: "composition-role:focal",
    relation: "prefers-layout",
    payload: {
      layout: "CENTER_FOCAL",
      rule: "focal-center-layout",
      note: "焦点珠居中放置，形成中心构图"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-composition-04",
    knowledgeType: "COMPOSITION_RULE",
    knowledgeDomain: "knowledge-domain:composition-rule",
    subject: "composition-role:spacer",
    relation: "prefers-layout",
    payload: {
      layout: "REPEAT_RHYTHM",
      rule: "spacer-repeat-rhythm",
      note: "隔珠按固定间隔重复，形成可预期的节奏"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-composition-05",
    knowledgeType: "COMPOSITION_RULE",
    knowledgeDomain: "knowledge-domain:composition-rule",
    subject: "composition-role:main",
    relation: "prefers-layout",
    payload: {
      layout: "LOW_CONTRAST_FLOW",
      rule: "low-contrast-flow",
      note: "邻近色主珠适合低对比流动式排布"
    },
    confidence: 0.82,
    conditions: { appliesToStyleTags: ["style:ethereal"] }
  }),
  // TRANSITION_RULE
  fixtureRule({
    id: "krule-transition-01",
    knowledgeType: "TRANSITION_RULE",
    knowledgeDomain: "knowledge-domain:transition-rule",
    subject: "composition-role:accent",
    relation: "prefers-transition",
    payload: {
      transition: "low-saturation-bridge",
      rule: "saturation-bridge",
      note: "高饱和珠之间宜放入低饱和珠（灰、白）作过渡缓冲"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-transition-02",
    knowledgeType: "TRANSITION_RULE",
    knowledgeDomain: "knowledge-domain:transition-rule",
    subject: "composition-role:spacer",
    relation: "prefers-transition",
    payload: {
      transition: "neutral-spacer-bridge",
      rule: "spacer-as-transition",
      note: "隔珠（玉髓或银隔珠）可作为异色区块之间的自然过渡"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-transition-03",
    knowledgeType: "TRANSITION_RULE",
    knowledgeDomain: "knowledge-domain:transition-rule",
    subject: "composition-role:main",
    relation: "prefers-transition",
    payload: {
      transition: "hue-gradual-shift",
      rule: "hue-gradation",
      note: "主珠色相沿色环顺序渐变排布，避免色相跳变"
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-transition-04",
    knowledgeType: "TRANSITION_RULE",
    knowledgeDomain: "knowledge-domain:transition-rule",
    subject: "composition-role:accent",
    relation: "prefers-transition",
    payload: {
      transition: "lightness-step-limit",
      rule: "lightness-step",
      note: "相邻珠体明度差逐级过渡，避免明度断崖"
    },
    confidence: 0.82
  }),
  // FOCAL_RULE
  fixtureRule({
    id: "krule-focal-01",
    knowledgeType: "FOCAL_RULE",
    knowledgeDomain: "knowledge-domain:focal-rule",
    subject: "composition-role:focal",
    relation: "anchors-at",
    payload: {
      anchor: "center",
      rule: "center-anchor",
      note: "焦点珠锚定于手串中心（佩戴时手腕内侧）"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-focal-02",
    knowledgeType: "FOCAL_RULE",
    knowledgeDomain: "knowledge-domain:focal-rule",
    subject: "composition-role:focal",
    relation: "anchors-at",
    payload: {
      anchor: "symmetric-pair",
      rule: "symmetric-pair-anchor",
      note: "双焦点对称分布时保持与中心等距"
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-focal-03",
    knowledgeType: "FOCAL_RULE",
    knowledgeDomain: "knowledge-domain:focal-rule",
    subject: "composition-role:focal",
    relation: "anchors-at",
    payload: {
      anchor: "center",
      rule: "largest-bead-anchor",
      note: "最大珠径的珠子作为视觉锚点居中放置"
    },
    confidence: 0.85,
    conditions: { appliesToStyleTags: ["style:modern"] }
  }),
  // NEGATIVE_RULE
  fixtureRule({
    id: "krule-negative-01",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "color:red",
    relation: "conflicts-with",
    payload: {
      conflictsWith: ["color:pink"],
      rule: "high-saturation-warm-clash",
      note: "高饱和红与粉直接相邻对比生硬，建议降低饱和或以中性色分隔"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-negative-02",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "color:pink",
    relation: "conflicts-with",
    payload: {
      conflictsWith: ["color:red"],
      rule: "high-saturation-warm-clash",
      note: "高饱和粉与红相邻易显突兀，可用灰白过渡"
    },
    confidence: 0.84
  }),
  fixtureRule({
    id: "krule-negative-03",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "color:multicolor",
    relation: "avoid",
    payload: {
      maxBeadCount: 2,
      rule: "multicolor-bead-count-limit",
      note: "多色珠单串不超过 2 颗，避免视觉杂乱"
    },
    confidence: 0.88
  }),
  fixtureRule({
    id: "krule-negative-04",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "material:pyrite",
    relation: "conflicts-with",
    payload: {
      conflictsWith: ["material:hematite"],
      rule: "metallic-luster-clash",
      note: "黄铁矿与赤铁矿同为强金属光泽，相邻叠加显得杂乱"
    },
    confidence: 0.82
  }),
  fixtureRule({
    id: "krule-negative-05",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "material:hematite",
    relation: "conflicts-with",
    payload: {
      conflictsWith: ["material:pyrite"],
      rule: "metallic-luster-clash",
      note: "赤铁矿与黄铁矿金属光泽冲突，建议二选一"
    },
    confidence: 0.82
  }),
  fixtureRule({
    id: "krule-negative-06",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "composition-role:main",
    relation: "avoid",
    payload: {
      minBeadGap: 0.2,
      maxMaterialCount: 3,
      rule: "avoid-material-crowding",
      note: "相对珠间距低于 0.2 且材质超过 3 种时视觉过密"
    },
    confidence: 0.83
  }),
  fixtureRule({
    id: "krule-negative-07",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "material:fluorite",
    relation: "avoid",
    payload: {
      conflictsWith: ["material:quartz", "material:topaz"],
      rule: "soft-stone-direct-adjacency",
      note: "萤石莫氏硬度约 4，避免与高硬度材质直接相邻刮伤"
    },
    confidence: 0.86
  }),
  fixtureRule({
    id: "krule-negative-08",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "material:calcite",
    relation: "avoid",
    payload: {
      conflictsWith: ["material:quartz", "material:topaz"],
      rule: "soft-stone-direct-adjacency",
      note: "方解石莫氏硬度约 3，避免与高硬度材质直接相邻"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-negative-09",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "color:multicolor",
    relation: "avoid",
    payload: {
      rule: "minimal-avoids-multicolor",
      note: "极简风格应避免使用多色珠"
    },
    confidence: 0.84,
    conditions: { appliesToStyleTags: ["style:minimal"] }
  }),
  fixtureRule({
    id: "krule-negative-10",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "color:brown",
    relation: "conflicts-with",
    payload: {
      conflictsWith: ["color:black"],
      rule: "dark-low-contrast-mud",
      note: "棕与黑明度接近，相邻显得沉闷缺乏层次"
    },
    confidence: 0.78
  }),
  fixtureRule({
    id: "krule-negative-11",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "material:pyrite",
    relation: "conflicts-with",
    payload: {
      conflictsWith: ["material:sterling-silver"],
      rule: "mixed-metal-clash",
      note: "黄铁矿的金色金属光泽与纯银配件混搭金属色不统一"
    },
    confidence: 0.76
  }),
  fixtureRule({
    id: "krule-negative-12",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "emotion:protection",
    relation: "forbidden-claims",
    payload: {
      forbidden: ["guaranteed-effect", "deterministic-fortune"],
      rule: "compliance-forbidden-claims",
      note: "守护主题仅作为文化意象呈现，禁止任何保证功效或确定性运势的表述"
    },
    confidence: 0.95
  }),
  fixtureRule({
    id: "krule-negative-13",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "emotion:protection",
    relation: "forbidden-claims",
    payload: {
      forbidden: ["medical-claim", "guaranteed-effect", "deterministic-fortune"],
      rule: "compliance-no-medical-claims",
      note: "禁止医疗功效宣称与确定性运势表述，全部文案仅限文化与美学意象"
    },
    confidence: 0.95
  }),
  // CULTURAL_SYMBOLISM（文化意象参考，非功效表述）
  fixtureRule({
    id: "krule-cultural-01",
    knowledgeType: "CULTURAL_SYMBOLISM",
    knowledgeDomain: "knowledge-domain:cultural-symbolism",
    subject: "material:lapis-lazuli",
    relation: "symbolizes",
    payload: {
      imagery: "夜空与星辰",
      paletteInspiration: ["color:blue", "color:black", "color:yellow"],
      note: "青金石在多个文化中象征夜空，深蓝底色与金色斑点构成深蓝金配色灵感；此为文化意象参考，非功效表述"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-cultural-02",
    knowledgeType: "CULTURAL_SYMBOLISM",
    knowledgeDomain: "knowledge-domain:cultural-symbolism",
    subject: "material:jade",
    relation: "symbolizes",
    payload: {
      imagery: "温润君子",
      paletteInspiration: ["color:green", "color:white"],
      note: "玉在东亚文化中象征温润品德，青白配色是东方当代设计的经典灵感；此为文化意象参考，非功效表述"
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-cultural-03",
    knowledgeType: "CULTURAL_SYMBOLISM",
    knowledgeDomain: "knowledge-domain:cultural-symbolism",
    subject: "material:obsidian",
    relation: "symbolizes",
    payload: {
      imagery: "黑曜守护",
      paletteInspiration: ["color:black", "color:gray"],
      note: "黑曜岩在多处传统文化中被赋予守护意象，黑银配色呈现沉稳气质；此为文化意象参考，非功效表述"
    },
    confidence: 0.8
  }),
  fixtureRule({
    id: "krule-cultural-04",
    knowledgeType: "CULTURAL_SYMBOLISM",
    knowledgeDomain: "knowledge-domain:cultural-symbolism",
    subject: "material:rhodonite",
    relation: "symbolizes",
    payload: {
      imagery: "蔷薇与关怀",
      paletteInspiration: ["color:pink", "color:black"],
      note: "蔷薇辉石粉红底与黑色锰纹形成蔷薇意象，粉黑对比是配色灵感来源；此为文化意象参考，非功效表述"
    },
    confidence: 0.78
  }),
  fixtureRule({
    id: "krule-cultural-05",
    knowledgeType: "CULTURAL_SYMBOLISM",
    knowledgeDomain: "knowledge-domain:cultural-symbolism",
    subject: "material:garnet",
    relation: "symbolizes",
    payload: {
      imagery: "旅途与信义",
      paletteInspiration: ["color:red", "color:brown"],
      note: "石榴石在历史上常作为旅途信物，深红棕暖调适合复古主题；此为文化意象参考，非功效表述"
    },
    confidence: 0.8
  }),
  fixtureRule({
    id: "krule-cultural-06",
    knowledgeType: "CULTURAL_SYMBOLISM",
    knowledgeDomain: "knowledge-domain:cultural-symbolism",
    subject: "material:quartz",
    relation: "symbolizes",
    payload: {
      imagery: "冰晶与清明",
      paletteInspiration: ["color:white", "color:blue"],
      note: "清透石英在文化中常喻冰晶清明，白蓝浅色系呼应这一意象；此为文化意象参考，非功效表述"
    },
    confidence: 0.82
  }),
  fixtureRule({
    id: "krule-cultural-07",
    knowledgeType: "CULTURAL_SYMBOLISM",
    knowledgeDomain: "knowledge-domain:cultural-symbolism",
    subject: "material:tourmaline",
    relation: "symbolizes",
    payload: {
      imagery: "彩虹渐变",
      paletteInspiration: ["color:green", "color:pink"],
      note: "西瓜碧玺的绿粉渐变是多样性的经典意象，可直接作为渐变配色灵感；此为文化意象参考，非功效表述"
    },
    confidence: 0.78
  }),
  // TAROT（塔罗意象 → 配色/情绪建议）
  fixtureRule({
    id: "krule-tarot-01",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-17-the-star",
    relation: "suggests-palette",
    payload: {
      colors: ["color:blue", "color:white"],
      emotions: ["emotion:hope", "emotion:calm", "emotion:renewal"],
      styles: ["style:ethereal"]
    },
    confidence: 0.85
  }),
  fixtureRule({
    id: "krule-tarot-02",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-19-the-sun",
    relation: "suggests-palette",
    payload: {
      colors: ["color:yellow", "color:orange"],
      emotions: ["emotion:joy", "emotion:vitality"],
      styles: ["style:natural"]
    },
    confidence: 0.82
  }),
  fixtureRule({
    id: "krule-tarot-03",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-18-the-moon",
    relation: "suggests-palette",
    payload: {
      colors: ["color:purple", "color:gray", "color:white"],
      emotions: ["emotion:calm", "emotion:connection"],
      styles: ["style:ethereal"]
    },
    confidence: 0.78
  }),
  fixtureRule({
    id: "krule-tarot-04",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-00-the-fool",
    relation: "suggests-palette",
    payload: {
      colors: ["color:white", "color:yellow"],
      emotions: ["emotion:hope", "emotion:joy"],
      styles: ["style:natural"]
    },
    confidence: 0.76
  }),
  fixtureRule({
    id: "krule-tarot-05",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-06-the-lovers",
    relation: "suggests-palette",
    payload: {
      colors: ["color:pink", "color:red"],
      emotions: ["emotion:love", "emotion:connection"],
      styles: ["style:romantic"]
    },
    confidence: 0.8
  }),
  fixtureRule({
    id: "krule-tarot-06",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-09-the-hermit",
    relation: "suggests-palette",
    payload: {
      colors: ["color:gray", "color:brown"],
      emotions: ["emotion:focus", "emotion:grounding"],
      styles: ["style:vintage"]
    },
    confidence: 0.76
  }),
  fixtureRule({
    id: "krule-tarot-07",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-14-temperance",
    relation: "suggests-palette",
    payload: {
      colors: ["color:teal", "color:blue", "color:white"],
      emotions: ["emotion:calm", "emotion:renewal"],
      styles: ["style:minimal"]
    },
    confidence: 0.78
  }),
  fixtureRule({
    id: "krule-tarot-08",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-08-strength",
    relation: "suggests-emotion",
    payload: {
      colors: ["color:red", "color:orange"],
      emotions: ["emotion:courage", "emotion:confidence"],
      styles: ["style:modern"]
    },
    confidence: 0.76
  }),
  fixtureRule({
    id: "krule-tarot-09",
    knowledgeType: "TAROT",
    knowledgeDomain: "knowledge-domain:tarot",
    subject: "tarot:major-21-the-world",
    relation: "suggests-palette",
    payload: {
      colors: ["color:green", "color:blue"],
      emotions: ["emotion:renewal", "emotion:confidence"],
      styles: ["style:natural"]
    },
    confidence: 0.75
  }),
  // MARKET_OBSERVATION（市场观察，多来源引用）
  fixtureRule({
    id: "krule-market-01",
    knowledgeType: "MARKET_OBSERVATION",
    knowledgeDomain: "knowledge-domain:market-observation",
    subject: "color:purple",
    relation: "observed-trend",
    payload: {
      trend: "low-saturation-purple-combinations-rising",
      window: "2024-2026",
      note: "紫色系低饱和组合（雾紫、灰紫）近年讨论热度持续走高"
    },
    confidence: 0.7,
    includeMarketSource: true
  }),
  fixtureRule({
    id: "krule-market-02",
    knowledgeType: "MARKET_OBSERVATION",
    knowledgeDomain: "knowledge-domain:market-observation",
    subject: "color:teal",
    relation: "observed-trend",
    payload: {
      trend: "teal-silver-pairing-popular",
      window: "2024-2026",
      note: "蓝绿与银饰组合在轻珠宝市场关注度上升"
    },
    confidence: 0.68,
    includeMarketSource: true
  }),
  fixtureRule({
    id: "krule-market-03",
    knowledgeType: "MARKET_OBSERVATION",
    knowledgeDomain: "knowledge-domain:market-observation",
    subject: "material:sterling-silver",
    relation: "observed-trend",
    payload: {
      trend: "silver-accessories-preference",
      window: "2025-2026",
      note: "纯银配件在年轻消费群体中的偏好度上升"
    },
    confidence: 0.72,
    includeMarketSource: true
  }),
  fixtureRule({
    id: "krule-market-04",
    knowledgeType: "MARKET_OBSERVATION",
    knowledgeDomain: "knowledge-domain:market-observation",
    subject: "color:brown",
    relation: "observed-trend",
    payload: {
      trend: "earth-tone-comeback",
      window: "2025-2026",
      note: "大地色系在自然风格手串中明显回潮"
    },
    confidence: 0.65,
    includeMarketSource: true
  }),
  fixtureRule({
    id: "krule-market-05",
    knowledgeType: "MARKET_OBSERVATION",
    knowledgeDomain: "knowledge-domain:market-observation",
    subject: "material:tourmaline",
    relation: "observed-trend",
    payload: {
      trend: "multicolor-tourmaline-demand",
      window: "2024-2026",
      note: "多色碧玺手串需求增长，但建议控制多色珠数量避免杂乱"
    },
    confidence: 0.62,
    includeMarketSource: true
  }),
  fixtureRule({
    id: "krule-market-06",
    knowledgeType: "MARKET_OBSERVATION",
    knowledgeDomain: "knowledge-domain:market-observation",
    subject: "color:gray",
    relation: "observed-trend",
    payload: {
      trend: "gray-neutral-palette-steady",
      window: "2025-2026",
      note: "灰色作为中性过渡色在低饱和组合中稳定流行"
    },
    confidence: 0.75,
    includeMarketSource: true
  }),
  fixtureRule({
    id: "krule-market-07",
    knowledgeType: "MARKET_OBSERVATION",
    knowledgeDomain: "knowledge-domain:market-observation",
    subject: "material:obsidian",
    relation: "observed-trend",
    payload: {
      trend: "obsidian-modern-pairing-rising",
      window: "2025-2026",
      note: "黑曜石与金属配件的现代风搭配讨论度上升"
    },
    confidence: 0.64,
    includeMarketSource: true
  })
];
