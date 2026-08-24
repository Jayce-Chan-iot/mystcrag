import type { RecommendationContext } from "@mystcrag/design-contract";

/**
 * Golden scenarios for the design-quality evaluation (§17.5). Each scenario
 * is a RecommendationContext plus declarative expectations the evaluated
 * pipeline must satisfy. Contexts mirror the shapes produced by
 * context-resolver (questionnaire / manual / tarot sources).
 */
export const GOLDEN_SET_VERSION = "golden-set-v1";

export type PreferenceKind = "color" | "style" | "emotion";

export type GoldenExpectations = {
  /** Floor for the top candidate's overallScore. */
  minOverallScore?: number;
  /** Floor for the top candidate's coverage of one preference dimension. */
  minPreferenceCoverage?: { kind: PreferenceKind; rate: number };
  /** No candidate may carry a HARD_RULE violation. */
  hardViolationFree?: boolean;
  /** Every candidate's materialCostMinor must stay under maxBudgetMinor. */
  budgetRespected?: boolean;
  /** No candidate may use an excluded product. */
  excludedAbsent?: boolean;
  /** Every candidate must contain the required product. */
  requiredPresent?: boolean;
  /** No candidate may use an avoided material. */
  avoidedMaterialAbsent?: boolean;
  /** Minimum number of returned candidates. */
  minCandidates?: number;
  /** The top candidate's trace must list at least one fired knowledge rule. */
  mustFireRules?: boolean;
};

export type GoldenScenario = {
  id: string;
  description: string;
  context: RecommendationContext;
  stock?: ReadonlyMap<string, number>;
  expectations: GoldenExpectations;
};

type ContextOverrides = {
  contextId: string;
  sourceType?: "context-source:questionnaire" | "context-source:manual" | "context-source:tarot";
  wristCircumferenceMm?: number;
  targetInnerCircumferenceMm?: number;
  maxBudgetMinor?: number;
  requiredProductIds?: readonly string[];
  excludedProductIds?: readonly string[];
  emotionTags?: readonly string[];
  styleTags?: readonly string[];
  colorPreferences?: readonly string[];
  visualPreferences?: readonly string[];
  materialAvoidances?: readonly string[];
  colorAvoidances?: readonly string[];
};

function goldenContext(overrides: ContextOverrides): RecommendationContext {
  return {
    contextId: overrides.contextId,
    locale: "zh-CN",
    currency: "CNY",
    sources: [{ sourceType: overrides.sourceType ?? "context-source:questionnaire", weight: 1 }],
    hardConstraints: {
      wristCircumferenceMm: overrides.wristCircumferenceMm ?? 155,
      ...(overrides.targetInnerCircumferenceMm === undefined
        ? {}
        : { targetInnerCircumferenceMm: overrides.targetInnerCircumferenceMm }),
      ...(overrides.maxBudgetMinor === undefined ? {} : { maxBudgetMinor: overrides.maxBudgetMinor }),
      requiredProductIds: [...(overrides.requiredProductIds ?? [])],
      excludedProductIds: [...(overrides.excludedProductIds ?? [])],
      mustKeepComponentIds: []
    },
    preferences: {
      emotionTags: [...(overrides.emotionTags ?? [])],
      styleTags: [...(overrides.styleTags ?? [])],
      colorPreferences: [...(overrides.colorPreferences ?? [])],
      visualPreferences: [...(overrides.visualPreferences ?? [])]
    },
    avoidances: {
      materialIds: [...(overrides.materialAvoidances ?? [])],
      colorFamilyIds: [...(overrides.colorAvoidances ?? [])]
    },
    contextWeights: {}
  };
}

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    id: "golden-preference-calm-purple",
    description: "冷静紫调偏好：紫色 + 平静情绪，推荐应命中紫色系并触发情绪知识规则",
    context: goldenContext({
      contextId: "golden-calm-purple",
      colorPreferences: ["color:purple"],
      emotionTags: ["emotion:calm"]
    }),
    expectations: {
      minOverallScore: 85,
      minPreferenceCoverage: { kind: "color", rate: 1 },
      hardViolationFree: true,
      minCandidates: 1,
      mustFireRules: true
    }
  },
  {
    id: "golden-preference-ethereal-pastel",
    description: "空灵浅色系偏好：ethereal 风格 + 白/粉浅色，风格覆盖应达标",
    context: goldenContext({
      contextId: "golden-ethereal-pastel",
      styleTags: ["style:ethereal"],
      colorPreferences: ["color:white", "color:pink"]
    }),
    expectations: {
      minOverallScore: 87,
      minPreferenceCoverage: { kind: "style", rate: 1 },
      hardViolationFree: true,
      minCandidates: 1,
      mustFireRules: true
    }
  },
  {
    id: "golden-preference-bold-modern",
    description: "现代利落偏好：modern 风格 + 勇气情绪，黑/灰主色可命中",
    context: goldenContext({
      contextId: "golden-bold-modern",
      styleTags: ["style:modern"],
      emotionTags: ["emotion:courage"],
      colorPreferences: ["color:black", "color:gray"]
    }),
    expectations: {
      minOverallScore: 90,
      minPreferenceCoverage: { kind: "style", rate: 1 },
      hardViolationFree: true,
      minCandidates: 1,
      mustFireRules: true
    }
  },
  {
    id: "golden-budget-capped",
    description: "预算受限：总预算 6000 分，候选成本不得超预算",
    context: goldenContext({
      contextId: "golden-budget-capped",
      maxBudgetMinor: 6000,
      colorPreferences: ["color:purple"],
      emotionTags: ["emotion:calm"]
    }),
    expectations: {
      minOverallScore: 78,
      budgetRespected: true,
      hardViolationFree: true,
      minCandidates: 1
    }
  },
  {
    id: "golden-excluded-product",
    description: "排除商品：黄水晶被排除后不得出现在任何候选中",
    context: goldenContext({
      contextId: "golden-excluded-product",
      excludedProductIds: ["product-citrine-10"],
      emotionTags: ["emotion:joy"],
      colorPreferences: ["color:yellow"]
    }),
    expectations: {
      minOverallScore: 82,
      excludedAbsent: true,
      hardViolationFree: true,
      minCandidates: 1
    }
  },
  {
    id: "golden-required-product",
    description: "必含商品：紫水晶 8mm 必须进入每个候选",
    context: goldenContext({
      contextId: "golden-required-product",
      requiredProductIds: ["product-amethyst-8"],
      colorPreferences: ["color:purple"],
      emotionTags: ["emotion:calm"]
    }),
    expectations: {
      minOverallScore: 85,
      requiredPresent: true,
      hardViolationFree: true,
      minCandidates: 1,
      mustFireRules: true
    }
  },
  {
    id: "golden-avoid-material",
    description: "材质回避：回避黑曜石后任何候选不得含黑曜石材质",
    context: goldenContext({
      contextId: "golden-avoid-material",
      materialAvoidances: ["material:obsidian"],
      emotionTags: ["emotion:grounding"]
    }),
    expectations: {
      minOverallScore: 81,
      avoidedMaterialAbsent: true,
      hardViolationFree: true,
      minCandidates: 1
    }
  },
  {
    id: "golden-small-wrist",
    description: "小腕围（130mm）：几何约束不得溢出，仍能给出候选",
    context: goldenContext({
      contextId: "golden-small-wrist",
      wristCircumferenceMm: 130,
      colorPreferences: ["color:purple"],
      emotionTags: ["emotion:calm"]
    }),
    expectations: {
      minOverallScore: 85,
      hardViolationFree: true,
      minCandidates: 1
    }
  },
  {
    id: "golden-large-wrist",
    description: "大腕围（185mm）：几何约束不得溢出，候选可完整成串",
    context: goldenContext({
      contextId: "golden-large-wrist",
      wristCircumferenceMm: 185,
      colorPreferences: ["color:purple"],
      emotionTags: ["emotion:calm"]
    }),
    expectations: {
      minOverallScore: 85,
      hardViolationFree: true,
      minCandidates: 1
    }
  },
  {
    id: "golden-tarot-star",
    description: "塔罗来源（星星牌）：hope/blue/white/ethereal 信号应驱动颜色覆盖与规则触发",
    context: goldenContext({
      contextId: "golden-tarot-star",
      sourceType: "context-source:tarot",
      colorPreferences: ["color:blue", "color:white"],
      emotionTags: ["emotion:hope", "emotion:calm"],
      styleTags: ["style:ethereal"]
    }),
    expectations: {
      minOverallScore: 88,
      minPreferenceCoverage: { kind: "color", rate: 0.5 },
      hardViolationFree: true,
      minCandidates: 1,
      mustFireRules: true
    }
  },
  {
    id: "golden-multi-material",
    description: "开放偏好（无强约束）：应产出完整候选集并保持硬约束零违规",
    context: goldenContext({
      contextId: "golden-multi-material",
      emotionTags: ["emotion:calm"],
      styleTags: ["style:minimal"]
    }),
    expectations: {
      minOverallScore: 80,
      hardViolationFree: true,
      minCandidates: 3,
      mustFireRules: true
    }
  },
  {
    id: "golden-stock-limited",
    description: "库存受限：紫水晶与月光石库存紧张，规划不得超出库存",
    context: goldenContext({
      contextId: "golden-stock-limited",
      colorPreferences: ["color:purple", "color:white"],
      emotionTags: ["emotion:hope"]
    }),
    stock: new Map([
      ["product-amethyst-8", 3],
      ["product-amethyst-10", 2],
      ["product-aquamarine-8", 3],
      ["product-moonstone-6", 2],
      ["product-rose-quartz-8", 4],
      ["product-rose-quartz-6", 4],
      ["product-silver-spacer-4", 30]
    ]),
    expectations: {
      minOverallScore: 84,
      hardViolationFree: true,
      minCandidates: 1
    }
  }
];
