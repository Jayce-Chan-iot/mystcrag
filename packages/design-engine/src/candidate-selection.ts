import type { CatalogProduct, RecommendationContext, StockSnapshot } from "./types.js";

export type RejectedProduct = {
  productId: string;
  reason: "EXCLUDED" | "AVOIDED_MATERIAL" | "AVOIDED_COLOR" | "OUT_OF_STOCK" | "OVER_UNIT_BUDGET";
};

export type SelectionResult = {
  ranked: CatalogProduct[];
  rejected: RejectedProduct[];
};

function overlapCount(a: readonly string[], b: readonly string[]): number {
  const setB = new Set(b);
  let count = 0;
  for (const value of a) {
    if (setB.has(value)) count += 1;
  }
  return count;
}

/**
 * Hard-filter the catalog against the context (exclusions, avoidances, stock,
 * unit budget) then rank survivors by deterministic preference affinity.
 * Ordering: preference score desc, unit price asc, product id asc.
 */
export function selectCandidates(input: {
  context: RecommendationContext;
  products: readonly CatalogProduct[];
  stock?: StockSnapshot;
}): SelectionResult {
  const { context, products, stock } = input;
  const hard = context.hardConstraints;
  const excluded = new Set(hard.excludedProductIds);
  const avoidedMaterials = new Set(context.avoidances.materialIds);
  const avoidedColors = new Set(context.avoidances.colorFamilyIds);
  const required = new Set(hard.requiredProductIds);

  const accepted: CatalogProduct[] = [];
  const rejected: RejectedProduct[] = [];

  for (const product of products) {
    if (excluded.has(product.beadProductId)) {
      rejected.push({ productId: product.beadProductId, reason: "EXCLUDED" });
      continue;
    }
    if (avoidedMaterials.has(product.materialKey)) {
      rejected.push({ productId: product.beadProductId, reason: "AVOIDED_MATERIAL" });
      continue;
    }
    if (product.colorTags.some((tag) => avoidedColors.has(tag))) {
      rejected.push({ productId: product.beadProductId, reason: "AVOIDED_COLOR" });
      continue;
    }
    if (stock !== undefined && (stock.get(product.beadProductId) ?? 0) <= 0) {
      rejected.push({ productId: product.beadProductId, reason: "OUT_OF_STOCK" });
      continue;
    }
    if (
      hard.maxBudgetMinor !== undefined &&
      product.unitPriceMinor > hard.maxBudgetMinor
    ) {
      rejected.push({ productId: product.beadProductId, reason: "OVER_UNIT_BUDGET" });
      continue;
    }
    accepted.push(product);
  }

  const preferences = context.preferences;
  const scored = accepted.map((product) => {
    const affinity =
      3 * overlapCount(product.colorTags, preferences.colorPreferences) +
      2 * overlapCount(product.styleTags, preferences.styleTags) +
      2 * overlapCount(product.emotionTags, preferences.emotionTags) +
      overlapCount(product.visualTags, preferences.visualPreferences);
    const requiredBoost = required.has(product.beadProductId) ? 1000 : 0;
    return { product, rank: affinity + requiredBoost };
  });

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    if (a.product.unitPriceMinor !== b.product.unitPriceMinor) {
      return a.product.unitPriceMinor - b.product.unitPriceMinor;
    }
    return a.product.beadProductId < b.product.beadProductId ? -1 : 1;
  });

  return { ranked: scored.map((entry) => entry.product), rejected };
}
