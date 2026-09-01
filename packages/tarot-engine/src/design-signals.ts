import type { TarotSpreadType, TarotTheme } from "@mystcrag/design-contract";
import type { RevealedTarotCard } from "./types";

export const TAROT_DESIGN_RULE_VERSION = "tarot-design-rules-v1";

export interface TarotDesignSignals {
  readonly palette: { readonly primary: string; readonly support: string; readonly accent: string };
  readonly styleTags: readonly string[];
  readonly themeTags: readonly string[];
  readonly directions: readonly ["BALANCED", "CONTRAST", "NEUTRAL_LED"];
  readonly ruleVersion: string;
}

export interface TarotCatalogCandidate {
  readonly productId: string;
  readonly colorTags: readonly string[];
  readonly visualStyleTags: readonly string[];
  readonly themeTags: readonly string[];
  readonly active: boolean;
  readonly unitPriceMinor: number;
}

export interface ScoredTarotMaterial {
  readonly productId: string;
  readonly totalScore: number;
  readonly scores: {
    readonly color: number;
    readonly visualStyle: number;
    readonly theme: number;
    readonly availability: number;
    readonly budget: number;
  };
}

const tagValue = (tag: string): string => tag.slice(tag.indexOf(":") + 1);

const colorFor = (card: RevealedTarotCard): string => {
  const colorTag = card.designTags.colors.find((tag) => tag.startsWith("color-v1:"));
  if (!colorTag) {
    throw new Error(`card ${card.id} has no color design tag`);
  }
  return tagValue(colorTag);
};

const forSlot = (cards: readonly RevealedTarotCard[], slot: RevealedTarotCard["slot"]): RevealedTarotCard => {
  const card = cards.find((candidate) => candidate.slot === slot);
  if (!card) {
    throw new Error(`missing revealed card for ${slot}`);
  }
  return card;
};

const unique = (tags: readonly string[]): readonly string[] => [...new Set(tags)];

export function deriveDesignSignals(input: {
  spreadType: TarotSpreadType;
  cards: readonly RevealedTarotCard[];
  theme: TarotTheme;
}): TarotDesignSignals {
  const roleCards = input.spreadType === "SINGLE"
    ? { primary: forSlot(input.cards, "GUIDANCE"), support: undefined, accent: undefined }
    : {
      primary: forSlot(input.cards, "PRESENT"),
      support: forSlot(input.cards, "PAST"),
      accent: forSlot(input.cards, "FUTURE"),
    };
  const cards = Object.values(roleCards).filter(
    (card): card is RevealedTarotCard => card !== undefined,
  );

  return {
    palette: {
      primary: colorFor(roleCards.primary),
      support: roleCards.support ? colorFor(roleCards.support) : "ivory",
      accent: roleCards.accent ? colorFor(roleCards.accent) : "ink",
    },
    styleTags: unique(cards.flatMap((card) => [
      ...card.designTags.visual,
      `orientation-v1:${card.orientation.toLowerCase()}`,
      ...((card.orientation === "REVERSED" ? card.reversedKeywords : card.uprightKeywords)
        .map((keyword) => `keyword-v1:${keyword}`)),
    ])),
    themeTags: unique([
      `theme-v1:${input.theme.toLowerCase().replaceAll("_", "-")}`,
      ...cards.flatMap((card) => card.designTags.themes),
    ]),
    directions: ["BALANCED", "CONTRAST", "NEUTRAL_LED"],
    ruleVersion: TAROT_DESIGN_RULE_VERSION,
  };
}

const normalizedTag = (tag: string): string =>
  tagValue(tag).trim().toLowerCase();

const hasMatch = (left: readonly string[], right: readonly string[]): boolean => {
  const rightValues = new Set(right.map(normalizedTag));
  return left.some((tag) => rightValues.has(normalizedTag(tag)));
};

const compareProductIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function scoreTarotMaterials(input: {
  signals: TarotDesignSignals;
  products: readonly TarotCatalogCandidate[];
  budget?: { minMinor?: number; maxMinor?: number };
}): readonly ScoredTarotMaterial[] {
  const palette = [
    input.signals.palette.primary,
    input.signals.palette.support,
    input.signals.palette.accent,
  ];

  return input.products
    .filter((product) => product.active)
    .map((product): ScoredTarotMaterial => {
      const withinMinimum =
        input.budget?.minMinor === undefined || product.unitPriceMinor >= input.budget.minMinor;
      const withinMaximum =
        input.budget?.maxMinor === undefined || product.unitPriceMinor <= input.budget.maxMinor;
      const scores = {
        color: hasMatch(product.colorTags, palette) ? 40 : 0,
        visualStyle: hasMatch(product.visualStyleTags, input.signals.styleTags) ? 25 : 0,
        theme: hasMatch(product.themeTags, input.signals.themeTags) ? 15 : 0,
        availability: 10,
        budget: withinMinimum && withinMaximum ? 10 : 0,
      } as const;
      return {
        productId: product.productId,
        totalScore:
          scores.color +
          scores.visualStyle +
          scores.theme +
          scores.availability +
          scores.budget,
        scores,
      };
    })
    .sort(
      (left, right) =>
        right.totalScore - left.totalScore || compareProductIds(left.productId, right.productId),
    );
}
