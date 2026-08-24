import assert from "node:assert/strict";
import test from "node:test";

import { toOrderSnapshot } from "@mystcrag/design-contract";

import { mockDesignOptions } from "../../features/design/fixtures/mock-design-options";
import { getBudgetStatus } from "../../features/design/components/design-results";
import { responseNotice } from "../../features/design/components/diy-editor";
import { toGenerateDesignRequest } from "../../features/questionnaire/model/questionnaire";
import { resolveAccessToken, resolveMockMode } from "./api-runtime";
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
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: successFetch({ requestId: request.requestId, design, warnings: [] }, calls) });
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
  assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer verified-test-token");
  assert.equal(Object.hasOwn(calls[0]?.init?.headers as object, "x-actor-id"), false);
});

test("refresh loads the persisted design through GET instead of fixed Mock options", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: successFetch(design, calls) });
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
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: successFetch(payload, calls) });
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

test("REPLACE_COMPONENT sends expectedRevision and accepts only server revision and price", async () => {
  const serverDesign = structuredClone(design);
  serverDesign.revision = design.revision + 4;
  serverDesign.updatedAt = "2026-07-22T09:00:00.000Z";
  serverDesign.pricing.totalPriceMinor = design.pricing.totalPriceMinor + 2_000;
  serverDesign.pricing.laborFeeMinor = design.pricing.laborFeeMinor + 2_000;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: successFetch({ requestId: "update-response", design: serverDesign, warnings: [{ code: "PRICE_CHANGED", message: "repriced" }] }, calls) });
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
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: successFetch({ requestId: "save-response", design, warnings: [], savedAt }, calls) });
  const response = await client.save(design);
  assert.equal(calls[0]?.input, "/api/design/save");
  assert.equal(response.savedAt, savedAt);
  assert.equal((JSON.parse(String(calls[0]?.init?.body)) as { design: { revision: number } }).design.revision, design.revision);
});

test("price calls the authoritative Backend pricing route", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: successFetch({ requestId: "price-response", design, warnings: [] }, calls) });
  const response = await client.price(design);
  assert.equal(calls[0]?.input, "/api/design/price");
  assert.equal(response.design.pricing.totalPriceMinor, design.pricing.totalPriceMinor);
});

test("order request uses server price/version and validates immutable snapshot response", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const createdAt = "2026-07-21T10:40:00.000Z";
  const payload = { requestId: "order-response", design, warnings: [], orderId: "order-real-1", orderStatus: "PENDING", snapshot: toOrderSnapshot(design, createdAt), createdAt };
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: successFetch(payload, calls) });
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
    const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: (async () => jsonResponse({ error: { code, message: code, requestId: "request-error" } }, 409)) as typeof fetch });
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
  assert.equal(resolveAccessToken(), process.env.NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN?.trim() ?? "");
});

test("missing verified credential fails before network traffic", async () => {
  let called = false;
  const client = createDesignApiClient({ accessToken: "", useMock: false, fetcher: (async () => { called = true; return jsonResponse({}); }) as typeof fetch });
  await assert.rejects(client.get(design.designId), (error: unknown) => error instanceof FrontendApiError && error.code === "UNAUTHORIZED");
  assert.equal(called, false);
});

test("invalid Backend success payload is rejected instead of displayed", async () => {
  const client = createDesignApiClient({ accessToken: "verified-test-token", useMock: false, fetcher: (async () => jsonResponse({ designId: "forged" })) as typeof fetch });
  await assert.rejects(client.get(design.designId), (error: unknown) => error instanceof FrontendApiError && error.code === "INTERNAL_ERROR");
});
