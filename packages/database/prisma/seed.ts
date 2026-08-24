import {
  DesignV1Schema,
  VisualProfileSchema,
  getTaxonomyTerm,
  resolveTaxonomyId,
  type VisualProfile
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createPrismaClient } from "../src/client/prisma-client.js";
import { minorToBigInt } from "../src/mappers/money.mapper.js";
import { toPrismaJson } from "../src/mappers/snapshot.mapper.js";

const USER_ID = "user-phase-2c-demo";

const publishedRevision1 = DesignV1Schema.parse({
  ...structuredClone(standardAiDesignFixture),
  designId: "design-ai-published",
  community: {
    visibility: "PUBLIC",
    publishConsent: true,
    allowRemix: true,
    creatorDisplayMode: "DISPLAY_NAME"
  }
});

const publishedRevision2 = DesignV1Schema.parse({
  ...structuredClone(publishedRevision1),
  designName: "Rain After Blue · Refined",
  revision: 2,
  updatedAt: "2026-07-21T07:00:00.000Z"
});

const diyDesign = DesignV1Schema.parse({
  ...structuredClone(standardAiDesignFixture),
  designId: "design-diy-private",
  designName: "Quiet Orbit",
  designMode: "DIY_CREATED",
  provenance: {
    generatedBy: "USER",
    modelProvider: null,
    modelName: null,
    promptVersion: null,
    knowledgeBaseVersion: null,
    designTemplateVersion: null,
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

const rejectedDesign = DesignV1Schema.parse({
  ...structuredClone(standardAiDesignFixture),
  designId: "design-rejected",
  designName: "Blocked Claim Review",
  story: {
    ...structuredClone(standardAiDesignFixture.story),
    designStory: "A test-only example containing prohibited guaranteed-effect wording."
  },
  compliance: {
    complianceStatus: "REJECTED",
    restrictedClaims: [
      {
        code: "CLAIM_GUARANTEED_EFFECT",
        category: "GUARANTEED_FORTUNE_CHANGE",
        fieldPath: "story.designStory",
        severity: "HIGH",
        userVisibleMessage: "Guaranteed-effect wording is not allowed."
      }
    ],
    disclaimerKeys: ["CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT"],
    reviewRequired: true
  },
  community: {
    visibility: "PRIVATE",
    publishConsent: false,
    allowRemix: false,
    creatorDisplayMode: "ANONYMOUS"
  }
});

type CrystalSeed = {
  id: string;
  nameCn: string;
  nameEn: string;
  mineralName: string;
  colorTags: string[];
  productSlug: string;
  skuPrefix: string;
  shape: "ROUND" | "FACETED";
  diameterMm: number;
  cnyPrice: number;
  twdPrice: number;
  grade?: string;
  extraSizes?: number[];
};

const crystals: readonly CrystalSeed[] = [
  {
    id: "crystal-aquamarine",
    nameCn: "海蓝宝",
    nameEn: "Aquamarine",
    mineralName: "Beryl",
    colorTags: ["blue", "cool", "translucent"],
    productSlug: "aquamarine",
    skuPrefix: "AQ",
    shape: "ROUND",
    diameterMm: 8,
    cnyPrice: 1200,
    twdPrice: 560,
    grade: "AA",
    extraSizes: [6, 10]
  },
  {
    id: "crystal-moonstone",
    nameCn: "月光石",
    nameEn: "Moonstone",
    mineralName: "Feldspar",
    colorTags: ["white", "blue", "iridescent"],
    productSlug: "moonstone",
    skuPrefix: "MO",
    shape: "ROUND",
    diameterMm: 6,
    cnyPrice: 800,
    twdPrice: 370,
    extraSizes: [8, 10]
  },
  {
    id: "crystal-clear-quartz",
    nameCn: "白水晶",
    nameEn: "Clear Quartz",
    mineralName: "Quartz",
    colorTags: ["clear", "white", "neutral"],
    productSlug: "quartz",
    skuPrefix: "QU",
    shape: "ROUND",
    diameterMm: 10,
    cnyPrice: 1000,
    twdPrice: 460,
    extraSizes: [6, 8]
  },
  { id: "crystal-amethyst", nameCn: "紫水晶", nameEn: "Amethyst", mineralName: "Quartz", colorTags: ["purple", "cool", "deep"], productSlug: "amethyst", skuPrefix: "AM", shape: "FACETED", diameterMm: 8, cnyPrice: 680, twdPrice: 340, grade: "AA", extraSizes: [6, 10] },
  { id: "crystal-rose-quartz", nameCn: "粉水晶", nameEn: "Rose Quartz", mineralName: "Quartz", colorTags: ["pink", "warm", "soft"], productSlug: "rose-quartz", skuPrefix: "RQ", shape: "ROUND", diameterMm: 8, cnyPrice: 360, twdPrice: 180, extraSizes: [6, 10] },
  { id: "crystal-citrine", nameCn: "黄水晶", nameEn: "Citrine", mineralName: "Quartz", colorTags: ["yellow", "gold", "warm"], productSlug: "citrine", skuPrefix: "CI", shape: "FACETED", diameterMm: 8, cnyPrice: 840, twdPrice: 420, grade: "AA", extraSizes: [6, 10] },
  { id: "crystal-green-aventurine", nameCn: "绿东陵石", nameEn: "Green Aventurine", mineralName: "Quartz", colorTags: ["green", "soft", "natural"], productSlug: "green-aventurine", skuPrefix: "GA", shape: "ROUND", diameterMm: 8, cnyPrice: 300, twdPrice: 150 },
  { id: "crystal-tiger-eye", nameCn: "虎眼石", nameEn: "Tiger Eye", mineralName: "Quartz", colorTags: ["brown", "gold", "warm"], productSlug: "tiger-eye", skuPrefix: "TE", shape: "ROUND", diameterMm: 8, cnyPrice: 420, twdPrice: 210, extraSizes: [6, 10] },
  { id: "crystal-lapis-lazuli", nameCn: "青金石", nameEn: "Lapis Lazuli", mineralName: "Lazurite", colorTags: ["blue", "gold", "deep"], productSlug: "lapis", skuPrefix: "LA", shape: "ROUND", diameterMm: 8, cnyPrice: 620, twdPrice: 310, extraSizes: [6, 10] },
  { id: "crystal-garnet", nameCn: "石榴石", nameEn: "Garnet", mineralName: "Garnet", colorTags: ["red", "wine", "deep"], productSlug: "garnet", skuPrefix: "GN", shape: "FACETED", diameterMm: 8, cnyPrice: 700, twdPrice: 350, grade: "AA" },
  { id: "crystal-labradorite", nameCn: "拉长石", nameEn: "Labradorite", mineralName: "Feldspar", colorTags: ["gray", "blue", "iridescent"], productSlug: "labradorite", skuPrefix: "LB", shape: "ROUND", diameterMm: 8, cnyPrice: 740, twdPrice: 370, grade: "AA" },
  { id: "crystal-black-onyx", nameCn: "黑玛瑙", nameEn: "Black Onyx", mineralName: "Chalcedony", colorTags: ["black", "neutral", "deep"], productSlug: "black-onyx", skuPrefix: "BO", shape: "ROUND", diameterMm: 8, cnyPrice: 280, twdPrice: 140, extraSizes: [6, 10] },
  { id: "crystal-smoky-quartz", nameCn: "烟晶", nameEn: "Smoky Quartz", mineralName: "Quartz", colorTags: ["brown", "gray", "neutral"], productSlug: "smoky-quartz", skuPrefix: "SQ", shape: "ROUND", diameterMm: 8, cnyPrice: 400, twdPrice: 200, extraSizes: [6, 10] },
  { id: "crystal-sunstone", nameCn: "日光石", nameEn: "Sunstone", mineralName: "Feldspar", colorTags: ["orange", "gold", "warm"], productSlug: "sunstone", skuPrefix: "SS", shape: "FACETED", diameterMm: 8, cnyPrice: 780, twdPrice: 390, grade: "AA" },
  { id: "crystal-amazonite", nameCn: "天河石", nameEn: "Amazonite", mineralName: "Feldspar", colorTags: ["green", "blue", "fresh"], productSlug: "amazonite", skuPrefix: "AZ", shape: "ROUND", diameterMm: 8, cnyPrice: 440, twdPrice: 220 },
  { id: "crystal-fluorite", nameCn: "萤石", nameEn: "Fluorite", mineralName: "Fluorite", colorTags: ["purple", "green", "clear"], productSlug: "fluorite", skuPrefix: "FL", shape: "ROUND", diameterMm: 8, cnyPrice: 500, twdPrice: 250, extraSizes: [6, 10] },
  { id: "crystal-red-agate", nameCn: "红玛瑙", nameEn: "Red Agate", mineralName: "Chalcedony", colorTags: ["red", "orange", "warm"], productSlug: "red-agate", skuPrefix: "RA", shape: "ROUND", diameterMm: 8, cnyPrice: 340, twdPrice: 170, extraSizes: [6, 10] },
  { id: "crystal-rhodonite", nameCn: "蔷薇辉石", nameEn: "Rhodonite", mineralName: "Rhodonite", colorTags: ["pink", "black", "deep"], productSlug: "rhodonite", skuPrefix: "RH", shape: "ROUND", diameterMm: 8, cnyPrice: 460, twdPrice: 230 },
  { id: "crystal-obsidian", nameCn: "黑曜石", nameEn: "Obsidian", mineralName: "Volcanic Glass", colorTags: ["black", "neutral", "deep"], productSlug: "obsidian", skuPrefix: "OB", shape: "ROUND", diameterMm: 8, cnyPrice: 320, twdPrice: 160, extraSizes: [6, 10] },
  { id: "crystal-prehnite", nameCn: "葡萄石", nameEn: "Prehnite", mineralName: "Prehnite", colorTags: ["green", "yellow", "translucent"], productSlug: "prehnite", skuPrefix: "PR", shape: "ROUND", diameterMm: 8, cnyPrice: 520, twdPrice: 260, extraSizes: [6, 10] }
];

const SIZE_PRICE_FACTORS: Record<number, number> = { 6: 0.7, 8: 1, 10: 1.4 };

function scaledPrice(basePrice: number, sizeMm: number): number {
  const factor = SIZE_PRICE_FACTORS[sizeMm] ?? 1;
  return Math.max(10, Math.round((basePrice * factor) / 10) * 10);
}

function lengthAlongStringMm(shape: "ROUND" | "FACETED", diameterMm: number): number {
  return shape === "FACETED" ? Math.round(diameterMm * 1.05 * 100) / 100 : diameterMm;
}

function holeDiameterMm(diameterMm: number): number {
  return diameterMm <= 6 ? 0.8 : 1;
}

function buildVisualProfile(colorTags: readonly string[], shape: "ROUND" | "FACETED"): VisualProfile {
  const colors: string[] = [];
  let temperature: string | null = null;
  let transparency: string | null = null;
  let saturationLevel: string | null = null;
  let lightnessLevel: string | null = null;

  for (const tag of colorTags) {
    const termId = resolveTaxonomyId(tag);
    const term = termId === null ? null : getTaxonomyTerm(termId);
    if (term === null) continue;
    if (term.domain === "COLOR" && colors.length < 2) colors.push(term.id);
    if (term.domain === "TEMPERATURE" && temperature === null) temperature = term.id;
    if (term.domain === "TRANSPARENCY" && transparency === null) transparency = term.id;
    if (term.domain === "SATURATION_LEVEL" && saturationLevel === null) saturationLevel = term.id;
    if (term.domain === "LIGHTNESS_LEVEL" && lightnessLevel === null) lightnessLevel = term.id;
  }

  const iridescent = colorTags.includes("iridescent");
  return VisualProfileSchema.parse({
    colorFamily: colors[0] ?? "color:white",
    ...(colors[1] ? { secondaryColorFamily: colors[1] } : {}),
    saturationLevel: saturationLevel ?? "saturation-level:medium",
    lightnessLevel: lightnessLevel ?? "lightness-level:medium",
    temperature: temperature ?? "temperature:neutral",
    transparency: transparency ?? "transparency:opaque",
    luster: iridescent || shape === "FACETED" ? "luster:bright" : "luster:soft",
    visualWeight: lightnessLevel === "lightness-level:low" ? "HIGH" : "MEDIUM",
    uniformity: "HIGH",
    textureComplexity: iridescent ? "HIGH" : "LOW"
  });
}

type MaterialProductSeed = {
  id: string;
  sku: string;
  crystalId: string;
  name: string;
  currency: "CNY" | "TWD";
  price: number;
  cost: number;
  shape: "ROUND" | "FACETED";
  diameterMm: number;
  lengthAlongStringMm: number;
  holeDiameterMm: number;
  grade: string;
  visualProfile: VisualProfile;
};

const materialProducts: readonly MaterialProductSeed[] = crystals.flatMap((crystal) => {
  const sizes = [crystal.diameterMm, ...(crystal.extraSizes ?? [])].sort((left, right) => left - right);
  return sizes.flatMap((sizeMm): MaterialProductSeed[] => [
    {
      id: `product-${crystal.productSlug}-${crystal.shape.toLowerCase()}-${sizeMm}`,
      sku: `${crystal.skuPrefix}-CNY-${sizeMm}`,
      crystalId: crystal.id,
      name: `${crystal.nameCn}${crystal.shape === "ROUND" ? "圆珠" : "切面珠"} ${sizeMm}mm`,
      currency: "CNY",
      price: scaledPrice(crystal.cnyPrice, sizeMm),
      cost: Math.floor((scaledPrice(crystal.cnyPrice, sizeMm) * 0.42) / 10) * 10,
      shape: crystal.shape,
      diameterMm: sizeMm,
      lengthAlongStringMm: lengthAlongStringMm(crystal.shape, sizeMm),
      holeDiameterMm: holeDiameterMm(sizeMm),
      grade: crystal.grade ?? "A",
      visualProfile: buildVisualProfile(crystal.colorTags, crystal.shape)
    },
    {
      id: `product-${crystal.productSlug}-${crystal.shape.toLowerCase()}-${sizeMm}-twd`,
      sku: `${crystal.skuPrefix}-TWD-${sizeMm}`,
      crystalId: crystal.id,
      name: `${crystal.nameCn}${crystal.shape === "ROUND" ? "圓珠" : "切面珠"} ${sizeMm}mm`,
      currency: "TWD",
      price: scaledPrice(crystal.twdPrice, sizeMm),
      cost: Math.floor((scaledPrice(crystal.twdPrice, sizeMm) * 0.42) / 10) * 10,
      shape: crystal.shape,
      diameterMm: sizeMm,
      lengthAlongStringMm: lengthAlongStringMm(crystal.shape, sizeMm),
      holeDiameterMm: holeDiameterMm(sizeMm),
      grade: crystal.grade ?? "A",
      visualProfile: buildVisualProfile(crystal.colorTags, crystal.shape)
    }
  ]);
});

const OUT_OF_STOCK_PRODUCT_IDS = new Set([
  "product-amethyst-faceted-10",
  "product-amethyst-faceted-6",
  "product-citrine-faceted-10-twd",
  "product-fluorite-round-6",
  "product-black-onyx-round-10",
  "product-rose-quartz-round-6-twd",
  "product-moonstone-round-10",
  "product-garnet-faceted-8",
  "product-pendant-drop-silver-8"
]);

const LOW_STOCK_PRODUCT_IDS = new Set([
  "product-tiger-eye-round-6",
  "product-lapis-round-10-twd"
]);

const INVENTORY_SOURCE_VERSION = "seed-2026-08-v2";

async function seed() {
  const prisma = createPrismaClient(
    process.env.DATABASE_URL ??
      "postgresql://mystcrag:mystcrag_dev@localhost:5432/mystcrag?schema=public"
  );
  try {
    await prisma.$connect();
    await prisma.user.upsert({
      where: { id: USER_ID },
      create: { id: USER_ID, email: "phase2c@mystcrag.example", displayName: "玄矶测试创作者" },
      update: { displayName: "玄矶测试创作者" }
    });

    for (const crystal of crystals) {
      await prisma.crystal.upsert({
        where: { id: crystal.id },
        create: {
          id: crystal.id,
          nameCn: crystal.nameCn,
          nameEn: crystal.nameEn,
          mineralName: crystal.mineralName,
          colorTags: [...crystal.colorTags],
          gemologicalInfo: { family: crystal.mineralName, use: "jewelry design reference" },
          visualTags: [...crystal.colorTags],
          styleTags: ["minimal", "contemporary-eastern"],
          emotionTags: ["calm-aesthetic"],
          cultureTags: ["design-inspiration-only"],
          priceLevel: 2,
          marketAvailability: "regular",
          complianceNote: "Cultural design reference only; no medical or guaranteed effect claim."
        },
        update: { nameCn: crystal.nameCn, nameEn: crystal.nameEn }
      });
    }

    for (const product of materialProducts) {
      await prisma.materialProduct.upsert({
        where: { id: product.id },
        create: {
          id: product.id,
          sku: product.sku,
          crystalId: product.crystalId,
          name: product.name,
          shape: product.shape,
          diameterMm: product.diameterMm,
          lengthAlongStringMm: product.lengthAlongStringMm,
          holeDiameterMm: product.holeDiameterMm,
          grade: product.grade,
          visualProfile: toPrismaJson(product.visualProfile),
          materialKey: `${product.crystalId}-material-v1`,
          modelAssetKey: `sphere-${product.shape.toLowerCase()}-${product.diameterMm}mm-v1`,
          textureAssetKey: `${product.crystalId}-texture-v1`,
          currency: product.currency,
          unitPriceMinor: minorToBigInt(product.price, "unitPriceMinor"),
          unitCostMinor: minorToBigInt(product.cost, "unitCostMinor")
        },
        update: {
          name: product.name,
          shape: product.shape,
          diameterMm: product.diameterMm,
          lengthAlongStringMm: product.lengthAlongStringMm,
          holeDiameterMm: product.holeDiameterMm,
          grade: product.grade,
          visualProfile: toPrismaJson(product.visualProfile),
          unitPriceMinor: minorToBigInt(product.price, "unitPriceMinor"),
          unitCostMinor: minorToBigInt(product.cost, "unitCostMinor"),
          active: true
        }
      });
    }

    const accessories = [
      {
        id: "product-spacer-silver-3",
        sku: "SP-CNY-SILVER-3",
        accessoryType: "SPACER",
        material: "STERLING_SILVER",
        finish: "POLISHED",
        dimensions: { diameterMm: 3, widthMm: 2 },
        lengthAlongStringMm: 2,
        modelAssetKey: "spacer-silver-3mm-v1",
        currency: "CNY" as const,
        unitPriceMinor: 300,
        unitCostMinor: 110
      },
      {
        id: "product-spacer-silver-3-twd",
        sku: "SP-TWD-SILVER-3",
        accessoryType: "SPACER",
        material: "STERLING_SILVER",
        finish: "POLISHED",
        dimensions: { diameterMm: 3, widthMm: 2 },
        lengthAlongStringMm: 2,
        modelAssetKey: "spacer-silver-3mm-v1",
        currency: "TWD" as const,
        unitPriceMinor: 140,
        unitCostMinor: 50
      },
      {
        id: "product-pendant-drop-silver-8",
        sku: "PD-CNY-SILVER-8",
        accessoryType: "PENDANT",
        material: "STERLING_SILVER",
        finish: "POLISHED",
        dimensions: { widthMm: 5, heightMm: 8, depthMm: 2 },
        lengthAlongStringMm: null,
        modelAssetKey: "pendant-drop-silver-8mm-v1",
        currency: "CNY" as const,
        unitPriceMinor: 500,
        unitCostMinor: 180
      },
      {
        id: "product-pendant-drop-silver-8-twd",
        sku: "PD-TWD-SILVER-8",
        accessoryType: "PENDANT",
        material: "STERLING_SILVER",
        finish: "POLISHED",
        dimensions: { widthMm: 5, heightMm: 8, depthMm: 2 },
        lengthAlongStringMm: null,
        modelAssetKey: "pendant-drop-silver-8mm-v1",
        currency: "TWD" as const,
        unitPriceMinor: 230,
        unitCostMinor: 80
      }
    ];
    for (const accessory of accessories) {
      await prisma.accessoryProduct.upsert({
        where: { id: accessory.id },
        create: {
          id: accessory.id,
          sku: accessory.sku,
          accessoryType: accessory.accessoryType,
          material: accessory.material,
          finish: accessory.finish,
          dimensions: toPrismaJson(accessory.dimensions),
          lengthAlongStringMm: accessory.lengthAlongStringMm,
          modelAssetKey: accessory.modelAssetKey,
          currency: accessory.currency,
          unitPriceMinor: minorToBigInt(accessory.unitPriceMinor, "unitPriceMinor"),
          unitCostMinor: minorToBigInt(accessory.unitCostMinor, "unitCostMinor")
        },
        update: {
          lengthAlongStringMm: accessory.lengthAlongStringMm,
          unitPriceMinor: minorToBigInt(accessory.unitPriceMinor, "unitPriceMinor"),
          unitCostMinor: minorToBigInt(accessory.unitCostMinor, "unitCostMinor"),
          active: true
        }
      });
    }

    await prisma.pricingRule.createMany({
      data: [
        { version: "cny-retail-2026-07-v1", currency: "CNY", rulePayload: { strategy: "catalog-plus-fixed-fees" } },
        { version: "twd-retail-2026-07-v1", currency: "TWD", rulePayload: { strategy: "independent-twd-catalog" } }
      ],
      skipDuplicates: true
    });

    const allProductIds = [
      ...materialProducts.map(({ id }) => id),
      ...accessories.map(({ id }) => id)
    ];
    await prisma.materialProduct.updateMany({
      where: { id: { notIn: materialProducts.map(({ id }) => id) }, active: true },
      data: { active: false }
    });
    await prisma.accessoryProduct.updateMany({
      where: { id: { notIn: accessories.map(({ id }) => id) }, active: true },
      data: { active: false }
    });
    await prisma.inventorySnapshot.deleteMany({ where: { sourceVersion: "seed-2026-07-v1" } });
    await prisma.inventorySnapshot.createMany({
      data: allProductIds.map((productId) => ({
        productType: productId.startsWith("product-spacer") || productId.startsWith("product-pendant") ? "ACCESSORY" : "MATERIAL",
        productId,
        availableQuantity: OUT_OF_STOCK_PRODUCT_IDS.has(productId)
          ? 0
          : LOW_STOCK_PRODUCT_IDS.has(productId)
            ? 5
            : 100,
        reservedQuantity: 0,
        sourceVersion: INVENTORY_SOURCE_VERSION
      })),
      skipDuplicates: true
    });

    const designs = [publishedRevision2, diyDesign, rejectedDesign];
    for (const design of designs) {
      await prisma.design.upsert({
        where: { id: design.designId },
        create: {
          id: design.designId,
          ownerId: USER_ID,
          name: design.designName,
          mode: design.designMode,
          status: design.designMode === "AI_GENERATED" ? "GENERATED" : "DRAFT",
          schemaVersion: design.schemaVersion,
          currentRevision: design.revision,
          locale: design.locale,
          currency: design.currency,
          currentSnapshot: toPrismaJson(design),
          complianceStatus: design.compliance.complianceStatus,
          visibility: design.community.visibility,
          publishConsent: design.community.publishConsent,
          allowRemix: design.community.allowRemix,
          creatorDisplayMode: design.community.creatorDisplayMode
        },
        // Seeding is additive: never rewind a locally edited design or overwrite
        // its current revision when the demo catalog is refreshed.
        update: {}
      });
    }

    await prisma.designRevision.createMany({
      data: [
        { id: "revision-ai-1", designId: publishedRevision1.designId, revisionNumber: 1, schemaVersion: "1.0.0", snapshot: toPrismaJson(publishedRevision1), changeType: "CREATED", changeReason: "AI generated seed design", createdBy: USER_ID },
        { id: "revision-ai-2", designId: publishedRevision2.designId, revisionNumber: 2, schemaVersion: "1.0.0", snapshot: toPrismaJson(publishedRevision2), changeType: "UPDATED", changeReason: "Creator refined the design name", createdBy: USER_ID },
        { id: "revision-diy-1", designId: diyDesign.designId, revisionNumber: 1, schemaVersion: "1.0.0", snapshot: toPrismaJson(diyDesign), changeType: "CREATED", changeReason: "DIY seed design", createdBy: USER_ID },
        { id: "revision-rejected-1", designId: rejectedDesign.designId, revisionNumber: 1, schemaVersion: "1.0.0", snapshot: toPrismaJson(rejectedDesign), changeType: "CREATED", changeReason: "Compliance rejection seed", createdBy: USER_ID }
      ],
      skipDuplicates: true
    });

    await prisma.designPublication.upsert({
      where: { id: "publication-ai-revision-1" },
      create: {
        id: "publication-ai-revision-1",
        designId: publishedRevision1.designId,
        designRevisionId: "revision-ai-1",
        publishedById: USER_ID,
        visibility: "PUBLIC",
        publishConsent: true,
        allowRemix: true,
        creatorDisplayMode: "DISPLAY_NAME"
      },
      update: { allowRemix: true }
    });

    const existingOrder = await prisma.order.findUnique({ where: { id: "order-seed-1" } });
    if (!existingOrder) {
      await prisma.order.create({
        data: {
          id: "order-seed-1",
          userId: USER_ID,
          currency: "CNY",
          totalAmountMinor: minorToBigInt(publishedRevision1.pricing.totalPriceMinor, "totalAmountMinor"),
          designRevisionId: "revision-ai-1",
          designSnapshot: {
            create: {
              id: "order-snapshot-seed-1",
              schemaVersion: publishedRevision1.schemaVersion,
              designSnapshot: toPrismaJson(publishedRevision1),
              pricingSnapshot: toPrismaJson(publishedRevision1.pricing),
              productionSnapshot: toPrismaJson(publishedRevision1.production),
              fulfillmentSnapshot: toPrismaJson({
                status: "IN_STOCK",
                estimatedRestockDays: 0,
                lines: publishedRevision1.production.billOfMaterials.map((item) => ({
                  productId: item.productId,
                  requestedQuantity: item.quantity,
                  reservedQuantity: item.quantity,
                  backorderQuantity: 0,
                  status: "IN_STOCK",
                  estimatedRestockDays: 0
                }))
              }),
              currency: "CNY",
              pricingRuleVersion: publishedRevision1.pricing.pricingVersion
            }
          }
        }
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

await seed();
