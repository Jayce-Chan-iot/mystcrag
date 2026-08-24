import type { CatalogProduct, RecommendationContext } from "./types.js";

export type BeadRole = "MAIN" | "ACCENT" | "FOCAL";

export type AllocatedProduct = {
  product: CatalogProduct;
  role: BeadRole;
};

/**
 * Assigns composition roles to the ranked pool with material variety: the
 * highest-ranked product becomes the focal bead, the next distinct material
 * the main bead, and a third distinct material (or color) the accent. Required
 * products are guaranteed allocation because selection ranks them first.
 */
export function allocateComposition(input: {
  ranked: readonly CatalogProduct[];
  context: RecommendationContext;
}): AllocatedProduct[] {
  const pool: CatalogProduct[] = [];
  const seenMaterials = new Set<string>();
  const seenColors = new Set<string>();

  for (const product of input.ranked) {
    const newMaterial = !seenMaterials.has(product.materialKey);
    const newColor = product.colorTags.some((tag) => !seenColors.has(tag));
    if (pool.length === 0 || newMaterial || newColor) {
      pool.push(product);
      seenMaterials.add(product.materialKey);
      for (const tag of product.colorTags) seenColors.add(tag);
    }
    if (pool.length >= 3) break;
  }

  if (pool.length === 0) return [];

  const [first, second, third] = pool;
  if (first === undefined) return [];
  if (second === undefined) {
    return [
      { product: first, role: "FOCAL" },
      { product: first, role: "MAIN" },
      { product: first, role: "ACCENT" }
    ];
  }
  if (third === undefined) {
    return [
      { product: first, role: "FOCAL" },
      { product: second, role: "MAIN" },
      { product: second, role: "ACCENT" }
    ];
  }
  return [
    { product: first, role: "FOCAL" },
    { product: second, role: "MAIN" },
    { product: third, role: "ACCENT" }
  ];
}

export function beadUnitLengthMm(product: CatalogProduct): number {
  return product.lengthAlongStringMm ?? product.diameterMm;
}
