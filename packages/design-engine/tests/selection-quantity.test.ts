import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateComposition,
  planQuantities,
  selectCandidates
} from "../src/index.js";
import { CATALOG, buildContext } from "./fixtures.js";

test("selection drops excluded, avoided, and out-of-stock products", () => {
  const context = buildContext({
    excludedProductIds: ["product-obsidian-8"],
    avoidances: { materialIds: ["material:citrine"] }
  });
  const stock = new Map([
    ["product-amethyst-8", 5],
    ["product-aquamarine-8", 0],
    ["product-moonstone-6", 5]
  ]);
  const { ranked, rejected } = selectCandidates({ context, products: CATALOG, stock });
  const ids = ranked.map((product) => product.beadProductId);
  assert.equal(ids.includes("product-obsidian-8"), false);
  assert.equal(ids.includes("product-citrine-10"), false);
  assert.equal(ids.includes("product-aquamarine-8"), false);
  assert.equal(ids.includes("product-amethyst-8"), true);
  assert.equal(
    rejected.some((entry) => entry.reason === "OUT_OF_STOCK" && entry.productId === "product-aquamarine-8"),
    true
  );
});

test("selection ranks preference matches first with deterministic tiebreaks", () => {
  const context = buildContext({
    preferences: { colorPreferences: ["color:purple"], styleTags: ["style:minimal"] }
  });
  const { ranked } = selectCandidates({ context, products: CATALOG });
  assert.equal(ranked[0]!.beadProductId, "product-amethyst-8");
});

test("required products outrank preference affinity", () => {
  const context = buildContext({
    requiredProductIds: ["product-obsidian-8"],
    preferences: { colorPreferences: ["color:purple"] }
  });
  const { ranked } = selectCandidates({ context, products: CATALOG });
  assert.equal(ranked[0]!.beadProductId, "product-obsidian-8");
});

test("unit budget rejects products priced above the cap", () => {
  const context = buildContext({ maxBudgetMinor: 400 });
  const { ranked, rejected } = selectCandidates({ context, products: CATALOG });
  assert.equal(ranked.every((product) => product.unitPriceMinor <= 400), true);
  assert.equal(rejected.some((entry) => entry.reason === "OVER_UNIT_BUDGET"), true);
});

test("allocation assigns focal, main, and accent with distinct materials", () => {
  const { ranked } = selectCandidates({
    context: buildContext(),
    products: CATALOG
  });
  const allocation = allocateComposition({ ranked, context: buildContext() });
  assert.equal(allocation.length, 3);
  assert.equal(allocation[0]!.role, "FOCAL");
  assert.equal(allocation[1]!.role, "MAIN");
  assert.equal(allocation[2]!.role, "ACCENT");
  const materials = new Set(allocation.map((entry) => entry.product.materialKey));
  assert.equal(materials.size, 3);
});

test("quantity fills the target circumference within one smallest bead", () => {
  const { ranked } = selectCandidates({ context: buildContext(), products: CATALOG });
  const allocation = allocateComposition({ ranked, context: buildContext() });
  const target = 162;
  const plan = planQuantities({
    targetInnerCircumferenceMm: target,
    beadGapMm: 0.4,
    allocation
  });
  assert.ok(plan.totalBeadCount > 0);
  const smallest = Math.min(
    ...allocation.map((entry) => entry.product.lengthAlongStringMm ?? entry.product.diameterMm)
  );
  assert.ok(Math.abs(plan.deltaFromTargetMm) <= smallest + 0.4);
});

test("stock caps bead counts per product", () => {
  const { ranked } = selectCandidates({ context: buildContext(), products: CATALOG });
  const allocation = allocateComposition({ ranked, context: buildContext() });
  const stock = new Map(allocation.map((entry) => [entry.product.beadProductId, 2]));
  const plan = planQuantities({
    targetInnerCircumferenceMm: 200,
    beadGapMm: 0.4,
    allocation,
    stock
  });
  for (const [productId, count] of plan.counts) {
    assert.ok(count <= 2, `${productId} count ${count} exceeds stock`);
  }
});

test("hard budget trims counts without dropping below one bead per product", () => {
  const { ranked } = selectCandidates({ context: buildContext(), products: CATALOG });
  const allocation = allocateComposition({ ranked, context: buildContext() });
  const plan = planQuantities({
    targetInnerCircumferenceMm: 200,
    beadGapMm: 0.4,
    allocation,
    maxBudgetMinor: 3000
  });
  let cost = 0;
  for (const entry of allocation) {
    const count = plan.counts.get(entry.product.beadProductId) ?? 0;
    assert.ok(count >= 1, "each allocated product keeps at least one bead");
    cost += count * entry.product.unitPriceMinor;
  }
  assert.ok(cost <= 3000, `material cost ${cost} exceeds budget`);
});
