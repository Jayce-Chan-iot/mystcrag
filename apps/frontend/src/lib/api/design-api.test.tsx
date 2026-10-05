import assert from "node:assert/strict";
import test from "node:test";

import {
  PublicDesignV1Schema,
  toOrderSnapshot,
  type PublicDesignV1
} from "@mystcrag/design-contract";

import { mockDesignOptions } from "../../features/design/fixtures/mock-design-options";
import { getBudgetStatus } from "../../features/design/components/design-results";
import { responseNotice } from "../../features/design/components/diy-editor";
import { toGenerateDesignRequest } from "../../features/questionnaire/model/questionnaire";
import { resolveMockMode } from "./api-runtime";
import {
  createAddRequest,
  createDesignApiClient,
  createMoveRequest,
  createRemoveRequest,
  createReplaceRequest
} from "./design-api";
import { FrontendApiError } from "./frontend-api-error";

const design = mockDesignOptions[0]!;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function successFetch(payload: unknown, calls: Array<{ input: string; init?: RequestInit }>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), ...(init ? { init } : {}) });
    return jsonResponse(payload);
  }) as typeof fetch;
}

test("real generate request sends complete questionnaire answers and budget to Backend", async () => {
  const request = toGenerateDesignRequest({ state: "quiet", color: "mist-blue", style: "minimal", budget: "entry", wrist: "155", culture: "landscape", excludedProductIds: ["product-quartz-round-10"], personalizationConsent: true });
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({ useMock: false, fetcher: successFetch({ requestId: request.requestId, design, warnings: [] }, calls) });
  await client.generate(request);
  assert.equal(calls[0]?.input, "/api/design/generate");
  const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(sent.emotionTags, ["quiet"]);
  assert.deepEqual(sent.styleTags, ["minimal", "landscape"]);
  assert.deepEqual(sent.colorTags, ["mist-blue"]);
  assert.equal(sent.wristCircumferenceMm, 155);
  assert.equal(sent.minBudgetMinor, 29_900);
  assert.equal(sent.maxBudgetMinor, 49_900);
  assert.deepEqual(sent.excludedProductIds, ["product-quartz-round-10"]);
  assert.equal(sent.personalizationConsent, true);
  // Note: Authorization header is no longer set by the client; BFF proxy adds it from session cookie
  assert.equal(Object.hasOwn(calls[0]?.init?.headers as object, "authorization"), false);
  assert.equal(Object.hasOwn(calls[0]?.init?.headers as object, "x-actor-id"), false);
});

test("refresh loads the persisted design through GET instead of fixed Mock options", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({ useMock: false, fetcher: successFetch(design, calls) });
  const loaded = await client.get(design.designId);
  assert.equal(loaded.designId, design.designId);
  assert.equal(calls[0]?.input, `/api/design/${design.designId}`);
  assert.equal(calls[0]?.init?.method, "GET");
});

test("material library loads the complete currency catalog through the protected Backend route", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const material = design.beads[0]!;
  const payload = {
    materials: [{
      beadProductId: material.beadProductId,
      sku: "AQ-CNY-8",
      displayName: "海蓝宝圆珠 8mm",
      crystalId: material.crystalId,
      crystalNameCn: "海蓝宝",
      crystalNameEn: "Aquamarine",
      mineralName: "Beryl",
      colorTags: ["blue", "cool"],
      visualTags: ["translucent"],
      styleTags: ["minimal"],
      emotionTags: ["calm-aesthetic"],
      cultureTags: ["design-inspiration-only"],
      materialKey: material.materialKey,
      shape: material.shape,
      diameterMm: material.diameterMm,
      modelAssetKey: material.modelAssetKey,
      textureAssetKey: material.textureAssetKey,
      currency: design.currency,
      unitPriceMinor: material.unitPriceMinor,
      availableQuantity: 93
    }],
    accessories: [{
      accessoryProductId: "product-spacer-silver-3",
      sku: "SP-CNY-SILVER-3",
      displayName: "925银隔珠 3mm",
      accessoryType: "SPACER",
      material: "STERLING_SILVER",
      finish: "POLISHED",
      currency: design.currency,
      unitPriceMinor: 300,
      availableQuantity: 7
    }]
  };
  const client = createDesignApiClient({ useMock: false, fetcher: successFetch(payload, calls) });
  const response = await client.materials("CNY");
  assert.equal(response.materials[0]?.crystalNameCn, "海蓝宝");
  assert.deepEqual(response.materials[0]?.visualTags, ["translucent"]);
  assert.deepEqual(response.materials[0]?.styleTags, ["minimal"]);
  assert.deepEqual(response.materials[0]?.emotionTags, ["calm-aesthetic"]);
  assert.deepEqual(response.materials[0]?.cultureTags, ["design-inspiration-only"]);
  assert.equal(response.materials[0]?.availableQuantity, 93);
  assert.equal(response.accessories[0]?.displayName, "925银隔珠 3mm");
  assert.equal(calls[0]?.input, "/api/catalog/materials?currency=CNY");
  assert.equal(calls[0]?.init?.method, "GET");
});

test("mock material library satisfies the complete catalog schema without a network call", async () => {
  let fetchCalls = 0;
  const client = createDesignApiClient({
    useMock: true,
    fetcher: (async () => {
      fetchCalls += 1;
      throw new Error("mock mode must not call fetch");
    }) as typeof fetch
  });

  const response = await client.materials("CNY");

  assert.equal(fetchCalls, 0);
  assert.equal(response.materials.length, 4);
  for (const material of response.materials) {
    assert.ok(Array.isArray(material.visualTags));
    assert.ok(Array.isArray(material.styleTags));
    assert.ok(Array.isArray(material.emotionTags));
    assert.ok(Array.isArray(material.cultureTags));
  }
});

test("mock collection APIs expose honest empty states without fabricating user data or calling fetch", async () => {
  let fetchCalls = 0;
  const client = createDesignApiClient({
    useMock: true,
    fetcher: (async () => {
      fetchCalls += 1;
      throw new Error("mock mode must not call fetch");
    }) as typeof fetch
  });

  assert.deepEqual(await client.listDesigns(), { designs: [] });
  assert.deepEqual(await client.listOrders(), { orders: [] });
  assert.equal(fetchCalls, 0);
});

test("REPLACE_COMPONENT sends expectedRevision and accepts only server revision and price", async () => {
  const serverDesign = structuredClone(design);
  serverDesign.revision = design.revision + 4;
  serverDesign.updatedAt = "2026-07-22T09:00:00.000Z";
  serverDesign.pricing.totalPriceMinor = design.pricing.totalPriceMinor + 2_000;
  serverDesign.pricing.laborFeeMinor = design.pricing.laborFeeMinor + 2_000;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({ useMock: false, fetcher: successFetch({ requestId: "update-response", design: serverDesign, warnings: [{ code: "PRICE_CHANGED", message: "repriced" }] }, calls) });
  const replacement = design.beads[1]!;
  const response = await client.update(createReplaceRequest(design, design.beads[0]!.componentId, replacement));
  const sent = JSON.parse(String(calls[0]?.init?.body)) as { expectedRevision: number; operations: Array<{ operation: string }> };
  assert.equal(calls[0]?.input, "/api/design/update");
  assert.equal(sent.expectedRevision, design.revision);
  assert.equal(sent.operations[0]?.operation, "REPLACE_COMPONENT");
  assert.equal(response.design.revision, serverDesign.revision);
  assert.equal(response.design.pricing.totalPriceMinor, serverDesign.pricing.totalPriceMinor);
  assert.equal(responseNotice(response.warnings.map((warning) => warning.code)), null);
});

test("DIY add, move and remove requests use the finite shared operations", () => {
  const source = design.beads[0]!;
  const added = createAddRequest(design, source, 1, "component-added-by-diy");
  const moved = createMoveRequest(design, source.componentId, 1);
  const removed = createRemoveRequest(design, source.componentId);

  assert.equal(added.expectedRevision, design.revision);
  assert.deepEqual(added.operations[0], {
    operation: "ADD_COMPONENT",
    component: {
      ...source,
      componentId: "component-added-by-diy",
      positionIndex: 1,
      role: "MAIN"
    }
  });
  assert.deepEqual(moved.operations[0], {
    operation: "MOVE_COMPONENT",
    componentId: source.componentId,
    targetPositionIndex: 1
  });
  assert.deepEqual(removed.operations[0], {
    operation: "REMOVE_COMPONENT",
    componentId: source.componentId
  });
});

test("save uses the real SaveDesign DTO and keeps Backend savedAt", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const savedAt = "2026-07-21T10:30:00.000Z";
  const client = createDesignApiClient({ useMock: false, fetcher: successFetch({ requestId: "save-response", design, warnings: [], savedAt }, calls) });
  const response = await client.save(design);
  assert.equal(calls[0]?.input, "/api/design/save");
  assert.equal(response.savedAt, savedAt);
  assert.equal((JSON.parse(String(calls[0]?.init?.body)) as { design: { revision: number } }).design.revision, design.revision);
});

test("price calls the authoritative Backend pricing route", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({ useMock: false, fetcher: successFetch({ requestId: "price-response", design, warnings: [] }, calls) });
  const response = await client.price(design);
  assert.equal(calls[0]?.input, "/api/design/price");
  assert.equal(response.design.pricing.totalPriceMinor, design.pricing.totalPriceMinor);
});

test("order request uses server price/version and validates immutable snapshot response", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const createdAt = "2026-07-21T10:40:00.000Z";
  const payload = { requestId: "order-response", design, warnings: [], orderId: "order-real-1", orderStatus: "PENDING", snapshot: toOrderSnapshot(design, createdAt), createdAt };
  const client = createDesignApiClient({ useMock: false, fetcher: successFetch(payload, calls) });
  const response = await client.createOrder(design);
  const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(calls[0]?.input, "/api/orders/from-design");
  assert.equal(sent.expectedRevision, design.revision);
  assert.equal(sent.expectedPricingVersion, design.pricing.pricingVersion);
  assert.equal(sent.expectedTotalPriceMinor, design.pricing.totalPriceMinor);
  assert.equal(response.snapshot.design.revision, design.revision);
});

for (const code of ["CONFLICT", "INVENTORY_CHANGED", "PRICE_CHANGED", "COMPLIANCE_BLOCKED"] as const) {
  test(`${code} Backend errors remain explicit Frontend states`, async () => {
    const client = createDesignApiClient({ useMock: false, fetcher: (async () => jsonResponse({ error: { code, message: code, requestId: "request-error" } }, 409)) as typeof fetch });
    await assert.rejects(client.get(design.designId), (error: unknown) => error instanceof FrontendApiError && error.code === code && error.requestId === "request-error");
  });
}

test("budget state explicitly marks over-budget Backend designs", () => {
  assert.equal(getBudgetStatus(50_000, { currency: "CNY", minBudgetMinor: 29_900, maxBudgetMinor: 49_900 }), "OVER_BUDGET");
  assert.equal(getBudgetStatus(39_900, { currency: "CNY", minBudgetMinor: 29_900, maxBudgetMinor: 49_900 }), "WITHIN_BUDGET");
});

test("production mode cannot enable or silently fall back to Mock", () => {
  assert.equal(resolveMockMode({ nodeEnv: "production", flag: "true" }), false);
  assert.equal(resolveMockMode({ nodeEnv: "development", flag: "true" }), true);
  assert.equal(resolveMockMode({ nodeEnv: "development", flag: undefined }), false);
});

test("missing session cookie results in 401 from BFF proxy", async () => {
  // Note: Client no longer checks for accessToken; BFF proxy returns 401 if no session
  const client = createDesignApiClient({ useMock: false, fetcher: (async () => jsonResponse({ error: { code: "UNAUTHORIZED", message: "Authentication is required.", requestId: "req-1" } }, 401)) as typeof fetch });
  await assert.rejects(client.get(design.designId), (error: unknown) => error instanceof FrontendApiError && error.code === "UNAUTHORIZED");
});

test("invalid Backend success payload is rejected instead of displayed", async () => {
  const client = createDesignApiClient({ useMock: false, fetcher: (async () => jsonResponse({ designId: "forged" })) as typeof fetch });
  await assert.rejects(client.get(design.designId), (error: unknown) => error instanceof FrontendApiError && error.code === "INTERNAL_ERROR");
});

// TASK-UX-DIY-FE-001: the empty tray becomes a real design only through the
// server-authoritative first-bead route, so the client may send the four public
// request fields and must reject any response that is not one private
// DIY_CREATED revision-1 bead.
function oneBeadDiyDesign(
  designId = "design-diy-first-bead",
  options: { accessory?: boolean } = {}
): PublicDesignV1 {
  const created = structuredClone(design);
  const beads = created.beads.slice(0, 1).map((bead, index) => ({ ...bead, positionIndex: index }));
  const accessories = options.accessory ? structuredClone(design.accessories) : [];
  const materialSubtotalMinor = beads.reduce((total, bead) => total + bead.unitPriceMinor * bead.quantity, 0);
  const accessorySubtotalMinor = accessories.reduce((total, item) => total + item.unitPriceMinor * item.quantity, 0);
  created.designId = designId;
  created.designName = "首珠草稿";
  created.designMode = "DIY_CREATED";
  created.revision = 1;
  created.beads = beads;
  created.accessories = accessories;
  created.bracelet.totalBeadCount = beads.length;
  created.pricing.materialSubtotalMinor = materialSubtotalMinor;
  created.pricing.accessorySubtotalMinor = accessorySubtotalMinor;
  created.pricing.totalPriceMinor =
    materialSubtotalMinor +
    accessorySubtotalMinor +
    created.pricing.laborFeeMinor +
    created.pricing.designFeeMinor +
    created.pricing.packagingFeeMinor +
    created.pricing.platformFeeEstimateMinor +
    created.pricing.logisticsFeeEstimateMinor -
    created.pricing.discountMinor;
  created.production.billOfMaterials = beads.map((bead) => ({
    productId: bead.beadProductId,
    specification: `${bead.shape} ${bead.diameterMm}mm`,
    quantity: 1,
    sourceComponentIds: [bead.componentId]
  }));
  created.production.componentSequence = beads.map((bead) => bead.componentId);
  created.production.anchoredComponents = options.accessory
    ? structuredClone(design.production.anchoredComponents)
    : [];
  created.community.visibility = "PRIVATE";
  return PublicDesignV1Schema.parse(created);
}

const firstBeadRequest = {
  requestId: "first-bead-intent-1",
  beadProductId: "product-aquamarine-round-8",
  locale: "zh-CN",
  currency: "CNY"
} as const;

test("first-bead creation posts only the four public fields to the protected route", async () => {
  const oneBead = oneBeadDiyDesign();
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({
    useMock: false,
    fetcher: successFetch({ requestId: firstBeadRequest.requestId, design: oneBead, warnings: [] }, calls)
  });
  const response = await client.createDiyFirstBead(firstBeadRequest);

  assert.equal(calls[0]?.input, "/api/design/diy-first-bead");
  assert.equal(calls[0]?.init?.method, "POST");
  const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sent).sort(), ["beadProductId", "currency", "locale", "requestId"]);
  assert.equal(sent.requestId, firstBeadRequest.requestId);
  assert.equal(sent.beadProductId, firstBeadRequest.beadProductId);
  assert.equal(Object.hasOwn(sent, "actorId"), false, "owner identity is never sent by the client");
  assert.equal(Object.hasOwn(sent, "unitPriceMinor"), false, "price is never sent by the client");
  assert.equal(response.design.beads.length, 1);
  assert.equal(response.design.designId, oneBead.designId);
  assert.equal(Object.hasOwn(calls[0]?.init?.headers as object, "authorization"), false);
});

for (const forged of [
  { actorId: "user-victim" },
  { unitPriceMinor: 1 },
  { availableQuantity: 999 },
  { revision: 7 },
  { design: oneBeadDiyDesign("design-forged") }
]) {
  test(`first-bead request rejects the forged field ${Object.keys(forged)[0]}`, async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const client = createDesignApiClient({
      useMock: false,
      fetcher: successFetch({ requestId: firstBeadRequest.requestId, design: oneBeadDiyDesign(), warnings: [] }, calls)
    });
    await assert.rejects(
      client.createDiyFirstBead({ ...firstBeadRequest, ...forged } as never),
      (error: unknown) => (error as { name?: string }).name === "ZodError"
    );
    assert.equal(calls.length, 0, "a forged first-bead request must never reach the network");
  });
}

const firstBeadResponseTampering: Array<[string, (oneBead: PublicDesignV1) => PublicDesignV1]> = [
  ["zero beads", (oneBead) => ({ ...oneBead, beads: [], production: { ...oneBead.production, componentSequence: [] } })],
  ["two beads", (oneBead) => {
    const tampered = structuredClone(oneBead);
    const second = { ...tampered.beads[0]!, componentId: "component-second", positionIndex: 1 };
    tampered.beads = [...tampered.beads, second];
    tampered.production.componentSequence = tampered.beads.map((bead) => bead.componentId);
    return tampered;
  }],
  ["an accessory", () => {
    const withAccessory = oneBeadDiyDesign("design-diy-first-bead", { accessory: true });
    assert.equal(withAccessory.accessories.length, 1, "fixture must carry an accessory to prove the guard");
    return withAccessory;
  }],
  ["a non-DIY mode", (oneBead) => ({ ...oneBead, designMode: "AI_GENERATED" as PublicDesignV1["designMode"] })],
  ["a later revision", (oneBead) => ({ ...oneBead, revision: 2 })],
  ["a shared visibility", (oneBead) => ({ ...oneBead, community: { ...oneBead.community, visibility: "PUBLIC" as const } })]
];

for (const [label, tamper] of firstBeadResponseTampering) {
  test(`a first-bead response with ${label} is rejected instead of opened in the editor`, async () => {
    const tampered = tamper(oneBeadDiyDesign());
    const client = createDesignApiClient({
      useMock: false,
      fetcher: successFetch({ requestId: firstBeadRequest.requestId, design: tampered, warnings: [] }, [])
    });
    await assert.rejects(
      client.createDiyFirstBead(firstBeadRequest),
      (error: unknown) => error instanceof FrontendApiError && error.code === "INTERNAL_ERROR"
    );
  });
}

test("first-bead network failure keeps a retryable Frontend error state", async () => {
  const client = createDesignApiClient({
    useMock: false,
    fetcher: (async () => jsonResponse({ error: { code: "INVENTORY_CHANGED", message: "sold out", requestId: "req-stock" } }, 409)) as typeof fetch
  });
  await assert.rejects(
    client.createDiyFirstBead(firstBeadRequest),
    (error: unknown) => error instanceof FrontendApiError && error.code === "INVENTORY_CHANGED"
  );
});

test("mock mode refuses to fabricate a first-bead design", async () => {
  let fetchCalls = 0;
  const client = createDesignApiClient({
    useMock: true,
    fetcher: (async () => {
      fetchCalls += 1;
      throw new Error("mock mode must not call fetch");
    }) as typeof fetch
  });
  await assert.rejects(
    client.createDiyFirstBead(firstBeadRequest),
    (error: unknown) => error instanceof FrontendApiError && error.code === "VALIDATION_ERROR"
  );
  assert.equal(fetchCalls, 0);
});
