import assert from "node:assert/strict";
import test from "node:test";

import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createApp } from "../../app.js";
import type { DesignStubOperation, DesignStubService } from "./design.service.js";

const cloneDesign = () => structuredClone(standardAiDesignFixture);

function validBodies() {
  const design = cloneDesign();
  return [
    {
      url: "/api/design/generate",
      body: {
        requestId: "request-generate",
        locale: "zh-CN",
        currency: "CNY",
        wristCircumferenceMm: 155,
        emotionTags: ["calm"],
        styleTags: ["minimal"],
        colorTags: ["blue"]
      }
    },
    {
      url: "/api/design/update",
      body: {
        requestId: "request-update",
        designId: design.designId,
        expectedRevision: design.revision,
        operations: [
          {
            operation: "MOVE_COMPONENT",
            componentId: "bead-moonstone-1",
            targetPositionIndex: 3
          }
        ]
      }
    },
    {
      url: "/api/design/price",
      body: { requestId: "request-price", currency: "CNY", design }
    },
    {
      url: "/api/design/save",
      body: { requestId: "request-save", design }
    },
    {
      url: "/api/design/publish",
      body: {
        requestId: "request-publish",
        design,
        visibility: "PRIVATE",
        publishConsent: false,
        allowRemix: false,
        creatorDisplayMode: "ANONYMOUS"
      }
    },
    {
      url: "/api/orders/from-design",
      body: {
        requestId: "request-order",
        design,
        expectedRevision: design.revision,
        expectedPricingVersion: design.pricing.pricingVersion,
        expectedTotalPriceMinor: design.pricing.totalPriceMinor
      }
    }
  ];
}

test("all six validated development routes return stable NOT_IMPLEMENTED errors", async () => {
  const app = createApp();
  for (const route of validBodies()) {
    const response = await app.inject({ method: "POST", url: route.url, payload: route.body });
    assert.equal(response.statusCode, 501, route.url);
    assert.equal(response.json().error.code, "NOT_IMPLEMENTED");
  }
  await app.close();
});

test("invalid requests are rejected and preserve requestId", async () => {
  const app = createApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/design/generate",
    payload: { requestId: "request-invalid", currency: "CNY" }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.requestId, "request-invalid");
  await app.close();
});

test("invalid service responses are caught before leaving the API boundary", async () => {
  const service: DesignStubService = {
    async execute() {
      return { arbitrary: "response" };
    }
  };
  const app = createApp({ designService: service });
  const route = validBodies()[0]!;
  const response = await app.inject({ method: "POST", url: route.url, payload: route.body });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.code, "INTERNAL_ERROR");
  await app.close();
});

test("publication without consent is rejected by the explicit guard", async () => {
  const app = createApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/design/publish",
    payload: {
      requestId: "request-no-consent",
      design: cloneDesign(),
      visibility: "PUBLIC",
      publishConsent: false,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS"
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "CONSENT_REQUIRED");
  await app.close();
});

test("REJECTED designs are blocked before order orchestration", async () => {
  const design = cloneDesign();
  design.compliance.complianceStatus = "REJECTED";
  design.compliance.reviewRequired = true;
  const app = createApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/orders/from-design",
    payload: {
      requestId: "request-rejected-order",
      design,
      expectedRevision: design.revision,
      expectedPricingVersion: design.pricing.pricingVersion,
      expectedTotalPriceMinor: design.pricing.totalPriceMinor
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "COMPLIANCE_BLOCKED");
  await app.close();
});

test("client cost and owner fields are rejected", async () => {
  const app = createApp();
  const designWithCosts = cloneDesign() as unknown as Record<string, unknown>;
  designWithCosts.costs = { laborCostMinor: 1 };
  const costResponse = await app.inject({
    method: "POST",
    url: "/api/design/save",
    payload: { requestId: "request-cost", design: designWithCosts }
  });
  assert.equal(costResponse.statusCode, 400);

  const ownerResponse = await app.inject({
    method: "POST",
    url: "/api/design/save",
    payload: { requestId: "request-owner", ownerId: "client-owner", design: cloneDesign() }
  });
  assert.equal(ownerResponse.statusCode, 400);
  await app.close();
});

test("price orchestration receives product intent without client prices", async () => {
  let capturedOperation: DesignStubOperation | undefined;
  let capturedInput: unknown;
  const service: DesignStubService = {
    async execute(operation, input) {
      capturedOperation = operation;
      capturedInput = input;
      return {};
    }
  };
  const app = createApp({ designService: service });
  const route = validBodies().find((item) => item.url === "/api/design/price")!;
  await app.inject({ method: "POST", url: route.url, payload: route.body });
  const serialized = JSON.stringify(capturedInput);
  assert.equal(capturedOperation, "PRICE");
  assert.equal(serialized.includes("unitPriceMinor"), false);
  assert.equal(serialized.includes("totalPriceMinor"), false);
  assert.equal(serialized.includes("ownerId"), false);
  await app.close();
});

test("health check remains unchanged after route registration", async () => {
  const app = createApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  await app.close();
});
