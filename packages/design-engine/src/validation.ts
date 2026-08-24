import type { RecommendationContext } from "@mystcrag/design-contract";

import type { ConstraintViolation, DesignDraft, StockSnapshot } from "./types.js";

/** Geometry tolerance: within one smallest-bead unit of the target. */
export function geometryToleranceMm(draft: DesignDraft): number {
  const units = draft.beads.map(
    (bead) => bead.lengthAlongStringMm ?? bead.diameterMm
  );
  return units.length > 0 ? Math.min(...units) : 1;
}

/**
 * Deterministic constraint validation for a draft: geometry fit against the
 * target inner circumference, hard budget, required products, excluded
 * products, must-keep components, and per-product stock caps.
 */
export function validateDesignDraft(input: {
  draft: DesignDraft;
  context: RecommendationContext;
  stock?: StockSnapshot;
}): ConstraintViolation[] {
  const { draft, context, stock } = input;
  const hard = context.hardConstraints;
  const violations: ConstraintViolation[] = [];

  const tolerance = geometryToleranceMm(draft);
  const assembledPathMm =
    draft.beads.reduce(
      (total, bead) => total + (bead.lengthAlongStringMm ?? bead.diameterMm),
      0
    ) + draft.bracelet.beadGapMm * draft.beads.length;
  const delta = draft.bracelet.targetInnerCircumferenceMm - assembledPathMm;

  if (delta > tolerance) {
    violations.push({
      code: "GEOMETRY_UNDERFILL",
      message: `Assembled path is ${Number(delta.toFixed(2))}mm short of the target inner circumference (tolerance ${tolerance}mm)`
    });
  } else if (-delta > tolerance) {
    violations.push({
      code: "GEOMETRY_OVERFLOW",
      message: `Assembled path exceeds the target inner circumference by ${Number((-delta).toFixed(2))}mm (tolerance ${tolerance}mm)`
    });
  }

  if (hard.maxBudgetMinor !== undefined && draft.materialCostMinor > hard.maxBudgetMinor) {
    violations.push({
      code: "BUDGET_EXCEEDED",
      message: `Material cost ${draft.materialCostMinor} exceeds the hard budget ${hard.maxBudgetMinor}`
    });
  }

  const productCounts = new Map<string, number>();
  for (const bead of draft.beads) {
    productCounts.set(bead.beadProductId, (productCounts.get(bead.beadProductId) ?? 0) + 1);
  }

  for (const productId of hard.requiredProductIds) {
    if (!productCounts.has(productId)) {
      violations.push({
        code: "MUST_KEEP_MISSING",
        message: `Required product ${productId} is missing from the draft`
      });
    }
  }

  for (const productId of hard.excludedProductIds) {
    if (productCounts.has(productId)) {
      violations.push({
        code: "EXCLUDED_PRESENT",
        message: `Excluded product ${productId} is present in the draft`
      });
    }
  }

  if (stock !== undefined) {
    for (const [productId, count] of productCounts) {
      const available = stock.get(productId) ?? 0;
      if (count > available) {
        violations.push({
          code: "STOCK_EXCEEDED",
          message: `Draft needs ${count} of ${productId} but only ${available} in stock`
        });
      }
    }
  }

  const componentIds = new Set(
    draft.beads.map((bead) => bead.componentId)
  );
  for (const componentId of hard.mustKeepComponentIds) {
    if (!componentIds.has(componentId)) {
      violations.push({
        code: "MUST_KEEP_MISSING",
        message: `Must-keep component ${componentId} is not present in the draft`
      });
    }
  }

  return violations;
}
