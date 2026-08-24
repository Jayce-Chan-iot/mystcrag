import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogMaterialProduct, ListMyOrdersResponse, PublicDesignV1 } from "@mystcrag/design-contract";

import {
  favoriteMaterials,
  formatProfileDateTime,
  levelForDesignCount,
  maskContact,
  ongoingOrderCount,
  resolvePreferences,
  restockEtaDays,
  wristCentimeters,
  ORDER_STATUS_PRESENTATION
} from "./profile-model";

function design(overrides: Partial<PublicDesignV1>): PublicDesignV1 {
  return {
    designId: overrides.designId ?? "design-1",
    designName: overrides.designName ?? "星河守护",
    designMode: "TAROT_GUIDED",
    revision: 1,
    createdAt: "2026-05-01T08:00:00.000Z",
    updatedAt: "2026-05-20T06:32:00.000Z",
    locale: "zh-CN",
    currency: "CNY",
    bracelet: {
      wristCircumferenceMm: 150,
      targetInnerCircumferenceMm: 157,
      elasticAllowanceMm: 7,
      braceletLayout: "CIRCLE",
      beadGapMm: 0.4,
      totalBeadCount: 20
    },
    beads: [],
    accessories: [],
    story: {
      emotionTags: [],
      styleTags: [],
      colorPalette: [],
      culturalInspiration: [],
      designStory: "一段设计故事",
      recommendationReasons: [],
      sourceTemplateIds: []
    },
    pricing: {
      materialSubtotalMinor: 10000,
      accessorySubtotalMinor: 0,
      laborFeeMinor: 0,
      designFeeMinor: 0,
      packagingFeeMinor: 0,
      platformFeeEstimateMinor: 0,
      logisticsFeeEstimateMinor: 0,
      discountMinor: 0,
      adjustments: [],
      totalPriceMinor: 12280,
      pricingVersion: "cny-retail-2026-07-v1",
      priceCalculatedAt: "2026-05-20T06:32:00.000Z"
    },
    production: {
      wristCircumferenceMm: 150,
      billOfMaterials: [],
      componentSequence: [],
      anchoredComponents: [],
      productionNotes: [],
      substitutionRules: []
    },
    compliance: {
      complianceStatus: "PASSED",
      restrictedClaims: [],
      disclaimerKeys: [],
      reviewRequired: false
    },
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
    },
    ...overrides
  } as PublicDesignV1;
}

function order(overrides: Partial<ListMyOrdersResponse["orders"][number]> & { orderId: string }): ListMyOrdersResponse["orders"][number] {
  return {
    orderId: overrides.orderId,
    status: overrides.status ?? "CONFIRMED",
    currency: "CNY",
    totalAmountMinor: overrides.totalAmountMinor ?? 12280,
    createdAt: overrides.createdAt ?? "2026-05-20T06:32:00.000Z",
    design: overrides.design ?? design({ designId: `${overrides.orderId}-design` }),
    fulfillment: overrides.fulfillment ?? {
      status: "IN_STOCK",
      estimatedRestockDays: 0,
      lines: [
        {
          productId: "product-1",
          requestedQuantity: 20,
          reservedQuantity: 20,
          backorderQuantity: 0,
          status: "IN_STOCK",
          estimatedRestockDays: 0
        }
      ]
    }
  };
}

const ORDERS = [
  order({ orderId: "order-pending", status: "PENDING" }),
  order({
    orderId: "order-restock",
    status: "AWAITING_RESTOCK",
    fulfillment: {
      status: "AWAITING_RESTOCK",
      estimatedRestockDays: 5,
      lines: [
        {
          productId: "product-1",
          requestedQuantity: 20,
          reservedQuantity: 12,
          backorderQuantity: 8,
          status: "PARTIALLY_BACKORDERED",
          estimatedRestockDays: 5
        }
      ]
    }
  }),
  order({ orderId: "order-shipped", status: "SHIPPED" }),
  order({ orderId: "order-done", status: "COMPLETED" }),
  order({ orderId: "order-cancelled", status: "CANCELLED" })
];

test("order status labels follow the approved wording", () => {
  assert.equal(ORDER_STATUS_PRESENTATION.AWAITING_RESTOCK.label, "待补货");
  assert.equal(ORDER_STATUS_PRESENTATION.IN_PRODUCTION.label, "制作中");
  assert.equal(ORDER_STATUS_PRESENTATION.COMPLETED.label, "已完成");
  assert.equal(ORDER_STATUS_PRESENTATION.CANCELLED.label, "已取消");
});

test("ongoing order count excludes completed and cancelled orders", () => {
  assert.equal(ongoingOrderCount(ORDERS), 3);
  assert.equal(ongoingOrderCount([]), 0);
});

test("restock eta is only reported for awaiting-restock fulfillment", () => {
  assert.equal(restockEtaDays(ORDERS[1]!), 5);
  assert.equal(restockEtaDays(ORDERS[0]!), null);
  assert.equal(restockEtaDays(ORDERS[2]!), null);
});

test("designer levels follow the activity thresholds", () => {
  assert.deepEqual(levelForDesignCount(0), { level: 1, title: "初识水晶" });
  assert.deepEqual(levelForDesignCount(2), { level: 1, title: "初识水晶" });
  assert.deepEqual(levelForDesignCount(3), { level: 2, title: "灵感学徒" });
  assert.deepEqual(levelForDesignCount(12), { level: 3, title: "晶曜匠人" });
  assert.deepEqual(levelForDesignCount(25), { level: 4, title: "星辉设计师" });
  assert.deepEqual(levelForDesignCount(99), { level: 5, title: "玄机大师" });
});

test("contact details mask the middle segments", () => {
  assert.equal(maskContact("email", "xuanji@mystcrag.com"), "xua****@mystcrag.com");
  assert.equal(maskContact("phone", "13812349827"), "138****27");
  assert.equal(maskContact("email", "  "), "");
});

test("preferences resolve from valid storage and fall back otherwise", () => {
  assert.deepEqual(resolvePreferences(null, 150), {
    wristCircumferenceMm: 150,
    preferredDiameterMm: 8,
    colorTags: []
  });
  assert.deepEqual(resolvePreferences(undefined, null), {
    wristCircumferenceMm: 155,
    preferredDiameterMm: 8,
    colorTags: []
  });
  assert.deepEqual(
    resolvePreferences({ wristCircumferenceMm: 160, preferredDiameterMm: 10, colorTags: ["purple", 7] }, 150),
    { wristCircumferenceMm: 160, preferredDiameterMm: 10, colorTags: ["purple"] }
  );
  assert.equal(resolvePreferences({ wristCircumferenceMm: 500, preferredDiameterMm: 33 }, 148).wristCircumferenceMm, 148);
  assert.equal(resolvePreferences({ wristCircumferenceMm: 500 }, 148).preferredDiameterMm, 8);
});

function material(id: string): CatalogMaterialProduct {
  return {
    beadProductId: id,
    sku: `SKU-${id}`,
    displayName: id,
    crystalId: id,
    crystalNameCn: id,
    crystalNameEn: id,
    mineralName: "Quartz",
    colorTags: ["clear"],
    visualTags: [],
    styleTags: [],
    emotionTags: [],
    cultureTags: [],
    materialKey: `${id}-material-v1`,
    shape: "ROUND",
    diameterMm: 8,
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: `${id}-texture-v1`,
    currency: "CNY",
    unitPriceMinor: 500,
    availableQuantity: 100
  } as CatalogMaterialProduct;
}

test("favorite materials keep catalog order and drop unknown ids", () => {
  const materials = [material("a"), material("b"), material("c")];
  assert.deepEqual(
    favoriteMaterials(["c", "zzz", "a"], materials).map((item) => item.beadProductId),
    ["a", "c"]
  );
  assert.deepEqual(favoriteMaterials([], materials), []);
});

test("wrist formatting and datetime rendering stay display-friendly", () => {
  assert.equal(wristCentimeters(155), "15.5");
  assert.match(formatProfileDateTime("2026-05-20T06:32:00.000Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(formatProfileDateTime("not-a-date"), "");
});
