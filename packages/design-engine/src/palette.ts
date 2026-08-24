import { pairHarmony, taxonomyColorOklch } from "./color.js";

/**
 * Structural input for palette recommendation: COLOR_THEORY knowledge rules
 * projected to plain data by the caller, so the engine stays independent of
 * knowledge-core (task book section on module boundaries).
 */
export type PaletteColorRule = {
  ruleId: string;
  subject: string;
  relation: string;
  companions: readonly string[];
  confidence: number;
  note?: string;
};

export type PaletteSuggestion = {
  colors: string[];
  harmonyScore: number;
  ruleIds: string[];
  confidence: number;
  note?: string;
};

/** Relations that contribute companion colors to a palette. */
const COMPANION_RELATIONS = new Set(["harmonizes-with", "contrasts-with"]);

const DEFAULT_PALETTE_SIZE = 3;
const DEFAULT_LIMIT = 3;

function averagePairHarmony(colors: readonly string[]): number {
  const oklchColors = colors
    .map((color) => taxonomyColorOklch(color))
    .filter((value): value is NonNullable<typeof value> => value !== undefined);
  if (oklchColors.length < 2) return 0.5;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < oklchColors.length; i += 1) {
    for (let j = i + 1; j < oklchColors.length; j += 1) {
      total += pairHarmony(oklchColors[i]!, oklchColors[j]!);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0.5 : Number((total / pairs).toFixed(6));
}

function companionsOf(
  rules: readonly PaletteColorRule[],
  subject: string
): PaletteColorRule[] {
  return rules
    .filter((rule) => rule.subject === subject && COMPANION_RELATIONS.has(rule.relation))
    .sort((left, right) =>
      right.confidence - left.confidence || left.ruleId.localeCompare(right.ruleId)
    );
}

function expandPalette(
  base: string,
  rules: readonly PaletteColorRule[],
  firstCompanion: PaletteColorRule,
  paletteSize: number
): { colors: string[]; ruleIds: string[]; confidence: number; note?: string } {
  const colors = [base, ...firstCompanion.companions];
  const ruleIds = [firstCompanion.ruleId];
  const confidences = [firstCompanion.confidence];
  const note = firstCompanion.note;

  if (colors.length < paletteSize) {
    const frontier = [...firstCompanion.companions];
    const seen = new Set(colors);
    while (colors.length < paletteSize && frontier.length > 0) {
      const subject = frontier.shift()!;
      for (const rule of companionsOf(rules, subject)) {
        if (colors.length >= paletteSize) break;
        for (const companion of rule.companions) {
          if (colors.length >= paletteSize) break;
          if (seen.has(companion) || companion === base) continue;
          seen.add(companion);
          colors.push(companion);
          ruleIds.push(rule.ruleId);
          confidences.push(rule.confidence);
          frontier.push(companion);
        }
      }
    }
  }

  return {
    colors: colors.slice(0, paletteSize),
    ruleIds,
    confidence: Math.min(...confidences),
    note
  };
}

/**
 * Deterministic palette recommendation from COLOR_THEORY rules: expands the
 * base color through companion relations (breadth-first, confidence-ordered,
 * rule-id tiebreak) and scores each palette with the OKLCH pair-harmony math
 * shared with design scoring. Identical inputs always produce identical
 * output; no I/O, no randomness.
 */
export function recommendPalettes(input: {
  baseColorTaxonomyId: string;
  rules: readonly PaletteColorRule[];
  paletteSize?: number;
  limit?: number;
}): PaletteSuggestion[] {
  const paletteSize = Math.min(Math.max(input.paletteSize ?? DEFAULT_PALETTE_SIZE, 2), 5);
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 10);

  const suggestions: PaletteSuggestion[] = [];
  const signatures = new Set<string>();

  for (const firstCompanion of companionsOf(input.rules, input.baseColorTaxonomyId)) {
    const expanded = expandPalette(
      input.baseColorTaxonomyId,
      input.rules,
      firstCompanion,
      paletteSize
    );
    const signature = [...expanded.colors].sort().join("|");
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    suggestions.push({
      colors: expanded.colors,
      harmonyScore: averagePairHarmony(expanded.colors),
      ruleIds: expanded.ruleIds,
      confidence: Number(expanded.confidence.toFixed(4)),
      ...(expanded.note === undefined ? {} : { note: expanded.note })
    });
  }

  suggestions.sort((left, right) =>
    right.harmonyScore - left.harmonyScore ||
    right.confidence - left.confidence ||
    left.colors.join("|").localeCompare(right.colors.join("|"))
  );

  return suggestions.slice(0, limit);
}
