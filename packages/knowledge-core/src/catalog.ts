import { createHash } from "node:crypto";

import type { CatalogMaterialProduct } from "@mystcrag/design-contract";

import type { CatalogFeasibilitySnapshot } from "./compiler/rule-compiler.js";

/**
 * Content-addressed catalog version: hashes the fields rule compilation
 * depends on (product identity, price, color/style tags, material key), so
 * identical catalogs compile to identical decision rule sets and the
 * compiled-rule cache stays valid until the catalog actually changes.
 */
export function catalogVersionOf(
  products: readonly CatalogMaterialProduct[]
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        products.map((product) => [
          product.beadProductId,
          product.unitPriceMinor,
          product.colorTags,
          product.styleTags,
          product.materialKey
        ])
      )
    )
    .digest("hex")
    .slice(0, 12);
  return `catalog-${digest}`;
}

/**
 * Builds the feasibility snapshot the rule compiler consumes from active
 * contract catalog materials. Shared by the backend recommendation service
 * and the MCP server so both compile against an identical catalog view.
 */
export function catalogFeasibilitySnapshotOf(
  products: readonly CatalogMaterialProduct[]
): CatalogFeasibilitySnapshot {
  return {
    productCatalogVersion: catalogVersionOf(products),
    availableTaxonomyRefs: [
      ...new Set(products.flatMap((product) => [...product.colorTags, product.materialKey]))
    ]
  };
}
