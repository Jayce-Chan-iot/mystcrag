import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import { CreateDiyFirstBeadResponseSchema, type CatalogMaterialProduct } from "@mystcrag/design-contract";

import { FrontendApiError } from "../../../lib/api/frontend-api-error";
import { mockDesignOptions } from "../fixtures/mock-design-options";
import { DIY_LAYOUT_CLASS } from "./diy-editor";
import {
  DiyEmptyTrayFrame,
  createFirstBeadFlow,
  createFirstBeadWorkbenchState,
  diyDesignHref,
  selectPurchasableMaterials,
  type DiyEmptySelection,
  type DiyEmptyTrayFrameProps,
  type DiyFirstBeadIntent
} from "./diy-empty-workbench";

const oneBeadDesign = (() => {
  const created = structuredClone(mockDesignOptions[0]!);
  const [bead] = created.beads;
  if (!bead) throw new Error("fixture needs one bead");
  const single = { ...bead, positionIndex: 0 };
  created.designId = "design-diy-first-bead";
  created.designMode = "DIY_CREATED";
  created.revision = 1;
  created.beads = [single];
  created.accessories = [];
  created.bracelet.totalBeadCount = 1;
  created.pricing.materialSubtotalMinor = single.unitPriceMinor * single.quantity;
  created.pricing.accessorySubtotalMinor = 0;
  created.pricing.totalPriceMinor =
    created.pricing.materialSubtotalMinor +
    created.pricing.laborFeeMinor +
    created.pricing.designFeeMinor +
    created.pricing.packagingFeeMinor +
    created.pricing.platformFeeEstimateMinor +
    created.pricing.logisticsFeeEstimateMinor -
    created.pricing.discountMinor;
  created.production.componentSequence = [single.componentId];
  created.production.anchoredComponents = [];
  created.production.billOfMaterials = [{
    productId: single.beadProductId,
    specification: `${single.shape} ${single.diameterMm}mm`,
    quantity: 1,
    sourceComponentIds: [single.componentId]
  }];
  created.community.visibility = "PRIVATE";
  return CreateDiyFirstBeadResponseSchema.parse({
    requestId: "first-bead-1",
    design: created,
    warnings: []
  });
})();

function catalogProduct(overrides: Partial<CatalogMaterialProduct> = {}): CatalogMaterialProduct {
  const bead = mockDesignOptions[0]!.beads[0]!;
  return {
    beadProductId: overrides.beadProductId ?? "product-aquamarine-round-8",
    sku: "AQ-CNY-8",
    displayName: "海蓝宝圆珠 8mm",
    crystalId: bead.crystalId,
    crystalNameCn: "海蓝宝",
    crystalNameEn: "Aquamarine",
    mineralName: "Beryl",
    colorTags: ["blue"],
    visualTags: [],
    styleTags: [],
    emotionTags: [],
    cultureTags: [],
    materialKey: bead.materialKey,
    shape: bead.shape,
    diameterMm: bead.diameterMm,
    modelAssetKey: bead.modelAssetKey,
    textureAssetKey: bead.textureAssetKey,
    currency: "CNY",
    unitPriceMinor: 2_400,
    availableQuantity: 12,
    ...overrides
  };
}

const zhCn: DiyEmptySelection = { locale: "zh-CN", currency: "CNY" };

function renderFrame(
  props: Partial<Pick<DiyEmptyTrayFrameProps, "materials" | "status" | "selection">> = {}
): string {
  return renderToStaticMarkup(
    <DiyEmptyTrayFrame
      materials={props.materials ?? []}
      onPickBead={() => undefined}
      onRetry={() => undefined}
      onSelectionChange={() => undefined}
      selection={props.selection ?? zhCn}
      status={props.status ?? createFirstBeadWorkbenchState()}
    />
  );
}

function createFlow(options: {
  create?: (request: DiyFirstBeadIntent) => Promise<typeof oneBeadDesign>;
  selection?: { locale: string; currency: string };
} = {}) {
  const requests: unknown[] = [];
  const navigation: string[] = [];
  let sequence = 0;
  const respond = options.create ?? (async () => oneBeadDesign);
  const flow = createFirstBeadFlow({
    create: async (request) => {
      requests.push(request);
      return respond(request);
    },
    navigate: (href) => navigation.push(href),
    createRequestId: () => {
      sequence += 1;
      return `first-bead-${sequence}`;
    },
    initialSelection: { locale: "zh-CN", currency: "CNY", ...options.selection } as DiyEmptySelection
  });
  return { flow, requests, navigation };
}

test("the empty tray carries no design id, no quote and no pre-placed bead", () => {
  const markup = renderFrame();

  assert.match(markup, /data-diy-empty-tray="true"/);
  assert.match(markup, /data-empty-tray-bead-count="0"/);
  assert.doesNotMatch(markup, /design-diy-private/, "no fixed demo design may be implied");
  assert.doesNotMatch(markup, /data-server-authoritative-price/, "no design quote exists before the first bead");
  assert.doesNotMatch(markup, /合计|总价/, "the empty tray must not show a total price");
  assert.doesNotMatch(markup, /已保存|设计已确认/, "there is no saved state before the first bead");
});

test("save and finish stay disabled and name the missing first bead", () => {
  const markup = renderFrame();

  assert.match(markup, /data-diy-empty-action="save"[^>]*disabled=""/);
  assert.match(markup, /data-diy-empty-action="finish"[^>]*disabled=""/);
  assert.match(markup, /先选择第一颗珠子/);
});

test("the empty tray keeps the shared DIY workbench layout and the real catalog", () => {
  const markup = renderFrame({ materials: [catalogProduct()] });

  assert.ok(markup.includes(DIY_LAYOUT_CLASS), "the empty tray must reuse the DIY workbench width");
  assert.match(markup, /data-diy-empty-catalog="true"/);
  assert.match(markup, /海蓝宝/);
  assert.match(markup, /data-first-bead-product="product-aquamarine-round-8"/);
});

test("one first-bead intent uses a single request id and one in-flight call", async () => {
  const { flow, requests } = createFlow();

  await Promise.all([
    flow.pickBead("product-aquamarine-round-8"),
    flow.pickBead("product-aquamarine-round-8")
  ]);

  assert.equal(requests.length, 1, "a double click must not submit twice");
  assert.deepEqual(requests[0], {
    requestId: "first-bead-1",
    beadProductId: "product-aquamarine-round-8",
    locale: "zh-CN",
    currency: "CNY"
  });
});

test("a successful first bead is the only thing that opens the design route", async () => {
  const { flow, navigation } = createFlow();

  await flow.pickBead("product-aquamarine-round-8");

  assert.equal(flow.state.status, "EMPTY");
  assert.equal(flow.state.intent, null, "the intent key is cleared once the design exists");
  assert.deepEqual(navigation, ["/diy/design-diy-first-bead"]);
});

test("a failed first bead keeps the tray empty and retries with the same key", async () => {
  let attempt = 0;
  const { flow, requests, navigation } = createFlow({
    create: async () => {
      attempt += 1;
      if (attempt === 1) throw new FrontendApiError("NETWORK_ERROR", "connection reset");
      return oneBeadDesign;
    }
  });

  await flow.pickBead("product-aquamarine-round-8");

  assert.equal(flow.state.status, "ERROR");
  assert.equal(flow.state.noticeCode, "NETWORK_ERROR");
  assert.equal(flow.state.intent?.requestId, "first-bead-1", "the failed intent keeps its key");
  assert.deepEqual(navigation, [], "a failure must not open any design route");

  await flow.retry();

  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) => (request as { requestId: string }).requestId),
    ["first-bead-1", "first-bead-1"],
    "the retry reuses the same idempotency key"
  );
  assert.deepEqual(navigation, ["/diy/design-diy-first-bead"]);
});

test("choosing a different bead after a failure starts a new intent key", async () => {
  const { flow, requests } = createFlow({
    create: async () => {
      throw new FrontendApiError("INVENTORY_CHANGED", "just sold out");
    }
  });

  await flow.pickBead("product-aquamarine-round-8");
  await flow.pickBead("product-moonstone-round-6");

  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) => request as Record<string, unknown>),
    [
      { requestId: "first-bead-1", beadProductId: "product-aquamarine-round-8", locale: "zh-CN", currency: "CNY" },
      { requestId: "first-bead-2", beadProductId: "product-moonstone-round-6", locale: "zh-CN", currency: "CNY" }
    ],
    "a different first bead is a different durable request, so the key must change"
  );
  assert.equal(flow.state.intent?.beadProductId, "product-moonstone-round-6");
});

test("switching language or currency creates no design and keeps the tray empty", async () => {
  const { flow, requests, navigation } = createFlow();

  flow.setSelection({ locale: "zh-TW", currency: "TWD" });
  flow.setSelection({ locale: "zh-CN", currency: "CNY" });

  assert.equal(requests.length, 0, "a language switch must never create a design");
  assert.equal(navigation.length, 0);
  assert.equal(flow.state.status, "EMPTY");
  assert.equal(flow.state.intent, null);
});

test("a language switch after a failure drops the stale key instead of reusing it", async () => {
  const { flow, requests } = createFlow({
    create: async () => {
      throw new FrontendApiError("NETWORK_ERROR", "connection reset");
    }
  });

  await flow.pickBead("product-aquamarine-round-8");
  flow.setSelection({ locale: "zh-TW", currency: "TWD" });
  await flow.pickBead("product-aquamarine-round-8");

  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map((request) => request as Record<string, unknown>),
    [
      { requestId: "first-bead-1", beadProductId: "product-aquamarine-round-8", locale: "zh-CN", currency: "CNY" },
      { requestId: "first-bead-2", beadProductId: "product-aquamarine-round-8", locale: "zh-TW", currency: "TWD" }
    ]
  );
});

test("mounting the workbench issues no creation request", () => {
  const { requests, navigation } = createFlow();

  assert.equal(requests.length, 0);
  assert.equal(navigation.length, 0);
});

test("a sold-out catalog product is never offered as a first bead", () => {
  const products = selectPurchasableMaterials([
    catalogProduct({ beadProductId: "product-in-stock", availableQuantity: 3 }),
    catalogProduct({ beadProductId: "product-sold-out", availableQuantity: 0 }),
    catalogProduct({ beadProductId: "product-negative", availableQuantity: -1 })
  ]);

  assert.deepEqual(products.map((product) => product.beadProductId), ["product-in-stock"]);
});

test("the design href encodes the server id without trusting a fixed one", () => {
  assert.equal(diyDesignHref("design/needs encoding"), "/diy/design%2Fneeds%20encoding");
});

test("an error state offers one retry that keeps the selection intent", () => {
  const markup = renderFrame({
    materials: [catalogProduct()],
    status: {
      status: "ERROR",
      intent: { requestId: "first-bead-1", beadProductId: "product-aquamarine-round-8", ...zhCn },
      noticeCode: "INVENTORY_CHANGED"
    }
  });

  assert.match(markup, /data-diy-empty-tray="true"/);
  assert.match(markup, /data-empty-tray-bead-count="0"/);
  assert.match(markup, /data-diy-empty-retry="true"/);
  assert.match(markup, /刚刚不可用|重试/);
});
