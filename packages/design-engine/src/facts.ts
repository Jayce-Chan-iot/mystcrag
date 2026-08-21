import type { CatalogProduct, RecommendationContext } from "./types.js";

export type DesignFacts = {
  designTaxonomyRefs: string[];
  contextTaxonomyRefs: string[];
};

function pushUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

/**
 * Builds the fact pair the compiled rules evaluate against. designTaxonomyRefs
 * mirrors the compiler's subject space (product color/style/emotion/visual tags
 * plus material keys and composition roles); contextTaxonomyRefs mirrors the
 * compiler's context ref set exactly so context-driven subjects resolve.
 */
export function buildDesignFacts(input: {
  products: readonly CatalogProduct[];
  context: RecommendationContext;
  compositionRoles?: readonly string[];
}): DesignFacts {
  const designTaxonomyRefs: string[] = [];
  for (const product of input.products) {
    pushUnique(designTaxonomyRefs, product.colorTags);
    pushUnique(designTaxonomyRefs, product.visualTags);
    pushUnique(designTaxonomyRefs, product.styleTags);
    pushUnique(designTaxonomyRefs, product.emotionTags);
    pushUnique(designTaxonomyRefs, [product.materialKey]);
  }
  pushUnique(designTaxonomyRefs, input.compositionRoles ?? []);

  const contextTaxonomyRefs: string[] = [];
  pushUnique(contextTaxonomyRefs, input.context.preferences.emotionTags);
  pushUnique(contextTaxonomyRefs, input.context.preferences.styleTags);
  pushUnique(contextTaxonomyRefs, input.context.preferences.colorPreferences);
  pushUnique(contextTaxonomyRefs, input.context.preferences.visualPreferences);
  pushUnique(contextTaxonomyRefs, input.context.avoidances.materialIds);
  pushUnique(contextTaxonomyRefs, input.context.avoidances.colorFamilyIds);

  return { designTaxonomyRefs, contextTaxonomyRefs };
}

/** Facts for an already-materialized draft (role + layout aware). */
export function buildDraftFacts(input: {
  draftProductIds: readonly string[];
  productsById: ReadonlyMap<string, CatalogProduct>;
  context: RecommendationContext;
  compositionRoles?: readonly string[];
}): DesignFacts {
  const products = input.draftProductIds
    .map((id) => input.productsById.get(id))
    .filter((product): product is CatalogProduct => product !== undefined);
  return buildDesignFacts({
    products,
    context: input.context,
    compositionRoles: input.compositionRoles
  });
}
