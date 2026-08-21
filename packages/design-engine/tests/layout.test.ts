import assert from "node:assert/strict";
import test from "node:test";

import {
  LAYOUT_STRATEGIES,
  allocateComposition,
  layoutSequence,
  planQuantities,
  selectCandidates,
  toBeadV1Sequence
} from "../src/index.js";
import { CATALOG, buildContext } from "./fixtures.js";

function buildPlan() {
  const context = buildContext();
  const { ranked } = selectCandidates({ context, products: CATALOG });
  const allocation = allocateComposition({ ranked, context });
  const plan = planQuantities({
    targetInnerCircumferenceMm: 162,
    beadGapMm: 0.4,
    allocation
  });
  return { allocation, plan };
}

test("every strategy places each counted bead exactly once", () => {
  const { allocation, plan } = buildPlan();
  for (const strategy of LAYOUT_STRATEGIES) {
    const sequence = layoutSequence({ strategy, allocation, counts: plan.counts });
    assert.equal(sequence.length, plan.totalBeadCount, `${strategy} length mismatch`);
    const expected = [...plan.counts.values()].reduce((a, b) => a + b, 0);
    assert.equal(sequence.length, expected);
  }
});

test("symmetric balance mirrors outer positions on the same product", () => {
  const { allocation, plan } = buildPlan();
  const sequence = layoutSequence({
    strategy: "SYMMETRIC_BALANCE",
    allocation,
    counts: plan.counts
  });
  let pairs = 0;
  let mirrored = 0;
  for (let i = 0; i < Math.floor(sequence.length / 2); i += 1) {
    pairs += 1;
    if (
      sequence[i]!.product.beadProductId ===
      sequence[sequence.length - 1 - i]!.product.beadProductId
    ) {
      mirrored += 1;
    }
  }
  assert.ok(pairs > 0);
  assert.ok(mirrored >= pairs - 3, `only ${mirrored}/${pairs} positions mirror`);
});

test("center focal keeps a focal bead near the middle", () => {
  const { allocation, plan } = buildPlan();
  const sequence = layoutSequence({
    strategy: "CENTER_FOCAL",
    allocation,
    counts: plan.counts
  });
  const focalPositions = sequence
    .map((instance, index) => (instance.role === "FOCAL" ? index : -1))
    .filter((index) => index >= 0);
  assert.ok(focalPositions.length > 0);
  const center = (sequence.length - 1) / 2;
  const nearest = Math.min(
    ...focalPositions.map((position) => Math.abs(position - center))
  );
  assert.ok(nearest <= 2, `focal is ${nearest} positions from center`);
});

test("low contrast flow orders beads into a lightness gradient", () => {
  const { allocation, plan } = buildPlan();
  const sequence = layoutSequence({
    strategy: "LOW_CONTRAST_FLOW",
    allocation,
    counts: plan.counts
  });
  const beads = toBeadV1Sequence(sequence, { idPrefix: "test" });
  assert.equal(beads[0]!.positionIndex, 0);
  assert.equal(beads[beads.length - 1]!.positionIndex, beads.length - 1);
  const ids = new Set(beads.map((bead) => bead.componentId));
  assert.equal(ids.size, beads.length);
});

test("toBeadV1Sequence produces contract-shaped bead entries", () => {
  const { allocation, plan } = buildPlan();
  const sequence = layoutSequence({
    strategy: "REPEAT_RHYTHM",
    allocation,
    counts: plan.counts
  });
  const beads = toBeadV1Sequence(sequence, { idPrefix: "design-test" });
  for (const [index, bead] of beads.entries()) {
    assert.equal(bead.positionIndex, index);
    assert.equal(bead.quantity, 1);
    assert.ok(bead.componentId.startsWith("design-test-bead-"));
    assert.ok(["MAIN", "ACCENT", "FOCAL"].includes(bead.role));
  }
});

test("layout is deterministic across repeated runs", () => {
  const { allocation, plan } = buildPlan();
  for (const strategy of LAYOUT_STRATEGIES) {
    const first = layoutSequence({ strategy, allocation, counts: plan.counts });
    for (let i = 0; i < 20; i += 1) {
      const repeat = layoutSequence({ strategy, allocation, counts: plan.counts });
      assert.deepEqual(repeat, first);
    }
  }
});
