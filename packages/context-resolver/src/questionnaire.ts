import { createHash } from "node:crypto";

import {
  resolveTaxonomyId,
  type ContextAvoidances,
  type ContextHardConstraints,
  type ContextPreferences,
  type Currency,
  type Locale,
  type RecommendationContext
} from "@mystcrag/design-contract";

/** Questionnaire answers are indirect signals — trusted but discounted. */
export const QUESTIONNAIRE_SOURCE_WEIGHT = 0.9;
/** Manual selections are the user's own explicit picks — full weight. */
export const MANUAL_SOURCE_WEIGHT = 1;

export type DirectContextInput = {
  wristCircumferenceMm: number;
  targetInnerCircumferenceMm?: number;
  maxBudgetMinor?: number;
  requiredProductIds?: readonly string[];
  excludedProductIds?: readonly string[];
  mustKeepComponentIds?: readonly string[];
  /** Raw or canonical tag values; unknown values are dropped. */
  emotionTags: readonly string[];
  styleTags: readonly string[];
  colorTags: readonly string[];
  visualTags?: readonly string[];
  avoidedMaterials?: readonly string[];
  avoidedColorFamilies?: readonly string[];
  locale?: Locale;
  currency?: Currency;
};

function resolveAll(
  values: readonly string[] | undefined,
  domain: Parameters<typeof resolveTaxonomyId>[1]
): string[] {
  if (values === undefined) return [];
  const resolved: string[] = [];
  for (const value of values) {
    const id = resolveTaxonomyId(value, domain);
    if (id !== null && !resolved.includes(id)) resolved.push(id);
  }
  return resolved;
}

function buildHardConstraints(input: DirectContextInput): ContextHardConstraints {
  return {
    wristCircumferenceMm: input.wristCircumferenceMm,
    ...(input.targetInnerCircumferenceMm === undefined
      ? {}
      : { targetInnerCircumferenceMm: input.targetInnerCircumferenceMm }),
    ...(input.maxBudgetMinor === undefined
      ? {}
      : { maxBudgetMinor: input.maxBudgetMinor }),
    requiredProductIds: [...(input.requiredProductIds ?? [])],
    excludedProductIds: [...(input.excludedProductIds ?? [])],
    mustKeepComponentIds: [...(input.mustKeepComponentIds ?? [])]
  };
}

function buildPreferences(input: DirectContextInput): ContextPreferences {
  return {
    emotionTags: resolveAll(input.emotionTags, "EMOTION"),
    styleTags: resolveAll(input.styleTags, "STYLE"),
    colorPreferences: resolveAll(input.colorTags, "COLOR"),
    visualPreferences: resolveAll(input.visualTags, "TEXTURE")
  };
}

function buildAvoidances(input: DirectContextInput): ContextAvoidances {
  return {
    materialIds: resolveAll(input.avoidedMaterials, "MATERIAL"),
    colorFamilyIds: resolveAll(input.avoidedColorFamilies, "COLOR")
  };
}

function contentId(prefix: string, payload: unknown): string {
  return `ctx-${createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 12)}`;
}

function buildContext(
  sourceType: "context-source:questionnaire" | "context-source:manual",
  weight: number,
  input: DirectContextInput
): RecommendationContext {
  const preferences = buildPreferences(input);
  const hardConstraints = buildHardConstraints(input);
  const avoidances = buildAvoidances(input);

  return {
    contextId: contentId("ctx", { sourceType, hardConstraints, preferences, avoidances }),
    locale: input.locale ?? "zh-CN",
    currency: input.currency ?? "CNY",
    sources: [{ sourceType, weight }],
    hardConstraints,
    preferences,
    avoidances,
    contextWeights: {}
  };
}

export function resolveQuestionnaireContext(
  input: DirectContextInput
): RecommendationContext {
  return buildContext("context-source:questionnaire", QUESTIONNAIRE_SOURCE_WEIGHT, input);
}

export function resolveManualContext(
  input: DirectContextInput
): RecommendationContext {
  return buildContext("context-source:manual", MANUAL_SOURCE_WEIGHT, input);
}
