import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateOrderFromDesignRequestSchema,
  CreateOrderFromDesignResponseSchema,
  GenerateDesignRequestSchema,
  GenerateDesignResponseSchema,
  ListCatalogMaterialsQuerySchema,
  ListCatalogMaterialsResponseSchema,
  PriceDesignRequestSchema,
  PriceDesignResponseSchema,
  PublishDesignRequestSchema,
  PublishDesignResponseSchema,
  SaveDesignRequestSchema,
  SaveDesignResponseSchema,
  UpdateDesignRequestSchema,
  UpdateDesignResponseSchema,
  toOrderSnapshot,
  toPublicDesign,
  type DesignV1
} from "../src/index";
import { standardAiDesignFixture } from "../src/fixtures/index";

const cloneDesign = (): DesignV1 => structuredClone(standardAiDesignFixture);
const capturedAt = "2026-07-21T07:00:00.000Z";

test("public projection removes the commercial envelope", () => {
  const publicDesign = toPublicDesign({
    design: cloneDesign(),
    costs: {
      componentCosts: [{ componentId: "bead-aquamarine-1", unitCostMinor: 450 }],
      laborCostMinor: 200,
      packagingCostMinor: 80,
      supplierReference: "supplier-internal-1"
    }
  });
  const serialized = JSON.stringify(publicDesign);
  assert.equal(serialized.includes("unitCostMinor"), false);
  assert.equal(serialized.includes("supplierReference"), false);
  assert.equal(serialized.includes('"costs"'), false);
});

test("all six request and response DTO pairs accept public-safe examples", () => {
  const design = cloneDesign();
  const warnings: never[] = [];
  const snapshot = toOrderSnapshot(design, capturedAt);

  assert.equal(
    GenerateDesignRequestSchema.safeParse({
      requestId: "request-generate-1",
      locale: "zh-CN",
      currency: "CNY",
      wristCircumferenceMm: 155,
      emotionTags: ["calm"],
      styleTags: ["minimal"],
      colorTags: ["blue"]
    }).success,
    true
  );
  assert.equal(
    GenerateDesignResponseSchema.safeParse({
      requestId: "request-generate-1",
      design,
      warnings
    }).success,
    true
  );

  assert.equal(
    UpdateDesignRequestSchema.safeParse({
      requestId: "request-update-1",
      designId: design.designId,
      expectedRevision: design.revision,
      operations: [
        {
          operation: "MOVE_COMPONENT",
          componentId: "bead-moonstone-1",
          targetPositionIndex: 3
        }
      ]
    }).success,
    true
  );
  assert.equal(
    UpdateDesignResponseSchema.safeParse({ requestId: "request-update-1", design, warnings })
      .success,
    true
  );

  assert.equal(
    PriceDesignRequestSchema.safeParse({ requestId: "request-price-1", currency: "CNY", design })
      .success,
    true
  );
  assert.equal(
    PriceDesignResponseSchema.safeParse({ requestId: "request-price-1", design, warnings })
      .success,
    true
  );

  assert.equal(
    SaveDesignRequestSchema.safeParse({ requestId: "request-save-1", design }).success,
    true
  );
  assert.equal(
    SaveDesignResponseSchema.safeParse({
      requestId: "request-save-1",
      design,
      warnings,
      savedAt: capturedAt
    }).success,
    true
  );

  assert.equal(
    PublishDesignRequestSchema.safeParse({
      requestId: "request-publish-1",
      design,
      visibility: "PRIVATE",
      publishConsent: false,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS"
    }).success,
    true
  );
  assert.equal(
    PublishDesignResponseSchema.safeParse({
      requestId: "request-publish-1",
      design,
      warnings,
      publicationId: "publication-1",
      publishedAt: capturedAt
    }).success,
    true
  );

  assert.equal(
    CreateOrderFromDesignRequestSchema.safeParse({
      requestId: "request-order-1",
      design,
      expectedRevision: design.revision,
      expectedPricingVersion: design.pricing.pricingVersion,
      expectedTotalPriceMinor: design.pricing.totalPriceMinor
    }).success,
    true
  );
  assert.equal(
    CreateOrderFromDesignResponseSchema.safeParse({
      requestId: "request-order-1",
      design,
      warnings,
      orderId: "order-1",
      orderStatus: "PENDING",
      snapshot,
      createdAt: capturedAt
    }).success,
    true
  );
});

test("update DTO rejects arbitrary JSON Patch operations", () => {
  assert.equal(
    UpdateDesignRequestSchema.safeParse({
      requestId: "request-update-invalid",
      designId: "design-ai-standard",
      expectedRevision: 1,
      operations: [{ operation: "replace", path: "/pricing", value: 0 }]
    }).success,
    false
  );
});

test("material catalog exposes sellable bead fields without internal cost data", () => {
  assert.equal(ListCatalogMaterialsQuerySchema.parse({}).currency, "CNY");
  const response = ListCatalogMaterialsResponseSchema.parse({
    materials: [{
      beadProductId: "product-amethyst-faceted-8",
      sku: "AM-CNY-8",
      displayName: "紫水晶切面珠 8mm",
      crystalId: "crystal-amethyst",
      crystalNameCn: "紫水晶",
      crystalNameEn: "Amethyst",
      colorTags: ["purple", "cool"],
      visualTags: ["translucent", "faceted"],
      styleTags: ["minimal", "contemporary-eastern"],
      emotionTags: ["calm-aesthetic"],
      cultureTags: ["design-inspiration-only"],
      materialKey: "crystal-amethyst-material-v1",
      shape: "FACETED",
      diameterMm: 8,
      modelAssetKey: "sphere-faceted-8mm-v1",
      textureAssetKey: "crystal-amethyst-texture-v1",
      currency: "CNY",
      unitPriceMinor: 680
    }]
  });
  assert.equal(response.materials[0]?.crystalNameCn, "紫水晶");
  assert.deepEqual(response.materials[0]?.visualTags, ["translucent", "faceted"]);
  assert.deepEqual(response.materials[0]?.styleTags, ["minimal", "contemporary-eastern"]);
  assert.deepEqual(response.materials[0]?.emotionTags, ["calm-aesthetic"]);
  assert.deepEqual(response.materials[0]?.cultureTags, ["design-inspiration-only"]);
  assert.equal(JSON.stringify(response).includes("unitCostMinor"), false);
});

test("REJECTED designs cannot publish or create orders", () => {
  const rejectedDesign = cloneDesign();
  rejectedDesign.compliance.complianceStatus = "REJECTED";
  rejectedDesign.compliance.reviewRequired = true;

  assert.equal(
    PublishDesignRequestSchema.safeParse({
      requestId: "request-publish-rejected",
      design: rejectedDesign,
      visibility: "PRIVATE",
      publishConsent: false,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS"
    }).success,
    false
  );

  assert.equal(
    CreateOrderFromDesignRequestSchema.safeParse({
      requestId: "request-order-rejected",
      design: rejectedDesign,
      expectedRevision: rejectedDesign.revision,
      expectedPricingVersion: rejectedDesign.pricing.pricingVersion,
      expectedTotalPriceMinor: rejectedDesign.pricing.totalPriceMinor
    }).success,
    false
  );

  assert.throws(() => toOrderSnapshot(rejectedDesign, capturedAt));
});
