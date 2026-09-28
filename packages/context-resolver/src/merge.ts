import type { ContextSource, RecommendationContext } from "@mystcrag/design-contract";

/**
 * Merges resolved contexts from several sources into one recommendation
 * context (task book EPIC 7: questionnaire / manual / tarot unified entry).
 *
 * Merge rules:
 * - sources keep their declaration order, deduplicated by sourceType (the
 *   first occurrence and its weight win);
 * - preferences union in declaration order without duplicates;
 * - scalar hard constraints come from the highest-trust source
 *   (Manual/Questionnaire > Tarot > Oracle), preserving declaration order
 *   within one trust level; an Oracle-only merge may carry its user-supplied
 *   wrist, but never budget or target circumference;
 * - array constraints union across non-Oracle sources so previously resolved
 *   constraints remain intact; Oracle never injects product/component constraints;
 * - avoidances union across non-Oracle sources (a user refusal stands while
 *   Oracle-derived guidance cannot manufacture a refusal);
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

  const softSourceTypes = new Set(["context-source:tarot", "context-source:oracle"]);
  const isSoftOnly = (context: RecommendationContext) =>
    context.sources.every((source) => softSourceTypes.has(source.sourceType));
  const isOracleOnly = (context: RecommendationContext) =>
    context.sources.every((source) => source.sourceType === "context-source:oracle");
  const scalarTrustRank = (context: RecommendationContext) => {
    if (!isSoftOnly(context)) return 2;
    if (!isOracleOnly(context)) return 1;
    return 0;
  };

  let primary = contexts[0]!;
  let scalarHardPrimary = contexts[0]!;
  for (const context of contexts) {
    for (const source of context.sources) {
      if (!sources.some((existing) => existing.sourceType === source.sourceType)) {
        sources.push(source);
      }
    }
    if (isSoftOnly(primary) && !isSoftOnly(context)) {
      primary = context;
    }
    if (scalarTrustRank(context) > scalarTrustRank(scalarHardPrimary)) {
      scalarHardPrimary = context;
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
    if (!isOracleOnly(context)) {
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
    }
    for (const [key, value] of Object.entries(context.contextWeights)) {
      if (contextWeights[key] === undefined) contextWeights[key] = value;
    }
  }

  const hard = scalarHardPrimary.hardConstraints;
  const mayCarryExtendedScalarConstraints = scalarTrustRank(scalarHardPrimary) > 0;
  return {
    contextId: primary.contextId,
    locale: primary.locale,
    currency: primary.currency,
    sources,
    hardConstraints: {
      wristCircumferenceMm: hard.wristCircumferenceMm,
      ...(!mayCarryExtendedScalarConstraints || hard.targetInnerCircumferenceMm === undefined
        ? {}
        : { targetInnerCircumferenceMm: hard.targetInnerCircumferenceMm }),
      ...(!mayCarryExtendedScalarConstraints || hard.maxBudgetMinor === undefined
        ? {}
        : { maxBudgetMinor: hard.maxBudgetMinor }),
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
