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
    colorTags: ["ocean-blue", "translucent"]
  },
  {
    id: "crystal-moonstone",
    nameCn: "月光石",
    nameEn: "Moonstone",
    mineralName: "Feldspar",
    colorTags: ["soft-white", "adularescent"]
  },
  {
    id: "crystal-clear-quartz",
    nameCn: "白水晶",
    nameEn: "Clear Quartz",
    mineralName: "Quartz",
    colorTags: ["clear", "neutral"]
  }
] as const;

const materialProducts = [
  ["product-aquamarine-round-8", "AQ-CNY-8", "crystal-aquamarine", "海蓝宝圆珠 8mm", "CNY", 1200, 520, 8],
  ["product-moonstone-round-6", "MO-CNY-6", "crystal-moonstone", "月光石圆珠 6mm", "CNY", 800, 310, 6],
  ["product-quartz-round-10", "QU-CNY-10", "crystal-clear-quartz", "白水晶圆珠 10mm", "CNY", 1000, 380, 10],
  ["product-aquamarine-round-8-twd", "AQ-TWD-8", "crystal-aquamarine", "海藍寶圓珠 8mm", "TWD", 560, 240, 8],
  ["product-moonstone-round-6-twd", "MO-TWD-6", "crystal-moonstone", "月光石圓珠 6mm", "TWD", 370, 145, 6],
  ["product-quartz-round-10-twd", "QU-TWD-10", "crystal-clear-quartz", "白水晶圓珠 10mm", "TWD", 460, 175, 10]
] as const;

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
          ...crystal,
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

    for (const [id, sku, crystalId, name, currency, price, cost, diameterMm] of materialProducts) {
      await prisma.materialProduct.upsert({
        where: { id },
        create: {
          id,
          sku,
          crystalId,
          name,
          shape: "ROUND",
          diameterMm,
          materialKey: `${crystalId}-material-v1`,
          modelAssetKey: `sphere-round-${diameterMm}mm-v1`,
          textureAssetKey: `${crystalId}-texture-v1`,
          currency,
          unitPriceMinor: minorToBigInt(price, "unitPriceMinor"),
          unitCostMinor: minorToBigInt(cost, "unitCostMinor")
        },
        update: {
          unitPriceMinor: minorToBigInt(price, "unitPriceMinor"),
          unitCostMinor: minorToBigInt(cost, "unitCostMinor"),
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
      ...materialProducts.map(([id]) => id),
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
        update: {
          name: design.designName,
          currentRevision: design.revision,
          currentSnapshot: toPrismaJson(design),
          complianceStatus: design.compliance.complianceStatus
        }
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
