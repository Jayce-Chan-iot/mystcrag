import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import {
  CreateDiyFirstBeadResponseSchema,
  type CatalogMaterialProduct,
  type ListCatalogMaterialsResponse
} from "@mystcrag/design-contract";

import { FrontendApiError } from "../../../lib/api/frontend-api-error";
import { mockDesignOptions } from "../fixtures/mock-design-options";
import { DIY_LAYOUT_CLASS } from "./diy-editor";
import {
  DiyEmptyTrayFrame,
  beginDiyCatalogLoad,
  createDiyCatalogState,
  createFirstBeadFlow,
  createFirstBeadWorkbenchState,
  diyDesignHref,
  failDiyCatalog,
  resolveDiyCatalog,
  runDiyCatalogLoad,
  selectPurchasableMaterials,
  type DiyCatalogLoadDeps,
  type DiyCatalogState,
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

function readyCatalog(materials: CatalogMaterialProduct[]): DiyCatalogState {
  const started = createDiyCatalogState("CNY");
  return resolveDiyCatalog(started, { currency: "CNY", generation: started.generation }, materials);
}

function renderFrame(
  props: Partial<Pick<DiyEmptyTrayFrameProps, "catalog" | "status" | "selection">> = {}
): string {
  return renderToStaticMarkup(
    <DiyEmptyTrayFrame
      catalog={props.catalog ?? createDiyCatalogState("CNY")}
      onPickBead={() => undefined}
      onRetry={() => undefined}
      onCatalogRetry={() => undefined}
      onSelectionChange={() => undefined}
      selection={props.selection ?? zhCn}
      status={props.status ?? createFirstBeadWorkbenchState()}
    />
  );
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function catalogResponse(materials: CatalogMaterialProduct[]): ListCatalogMaterialsResponse {
  return { materials, accessories: [] };
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
  const markup = renderFrame({ catalog: readyCatalog([catalogProduct()]) });

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
    catalog: readyCatalog([catalogProduct()]),
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

// Review repair (2026-10-05): the tray used to show one perpetual "loading" line
// for every non-ready catalog. Each read outcome must stay distinguishable, and a
// currency switch must invalidate both the beads and any in-flight response.

test("a fresh catalog read starts in loading with no selectable bead", () => {
  const state = createDiyCatalogState("CNY");
  assert.equal(state.status, "loading");
  assert.deepEqual(state.materials, []);
  assert.equal(state.currency, "CNY");
  assert.equal(state.noticeCode, null);

  const markup = renderFrame({ catalog: state });
  assert.match(markup, /data-diy-empty-catalog-state="loading"/);
  assert.doesNotMatch(markup, /data-first-bead-product/, "nothing is selectable before the read settles");
});

test("a loaded catalog with sellable beads is the only state that offers a first bead", () => {
  const state = readyCatalog([catalogProduct(), catalogProduct({ beadProductId: "product-moonstone-round-6" })]);
  assert.equal(state.status, "ready");

  const markup = renderFrame({ catalog: state });
  assert.match(markup, /data-diy-empty-catalog-state="ready"/);
  assert.match(markup, /data-first-bead-product="product-aquamarine-round-8"/);
  assert.doesNotMatch(markup, /正在读取当前目录/);
});

test("a sold-out catalog is announced as unavailable, not as endless loading", () => {
  const soldOut = readyCatalog([catalogProduct({ availableQuantity: 0 })]);
  assert.equal(soldOut.status, "empty");

  const markup = renderFrame({ catalog: soldOut });
  assert.match(markup, /data-diy-empty-catalog-state="empty"/);
  assert.doesNotMatch(markup, /正在读取当前目录/);
  assert.doesNotMatch(markup, /data-first-bead-product/);
  assert.match(markup, /没有可售|暂无可售/);
  assert.match(markup, /data-diy-empty-catalog-retry="true"/);
});

test("a failed catalog read keeps the tray empty and offers one retry", () => {
  const started = createDiyCatalogState("CNY");
  const failed = failDiyCatalog(started, { currency: "CNY", generation: started.generation }, "NETWORK_ERROR");
  assert.equal(failed.status, "failed");
  assert.equal(failed.noticeCode, "NETWORK_ERROR");
  assert.deepEqual(failed.materials, []);

  const markup = renderFrame({ catalog: failed });
  assert.match(markup, /data-diy-empty-catalog-state="failed"/);
  assert.match(markup, /data-error-code="NETWORK_ERROR"/);
  assert.match(markup, /data-diy-empty-catalog-retry="true"/);
  assert.doesNotMatch(markup, /正在读取当前目录/);
  assert.doesNotMatch(markup, /data-first-bead-product/);
});

test("a 401 catalog read prompts login instead of pretending the catalog is empty", () => {
  const started = createDiyCatalogState("CNY");
  const unauthorized = failDiyCatalog(started, { currency: "CNY", generation: started.generation }, "UNAUTHORIZED");
  assert.equal(unauthorized.status, "unauthorized");

  const markup = renderFrame({ catalog: unauthorized });
  assert.match(markup, /data-diy-empty-catalog-state="unauthorized"/);
  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.doesNotMatch(markup, /没有可售|暂无可售/, "an unauthenticated read must not be reported as no stock");
  assert.doesNotMatch(markup, /正在读取当前目录/);
});

test("switching currency immediately removes the previous currency beads", () => {
  const ready = readyCatalog([catalogProduct()]);
  const switched = beginDiyCatalogLoad(ready, "TWD");

  assert.equal(switched.currency, "TWD");
  assert.equal(switched.status, "loading");
  assert.deepEqual(switched.materials, [], "the CNY bead must not stay clickable");
  assert.equal(switched.generation, ready.generation + 1);

  const markup = renderFrame({
    catalog: switched,
    selection: { locale: "zh-TW", currency: "TWD" }
  });
  assert.doesNotMatch(markup, /data-first-bead-product/);
  assert.doesNotMatch(markup, /海蓝宝/);
});

test("a late response for the previous currency cannot repopulate the new catalog", async () => {
  const oldCurrency = defer<ListCatalogMaterialsResponse>();
  const newCurrency = defer<ListCatalogMaterialsResponse>();
  let state: DiyCatalogState = createDiyCatalogState("CNY");
  const store = {
    getState: () => state,
    setState: (next: DiyCatalogState) => {
      state = next;
    }
  };

  const oldLoad = runDiyCatalogLoad({
    materials: async (currency) => {
      if (currency !== "CNY") throw new Error("only CNY is requested here");
      return oldCurrency.promise;
    },
    ...store
  });

  // The customer switches currency before the first read settles.
  store.setState(beginDiyCatalogLoad(state, "TWD"));
  const newLoad = runDiyCatalogLoad({
    materials: async (currency) => {
      if (currency !== "TWD") throw new Error("only TWD is requested here");
      return newCurrency.promise;
    },
    ...store
  });

  oldCurrency.resolve(catalogResponse([catalogProduct()]));
  await oldLoad;
  assert.equal(state.status, "loading", "a stale CNY response must not re-enter the TWD tray");
  assert.deepEqual(state.materials, []);
  assert.equal(state.currency, "TWD");

  newCurrency.resolve(catalogResponse([catalogProduct({ currency: "TWD", beadProductId: "product-twd-round-8" })]));
  await newLoad;
  assert.equal(state.status, "ready");
  const settledMaterials: CatalogMaterialProduct[] = state.materials;
  assert.deepEqual(settledMaterials.map((material) => material.beadProductId), ["product-twd-round-8"]);
});

test("a late retry of the same currency cannot override the newer retry", async () => {
  const first = defer<ListCatalogMaterialsResponse>();
  const second = defer<ListCatalogMaterialsResponse>();
  let state: DiyCatalogState = createDiyCatalogState("CNY");
  let queue = Promise.resolve();
  const store = {
    getState: () => state,
    setState: (next: DiyCatalogState) => {
      state = next;
    }
  };
  const responses: Array<Promise<ListCatalogMaterialsResponse>> = [first.promise, second.promise];
  let call = 0;
  const materials: DiyCatalogLoadDeps["materials"] = () => {
    const next = responses[call];
    call += 1;
    return next ?? Promise.reject(new Error("no canned catalog response left"));
  };

  queue = runDiyCatalogLoad({ materials, ...store });
  queue = runDiyCatalogLoad({ materials, ...store });

  second.resolve(catalogResponse([catalogProduct({ beadProductId: "product-newest-round-8" })]));
  first.resolve(catalogResponse([catalogProduct({ beadProductId: "product-stale-round-8" })]));
  await queue;

  assert.equal(state.status, "ready");
  assert.deepEqual(
    state.materials.map((material) => material.beadProductId),
    ["product-newest-round-8"],
    "only the newest attempt may fill the tray"
  );
});

test("the catalog retry control re-reads the current currency only", async () => {
  let state = createDiyCatalogState("CNY");
  const requested: string[] = [];
  const deps = {
    materials: async (currency: string) => {
      requested.push(currency);
      throw new FrontendApiError("NETWORK_ERROR", "unreachable");
    },
    getState: () => state,
    setState: (next: DiyCatalogState) => {
      state = next;
    }
  };

  await runDiyCatalogLoad(deps);
  assert.equal(state.status, "failed");
  await runDiyCatalogLoad(deps);

  assert.deepEqual(requested, ["CNY", "CNY"], "a retry re-reads the same currency with a fresh attempt");
  assert.equal(state.generation, 2);
});
