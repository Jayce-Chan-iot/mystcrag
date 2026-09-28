import assert from "node:assert/strict";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";

import { mockDesignOptions } from "../fixtures/mock-design-options";
import {
  calculateBraceletCircumferenceMm,
  evaluateBraceletFit,
  formatEstimatedFitCm
} from "./bracelet-fit";

function copiedFixture(): PublicDesignV1 {
  return structuredClone(mockDesignOptions[0]!);
}

function wearFitFixture(): PublicDesignV1 {
  const design = copiedFixture();
  design.accessories = [];
  design.bracelet = {
    ...design.bracelet,
    elasticAllowanceMm: 5,
    targetInnerCircumferenceMm: 160,
    wristCircumferenceMm: 155
  };
  design.beads = [
    {
      ...design.beads[0]!,
      componentId: "bead-wear-fit",
      diameterMm: 158,
      lengthAlongStringMm: undefined,
      positionIndex: 0
    }
  ];
  return design;
}

test("bead lengthAlongStringMm precedes diameter and inline accessory length precedence holds", () => {
  const design = copiedFixture();
  design.accessories = [];
  design.beads = [
    {
      ...design.beads[0]!,
      componentId: "bead-with-length",
      diameterMm: 10,
      lengthAlongStringMm: 9.2,
      positionIndex: 0
    },
    {
      ...design.beads[0]!,
      componentId: "bead-diameter-only",
      diameterMm: 8,
      lengthAlongStringMm: undefined,
      positionIndex: 1
    }
  ];
  assert.equal(calculateBraceletCircumferenceMm(design), 9.2 + 8);

  design.accessories = [
    {
      accessoryProductId: "acc-inline",
      componentId: "acc-inline",
      placementMode: "INLINE",
      positionIndex: 2,
      accessoryType: "SPACER",
      material: "STERLING_SILVER",
      finish: "POLISHED",
      quantity: 1,
      modelAssetKey: "spacer-inline-v1",
      dimensions: { diameterMm: 6, widthMm: 7 },
      unitPriceMinor: 100
    }
  ];
  assert.equal(calculateBraceletCircumferenceMm(design), 9.2 + 8 + 7);

  design.accessories = [
    {
      accessoryProductId: "acc-diameter",
      componentId: "acc-diameter",
      placementMode: "INLINE",
      positionIndex: 2,
      accessoryType: "SPACER",
      material: "STERLING_SILVER",
      finish: "POLISHED",
      quantity: 1,
      modelAssetKey: "spacer-diameter-v1",
      dimensions: { diameterMm: 5 },
      unitPriceMinor: 100
    }
  ];
  assert.equal(calculateBraceletCircumferenceMm(design), 9.2 + 8 + 5);

  design.accessories = [
    {
      accessoryProductId: "acc-anchored",
      componentId: "acc-anchored",
      placementMode: "ANCHORED",
      anchorComponentId: "bead-with-length",
      anchorSlot: 0,
      accessoryType: "PENDANT",
      material: "STERLING_SILVER",
      finish: "POLISHED",
      quantity: 1,
      modelAssetKey: "pendant-anchored-v1",
      dimensions: { diameterMm: 12, widthMm: 18 },
      unitPriceMinor: 100
    }
  ];
  assert.equal(calculateBraceletCircumferenceMm(design), 9.2 + 8);
});

test("formatEstimatedFitCm rounds half-up to one decimal place", () => {
  assert.equal(formatEstimatedFitCm(144.0), "14.4");
  assert.equal(formatEstimatedFitCm(144.49), "14.4");
  assert.equal(formatEstimatedFitCm(144.5), "14.5");
  assert.equal(formatEstimatedFitCm(145.0), "14.5");
  assert.throws(() => formatEstimatedFitCm(Number.NaN), RangeError);
  assert.throws(() => formatEstimatedFitCm(-1), RangeError);
  assert.throws(() => formatEstimatedFitCm(Number.POSITIVE_INFINITY), RangeError);
});

test("evaluateBraceletFit uses the shared one-decimal formatter", () => {
  const design = copiedFixture();
  design.accessories = [];
  design.beads = [{ ...design.beads[0]!, diameterMm: 144.5, lengthAlongStringMm: 144.5 }];
  const fit = evaluateBraceletFit(design);
  assert.equal(fit.circumferenceCmLabel, "14.5");
  assert.equal(fit.circumferenceMm, 144.5);
});

test("wear fit preserves the engine material path, allowance, estimate and delta without renaming them", () => {
  const fit = evaluateBraceletFit(wearFitFixture());
  assert.equal(fit.userWristCircumferenceMm, 155);
  assert.equal(fit.targetInnerCircumferenceMm, 160);
  assert.equal(fit.assembledMaterialPathMm, 158);
  assert.equal(fit.elasticAllowanceMm, 5);
  assert.equal(fit.estimatedBraceletFitMm, 158);
  assert.equal(fit.deltaFromTargetMm, -2);
  assert.equal(fit.status, "VALID");
  assert.equal(fit.canComplete, true);
  // Compatibility fields stay until every tracked consumer is migrated.
  assert.equal(fit.circumferenceMm, 158);
  assert.equal(fit.circumferenceCmLabel, "15.8");
});

test("wear fit delegates delta and status to the bracelet engine instead of recomputing them", () => {
  const design = wearFitFixture();
  design.beads = [{ ...design.beads[0]!, diameterMm: 120 }];
  const fit = evaluateBraceletFit(design);
  assert.equal(fit.assembledMaterialPathMm, 120);
  assert.equal(fit.estimatedBraceletFitMm, 120);
  assert.equal(fit.deltaFromTargetMm, -40);
  assert.equal(fit.status, "TOO_SMALL");
  assert.equal(fit.canComplete, true);
});
