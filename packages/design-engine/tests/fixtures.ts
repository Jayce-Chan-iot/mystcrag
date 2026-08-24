import type {
  CatalogMaterialProduct,
  DecisionRule,
  RecommendationContext
} from "@mystcrag/design-contract";

import type { CatalogProduct, EngineRuleSet } from "../src/index.js";

export function catalogProduct(overrides: Partial<CatalogProduct> & {
  beadProductId: string;
}): CatalogProduct {
  return {
    beadProductId: overrides.beadProductId,
    displayName: overrides.displayName ?? "Bead",
    crystalId: overrides.crystalId ?? "crystal-x",
    crystalNameCn: overrides.crystalNameCn ?? "水晶",
    crystalNameEn: overrides.crystalNameEn ?? "Crystal",
    colorTags: overrides.colorTags ?? ["color:blue"],
    visualTags: overrides.visualTags ?? ["transparency:translucent"],
    styleTags: overrides.styleTags ?? ["style:minimal"],
    emotionTags: overrides.emotionTags ?? ["emotion:calm"],
    cultureTags: overrides.cultureTags ?? [],
    materialKey: overrides.materialKey ?? "material:quartz",
    shape: overrides.shape ?? "ROUND",
    diameterMm: overrides.diameterMm ?? 8,
    lengthAlongStringMm: overrides.lengthAlongStringMm,
    modelAssetKey: overrides.modelAssetKey ?? "sphere-round-8mm-v1",
    textureAssetKey: overrides.textureAssetKey ?? "texture-v1",
    currency: overrides.currency ?? "CNY",
    unitPriceMinor: overrides.unitPriceMinor ?? 500
  };
}

export const CATALOG: readonly CatalogProduct[] = [
  catalogProduct({
    beadProductId: "product-amethyst-8",
    displayName: "紫水晶 8mm",
    crystalId: "crystal-amethyst",
    colorTags: ["color:purple"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    materialKey: "material:amethyst",
    diameterMm: 8,
    unitPriceMinor: 600
  }),
  catalogProduct({
    beadProductId: "product-aquamarine-8",
    displayName: "海蓝宝 8mm",
    crystalId: "crystal-aquamarine",
    colorTags: ["color:blue"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    materialKey: "material:aquamarine",
    diameterMm: 8,
    unitPriceMinor: 700
  }),
  catalogProduct({
    beadProductId: "product-moonstone-6",
    displayName: "月光石 6mm",
    crystalId: "crystal-moonstone",
    colorTags: ["color:white"],
    styleTags: ["style:ethereal"],
    emotionTags: ["emotion:hope"],
    materialKey: "material:moonstone",
    diameterMm: 6,
    unitPriceMinor: 450
  }),
  catalogProduct({
    beadProductId: "product-citrine-10",
    displayName: "黄水晶 10mm",
    crystalId: "crystal-citrine",
    colorTags: ["color:yellow"],
    styleTags: ["style:natural"],
    emotionTags: ["emotion:joy"],
    materialKey: "material:citrine",
    diameterMm: 10,
    unitPriceMinor: 800
  }),
  catalogProduct({
    beadProductId: "product-obsidian-8",
    displayName: "黑曜石 8mm",
    crystalId: "crystal-obsidian",
    colorTags: ["color:black"],
    styleTags: ["style:bold"],
    emotionTags: ["emotion:grounded"],
    materialKey: "material:obsidian",
    diameterMm: 8,
    unitPriceMinor: 300
  })
];

export function buildContext(
  overrides?: Partial<RecommendationContext["hardConstraints"]> & {
    preferences?: Partial<RecommendationContext["preferences"]>;
    avoidances?: Partial<RecommendationContext["avoidances"]>;
  }
): RecommendationContext {
  return {
    contextId: "ctx-test-0001",
    locale: "zh-CN",
    currency: "CNY",
    sources: [{ sourceType: "context-source:questionnaire", weight: 1 }],
    hardConstraints: {
      wristCircumferenceMm: 155,
      requiredProductIds: [],
      excludedProductIds: [],
      mustKeepComponentIds: [],
      ...overrides
    },
    preferences: {
      emotionTags: [],
      styleTags: [],
      colorPreferences: [],
      visualPreferences: [],
      ...overrides?.preferences
    },
    avoidances: {
      materialIds: [],
      colorFamilyIds: [],
      ...overrides?.avoidances
    },
    contextWeights: {}
  };
}

function rule(overrides: Partial<DecisionRule> & { id: string }): DecisionRule {
  return {
    id: overrides.id,
    type: overrides.type ?? "COLOR_THEORY",
    priority: overrides.priority ?? "P4",
    hardness: overrides.hardness ?? "SOFT",
    conditions: overrides.conditions ?? {
      fact: "designTaxonomyRefs",
      operator: "contains",
      value: "color:blue"
    },
    action: overrides.action ?? { kind: "harmonizes-with", params: {} },
    weight: overrides.weight ?? 0.8,
    confidence: overrides.confidence ?? 0.9,
    knowledgeRefs: overrides.knowledgeRefs ?? [`kr-${overrides.id}`],
    contextRefs: overrides.contextRefs ?? []
  };
}

export const RULE_SET: EngineRuleSet = {
  knowledgeVersion: "knowledge-test-v1",
  productCatalogVersion: "catalog-test-v1",
  decisionRuleSetVersion: "rules-test-v1",
  rules: [
    rule({
      id: "dr-soft-blue",
      conditions: { fact: "designTaxonomyRefs", operator: "contains", value: "color:blue" },
      weight: 0.5,
      confidence: 0.8
    }),
    rule({
      id: "dr-soft-tarot",
      priority: "P6",
      conditions: { fact: "contextTaxonomyRefs", operator: "contains", value: "emotion:hope" },
      action: { kind: "suggests-emotion", params: {} },
      weight: 0.4,
      confidence: 0.7
    }),
    rule({
      id: "dr-hard-conflict",
      priority: "P1",
      hardness: "HARD",
      conditions: {
        all: [
          { fact: "designTaxonomyRefs", operator: "contains", value: "color:purple" },
          { fact: "designTaxonomyRefs", operator: "contains", value: "color:yellow" }
        ]
      },
      action: { kind: "conflicts-with", params: {} },
      weight: 1,
      confidence: 1
    })
  ]
};

export const NOW = "2026-08-21T12:00:00.000Z";

export type { CatalogMaterialProduct };
