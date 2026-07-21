import { DesignV1Schema } from "../schemas/design.schema";

export const standardAiDesignFixture = DesignV1Schema.parse({
  schemaVersion: "1.0.0",
  designId: "design-ai-standard",
  designName: "Rain After Blue",
  designMode: "AI_GENERATED",
  revision: 1,
  createdAt: "2026-07-21T06:00:00.000Z",
  updatedAt: "2026-07-21T06:05:00.000Z",
  locale: "zh-CN",
  currency: "CNY",
  bracelet: {
    wristCircumferenceMm: 155,
    targetInnerCircumferenceMm: 162,
    elasticAllowanceMm: 7,
    braceletLayout: "CIRCLE",
    beadGapMm: 0.4,
    totalBeadCount: 3
  },
  beads: [
    {
      componentId: "bead-aquamarine-1",
      positionIndex: 0,
      beadProductId: "product-aquamarine-round-8",
      crystalId: "crystal-aquamarine",
      materialKey: "aquamarine-clear-v1",
      shape: "ROUND",
      diameterMm: 8,
      quantity: 1,
      role: "MAIN",
      modelAssetKey: "sphere-round-8mm-v1",
      textureAssetKey: "aquamarine-clear-texture-v1",
      unitPriceMinor: 1200
    },
    {
      componentId: "bead-moonstone-1",
      positionIndex: 2,
      beadProductId: "product-moonstone-round-6",
      crystalId: "crystal-moonstone",
      materialKey: "moonstone-soft-v1",
      shape: "ROUND",
      diameterMm: 6,
      quantity: 1,
      role: "ACCENT",
      modelAssetKey: "sphere-round-6mm-v1",
      textureAssetKey: "moonstone-soft-texture-v1",
      unitPriceMinor: 800
    },
    {
      componentId: "bead-quartz-1",
      positionIndex: 3,
      beadProductId: "product-quartz-round-10",
      crystalId: "crystal-clear-quartz",
      materialKey: "clear-quartz-v1",
      shape: "ROUND",
      diameterMm: 10,
      quantity: 1,
      role: "FOCAL",
      modelAssetKey: "sphere-round-10mm-v1",
      textureAssetKey: "clear-quartz-texture-v1",
      unitPriceMinor: 1000
    }
  ],
  accessories: [
    {
      componentId: "accessory-spacer-1",
      accessoryType: "SPACER",
      accessoryProductId: "product-spacer-silver-3",
      placementMode: "INLINE",
      positionIndex: 1,
      material: "STERLING_SILVER",
      finish: "POLISHED",
      dimensions: { diameterMm: 3, widthMm: 2 },
      quantity: 1,
      unitPriceMinor: 300,
      modelAssetKey: "spacer-silver-3mm-v1"
    },
    {
      componentId: "accessory-pendant-1",
      accessoryType: "PENDANT",
      accessoryProductId: "product-pendant-drop-silver-8",
      placementMode: "ANCHORED",
      anchorComponentId: "accessory-spacer-1",
      anchorSlot: 0,
      material: "STERLING_SILVER",
      finish: "POLISHED",
      dimensions: { widthMm: 5, heightMm: 8, depthMm: 2 },
      quantity: 1,
      unitPriceMinor: 500,
      modelAssetKey: "pendant-drop-silver-8mm-v1"
    }
  ],
  story: {
    emotionTags: ["calm"],
    styleTags: ["minimal", "eastern-contemporary"],
    colorPalette: ["#A8D8E8", "#F6F3EC"],
    culturalInspiration: [
      {
        reference: "rain-cleared-sky imagery",
        inspiration: "Translucent blue and soft white contrast guide the visual rhythm.",
        disclaimerKey: "CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"
      }
    ],
    designStory: "A cool, translucent rhythm inspired by the sky after rain.",
    recommendationReasons: ["Matches the selected cool palette and minimal style."],
    sourceTemplateIds: ["template-rain-after-blue-v3"]
  },
  pricing: {
    materialSubtotalMinor: 3000,
    accessorySubtotalMinor: 800,
    laborFeeMinor: 500,
    designFeeMinor: 300,
    packagingFeeMinor: 200,
    platformFeeEstimateMinor: 100,
    logisticsFeeEstimateMinor: 600,
    discountMinor: 0,
    adjustments: [],
    totalPriceMinor: 5500,
    pricingVersion: "cny-retail-2026-07-v1",
    priceCalculatedAt: "2026-07-21T06:05:00.000Z"
  },
  production: {
    wristCircumferenceMm: 155,
    billOfMaterials: [
      {
        productId: "product-aquamarine-round-8",
        specification: "ROUND 8mm",
        quantity: 1,
        sourceComponentIds: ["bead-aquamarine-1"]
      },
      {
        productId: "product-moonstone-round-6",
        specification: "ROUND 6mm",
        quantity: 1,
        sourceComponentIds: ["bead-moonstone-1"]
      },
      {
        productId: "product-quartz-round-10",
        specification: "ROUND 10mm",
        quantity: 1,
        sourceComponentIds: ["bead-quartz-1"]
      },
      {
        productId: "product-spacer-silver-3",
        specification: "STERLING_SILVER 3mm",
        quantity: 1,
        sourceComponentIds: ["accessory-spacer-1"]
      },
      {
        productId: "product-pendant-drop-silver-8",
        specification: "STERLING_SILVER 5x8x2mm",
        quantity: 1,
        sourceComponentIds: ["accessory-pendant-1"]
      }
    ],
    componentSequence: [
      "bead-aquamarine-1",
      "accessory-spacer-1",
      "bead-moonstone-1",
      "bead-quartz-1"
    ],
    anchoredComponents: [
      {
        componentId: "accessory-pendant-1",
        anchorComponentId: "accessory-spacer-1",
        anchorSlot: 0
      }
    ],
    productionNotes: [],
    substitutionRules: []
  },
  compliance: {
    complianceStatus: "PASSED",
    restrictedClaims: [],
    disclaimerKeys: ["CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"],
    reviewRequired: false
  },
  provenance: {
    generatedBy: "AI",
    modelProvider: "provider-key",
    modelName: "model-key",
    promptVersion: "design-prompt-v1",
    knowledgeBaseVersion: "crystal-kb-2026-07",
    designTemplateVersion: "template-rain-v3",
    pricingRuleVersion: "cny-retail-2026-07-v1",
    sourceDesignId: null
  },
  community: {
    visibility: "PRIVATE",
    publishConsent: false,
    allowRemix: false,
    creatorDisplayMode: "ANONYMOUS"
  }
});
