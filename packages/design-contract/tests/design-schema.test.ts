import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENCY_MINOR_UNITS,
  DesignV1Schema,
  type DesignV1
} from "../src/index";
import {
  designContractFixtures,
  restrictedClaimFixture,
  standardAiDesignFixture,
  unauthorizedPublicFixture
} from "../src/fixtures/index";
import { InternalCommercialDesignV1Schema } from "../src/schemas/internal-commercial.schema";

const cloneDesign = (): DesignV1 => structuredClone(standardAiDesignFixture);

test("DesignV1 accepts the standard fixture", () => {
  assert.equal(DesignV1Schema.safeParse(cloneDesign()).success, true);
});

test("Design metadata keeps existing modes and accepts TAROT_GUIDED", () => {
  for (const designMode of [
    "AI_GENERATED",
    "DIY_CREATED",
    "AI_ASSISTED",
    "TEMPLATE_REMIX",
    "TAROT_GUIDED"
  ]) {
    const candidate = cloneDesign() as unknown as { designMode: string };
    candidate.designMode = designMode;
    assert.equal(DesignV1Schema.safeParse(candidate).success, true);
  }
});

test("Tarot provenance carries strict public-safe candidate identity without misusing Design lineage", () => {
  const candidate = cloneDesign() as DesignV1 & {
    provenance: DesignV1["provenance"] & {
      tarotCandidate: {
        sessionId: string;
        ruleVersion: string;
        rank: number;
        direction: string;
      };
    };
  };
  candidate.designMode = "TAROT_GUIDED";
  candidate.provenance.sourceDesignId = null;
  candidate.provenance.tarotCandidate = {
    sessionId: "tarot-session-1",
    ruleVersion: "tarot-design-rules-v1",
    rank: 1,
    direction: "BALANCED"
  };

  const parsed = DesignV1Schema.parse(candidate);
  assert.deepEqual(parsed.provenance.tarotCandidate, candidate.provenance.tarotCandidate);

  const invalid = structuredClone(candidate);
  invalid.provenance.tarotCandidate.rank = 4;
  assert.equal(DesignV1Schema.safeParse(invalid).success, false);
});

test("the fixture registry contains all ten categorized scenarios", () => {
  assert.equal(Object.keys(designContractFixtures).length, 10);
  assert.equal(restrictedClaimFixture.category, "flagged");
  assert.equal(DesignV1Schema.safeParse(restrictedClaimFixture.data).success, true);
  assert.equal(unauthorizedPublicFixture.category, "invalid");
});

test("CNY and TWD are independently accepted minor-unit currencies", () => {
  assert.equal(CURRENCY_MINOR_UNITS.CNY, 100);
  assert.equal(CURRENCY_MINOR_UNITS.TWD, 1);

  const twdDesign = cloneDesign();
  twdDesign.currency = "TWD";
  twdDesign.pricing.pricingVersion = "twd-retail-2026-07-v1";
  twdDesign.provenance.pricingRuleVersion = "twd-retail-2026-07-v1";
  assert.equal(DesignV1Schema.safeParse(twdDesign).success, true);
});

test("community fields use private, no-consent defaults", () => {
  const candidate = cloneDesign() as unknown as { community: Record<string, never> };
  candidate.community = {};
  const result = DesignV1Schema.parse(candidate);
  assert.deepEqual(result.community, {
    visibility: "PRIVATE",
    publishConsent: false,
    allowRemix: false,
    creatorDisplayMode: "ANONYMOUS"
  });
});

test("DesignV1 rejects missing fields, unknown versions, enums, and invalid time", () => {
  const missing = cloneDesign() as unknown as Record<string, unknown>;
  delete missing.designName;
  assert.equal(DesignV1Schema.safeParse(missing).success, false);

  const unknownVersion = cloneDesign() as unknown as { schemaVersion: string };
  unknownVersion.schemaVersion = "2.0.0";
  assert.equal(DesignV1Schema.safeParse(unknownVersion).success, false);

  const invalidMode = cloneDesign() as unknown as { designMode: string };
  invalidMode.designMode = "AUTOMATIC";
  assert.equal(DesignV1Schema.safeParse(invalidMode).success, false);

  const invalidTime = cloneDesign() as unknown as { updatedAt: string };
  invalidTime.updatedAt = "not-a-date";
  assert.equal(DesignV1Schema.safeParse(invalidTime).success, false);

  const invalidLocale = cloneDesign() as unknown as { locale: string };
  invalidLocale.locale = "not a locale";
  assert.equal(DesignV1Schema.safeParse(invalidLocale).success, false);

  const invalidRevision = cloneDesign() as unknown as { revision: number };
  invalidRevision.revision = 0;
  assert.equal(DesignV1Schema.safeParse(invalidRevision).success, false);
});

test("DesignV1 rejects invalid money values", () => {
  for (const invalidAmount of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity]) {
    const candidate = cloneDesign() as unknown as {
      pricing: { laborFeeMinor: number };
    };
    candidate.pricing.laborFeeMinor = invalidAmount;
    assert.equal(DesignV1Schema.safeParse(candidate).success, false);
  }
});

test("DesignV1 validates total, material, and accessory subtotals", () => {
  const invalidTotal = cloneDesign();
  invalidTotal.pricing.totalPriceMinor += 1;
  assert.equal(DesignV1Schema.safeParse(invalidTotal).success, false);

  const invalidMaterialSubtotal = cloneDesign();
  invalidMaterialSubtotal.pricing.materialSubtotalMinor += 1;
  invalidMaterialSubtotal.pricing.totalPriceMinor += 1;
  assert.equal(DesignV1Schema.safeParse(invalidMaterialSubtotal).success, false);

  const invalidAccessorySubtotal = cloneDesign();
  invalidAccessorySubtotal.pricing.accessorySubtotalMinor += 1;
  invalidAccessorySubtotal.pricing.totalPriceMinor += 1;
  assert.equal(DesignV1Schema.safeParse(invalidAccessorySubtotal).success, false);
});

test("DesignV1 accepts explicit signed adjustments when the final price is consistent", () => {
  const candidate = cloneDesign();
  candidate.pricing.adjustments = [
    {
      adjustmentId: "adjustment-manual-1",
      label: "Reviewed customization",
      amountMinor: -200,
      reasonCode: "MANUAL_REVIEW"
    }
  ];
  candidate.pricing.totalPriceMinor -= 200;
  assert.equal(DesignV1Schema.safeParse(candidate).success, true);
});

test("DesignV1 rejects duplicate component IDs and invalid main-ring positions", () => {
  const duplicateId = cloneDesign();
  duplicateId.beads[1]!.componentId = duplicateId.beads[0]!.componentId;
  assert.equal(DesignV1Schema.safeParse(duplicateId).success, false);

  const duplicatePosition = cloneDesign();
  duplicatePosition.beads[1]!.positionIndex = 1;
  assert.equal(DesignV1Schema.safeParse(duplicatePosition).success, false);

  const positionGap = cloneDesign();
  positionGap.beads[2]!.positionIndex = 4;
  assert.equal(DesignV1Schema.safeParse(positionGap).success, false);
});

test("DesignV1 rejects non-unit bead quantity and bead-count mismatch", () => {
  const invalidQuantity = cloneDesign() as unknown as {
    beads: Array<{ quantity: number }>;
  };
  invalidQuantity.beads[0]!.quantity = 2;
  assert.equal(DesignV1Schema.safeParse(invalidQuantity).success, false);

  const invalidCount = cloneDesign();
  invalidCount.bracelet.totalBeadCount = 4;
  assert.equal(DesignV1Schema.safeParse(invalidCount).success, false);
});

test("DesignV1 rejects missing, self, and anchored-to-anchored references", () => {
  const missingAnchor = cloneDesign();
  const missingAnchorPendant = missingAnchor.accessories[1]!;
  if (missingAnchorPendant.placementMode === "ANCHORED") {
    missingAnchorPendant.anchorComponentId = "missing-component";
  }
  assert.equal(DesignV1Schema.safeParse(missingAnchor).success, false);

  const selfAnchor = cloneDesign();
  const selfAnchorPendant = selfAnchor.accessories[1]!;
  if (selfAnchorPendant.placementMode === "ANCHORED") {
    selfAnchorPendant.anchorComponentId = selfAnchorPendant.componentId;
  }
  assert.equal(DesignV1Schema.safeParse(selfAnchor).success, false);

  const cycle = cloneDesign();
  const cyclePendant = cycle.accessories[1]!;
  if (cyclePendant.placementMode === "ANCHORED") {
    cyclePendant.anchorComponentId = "accessory-anchored-cycle";
  }
  cycle.accessories.push({
    componentId: "accessory-anchored-cycle",
    accessoryType: "CONNECTOR",
    accessoryProductId: "product-cycle-test",
    placementMode: "ANCHORED",
    anchorComponentId: "accessory-pendant-1",
    anchorSlot: 0,
    material: "STERLING_SILVER",
    finish: "POLISHED",
    dimensions: { widthMm: 1 },
    quantity: 1,
    unitPriceMinor: 0,
    modelAssetKey: "cycle-test-model"
  });
  assert.equal(DesignV1Schema.safeParse(cycle).success, false);
});

test("DesignV1 rejects unauthorized public visibility", () => {
  assert.equal(DesignV1Schema.safeParse(unauthorizedPublicFixture.data).success, false);
});

test("DesignV1 validates BOM sources and production-derived order", () => {
  const invalidBom = cloneDesign();
  invalidBom.production.billOfMaterials[0]!.sourceComponentIds = ["missing-component"];
  assert.equal(DesignV1Schema.safeParse(invalidBom).success, false);

  const invalidOrder = cloneDesign();
  invalidOrder.production.componentSequence.reverse();
  assert.equal(DesignV1Schema.safeParse(invalidOrder).success, false);
});

test("FLAGGED compliance requires review", () => {
  const candidate = cloneDesign();
  candidate.compliance.complianceStatus = "FLAGGED";
  candidate.compliance.reviewRequired = false;
  assert.equal(DesignV1Schema.safeParse(candidate).success, false);
});

test("Internal commercial costs only reference existing components", () => {
  const valid = {
    design: cloneDesign(),
    costs: {
      componentCosts: [{ componentId: "bead-aquamarine-1", unitCostMinor: 450 }],
      laborCostMinor: 200,
      packagingCostMinor: 80,
      supplierReference: "supplier-internal-1"
    }
  };
  assert.equal(InternalCommercialDesignV1Schema.safeParse(valid).success, true);

  const invalid = structuredClone(valid);
  invalid.costs.componentCosts[0]!.componentId = "missing-component";
  assert.equal(InternalCommercialDesignV1Schema.safeParse(invalid).success, false);
});

test("DesignV1 itself rejects cost and supplier fields", () => {
  const beadCost = cloneDesign() as unknown as {
    beads: Array<Record<string, unknown>>;
  };
  beadCost.beads[0]!.unitCostMinor = 450;
  assert.equal(DesignV1Schema.safeParse(beadCost).success, false);

  const supplier = cloneDesign() as unknown as Record<string, unknown>;
  supplier.supplierReference = "supplier-internal-1";
  assert.equal(DesignV1Schema.safeParse(supplier).success, false);
});
