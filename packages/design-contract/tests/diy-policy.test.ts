import assert from "node:assert/strict";
import test from "node:test";

import { DIY_MAX_BEAD_COUNT, DesignV1Schema, type DesignV1 } from "../src/index";
import { standardAiDesignFixture } from "../src/fixtures/index";

function makeHistoricalBeadChain(beadCount: number): DesignV1 {
  const source = structuredClone(standardAiDesignFixture);
  const template = source.beads[0];
  if (template === undefined) {
    throw new Error("The standard design fixture must contain at least one bead");
  }

  const beads = Array.from({ length: beadCount }, (_, index) => ({
    ...structuredClone(template),
    componentId: `bead-historical-${index + 1}`,
    positionIndex: index
  }));
  const materialSubtotalMinor = beads.reduce((total, bead) => total + bead.unitPriceMinor, 0);

  return {
    ...source,
    designMode: "DIY_CREATED",
    beads,
    accessories: [],
    bracelet: {
      ...source.bracelet,
      totalBeadCount: beads.length
    },
    pricing: {
      ...source.pricing,
      materialSubtotalMinor,
      accessorySubtotalMinor: 0,
      totalPriceMinor:
        materialSubtotalMinor +
        source.pricing.laborFeeMinor +
        source.pricing.designFeeMinor +
        source.pricing.packagingFeeMinor +
        source.pricing.platformFeeEstimateMinor +
        source.pricing.logisticsFeeEstimateMinor -
        source.pricing.discountMinor
    },
    production: {
      ...source.production,
      billOfMaterials: [
        {
          productId: template.beadProductId,
          specification: `${template.shape} ${template.diameterMm}mm`,
          quantity: beads.length,
          sourceComponentIds: beads.map((bead) => bead.componentId)
        }
      ],
      componentSequence: beads.map((bead) => bead.componentId),
      anchoredComponents: []
    }
  };
}

test("the package root exports the sole public DIY bead cap of 60", () => {
  assert.strictEqual(DIY_MAX_BEAD_COUNT, 60);
});

test("DesignV1 still parses a valid historical snapshot above the DIY cap", () => {
  const historical = makeHistoricalBeadChain(DIY_MAX_BEAD_COUNT + 1);
  assert.strictEqual(historical.beads.length, 61);
  assert.strictEqual(DesignV1Schema.safeParse(historical).success, true);
});

test("DesignV1 remains a schema limit only of at least one bead", () => {
  const overCap = makeHistoricalBeadChain(70);
  assert.strictEqual(DesignV1Schema.safeParse(overCap).success, true);
});
