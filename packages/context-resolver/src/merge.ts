import type { ContextSource, RecommendationContext } from "@mystcrag/design-contract";

/**
 * Merges resolved contexts from several sources into one recommendation
 * context (task book EPIC 7: questionnaire / manual / tarot unified entry).
 *
 * Merge rules:
 * - sources keep their declaration order, deduplicated by sourceType (the
 *   first occurrence and its weight win);
 * - preferences union in declaration order without duplicates;
 * - hard constraints come from the first non-tarot source — tarot never
 *   overrides physical or budget constraints;
 * - avoidances union (a user refusal from any source stands);
 * - contextWeights merge keys; later sources must not overwrite existing
 *   keys, so earlier (higher-trust) provenance is preserved.
 */
export function mergeContexts(
  contexts: readonly RecommendationContext[]
): RecommendationContext {
  if (contexts.length === 0) {
    throw new Error("mergeContexts requires at least one context");
  }

  const sources: ContextSource[] = [];
  const emotionTags: string[] = [];
  const styleTags: string[] = [];
  const colorPreferences: string[] = [];
  const visualPreferences: string[] = [];
  const materialIds: string[] = [];
  const colorFamilyIds: string[] = [];
  const requiredProductIds: string[] = [];
  const excludedProductIds: string[] = [];
  const mustKeepComponentIds: string[] = [];
  const contextWeights: Record<string, number> = {};

  let primary = contexts[0]!;
  for (const context of contexts) {
    for (const source of context.sources) {
      if (!sources.some((existing) => existing.sourceType === source.sourceType)) {
        sources.push(source);
      }
    }
    if (
      primary.sources.some((source) => source.sourceType === "context-source:tarot") &&
      !context.sources.some((source) => source.sourceType === "context-source:tarot")
    ) {
      primary = context;
    }
    for (const tag of context.preferences.emotionTags) {
      if (!emotionTags.includes(tag)) emotionTags.push(tag);
    }
    for (const tag of context.preferences.styleTags) {
      if (!styleTags.includes(tag)) styleTags.push(tag);
    }
    for (const tag of context.preferences.colorPreferences) {
      if (!colorPreferences.includes(tag)) colorPreferences.push(tag);
    }
    for (const tag of context.preferences.visualPreferences) {
      if (!visualPreferences.includes(tag)) visualPreferences.push(tag);
    }
    for (const id of context.avoidances.materialIds) {
      if (!materialIds.includes(id)) materialIds.push(id);
    }
    for (const id of context.avoidances.colorFamilyIds) {
      if (!colorFamilyIds.includes(id)) colorFamilyIds.push(id);
    }
    for (const id of context.hardConstraints.requiredProductIds) {
      if (!requiredProductIds.includes(id)) requiredProductIds.push(id);
    }
    for (const id of context.hardConstraints.excludedProductIds) {
      if (!excludedProductIds.includes(id)) excludedProductIds.push(id);
    }
    for (const id of context.hardConstraints.mustKeepComponentIds) {
      if (!mustKeepComponentIds.includes(id)) mustKeepComponentIds.push(id);
    }
    for (const [key, value] of Object.entries(context.contextWeights)) {
      if (contextWeights[key] === undefined) contextWeights[key] = value;
    }
  }

  const hard = primary.hardConstraints;
  return {
    contextId: primary.contextId,
    locale: primary.locale,
    currency: primary.currency,
    sources,
    hardConstraints: {
      wristCircumferenceMm: hard.wristCircumferenceMm,
      ...(hard.targetInnerCircumferenceMm === undefined
        ? {}
        : { targetInnerCircumferenceMm: hard.targetInnerCircumferenceMm }),
      ...(hard.maxBudgetMinor === undefined ? {} : { maxBudgetMinor: hard.maxBudgetMinor }),
      requiredProductIds,
      excludedProductIds,
      mustKeepComponentIds
    },
    preferences: {
      emotionTags,
      styleTags,
      colorPreferences,
      visualPreferences
    },
    avoidances: { materialIds, colorFamilyIds },
    contextWeights
  };
}
