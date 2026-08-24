import type {
  BeadV1,
  DesignScore,
  LayoutStrategy,
  RecommendationContext
} from "@mystcrag/design-contract";

import { pairHarmony, taxonomyColorOklch } from "./color.js";
import type { CatalogProduct, ConstraintViolation } from "./types.js";

export const DESIGN_SCORE_FORMULA_VERSION = "design-score-v1";

const OVERALL_WEIGHTS = {
  color: 0.22,
  material: 0.18,
  style: 0.15,
  composition: 0.2,
  constraint: 0.25
} as const;

const clamp = (value: number): number => Math.max(0, Math.min(100, value));
const round2 = (value: number): number => Number(value.toFixed(2));

type ProductTagSummary = { colorTags: string[]; styleTags: string[]; materialKey: string };

function colorHarmonyScore(products: readonly { colorTags: string[] }[]): number {
  const colors = [...new Set(products.flatMap((product) => product.colorTags))]
    .map((tag) => taxonomyColorOklch(tag))
    .filter((value): value is NonNullable<typeof value> => value !== undefined);
  if (colors.length <= 1) return 75;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      total += pairHarmony(colors[i]!, colors[j]!);
      pairs += 1;
    }
  }
  return (total / pairs) * 100;
}

function preferenceMatchScore(
  designTags: readonly string[],
  preferredTags: readonly string[]
): number {
  if (preferredTags.length === 0) return 70;
  if (designTags.length === 0) return 50;
  const preferred = new Set(preferredTags);
  const hits = designTags.filter((tag) => preferred.has(tag)).length;
  return clamp((hits / preferred.size) * 100);
}

function materialVarietyScore(products: readonly { materialKey: string }[]): number {
  const distinct = new Set(products.map((product) => product.materialKey)).size;
  if (distinct >= 3) return 100;
  if (distinct === 2) return 80;
  return 55;
}

function mirrorSymmetry(beads: readonly BeadV1[]): number {
  if (beads.length <= 1) return 100;
  let matches = 0;
  const half = Math.floor(beads.length / 2);
  for (let i = 0; i < half; i += 1) {
    if (beads[i]!.beadProductId === beads[beads.length - 1 - i]!.beadProductId) {
      matches += 1;
    }
  }
  return (matches / half) * 100;
}

function centerFocalScore(beads: readonly BeadV1[]): number {
  const center = (beads.length - 1) / 2;
  const focalIndices = beads
    .map((bead, index) => (bead.role === "FOCAL" ? index : -1))
    .filter((index) => index >= 0);
  if (focalIndices.length === 0) return 60;
  const meanOffset =
    focalIndices.reduce((sum, index) => sum + Math.abs(index - center), 0) /
    focalIndices.length;
  const maxOffset = center === 0 ? 1 : center;
  return clamp(100 - (meanOffset / maxOffset) * 60);
}

function rhythmRegularity(beads: readonly BeadV1[]): number {
  if (beads.length <= 2) return 100;
  let best = 0;
  for (let period = 1; period <= Math.floor(beads.length / 2); period += 1) {
    let matches = 0;
    let comparisons = 0;
    for (let i = 0; i + period < beads.length; i += 1) {
      comparisons += 1;
      if (beads[i]!.beadProductId === beads[i + period]!.beadProductId) matches += 1;
    }
    if (comparisons > 0) best = Math.max(best, matches / comparisons);
  }
  return best * 100;
}

function lightnessFlowScore(
  beads: readonly BeadV1[],
  productsById: ReadonlyMap<string, CatalogProduct>
): number {
  if (beads.length <= 2) return 100;
  const lightness = beads.map((bead) => {
    const product = productsById.get(bead.beadProductId);
    const tag = product?.colorTags[0];
    return tag !== undefined ? (taxonomyColorOklch(tag)?.l ?? 0.5) : 0.5;
  });
  const half = Math.ceil(lightness.length / 2);
  const ascending = lightness.slice(0, half);
  const descending = lightness.slice(half);

  const monotonic = (values: readonly number[]): number => {
    if (values.length <= 1) return 1;
    let ascendingRuns = 0;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i]! >= values[i - 1]!) ascendingRuns += 1;
    }
    return ascendingRuns / (values.length - 1);
  };

  const ascendingScore = monotonic(ascending);
  const descendingScore = monotonic([...descending].reverse());
  const descendingWeight = descending.length > 0 ? 0.5 : 0;
  return clamp((ascendingScore * (1 - descendingWeight) + descendingScore * descendingWeight) * 100);
}

function compositionScore(
  strategy: LayoutStrategy,
  beads: readonly BeadV1[],
  productsById: ReadonlyMap<string, CatalogProduct>
): number {
  switch (strategy) {
    case "SYMMETRIC_BALANCE":
      return mirrorSymmetry(beads);
    case "CENTER_FOCAL":
      return centerFocalScore(beads);
    case "REPEAT_RHYTHM":
      return rhythmRegularity(beads);
    case "LOW_CONTRAST_FLOW":
      return lightnessFlowScore(beads, productsById);
  }
}

/**
 * design-score-v1: six deterministic sub-scores in [0, 100]. Color blends
 * OKLCH pair harmony with context color preference coverage; composition is
 * strategy-native (symmetry / focal centring / rhythm regularity / lightness
 * flow); constraint penalises 25 points per violation; overall is the fixed
 * weighted blend. No hidden state, no randomness.
 */
export function computeDesignScore(input: {
  strategy: LayoutStrategy;
  beads: readonly BeadV1[];
  productsById: ReadonlyMap<string, CatalogProduct>;
  context: RecommendationContext;
  violations: readonly ConstraintViolation[];
}): DesignScore {
  const { strategy, beads, productsById, context, violations } = input;
  const usedProductIds = new Set(beads.map((bead) => bead.beadProductId));
  const productTags: ProductTagSummary[] = [];
  for (const product of productsById.values()) {
    if (!usedProductIds.has(product.beadProductId)) continue;
    productTags.push({
      colorTags: [...product.colorTags],
      styleTags: [...product.styleTags],
      materialKey: product.materialKey
    });
  }

  const designColorTags = [...new Set(productTags.flatMap((p) => p.colorTags))];
  const designStyleTags = [...new Set(productTags.flatMap((p) => p.styleTags))];

  const colorScore =
    0.6 * colorHarmonyScore(productTags) +
    0.4 * preferenceMatchScore(designColorTags, context.preferences.colorPreferences);
  const materialScore = materialVarietyScore(productTags);
  const styleScore = preferenceMatchScore(designStyleTags, context.preferences.styleTags);
  const composition = compositionScore(strategy, beads, productsById);
  const constraint = clamp(100 - violations.length * 25);

  const overall =
    OVERALL_WEIGHTS.color * colorScore +
    OVERALL_WEIGHTS.material * materialScore +
    OVERALL_WEIGHTS.style * styleScore +
    OVERALL_WEIGHTS.composition * composition +
    OVERALL_WEIGHTS.constraint * constraint;

  return {
    colorScore: round2(clamp(colorScore)),
    materialScore: round2(clamp(materialScore)),
    styleScore: round2(clamp(styleScore)),
    compositionScore: round2(clamp(composition)),
    constraintScore: round2(constraint),
    overallScore: round2(clamp(overall)),
    formulaVersion: DESIGN_SCORE_FORMULA_VERSION
  };
}

export { OVERALL_WEIGHTS };
