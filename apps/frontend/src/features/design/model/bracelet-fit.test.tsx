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
      productType: "CHARM",
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
      productType: "CHARM",
      dimensions: { diameterMm: 5, widthMm: undefined as unknown as number },
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
      anchorSlot: "OUTER",
      positionIndex: 3,
      productType: "CHARM",
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
