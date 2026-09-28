import { createHash } from "node:crypto";

import {
  OracleCastDtoSchema,
  OracleDesignSignalSchema,
  RecommendationContextSchema,
  type Currency,
  type Locale,
  type OracleCastDto,
  type OracleDesignSignal,
  type OracleRhythmTag,
  type OracleTrigram,
  type RecommendationContext
} from "@mystcrag/design-contract";

export const ORACLE_SOURCE_WEIGHT = 0.5;
export const ORACLE_DESIGN_RULE_VERSION = "oracle-design-rules-v1" as const;

type TrigramDesignRule = {
  readonly colors: readonly string[];
  readonly styles: readonly string[];
};

/**
 * Versioned cultural-to-visual correspondence for design guidance only.
 * These rules do not express fortune, efficacy, product, price, or fit facts.
 * See docs/OSS_RESEARCH.md for the structural references and content boundary.
 */
const TRIGRAM_DESIGN_RULES: Readonly<Record<OracleTrigram, TrigramDesignRule>> = {
  HEAVEN: { colors: ["color:white", "color:gray"], styles: ["style:minimal", "style:modern"] },
  LAKE: { colors: ["color:white", "color:blue"], styles: ["style:delicate", "style:romantic"] },
  FIRE: { colors: ["color:red", "color:orange"], styles: ["style:modern", "style:eastern-contemporary"] },
  THUNDER: { colors: ["color:green", "color:black"], styles: ["style:natural", "style:eastern-contemporary"] },
  WIND: { colors: ["color:green", "color:teal"], styles: ["style:natural", "style:delicate"] },
  WATER: { colors: ["color:blue", "color:black"], styles: ["style:ethereal", "style:minimal"] },
  MOUNTAIN: { colors: ["color:brown", "color:gray"], styles: ["style:minimal", "style:natural"] },
  EARTH: { colors: ["color:yellow", "color:brown"], styles: ["style:eastern-contemporary", "style:natural"] }
};

const RHYTHM_VISUAL_PREFERENCE: Readonly<Record<OracleRhythmTag, string>> = {
  "rhythm:steady": "texture:smooth",
  "rhythm:alternating": "texture:banded",
  "rhythm:gradual": "transparency:translucent",
  "rhythm:punctuated": "texture:included"
};

function visualPreferenceForRhythm(rhythm: string): string {
  const preference = RHYTHM_VISUAL_PREFERENCE[rhythm as OracleRhythmTag];
  if (preference === undefined) {
    throw new Error(`unsupported Oracle rhythm: ${rhythm}`);
  }
  return preference;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function rhythmForCast(cast: OracleCastDto): OracleRhythmTag {
  if (cast.movingLineIndices.length >= 3) return "rhythm:punctuated";
  if (cast.movingLineIndices.length > 0) return "rhythm:alternating";

  const polarities = cast.lines.map((line) => line === 7 || line === 9);
  const transitions = polarities.slice(1).filter((value, index) => value !== polarities[index]).length;
  return transitions >= 3 ? "rhythm:gradual" : "rhythm:steady";
}

export function deriveOracleDesignSignal(input: OracleCastDto): OracleDesignSignal {
  const cast = OracleCastDtoSchema.parse(input);
  const upper = TRIGRAM_DESIGN_RULES[cast.primaryHexagram.upperTrigram];
  const lower = TRIGRAM_DESIGN_RULES[cast.primaryHexagram.lowerTrigram];
  const primaryColorTags = unique(upper.colors);
  const supportColorTags = unique(lower.colors).filter((color) => !primaryColorTags.includes(color));

  return OracleDesignSignalSchema.parse({
    ruleVersion: ORACLE_DESIGN_RULE_VERSION,
    primaryColorTags,
    supportColorTags,
    styleTags: unique([...upper.styles, ...lower.styles]),
    rhythmTags: [rhythmForCast(cast)],
    accentLinePositions: [...cast.movingLineIndices]
  });
}

export function resolveOracleContext(input: {
  cast: OracleCastDto;
  signal: OracleDesignSignal;
  wristCircumferenceMm: number;
  locale: Locale;
  currency: Currency;
}): RecommendationContext {
  const cast = OracleCastDtoSchema.parse(input.cast);
  const signal = OracleDesignSignalSchema.parse(input.signal);
  if (
    signal.accentLinePositions.length !== cast.movingLineIndices.length ||
    signal.accentLinePositions.some((position, index) => position !== cast.movingLineIndices[index])
  ) {
    throw new Error("accent line positions must exactly match the cast moving lines");
  }

  const contextId = `ctx-${createHash("sha256")
    .update(
      JSON.stringify({
        cast,
        signal,
        wristCircumferenceMm: input.wristCircumferenceMm,
        locale: input.locale,
        currency: input.currency
      })
    )
    .digest("hex")
    .slice(0, 12)}`;

  return RecommendationContextSchema.parse({
    contextId,
    locale: input.locale,
    currency: input.currency,
    sources: [{ sourceType: "context-source:oracle", weight: ORACLE_SOURCE_WEIGHT }],
    hardConstraints: {
      wristCircumferenceMm: input.wristCircumferenceMm,
      requiredProductIds: [],
      excludedProductIds: [],
      mustKeepComponentIds: []
    },
    preferences: {
      emotionTags: [],
      styleTags: [...signal.styleTags],
      colorPreferences: unique([...signal.primaryColorTags, ...signal.supportColorTags]),
      visualPreferences: unique(signal.rhythmTags.map(visualPreferenceForRhythm))
    },
    avoidances: { materialIds: [], colorFamilyIds: [] },
    contextWeights: {
      [`oracle:hexagram-${cast.primaryHexagram.number}`]: ORACLE_SOURCE_WEIGHT
    }
  });
}
