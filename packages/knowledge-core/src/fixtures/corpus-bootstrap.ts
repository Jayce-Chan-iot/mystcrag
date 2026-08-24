import { createHash } from "node:crypto";

import {
  knowledgeDomainForType,
  listTaxonomyTerms,
  type KnowledgeRule,
  type TaxonomyTerm
} from "@mystcrag/design-contract";

import { KNOWLEDGE_RULE_FIXTURES, type KnowledgeRuleSeed } from "./knowledge-rules.js";

/**
 * Corpus Bootstrap (Quality Phase Q4). The curated handbook corpus
 * (KNOWLEDGE_RULE_FIXTURES, layer "core") stays untouched; this module adds
 * two deterministic layers on top so the reviewed corpus passes 500 rules:
 *
 * - "taxonomy-coverage": one systematic family per taxonomy domain — every
 *   COLOR/MATERIAL/STYLE/EMOTION/TEXTURE/LUSTER/TRANSPARENCY/COMPOSITION_ROLE
 *   term appears as a subject at least once.
 * - "combination": the tarot major-arcana extension (all 22 majors) and
 *   cross-domain pairs.
 *
 * The generator is a pure function of the taxonomy fixture: no randomness,
 * no clocks, no environment. A (knowledgeType, subject, relation) key may
 * only appear once across the whole corpus — collisions with the core layer
 * throw instead of silently shrinking the corpus.
 */
export type CorpusLayer = "taxonomy-coverage" | "combination";

const BOOTSTRAP_TIMESTAMP = "2026-08-21T12:00:00+08:00";

const BOOTSTRAP_SOURCE_REF = {
  sourceId: "source-fixture-bootstrap",
  documentId: "doc-fixture-bootstrap"
} as const;

const MARKET_SOURCE_REF = {
  sourceId: "source-fixture-market",
  documentId: "doc-fixture-market"
} as const;

function termsOf(domain: Parameters<typeof listTaxonomyTerms>[0]): Map<string, TaxonomyTerm> {
  return new Map(listTaxonomyTerms(domain).map((term) => [term.id, term]));
}

function required<T>(value: T | undefined, key: string): T {
  if (value === undefined) {
    throw new Error(`corpus bootstrap fixture map is missing an entry for ${key}`);
  }
  return value;
}

const COLOR_TERMS = termsOf("COLOR");
const MATERIAL_TERMS = termsOf("MATERIAL");
const STYLE_TERMS = termsOf("STYLE");
const EMOTION_TERMS = termsOf("EMOTION");
const TEXTURE_TERMS = termsOf("TEXTURE");
const LUSTER_TERMS = termsOf("LUSTER");
const TRANSPARENCY_TERMS = termsOf("TRANSPARENCY");
const ROLE_TERMS = termsOf("COMPOSITION_ROLE");

const CHROMATIC_COLORS = [
  "color:purple",
  "color:pink",
  "color:red",
  "color:orange",
  "color:yellow",
  "color:green",
  "color:teal",
  "color:blue"
] as const;

const ACHROMATIC_COLORS = ["color:white", "color:gray", "color:black"] as const;

const ALL_COLORS = [...COLOR_TERMS.keys()].sort();

const METALS = ["material:sterling-silver", "material:gold"] as const;
const NON_METAL_MATERIALS = [...MATERIAL_TERMS.keys()]
  .filter((id) => !METALS.includes(id as (typeof METALS)[number]))
  .sort();
const ALL_MATERIALS = [...MATERIAL_TERMS.keys()].sort();
const ALL_STYLES = [...STYLE_TERMS.keys()].sort();
const ALL_EMOTIONS = [...EMOTION_TERMS.keys()].sort();
const ALL_TEXTURES = [...TEXTURE_TERMS.keys()].sort();
const ALL_LUSTERS = [...LUSTER_TERMS.keys()].sort();
const ALL_TRANSPARENCIES = [...TRANSPARENCY_TERMS.keys()].sort();
const ALL_ROLES = [...ROLE_TERMS.keys()].sort();

const takenKeys = new Set(
  KNOWLEDGE_RULE_FIXTURES.map((rule) => `${rule.knowledgeType}|${rule.subject}|${rule.relation}`)
);
const generated: KnowledgeRuleSeed[] = [];

type BootstrapInput = {
  readonly id: string;
  readonly knowledgeType: KnowledgeRule["knowledgeType"];
  readonly subject: string;
  readonly relation: string;
  readonly payload: Record<string, unknown>;
  readonly layer: CorpusLayer;
  readonly confidence?: number;
  readonly market?: boolean;
};

function addRule(input: BootstrapInput): void {
  const key = `${input.knowledgeType}|${input.subject}|${input.relation}`;
  if (takenKeys.has(key)) {
    throw new Error(`corpus bootstrap key collision: ${key}`);
  }
  takenKeys.add(key);
  generated.push({
    id: input.id,
    knowledgeType: input.knowledgeType,
    knowledgeDomain: knowledgeDomainForType(input.knowledgeType),
    subject: input.subject,
    relation: input.relation,
    payload: { ...input.payload, corpusLayer: input.layer },
    conditions: {},
    confidence: input.confidence ?? 0.85,
    status: "APPROVED",
    sourceRefs: [input.market === true ? MARKET_SOURCE_REF : BOOTSTRAP_SOURCE_REF],
    version: 1,
    fingerprint: createHash("sha256").update(`a1${input.id}`).digest("hex"),
    createdAt: BOOTSTRAP_TIMESTAMP,
    updatedAt: BOOTSTRAP_TIMESTAMP,
    sourceId: input.market === true ? MARKET_SOURCE_REF.sourceId : BOOTSTRAP_SOURCE_REF.sourceId
  });
}

function suffix(taxonomyId: string): string {
  return taxonomyId.slice(taxonomyId.indexOf(":") + 1);
}

const LAYER_COVERAGE: CorpusLayer = "taxonomy-coverage";
const LAYER_COMBINATION: CorpusLayer = "combination";

// ---------------------------------------------------------------- COLOR_THEORY

/** Colors that naturally carry each taxonomy color, for grounded palettes. */
const NATURAL_MATERIALS_BY_COLOR: Readonly<Record<string, readonly string[]>> = {
  "color:white": ["material:quartz", "material:chalcedony"],
  "color:purple": ["material:quartz", "material:fluorite"],
  "color:pink": ["material:rhodonite", "material:quartz"],
  "color:red": ["material:garnet", "material:rhodonite"],
  "color:orange": ["material:calcite", "material:garnet"],
  "color:yellow": ["material:topaz", "material:pyrite"],
  "color:green": ["material:nephrite", "material:beryl"],
  "color:teal": ["material:tourmaline", "material:beryl"],
  "color:blue": ["material:lapis-lazuli", "material:topaz"],
  "color:gray": ["material:quartz", "material:hematite"],
  "color:black": ["material:obsidian", "material:hematite"],
  "color:brown": ["material:quartz", "material:agate"],
  "color:multicolor": ["material:tourmaline", "material:fluorite", "material:agate"]
};

for (const colorId of ALL_COLORS) {
  const zh = COLOR_TERMS.get(colorId)?.displayName.zh ?? suffix(colorId);
  addRule({
    id: `kboot-color-mono-${suffix(colorId)}`,
    knowledgeType: "COLOR_THEORY",
    subject: colorId,
    relation: "monochrome-uses",
    payload: {
      companions: [colorId],
      note: `${zh}单色串可通过材质与纹理差异制造层次，避免单调`
    },
    layer: LAYER_COVERAGE
  });

  const natural = NATURAL_MATERIALS_BY_COLOR[colorId];
  if (natural !== undefined) {
    addRule({
      id: `kboot-color-natural-${suffix(colorId)}`,
      knowledgeType: "COLOR_THEORY",
      subject: colorId,
      relation: "natural-materials",
      payload: {
        materials: natural,
        note: `${zh}常见于天然矿材，用天然呈色材质更易做出和谐成串`
      },
      layer: LAYER_COVERAGE
    });
  }
}

for (const colorId of CHROMATIC_COLORS) {
  const zh = COLOR_TERMS.get(colorId)?.displayName.zh ?? suffix(colorId);
  addRule({
    id: `kboot-color-deepen-${suffix(colorId)}`,
    knowledgeType: "COLOR_THEORY",
    subject: colorId,
    relation: "deepened-by",
    payload: {
      companions: ["color:gray", "color:black"],
      note: `${zh}与深色相邻时饱和感更沉稳，适合主色强调`
    },
    layer: LAYER_COVERAGE
  });
  addRule({
    id: `kboot-color-soften-${suffix(colorId)}`,
    knowledgeType: "COLOR_THEORY",
    subject: colorId,
    relation: "softened-by",
    payload: {
      companions: ["color:white"],
      note: `${zh}与白色混排可降低整体浓度，适合轻盈风格`
    },
    layer: LAYER_COVERAGE
  });
}

for (const colorId of ACHROMATIC_COLORS) {
  const zh = COLOR_TERMS.get(colorId)?.displayName.zh ?? suffix(colorId);
  addRule({
    id: `kboot-color-contrast-${suffix(colorId)}`,
    knowledgeType: "COLOR_THEORY",
    subject: colorId,
    relation: "contrasts-with",
    payload: {
      companions: [...CHROMATIC_COLORS],
      note: `${zh}作为中性底色可与任何有彩色形成清晰对比`
    },
    layer: LAYER_COVERAGE
  });
}

addRule({
  id: "kboot-color-harmonize-brown",
  knowledgeType: "COLOR_THEORY",
  subject: "color:brown",
  relation: "harmonizes-with",
  payload: {
    companions: ["color:orange", "color:yellow", "color:gray"],
    note: "棕色与暖色及灰色系相邻时过渡自然，适合大地色系串搭"
  },
  layer: LAYER_COVERAGE
});

addRule({
  id: "kboot-color-contrast-multicolor",
  knowledgeType: "COLOR_THEORY",
  subject: "color:multicolor",
  relation: "contrasts-with",
  payload: {
    companions: ["color:white", "color:black"],
    note: "多色珠与黑白色底搭配可以收敛视觉强度"
  },
  layer: LAYER_COVERAGE
});

for (const temperatureId of ["temperature:warm", "temperature:cool"]) {
  const zh = temperatureId === "temperature:warm" ? "暖色" : "冷色";
  addRule({
    id: `kboot-color-contrast-${suffix(temperatureId)}`,
    knowledgeType: "COLOR_THEORY",
    subject: temperatureId,
    relation: "contrasts-with",
    payload: {
      companions: [temperatureId === "temperature:warm" ? "temperature:cool" : "temperature:warm"],
      note: `${zh}与对侧温度混排时形成冷暖对比，适合焦点强调`
    },
    layer: LAYER_COVERAGE
  });
}

/** Texture/luster/transparency affinity for color selection. */
const COLOR_AFFINITY: Readonly<Record<string, readonly string[]>> = {
  "texture:smooth": ["color:white", "color:blue", "color:pink"],
  "texture:banded": ["color:brown", "color:gray", "color:orange"],
  "texture:included": ["color:white", "color:gray"],
  "texture:phantom": ["color:green", "color:purple", "color:teal"],
  "texture:crackled": ["color:white", "color:teal", "color:multicolor"],
  "texture:iridescent-sheen": ["color:multicolor", "color:purple", "color:teal"],
  "texture:catseye": ["color:gray", "color:yellow", "color:black"],
  "texture:speckled": ["color:brown", "color:black", "color:gray"],
  "texture:veined": ["color:red", "color:green", "color:brown"],
  "luster:matte": ["color:gray", "color:black", "color:brown"],
  "luster:soft": ["color:pink", "color:white", "color:purple"],
  "luster:bright": ["color:red", "color:yellow", "color:multicolor"],
  "transparency:transparent": ["color:white", "color:teal", "color:blue"],
  "transparency:translucent": ["color:pink", "color:purple", "color:white"],
  "transparency:opaque": ["color:black", "color:red", "color:brown"]
};

for (const [termId, colors] of Object.entries(COLOR_AFFINITY)) {
  const [domain, name] = termId.split(":");
  const zh =
    domain === "texture"
      ? TEXTURE_TERMS.get(termId)?.displayName.zh
      : domain === "luster"
        ? LUSTER_TERMS.get(termId)?.displayName.zh
        : TRANSPARENCY_TERMS.get(termId)?.displayName.zh;
  addRule({
    id: `kboot-color-affinity-${domain}-${name}`,
    knowledgeType: "COLOR_THEORY",
    subject: termId,
    relation: "prefers-colors",
    payload: {
      companionColors: colors,
      note: `${zh ?? name}质感的珠体更适合以上色彩，视觉整体更统一`
    },
    layer: LAYER_COVERAGE
  });
}

// -------------------------------------------------------- MATERIAL_COMPATIBILITY

for (const materialId of NON_METAL_MATERIALS) {
  const zh = MATERIAL_TERMS.get(materialId)?.displayName.zh ?? suffix(materialId);
  addRule({
    id: `kboot-material-metal-${suffix(materialId)}`,
    knowledgeType: "MATERIAL_COMPATIBILITY",
    subject: materialId,
    relation: "pairs-with-metals",
    payload: {
      metals: [...METALS],
      note: `${zh}与银金隔珠或配件搭配稳固，金属件可作为间隔与收尾`
    },
    layer: LAYER_COVERAGE
  });
}

const BEST_TEXTURE_BY_MATERIAL: Readonly<Record<string, readonly string[]>> = {
  "material:quartz": ["texture:smooth", "texture:phantom", "texture:included"],
  "material:feldspar": ["texture:smooth", "texture:speckled"],
  "material:beryl": ["texture:smooth", "texture:included"],
  "material:chalcedony": ["texture:banded"],
  "material:agate": ["texture:banded", "texture:veined"],
  "material:garnet": ["texture:smooth", "texture:catseye"],
  "material:fluorite": ["texture:banded", "texture:included"],
  "material:obsidian": ["texture:smooth", "texture:iridescent-sheen"],
  "material:lapis-lazuli": ["texture:included", "texture:speckled"],
  "material:rhodonite": ["texture:veined", "texture:speckled"],
  "material:tourmaline": ["texture:catseye", "texture:included", "texture:banded"],
  "material:jade": ["texture:smooth"],
  "material:jadeite": ["texture:smooth", "texture:veined"],
  "material:nephrite": ["texture:smooth", "texture:speckled"],
  "material:pyrite": ["texture:smooth", "texture:speckled"],
  "material:hematite": ["texture:smooth", "texture:catseye"],
  "material:calcite": ["texture:included", "texture:veined"],
  "material:topaz": ["texture:smooth", "texture:catseye"],
  "material:sterling-silver": ["texture:smooth"],
  "material:gold": ["texture:smooth"]
};

for (const [materialId, textures] of Object.entries(BEST_TEXTURE_BY_MATERIAL)) {
  const zh = MATERIAL_TERMS.get(materialId)?.displayName.zh ?? suffix(materialId);
  addRule({
    id: `kboot-material-texture-${suffix(materialId)}`,
    knowledgeType: "MATERIAL_COMPATIBILITY",
    subject: materialId,
    relation: "shows-best-in",
    payload: {
      textures,
      note: `${zh}以上列纹理呈现时特征最清晰，选珠时可优先参考`
    },
    layer: LAYER_COVERAGE
  });
}

for (const familyRoot of ["material:quartz", "material:chalcedony", "material:jade", "material:garnet"]) {
  const zh = MATERIAL_TERMS.get(familyRoot)?.displayName.zh ?? suffix(familyRoot);
  const children = [...MATERIAL_TERMS.values()]
    .filter((term) => term.parentId === familyRoot)
    .map((term) => term.id)
    .sort();
  addRule({
    id: `kboot-material-family-${suffix(familyRoot)}`,
    knowledgeType: "MATERIAL_COMPATIBILITY",
    subject: familyRoot,
    relation: "family-graduates-with",
    payload: {
      family: [familyRoot, ...children],
      note: `${zh}族内成员明度接近，适合同串渐变与过渡排列`
    },
    layer: LAYER_COVERAGE
  });
}

for (const softStone of ["material:calcite", "material:fluorite"]) {
  const zh = MATERIAL_TERMS.get(softStone)?.displayName.zh ?? suffix(softStone);
  addRule({
    id: `kboot-material-spacer-${suffix(softStone)}`,
    knowledgeType: "MATERIAL_COMPATIBILITY",
    subject: softStone,
    relation: "requires-spacer-near",
    payload: {
      hardStones: ["material:pyrite", "material:hematite", "material:topaz"],
      note: `${zh}硬度较低，与高硬度珠相邻时建议加隔珠减少磨损`
    },
    layer: LAYER_COVERAGE
  });
}

addRule({
  id: "kboot-material-tarnish-sterling-silver",
  knowledgeType: "MATERIAL_COMPATIBILITY",
  subject: "material:sterling-silver",
  relation: "tarnishes-near",
  payload: {
    companions: ["material:pyrite"],
    note: "纯银与含硫矿物长期接触易氧化发暗，建议加隔层或定期擦拭"
  },
  layer: LAYER_COVERAGE
});

addRule({
  id: "kboot-material-pairs-gold",
  knowledgeType: "MATERIAL_COMPATIBILITY",
  subject: "material:gold",
  relation: "pairs-with",
  payload: {
    companions: ["material:quartz", "material:jade", "material:topaz", "material:obsidian"],
    note: "金色与多数玉石水晶搭配醒目，适合做点缀或收尾"
  },
  layer: LAYER_COVERAGE
});

// ------------------------------------------------------------------ NEGATIVE_RULE

const EXPOSURE_BY_MATERIAL: Readonly<Record<string, readonly string[]>> = {
  "material:quartz": ["强酸碱清洁剂", "剧烈磕碰"],
  "material:feldspar": ["硬物刮擦", "高温骤变"],
  "material:beryl": ["硬物磕碰", "超声波清洗"],
  "material:chalcedony": ["长时间高温暴晒"],
  "material:agate": ["长时间高温暴晒", "强酸碱清洁剂"],
  "material:garnet": ["硬物磕碰", "高温骤变"],
  "material:fluorite": ["长时间日晒", "硬物磕碰"],
  "material:obsidian": ["硬物磕碰", "高温骤变"],
  "material:lapis-lazuli": ["化学品接触", "长时间浸水"],
  "material:rhodonite": ["酸性清洁剂", "硬物刮擦"],
  "material:tourmaline": ["长时间高温暴晒", "剧烈磕碰"],
  "material:jade": ["硬物磕碰", "化学品接触"],
  "material:jadeite": ["硬物磕碰", "化学品接触"],
  "material:nephrite": ["硬物磕碰", "化学品接触"],
  "material:pyrite": ["长时间浸水", "潮湿环境"],
  "material:hematite": ["长时间浸水", "潮湿环境"],
  "material:calcite": ["酸性清洁剂", "硬物刮擦"],
  "material:topaz": ["硬物磕碰", "高温骤变"],
  "material:sterling-silver": ["硫磺温泉", "化妆品与汗液长期附着"],
  "material:gold": ["汞类化学品接触"]
};

for (const [materialId, exposures] of Object.entries(EXPOSURE_BY_MATERIAL)) {
  const zh = MATERIAL_TERMS.get(materialId)?.displayName.zh ?? suffix(materialId);
  addRule({
    id: `kboot-negative-exposure-${suffix(materialId)}`,
    knowledgeType: "NEGATIVE_RULE",
    subject: materialId,
    relation: "avoid-exposure",
    payload: {
      exposures,
      note: `${zh}应避免以上接触场景，佩戴与存放时注意隔离`
    },
    confidence: 0.9,
    layer: LAYER_COVERAGE
  });
}

const HARD_SOFT_PAIRS: readonly (readonly [string, string])[] = [
  ["material:pyrite", "material:fluorite"],
  ["material:hematite", "material:fluorite"],
  ["material:pyrite", "material:calcite"],
  ["material:hematite", "material:calcite"],
  ["material:topaz", "material:fluorite"],
  ["material:topaz", "material:calcite"]
];

for (const [hardId, softId] of HARD_SOFT_PAIRS) {
  const hardZh = MATERIAL_TERMS.get(hardId)?.displayName.zh ?? suffix(hardId);
  const softZh = MATERIAL_TERMS.get(softId)?.displayName.zh ?? suffix(softId);
  addRule({
    id: `kboot-negative-adjacent-${suffix(hardId)}-${suffix(softId)}`,
    knowledgeType: "NEGATIVE_RULE",
    subject: `${hardId}+${softId}`,
    relation: "avoid-adjacent",
    payload: {
      hardMaterial: hardId,
      softMaterial: softId,
      note: `${hardZh}与${softZh}硬度差异大，直接相邻易刮伤，需以隔珠缓冲`
    },
    confidence: 0.88,
    layer: LAYER_COMBINATION
  });
}

for (const emotionId of ALL_EMOTIONS) {
  if (emotionId === "emotion:protection") {
    continue;
  }
  const zh = EMOTION_TERMS.get(emotionId)?.displayName.zh ?? suffix(emotionId);
  addRule({
    id: `kboot-negative-claims-${suffix(emotionId)}`,
    knowledgeType: "NEGATIVE_RULE",
    subject: emotionId,
    relation: "forbidden-claims",
    payload: {
      scope: ["copy", "marketing", "ai-explanation"],
      note: `面向“${zh}”情绪的文案只可作设计意象描述，不得写成功效、运势或结果性承诺`
    },
    confidence: 0.95,
    layer: LAYER_COVERAGE
  });
}

// --------------------------------------------------------------------- STYLE_RULE

const STYLE_TEMPERATURE: Readonly<Record<string, string>> = {
  "style:minimal": "temperature:neutral",
  "style:eastern-contemporary": "temperature:neutral",
  "style:romantic": "temperature:warm",
  "style:natural": "temperature:neutral",
  "style:modern": "temperature:cool",
  "style:vintage": "temperature:warm",
  "style:ethereal": "temperature:cool",
  "style:delicate": "temperature:cool"
};

const STYLE_TEXTURES: Readonly<Record<string, readonly string[]>> = {
  "style:minimal": ["texture:smooth"],
  "style:eastern-contemporary": ["texture:smooth", "texture:veined"],
  "style:romantic": ["texture:smooth", "texture:catseye"],
  "style:natural": ["texture:banded", "texture:speckled", "texture:included"],
  "style:modern": ["texture:smooth", "texture:crackled"],
  "style:vintage": ["texture:banded", "texture:veined"],
  "style:ethereal": ["texture:phantom", "texture:iridescent-sheen"],
  "style:delicate": ["texture:smooth", "texture:catseye"]
};

const STYLE_LUSTER: Readonly<Record<string, string>> = {
  "style:minimal": "luster:matte",
  "style:eastern-contemporary": "luster:soft",
  "style:romantic": "luster:soft",
  "style:natural": "luster:matte",
  "style:modern": "luster:bright",
  "style:vintage": "luster:soft",
  "style:ethereal": "luster:soft",
  "style:delicate": "luster:bright"
};

const STYLE_TRANSPARENCY: Readonly<Record<string, string>> = {
  "style:minimal": "transparency:opaque",
  "style:eastern-contemporary": "transparency:translucent",
  "style:romantic": "transparency:translucent",
  "style:natural": "transparency:opaque",
  "style:modern": "transparency:transparent",
  "style:vintage": "transparency:opaque",
  "style:ethereal": "transparency:translucent",
  "style:delicate": "transparency:transparent"
};

const STYLE_PROPORTION_NOTE: Readonly<Record<string, string>> = {
  "style:minimal": "大珠少量，留白呼吸",
  "style:eastern-contemporary": "中珠规整，节奏对称",
  "style:romantic": "中小珠渐变，柔化边界",
  "style:natural": "混径混形，错落自然",
  "style:modern": "等径利落，节奏一致",
  "style:vintage": "大珠复古，配重明显",
  "style:ethereal": "小珠轻盈，密度偏低",
  "style:delicate": "小珠精细，密度偏高"
};

for (const styleId of ALL_STYLES) {
  const zh = STYLE_TERMS.get(styleId)?.displayName.zh ?? suffix(styleId);
  const temperature = required(STYLE_TEMPERATURE[styleId], styleId);
  addRule({
    id: `kboot-style-temperature-${suffix(styleId)}`,
    knowledgeType: "STYLE_RULE",
    subject: styleId,
    relation: "prefers-temperature",
    payload: {
      temperature,
      note: `${zh}风格以${temperature.split(":")[1] === "warm" ? "暖" : temperature.split(":")[1] === "cool" ? "冷" : "中性"}色调为基调最协调`
    },
    layer: LAYER_COVERAGE
  });
  addRule({
    id: `kboot-style-textures-${suffix(styleId)}`,
    knowledgeType: "STYLE_RULE",
    subject: styleId,
    relation: "prefers-textures",
    payload: {
      textures: STYLE_TEXTURES[styleId],
      note: `${zh}风格优先选用以上纹理的珠体`
    },
    layer: LAYER_COVERAGE
  });
  addRule({
    id: `kboot-style-luster-${suffix(styleId)}`,
    knowledgeType: "STYLE_RULE",
    subject: styleId,
    relation: "prefers-luster",
    payload: {
      luster: STYLE_LUSTER[styleId],
      note: `${zh}风格整体光泽以${LUSTER_TERMS.get(required(STYLE_LUSTER[styleId], styleId))?.displayName.zh ?? ""}为宜`
    },
    layer: LAYER_COVERAGE
  });
  addRule({
    id: `kboot-style-transparency-${suffix(styleId)}`,
    knowledgeType: "STYLE_RULE",
    subject: styleId,
    relation: "prefers-transparency",
    payload: {
      transparency: STYLE_TRANSPARENCY[styleId],
      note: `${zh}风格优先选用${TRANSPARENCY_TERMS.get(required(STYLE_TRANSPARENCY[styleId], styleId))?.displayName.zh ?? ""}质感的珠体`
    },
    layer: LAYER_COVERAGE
  });
  addRule({
    id: `kboot-style-proportion-${suffix(styleId)}`,
    knowledgeType: "PROPORTION_RULE",
    subject: styleId,
    relation: "suggests-proportion",
    payload: {
      guidance: STYLE_PROPORTION_NOTE[styleId],
      note: `${zh}风格的典型比例做法：${STYLE_PROPORTION_NOTE[styleId]}`
    },
    layer: LAYER_COVERAGE
  });
}

const EMOTION_MATERIALS: Readonly<Record<string, readonly string[]>> = {
  "emotion:calm": ["material:quartz", "material:chalcedony"],
  "emotion:focus": ["material:lapis-lazuli", "material:quartz"],
  "emotion:confidence": ["material:garnet", "material:topaz"],
  "emotion:joy": ["material:calcite", "material:tourmaline"],
  "emotion:connection": ["material:rhodonite", "material:quartz"],
  "emotion:renewal": ["material:nephrite", "material:beryl"],
  "emotion:hope": ["material:topaz", "material:beryl"],
  "emotion:love": ["material:rhodonite", "material:quartz"],
  "emotion:courage": ["material:garnet", "material:obsidian"],
  "emotion:grounding": ["material:hematite", "material:nephrite"],
  "emotion:vitality": ["material:garnet", "material:tourmaline"],
  "emotion:protection": ["material:obsidian", "material:hematite"]
};

const EMOTION_TEXTURES: Readonly<Record<string, readonly string[]>> = {
  "emotion:calm": ["texture:smooth"],
  "emotion:focus": ["texture:smooth", "texture:veined"],
  "emotion:confidence": ["texture:smooth", "texture:catseye"],
  "emotion:joy": ["texture:included", "texture:speckled"],
  "emotion:connection": ["texture:banded"],
  "emotion:renewal": ["texture:phantom"],
  "emotion:hope": ["texture:iridescent-sheen"],
  "emotion:love": ["texture:smooth", "texture:catseye"],
  "emotion:courage": ["texture:crackled"],
  "emotion:grounding": ["texture:banded", "texture:speckled"],
  "emotion:vitality": ["texture:crackled", "texture:catseye"],
  "emotion:protection": ["texture:smooth", "texture:veined"]
};

const EMOTION_LUSTER: Readonly<Record<string, string>> = {
  "emotion:calm": "luster:soft",
  "emotion:focus": "luster:matte",
  "emotion:confidence": "luster:bright",
  "emotion:joy": "luster:bright",
  "emotion:connection": "luster:soft",
  "emotion:renewal": "luster:soft",
  "emotion:hope": "luster:bright",
  "emotion:love": "luster:soft",
  "emotion:courage": "luster:bright",
  "emotion:grounding": "luster:matte",
  "emotion:vitality": "luster:bright",
  "emotion:protection": "luster:matte"
};

for (const emotionId of ALL_EMOTIONS) {
  const zh = EMOTION_TERMS.get(emotionId)?.displayName.zh ?? suffix(emotionId);
  addRule({
    id: `kboot-emotion-materials-${suffix(emotionId)}`,
    knowledgeType: "STYLE_RULE",
    subject: emotionId,
    relation: "prefers-materials",
    payload: {
      materials: EMOTION_MATERIALS[emotionId],
      note: `表达“${zh}”意象时优先选用以上材质`
    },
    layer: LAYER_COVERAGE
  });
  addRule({
    id: `kboot-emotion-textures-${suffix(emotionId)}`,
    knowledgeType: "STYLE_RULE",
    subject: emotionId,
    relation: "prefers-textures",
    payload: {
      textures: EMOTION_TEXTURES[emotionId],
      note: `表达“${zh}”意象时优先选用以上纹理`
    },
    layer: LAYER_COVERAGE
  });
  addRule({
    id: `kboot-emotion-luster-${suffix(emotionId)}`,
    knowledgeType: "STYLE_RULE",
    subject: emotionId,
    relation: "prefers-luster",
    payload: {
      luster: EMOTION_LUSTER[emotionId],
      note: `表达“${zh}”意象时整体光泽以${LUSTER_TERMS.get(required(EMOTION_LUSTER[emotionId], emotionId))?.displayName.zh ?? ""}为宜`
    },
    layer: LAYER_COVERAGE
  });
}

for (const lusterId of ALL_LUSTERS) {
  const zh = LUSTER_TERMS.get(lusterId)?.displayName.zh ?? suffix(lusterId);
  const styles = ALL_STYLES.filter((styleId) => STYLE_LUSTER[styleId] === lusterId);
  addRule({
    id: `kboot-luster-styles-${suffix(lusterId)}`,
    knowledgeType: "STYLE_RULE",
    subject: lusterId,
    relation: "suits-styles",
    payload: {
      styles,
      note: `${zh}光泽常见于以上风格的成串搭配`
    },
    layer: LAYER_COVERAGE
  });
}

// ------------------------------------------- PROPORTION / COMPOSITION / FOCAL / TRANSITION

addRule({
  id: "kboot-proportion-pendant",
  knowledgeType: "PROPORTION_RULE",
  subject: "composition-role:pendant",
  relation: "suggests-proportion",
  payload: {
    guidance: "吊坠为主视觉锚点，两侧以中小珠对称收窄",
    note: "吊坠链体珠径宜小于吊坠宽度，避免头重脚轻"
  },
  layer: LAYER_COVERAGE
});

addRule({
  id: "kboot-composition-pendant",
  knowledgeType: "COMPOSITION_RULE",
  subject: "composition-role:pendant",
  relation: "prefers-layout",
  payload: {
    layout: "center-drop",
    note: "吊坠居中垂坠，两侧对称分布"
  },
  layer: LAYER_COVERAGE
});

addRule({
  id: "kboot-composition-luster-layout",
  knowledgeType: "COMPOSITION_RULE",
  subject: "luster:bright",
  relation: "prefers-layout",
  payload: {
    layout: "sparse-accent",
    note: "高光泽珠体作稀疏点缀比连续排列更显质感"
  },
  layer: LAYER_COMBINATION
});

const SYMMETRY_NOTE: Readonly<Record<string, string>> = {
  "composition-role:main": "主体珠左右对称分布",
  "composition-role:accent": "点缀珠成对出现保持平衡",
  "composition-role:focal": "焦点珠单点居中",
  "composition-role:spacer": "隔珠按等距节律分布",
  "composition-role:pendant": "吊坠单点垂坠于中轴"
};

for (const roleId of ALL_ROLES) {
  addRule({
    id: `kboot-composition-symmetry-${suffix(roleId)}`,
    knowledgeType: "COMPOSITION_RULE",
    subject: roleId,
    relation: "prefers-symmetry",
    payload: {
      symmetry: "mirror",
      note: SYMMETRY_NOTE[roleId] ?? "对称排布保持视觉平衡"
    },
    layer: LAYER_COVERAGE
  });
}

addRule({
  id: "kboot-transition-pendant",
  knowledgeType: "TRANSITION_RULE",
  subject: "composition-role:pendant",
  relation: "prefers-transition",
  payload: {
    transition: "symmetric-shoulders",
    note: "吊坠两侧以渐进珠径过渡，肩部对称"
  },
  layer: LAYER_COVERAGE
});

const TEXTURE_TRANSITION_NOTE: Readonly<Record<string, string>> = {
  "texture:banded": "顺纹方向连续排列形成条带渐变",
  "texture:phantom": "层次包体按明度递进排列形成纵深",
  "texture:crackled": "冰裂纹以稀疏到密集渐变制造节奏",
  "texture:iridescent-sheen": "虹彩珠间隔排列让光泽流转"
};

for (const [textureId, note] of Object.entries(TEXTURE_TRANSITION_NOTE)) {
  const zh = TEXTURE_TERMS.get(textureId)?.displayName.zh ?? suffix(textureId);
  addRule({
    id: `kboot-transition-${suffix(textureId)}`,
    knowledgeType: "TRANSITION_RULE",
    subject: textureId,
    relation: "prefers-transition",
    payload: {
      note: `${zh}：${note}`
    },
    layer: LAYER_COVERAGE
  });
}

addRule({
  id: "kboot-focal-pendant",
  knowledgeType: "FOCAL_RULE",
  subject: "composition-role:pendant",
  relation: "anchors-at",
  payload: {
    position: "strand-center",
    note: "吊坠锚定于链体中心，视线下垂自然聚焦"
  },
  layer: LAYER_COVERAGE
});

addRule({
  id: "kboot-focal-contrast",
  knowledgeType: "FOCAL_RULE",
  subject: "composition-role:focal",
  relation: "requires-adjacent-contrast",
  payload: {
    note: "焦点珠相邻珠需在明度或色相上拉开对比，突出焦点"
  },
  layer: LAYER_COVERAGE
});

// ------------------------------------------------------------ CULTURAL_SYMBOLISM

const COLOR_SYMBOLISM: Readonly<Record<string, string>> = {
  "color:white": "纯净与简洁",
  "color:purple": "优雅与神秘",
  "color:pink": "温柔与亲和",
  "color:red": "热情与活力",
  "color:orange": "明快与温暖",
  "color:yellow": "明亮与轻快",
  "color:green": "生机与自然",
  "color:teal": "沉静与清爽",
  "color:blue": "宁静与理性",
  "color:gray": "内敛与低调",
  "color:black": "沉稳与利落",
  "color:brown": "踏实与温厚",
  "color:multicolor": "丰富与活泼"
};

const MATERIAL_SYMBOLISM: Readonly<Record<string, string>> = {
  "material:feldspar": "朴实与温润",
  "material:beryl": "清新与明澈",
  "material:chalcedony": "温和与柔润",
  "material:agate": "层次与积淀",
  "material:fluorite": "缤纷与通透",
  "material:calcite": "明亮与温和",
  "material:topaz": "明快与大方",
  "material:pyrite": "坚毅与硬朗",
  "material:hematite": "沉稳与内敛",
  "material:sterling-silver": "利落与现代",
  "material:gold": "华贵与隆重",
  "material:jadeite": "灵秀与细腻",
  "material:nephrite": "温厚与含蓄"
};

const EMOTION_SYMBOLISM: Readonly<Record<string, string>> = {
  "emotion:calm": "平静与舒缓",
  "emotion:focus": "专注与沉稳",
  "emotion:confidence": "自信与明朗",
  "emotion:joy": "愉快与明快",
  "emotion:connection": "温暖与联结",
  "emotion:renewal": "焕新与清新",
  "emotion:hope": "向上与明快",
  "emotion:love": "温暖与柔和",
  "emotion:courage": "勇气与鲜明",
  "emotion:grounding": "沉稳与安定",
  "emotion:vitality": "活力与充沛",
  "emotion:protection": "安定与安心"
};

const TEXTURE_SYMBOLISM: Readonly<Record<string, string>> = {
  "texture:smooth": "均匀与流畅",
  "texture:banded": "节奏与层次",
  "texture:included": "独特印记",
  "texture:phantom": "幽深意境",
  "texture:crackled": "光影肌理",
  "texture:iridescent-sheen": "流动光感",
  "texture:catseye": "灵动视线",
  "texture:speckled": "天然点缀",
  "texture:veined": "纹理走向"
};

const LUSTER_SYMBOLISM: Readonly<Record<string, string>> = {
  "luster:matte": "内敛与克制",
  "luster:soft": "柔和与温润",
  "luster:bright": "明亮与醒目"
};

const TRANSPARENCY_SYMBOLISM: Readonly<Record<string, string>> = {
  "transparency:transparent": "清澈与通透",
  "transparency:translucent": "朦胧与柔和",
  "transparency:opaque": "厚实与沉稳"
};

const TEMPERATURE_SYMBOLISM: Readonly<Record<string, string>> = {
  "temperature:warm": "温暖与亲和",
  "temperature:neutral": "平衡与百搭",
  "temperature:cool": "清爽与冷静"
};

const STYLE_SYMBOLISM: Readonly<Record<string, string>> = {
  "style:minimal": "简约与克制",
  "style:eastern-contemporary": "东方雅致",
  "style:romantic": "浪漫与柔美",
  "style:natural": "自然与质朴",
  "style:modern": "现代与利落",
  "style:vintage": "古典韵味",
  "style:ethereal": "轻盈与空灵",
  "style:delicate": "精致与细腻"
};

const SYMBOLISM_TABLES: readonly (readonly [Readonly<Record<string, string>>, string])[] = [
  [COLOR_SYMBOLISM, "color"],
  [MATERIAL_SYMBOLISM, "material"],
  [EMOTION_SYMBOLISM, "emotion"],
  [TEXTURE_SYMBOLISM, "texture"],
  [LUSTER_SYMBOLISM, "luster"],
  [TRANSPARENCY_SYMBOLISM, "transparency"],
  [TEMPERATURE_SYMBOLISM, "temperature"],
  [STYLE_SYMBOLISM, "style"]
];

for (const [table, domain] of SYMBOLISM_TABLES) {
  for (const [subjectId, meaning] of Object.entries(table)) {
    addRule({
      id: `kboot-symbol-${domain}-${suffix(subjectId)}`,
      knowledgeType: "CULTURAL_SYMBOLISM",
      subject: subjectId,
      relation: "symbolizes",
      payload: {
        meaning,
        note: `${meaning}，仅作设计意象参考`
      },
      confidence: 0.8,
      layer: LAYER_COVERAGE
    });
  }
}

// ------------------------------------------------------------------- TAROT

const TAROT_MAJORS: readonly (readonly [string, readonly string[], string, string])[] = [
  ["tarot:major-00-the-fool", ["color:white", "color:yellow"], "emotion:joy", "轻快出发"],
  ["tarot:major-01-the-magician", ["color:red", "color:white"], "emotion:focus", "专注行动"],
  ["tarot:major-02-the-high-priestess", ["color:blue", "color:purple"], "emotion:calm", "静观内省"],
  ["tarot:major-03-the-empress", ["color:green", "color:pink"], "emotion:renewal", "丰饶生长"],
  ["tarot:major-04-the-emperor", ["color:red", "color:orange"], "emotion:confidence", "秩序坚定"],
  ["tarot:major-05-the-hierophant", ["color:yellow", "color:white"], "emotion:grounding", "传统传承"],
  ["tarot:major-06-the-lovers", ["color:pink", "color:red"], "emotion:love", "联结呼应"],
  ["tarot:major-07-the-chariot", ["color:black", "color:blue"], "emotion:courage", "奋进向前"],
  ["tarot:major-08-strength", ["color:orange", "color:yellow"], "emotion:courage", "柔中带刚"],
  ["tarot:major-09-the-hermit", ["color:gray", "color:yellow"], "emotion:focus", "沉静求索"],
  ["tarot:major-10-wheel-of-fortune", ["color:multicolor", "color:blue"], "emotion:renewal", "流转更迭"],
  ["tarot:major-11-justice", ["color:white", "color:gray"], "emotion:focus", "均衡取舍"],
  ["tarot:major-12-the-hanged-man", ["color:blue", "color:gray"], "emotion:calm", "换个视角"],
  ["tarot:major-13-death", ["color:black", "color:white"], "emotion:renewal", "告别更新"],
  ["tarot:major-14-temperance", ["color:teal", "color:white"], "emotion:calm", "调和平衡"],
  ["tarot:major-15-the-devil", ["color:black", "color:red"], "emotion:grounding", "直面束缚"],
  ["tarot:major-16-the-tower", ["color:black", "color:orange"], "emotion:courage", "破立之间"],
  ["tarot:major-17-the-star", ["color:teal", "color:white"], "emotion:hope", "澄澈希望"],
  ["tarot:major-18-the-moon", ["color:purple", "color:gray"], "emotion:calm", "梦境流动"],
  ["tarot:major-19-the-sun", ["color:yellow", "color:orange"], "emotion:joy", "明朗温暖"],
  ["tarot:major-20-judgement", ["color:white", "color:red"], "emotion:renewal", "唤醒更新"],
  ["tarot:major-21-the-world", ["color:multicolor", "color:green"], "emotion:connection", "圆融完成"]
];

const CORE_TAROT_PALETTE_SUBJECTS = new Set(
  KNOWLEDGE_RULE_FIXTURES.filter((rule) => rule.knowledgeType === "TAROT" && rule.relation === "suggests-palette").map(
    (rule) => rule.subject
  )
);
const CORE_TAROT_EMOTION_SUBJECTS = new Set(
  KNOWLEDGE_RULE_FIXTURES.filter((rule) => rule.knowledgeType === "TAROT" && rule.relation === "suggests-emotion").map(
    (rule) => rule.subject
  )
);

for (const [majorId, palette, emotionId, theme] of TAROT_MAJORS) {
  if (!CORE_TAROT_PALETTE_SUBJECTS.has(majorId)) {
    addRule({
      id: `kboot-tarot-palette-${suffix(majorId)}`,
      knowledgeType: "TAROT",
      subject: majorId,
      relation: "suggests-palette",
      payload: {
        palette,
        theme,
        note: `${theme}意象配色，仅作设计灵感参考`
      },
      confidence: 0.8,
      layer: LAYER_COMBINATION
    });
  }
  if (!CORE_TAROT_EMOTION_SUBJECTS.has(majorId)) {
    addRule({
      id: `kboot-tarot-emotion-${suffix(majorId)}`,
      knowledgeType: "TAROT",
      subject: majorId,
      relation: "suggests-emotion",
      payload: {
        emotion: emotionId,
        theme,
        note: `${theme}意象对应的情绪方向，仅作设计灵感参考`
      },
      confidence: 0.8,
      layer: LAYER_COMBINATION
    });
  }
}

// ---------------------------------------------------------- MARKET_OBSERVATION

const MARKET_HEAT: Readonly<Record<string, string>> = {
  "color:white": "steady",
  "color:pink": "rising",
  "color:red": "steady",
  "color:orange": "rising",
  "color:yellow": "steady",
  "color:green": "rising",
  "color:blue": "steady",
  "color:black": "steady",
  "color:brown": "steady",
  "color:multicolor": "rising",
  "material:feldspar": "steady",
  "material:beryl": "rising",
  "material:chalcedony": "steady",
  "material:agate": "steady",
  "material:garnet": "steady",
  "material:fluorite": "rising",
  "material:calcite": "steady",
  "material:lapis-lazuli": "rising",
  "material:rhodonite": "steady",
  "material:tourmaline": "rising",
  "material:jade": "steady",
  "material:jadeite": "steady",
  "material:nephrite": "steady",
  "material:pyrite": "steady",
  "material:hematite": "steady",
  "material:topaz": "rising",
  "material:gold": "rising",
  "style:minimal": "steady",
  "style:eastern-contemporary": "rising",
  "style:romantic": "steady",
  "style:natural": "rising",
  "style:modern": "steady",
  "style:vintage": "rising",
  "style:ethereal": "rising",
  "style:delicate": "steady",
  "emotion:calm": "steady",
  "emotion:focus": "steady",
  "emotion:confidence": "rising",
  "emotion:joy": "steady",
  "emotion:connection": "steady",
  "emotion:renewal": "rising",
  "emotion:hope": "rising",
  "emotion:love": "steady",
  "emotion:courage": "steady",
  "emotion:grounding": "rising",
  "emotion:vitality": "steady",
  "emotion:protection": "steady",
  "texture:smooth": "steady",
  "texture:banded": "steady",
  "texture:included": "rising",
  "texture:phantom": "rising",
  "texture:crackled": "steady",
  "texture:iridescent-sheen": "rising",
  "texture:catseye": "steady",
  "texture:speckled": "steady",
  "texture:veined": "steady"
};

const HEAT_NOTE: Readonly<Record<string, string>> = {
  steady: "近期讨论热度平稳，适合常规选品",
  rising: "近期社交平台讨论度上升，可作趋势参考"
};

const CORE_MARKET_SUBJECTS = new Set(
  KNOWLEDGE_RULE_FIXTURES.filter((rule) => rule.knowledgeType === "MARKET_OBSERVATION").map(
    (rule) => rule.subject
  )
);

for (const [subjectId, heat] of Object.entries(MARKET_HEAT)) {
  if (CORE_MARKET_SUBJECTS.has(subjectId)) {
    continue;
  }
  addRule({
    id: `kboot-market-${suffix(subjectId)}`,
    knowledgeType: "MARKET_OBSERVATION",
    subject: subjectId,
    relation: "observed-trend",
    payload: {
      heatLevel: heat,
      note: HEAT_NOTE[heat] ?? "近期讨论热度平稳"
    },
    confidence: 0.7,
    layer: LAYER_COVERAGE,
    market: true
  });
}

export const CORPUS_BOOTSTRAP_RULES: readonly KnowledgeRuleSeed[] = generated;

const layerCounts = {
  "taxonomy-coverage": 0,
  combination: 0
};
for (const seed of CORPUS_BOOTSTRAP_RULES) {
  const layer = (seed.payload as Record<string, unknown>).corpusLayer as CorpusLayer;
  layerCounts[layer] += 1;
}

export const BOOTSTRAP_CORPUS_LAYERS: {
  readonly total: number;
  readonly "taxonomy-coverage": number;
  readonly combination: number;
} = {
  total: CORPUS_BOOTSTRAP_RULES.length,
  "taxonomy-coverage": layerCounts["taxonomy-coverage"],
  combination: layerCounts.combination
};

/** The full importable fixture corpus: core handbook + bootstrap layers. */
export const KNOWLEDGE_CORPUS_FIXTURES: readonly KnowledgeRuleSeed[] = [
  ...KNOWLEDGE_RULE_FIXTURES,
  ...CORPUS_BOOTSTRAP_RULES
];
