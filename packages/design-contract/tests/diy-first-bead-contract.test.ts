import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateDiyFirstBeadRequestSchema,
  CreateDiyFirstBeadResponseSchema,
  DesignV1Schema
} from "../src/index";
import { standardAiDesignFixture } from "../src/fixtures/index";

const validRequest = {
  requestId: "request-first-bead-1",
  beadProductId: "product-aquamarine-round-8",
  locale: "zh-CN",
  currency: "CNY"
} as const;

const designId = "design-diy-first-bead";

function makeDiyDesign(beadCount: number) {
  const design = structuredClone(standardAiDesignFixture);
  const beads = design.beads.slice(0, beadCount).map((bead, index) => ({
    ...bead,
    positionIndex: index
  }));
  const materialSubtotalMinor = beads.reduce((total, bead) => total + bead.unitPriceMinor, 0);

  design.designId = designId;
  design.designName = "First Bead";
  design.designMode = "DIY_CREATED";
  design.revision = 1;
  design.beads = beads;
  design.accessories = [];
  design.bracelet.totalBeadCount = beads.length;
  design.pricing.materialSubtotalMinor = materialSubtotalMinor;
  design.pricing.accessorySubtotalMinor = 0;
  design.pricing.totalPriceMinor =
    materialSubtotalMinor +
    design.pricing.laborFeeMinor +
    design.pricing.designFeeMinor +
    design.pricing.packagingFeeMinor +
    design.pricing.platformFeeEstimateMinor +
    design.pricing.logisticsFeeEstimateMinor -
    design.pricing.discountMinor;
  design.production.billOfMaterials = beads.map((bead) => ({
    productId: bead.beadProductId,
    specification: `${bead.shape} ${bead.diameterMm}mm`,
    quantity: 1,
    sourceComponentIds: [bead.componentId]
  }));
  design.production.componentSequence = beads.map((bead) => bead.componentId);
  design.production.anchoredComponents = [];
  design.provenance = {
    generatedBy: "USER",
    modelProvider: null,
    modelName: null,
    promptVersion: null,
    knowledgeBaseVersion: null,
    designTemplateVersion: null,
    pricingRuleVersion: design.pricing.pricingVersion,
    sourceDesignId: null
  };

  return design;
}

function makeDiyDesignWithAccessory() {
  const design = makeDiyDesign(1);
  const bead = design.beads[0];
  const [spacer, pendant] = structuredClone(standardAiDesignFixture.accessories);
  if (bead === undefined || spacer === undefined || pendant === undefined) {
    throw new Error("The standard design fixture must contain one bead, an inline spacer, and an anchored pendant");
  }

  design.accessories = [spacer, pendant];
  design.pricing.accessorySubtotalMinor = spacer.unitPriceMinor + pendant.unitPriceMinor;
  design.pricing.totalPriceMinor =
    design.pricing.materialSubtotalMinor +
    design.pricing.accessorySubtotalMinor +
    design.pricing.laborFeeMinor +
    design.pricing.designFeeMinor +
    design.pricing.packagingFeeMinor +
    design.pricing.platformFeeEstimateMinor +
    design.pricing.logisticsFeeEstimateMinor -
    design.pricing.discountMinor;
  design.production.billOfMaterials = [
    ...design.production.billOfMaterials,
    ...structuredClone(standardAiDesignFixture.production.billOfMaterials).filter(
      (item) =>
        item.sourceComponentIds.includes(spacer.componentId) ||
        item.sourceComponentIds.includes(pendant.componentId)
    )
  ];
  design.production.componentSequence = [bead.componentId, spacer.componentId];
  design.production.anchoredComponents = [
    {
      componentId: pendant.componentId,
      anchorComponentId: spacer.componentId,
      anchorSlot: 0
    }
  ];

  return design;
}

function parseResponse(design: unknown) {
  return CreateDiyFirstBeadResponseSchema.safeParse({
    requestId: validRequest.requestId,
    design,
    warnings: []
  });
}

test("CreateDiyFirstBeadRequestSchema accepts a minimal first-bead intent", () => {
  assert.equal(CreateDiyFirstBeadRequestSchema.safeParse(validRequest).success, true);
});

test("CreateDiyFirstBeadRequestSchema rejects a missing beadProductId", () => {
  const { beadProductId, ...withoutBead } = validRequest;
  void beadProductId;
  assert.equal(CreateDiyFirstBeadRequestSchema.safeParse(withoutBead).success, false);
});

test("CreateDiyFirstBeadRequestSchema rejects client-supplied owner identity", () => {
  assert.equal(
    CreateDiyFirstBeadRequestSchema.safeParse({ ...validRequest, actorId: "actor-1" }).success,
    false
  );
  assert.equal(
    CreateDiyFirstBeadRequestSchema.safeParse({ ...validRequest, ownerId: "owner-1" }).success,
    false
  );
});

test("CreateDiyFirstBeadRequestSchema rejects client-supplied price, stock and revision", () => {
  assert.equal(
    CreateDiyFirstBeadRequestSchema.safeParse({ ...validRequest, unitPriceMinor: 1200 }).success,
    false
  );
  assert.equal(
    CreateDiyFirstBeadRequestSchema.safeParse({ ...validRequest, availableQuantity: 10 }).success,
    false
  );
  assert.equal(
    CreateDiyFirstBeadRequestSchema.safeParse({ ...validRequest, revision: 1 }).success,
    false
  );
});

test("CreateDiyFirstBeadRequestSchema rejects a fabricated bead object", () => {
  const result = CreateDiyFirstBeadRequestSchema.safeParse({
    ...validRequest,
    bead: {
      componentId: "bead-forged-1",
      beadProductId: validRequest.beadProductId,
      unitPriceMinor: 1
    }
  });
  assert.equal(result.success, false);
});

test("CreateDiyFirstBeadResponseSchema accepts exactly one private DIY bead at revision 1", () => {
  const design = makeDiyDesign(1);
  assert.equal(DesignV1Schema.safeParse(design).success, true);
  assert.equal(parseResponse(design).success, true);
});

test("CreateDiyFirstBeadResponseSchema rejects a zero-bead design", () => {
  const design = makeDiyDesign(0);
  assert.equal(DesignV1Schema.safeParse(design).success, false);
  assert.equal(parseResponse(design).success, false);
});

test("CreateDiyFirstBeadResponseSchema rejects more than one bead", () => {
  const design = makeDiyDesign(2);
  assert.equal(DesignV1Schema.safeParse(design).success, true);
  assert.equal(parseResponse(design).success, false);
});

test("CreateDiyFirstBeadResponseSchema rejects accessories the user never selected", () => {
  const design = makeDiyDesignWithAccessory();
  assert.equal(design.accessories.length > 0, true);
  assert.equal(DesignV1Schema.safeParse(design).success, true);
  assert.equal(parseResponse(design).success, false);
});

test("CreateDiyFirstBeadResponseSchema rejects a design that is not DIY_CREATED", () => {
  const design = makeDiyDesign(1);
  design.designMode = "AI_GENERATED";
  assert.equal(DesignV1Schema.safeParse(design).success, true);
  assert.equal(parseResponse(design).success, false);
});

test("CreateDiyFirstBeadResponseSchema rejects a design above revision 1", () => {
  const design = makeDiyDesign(1);
  design.revision = 2;
  assert.equal(DesignV1Schema.safeParse(design).success, true);
  assert.equal(parseResponse(design).success, false);
});

test("CreateDiyFirstBeadResponseSchema rejects a non-private design", () => {
  const design = makeDiyDesign(1);
  design.community.visibility = "UNLISTED";
  design.community.publishConsent = true;
  assert.equal(DesignV1Schema.safeParse(design).success, true);
  assert.equal(parseResponse(design).success, false);
});

test("CreateDiyFirstBeadResponseSchema rejects unknown response fields and missing warnings", () => {
  const design = makeDiyDesign(1);
  assert.equal(
    CreateDiyFirstBeadResponseSchema.safeParse({
      requestId: validRequest.requestId,
      design,
      warnings: [],
      savedAt: "2026-10-03T00:00:00.000Z"
    }).success,
    false
  );
  assert.equal(
    CreateDiyFirstBeadResponseSchema.safeParse({
      requestId: validRequest.requestId,
      design
    }).success,
    false
  );
});
