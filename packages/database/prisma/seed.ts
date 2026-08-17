import { DesignV1Schema } from "@mystcrag/design-contract";
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

const crystals = [
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
    twdPrice: 560
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
    twdPrice: 370
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
    twdPrice: 460
  },
  { id: "crystal-amethyst", nameCn: "紫水晶", nameEn: "Amethyst", mineralName: "Quartz", colorTags: ["purple", "cool", "deep"], productSlug: "amethyst", skuPrefix: "AM", shape: "FACETED", diameterMm: 8, cnyPrice: 680, twdPrice: 340 },
  { id: "crystal-rose-quartz", nameCn: "粉水晶", nameEn: "Rose Quartz", mineralName: "Quartz", colorTags: ["pink", "warm", "soft"], productSlug: "rose-quartz", skuPrefix: "RQ", shape: "ROUND", diameterMm: 8, cnyPrice: 360, twdPrice: 180 },
  { id: "crystal-citrine", nameCn: "黄水晶", nameEn: "Citrine", mineralName: "Quartz", colorTags: ["yellow", "gold", "warm"], productSlug: "citrine", skuPrefix: "CI", shape: "FACETED", diameterMm: 8, cnyPrice: 840, twdPrice: 420 },
  { id: "crystal-green-aventurine", nameCn: "绿东陵石", nameEn: "Green Aventurine", mineralName: "Quartz", colorTags: ["green", "soft", "natural"], productSlug: "green-aventurine", skuPrefix: "GA", shape: "ROUND", diameterMm: 8, cnyPrice: 300, twdPrice: 150 },
  { id: "crystal-tiger-eye", nameCn: "虎眼石", nameEn: "Tiger Eye", mineralName: "Quartz", colorTags: ["brown", "gold", "warm"], productSlug: "tiger-eye", skuPrefix: "TE", shape: "ROUND", diameterMm: 8, cnyPrice: 420, twdPrice: 210 },
  { id: "crystal-lapis-lazuli", nameCn: "青金石", nameEn: "Lapis Lazuli", mineralName: "Lazurite", colorTags: ["blue", "gold", "deep"], productSlug: "lapis", skuPrefix: "LA", shape: "ROUND", diameterMm: 8, cnyPrice: 620, twdPrice: 310 },
  { id: "crystal-garnet", nameCn: "石榴石", nameEn: "Garnet", mineralName: "Garnet", colorTags: ["red", "wine", "deep"], productSlug: "garnet", skuPrefix: "GN", shape: "FACETED", diameterMm: 8, cnyPrice: 700, twdPrice: 350 },
  { id: "crystal-labradorite", nameCn: "拉长石", nameEn: "Labradorite", mineralName: "Feldspar", colorTags: ["gray", "blue", "iridescent"], productSlug: "labradorite", skuPrefix: "LB", shape: "ROUND", diameterMm: 8, cnyPrice: 740, twdPrice: 370 },
  { id: "crystal-black-onyx", nameCn: "黑玛瑙", nameEn: "Black Onyx", mineralName: "Chalcedony", colorTags: ["black", "neutral", "deep"], productSlug: "black-onyx", skuPrefix: "BO", shape: "ROUND", diameterMm: 8, cnyPrice: 280, twdPrice: 140 },
  { id: "crystal-smoky-quartz", nameCn: "烟晶", nameEn: "Smoky Quartz", mineralName: "Quartz", colorTags: ["brown", "gray", "neutral"], productSlug: "smoky-quartz", skuPrefix: "SQ", shape: "ROUND", diameterMm: 8, cnyPrice: 400, twdPrice: 200 },
  { id: "crystal-sunstone", nameCn: "日光石", nameEn: "Sunstone", mineralName: "Feldspar", colorTags: ["orange", "gold", "warm"], productSlug: "sunstone", skuPrefix: "SS", shape: "FACETED", diameterMm: 8, cnyPrice: 780, twdPrice: 390 },
  { id: "crystal-amazonite", nameCn: "天河石", nameEn: "Amazonite", mineralName: "Feldspar", colorTags: ["green", "blue", "fresh"], productSlug: "amazonite", skuPrefix: "AZ", shape: "ROUND", diameterMm: 8, cnyPrice: 440, twdPrice: 220 },
  { id: "crystal-fluorite", nameCn: "萤石", nameEn: "Fluorite", mineralName: "Fluorite", colorTags: ["purple", "green", "clear"], productSlug: "fluorite", skuPrefix: "FL", shape: "ROUND", diameterMm: 8, cnyPrice: 500, twdPrice: 250 },
  { id: "crystal-red-agate", nameCn: "红玛瑙", nameEn: "Red Agate", mineralName: "Chalcedony", colorTags: ["red", "orange", "warm"], productSlug: "red-agate", skuPrefix: "RA", shape: "ROUND", diameterMm: 8, cnyPrice: 340, twdPrice: 170 },
  { id: "crystal-rhodonite", nameCn: "蔷薇辉石", nameEn: "Rhodonite", mineralName: "Rhodonite", colorTags: ["pink", "black", "deep"], productSlug: "rhodonite", skuPrefix: "RH", shape: "ROUND", diameterMm: 8, cnyPrice: 460, twdPrice: 230 }
] as const;

const materialProducts = crystals.flatMap((crystal) => ([
  {
    id: `product-${crystal.productSlug}-${crystal.shape.toLowerCase()}-${crystal.diameterMm}`,
    sku: `${crystal.skuPrefix}-CNY-${crystal.diameterMm}`,
    crystalId: crystal.id,
    name: `${crystal.nameCn}${crystal.shape === "ROUND" ? "圆珠" : "切面珠"} ${crystal.diameterMm}mm`,
    currency: "CNY" as const,
    price: crystal.cnyPrice,
    cost: Math.floor(crystal.cnyPrice * 0.42),
    shape: crystal.shape,
    diameterMm: crystal.diameterMm
  },
  {
    id: `product-${crystal.productSlug}-${crystal.shape.toLowerCase()}-${crystal.diameterMm}-twd`,
    sku: `${crystal.skuPrefix}-TWD-${crystal.diameterMm}`,
    crystalId: crystal.id,
    name: `${crystal.nameCn}${crystal.shape === "ROUND" ? "圓珠" : "切面珠"} ${crystal.diameterMm}mm`,
    currency: "TWD" as const,
    price: crystal.twdPrice,
    cost: Math.floor(crystal.twdPrice * 0.42),
    shape: crystal.shape,
    diameterMm: crystal.diameterMm
  }
]));

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
        modelAssetKey: "spacer-silver-3mm-v1",
        currency: "CNY" as const,
        unitPriceMinor: 300,
        unitCostMinor: 110
      },
      {
        id: "product-pendant-drop-silver-8",
        sku: "PD-CNY-SILVER-8",
        accessoryType: "PENDANT",
        material: "STERLING_SILVER",
        finish: "POLISHED",
        dimensions: { widthMm: 5, heightMm: 8, depthMm: 2 },
        modelAssetKey: "pendant-drop-silver-8mm-v1",
        currency: "CNY" as const,
        unitPriceMinor: 500,
        unitCostMinor: 180
      }
    ];
    for (const accessory of accessories) {
      await prisma.accessoryProduct.upsert({
        where: { id: accessory.id },
        create: {
          ...accessory,
          dimensions: toPrismaJson(accessory.dimensions),
          unitPriceMinor: minorToBigInt(accessory.unitPriceMinor, "unitPriceMinor"),
          unitCostMinor: minorToBigInt(accessory.unitCostMinor, "unitCostMinor")
        },
        update: {
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
    await prisma.inventorySnapshot.createMany({
      data: allProductIds.map((productId) => ({
        productType: productId.startsWith("product-spacer") || productId.startsWith("product-pendant") ? "ACCESSORY" : "MATERIAL",
        productId,
        availableQuantity: 100,
        reservedQuantity: 0,
        sourceVersion: "seed-2026-07-v1"
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
