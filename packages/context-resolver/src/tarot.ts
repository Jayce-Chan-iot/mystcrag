import { createHash } from "node:crypto";

import {
  resolveTaxonomyId,
  type Currency,
  type Locale,
  type RecommendationContext
} from "@mystcrag/design-contract";
import type {
  RevealedTarotCard,
  TarotDesignSignals
} from "@mystcrag/tarot-engine";

/**
 * Tarot stays a soft cultural context (task book EPIC 7, spec section 9):
 * it only contributes preferences at a discounted weight and never sets
 * hard constraints or avoidances beyond the wrist measurement the user
 * supplied directly.
 */
export const TAROT_SOURCE_WEIGHT = 0.5;

export type TarotKnowledgeRule = {
  readonly subject: string;
  readonly payload: {
    readonly colors: readonly string[];
    readonly emotions: readonly string[];
    readonly styles: readonly string[];
  };
  readonly confidence: number;
};

/** Card tones to canonical COLOR taxonomy refs. */
const TONE_TO_COLOR: Readonly<Record<string, string>> = {
  blue: "color:blue",
  violet: "color:purple",
  rose: "color:pink",
  ink: "color:black",
  amber: "color:yellow",
  ivory: "color:white"
};

export function tarotSubjectForCard(card: RevealedTarotCard): string {
  // Major arcana ids are zero-padded numbers ("17-the-star"); minor arcana
  // ids start with a suit name ("cups-01").
  const isMajor = /^\d{2}-/.test(card.id);
  return `tarot:${isMajor ? "major" : "minor"}-${card.id}`;
}

function pushUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function fallbackEmotions(card: RevealedTarotCard): string[] {
  const keywords =
    card.orientation === "REVERSED" ? card.reversedKeywords : card.uprightKeywords;
  const emotions: string[] = [];
  for (const keyword of keywords) {
    const id = resolveTaxonomyId(keyword, "EMOTION");
    if (id !== null) emotions.push(id);
  }
  return emotions;
}

function fallbackColors(cards: readonly RevealedTarotCard[]): string[] {
  const colors: string[] = [];
  for (const card of cards) {
    for (const tag of card.designTags.colors) {
      const tone = tag.slice(tag.indexOf(":") + 1);
      const mapped = TONE_TO_COLOR[tone];
      if (mapped !== undefined && !colors.includes(mapped)) colors.push(mapped);
    }
  }
  return colors;
}

export function resolveTarotContext(input: {
  wristCircumferenceMm: number;
  targetInnerCircumferenceMm?: number;
  signals: TarotDesignSignals;
  revealedCards: readonly RevealedTarotCard[];
  tarotRules: readonly TarotKnowledgeRule[];
  locale?: Locale;
  currency?: Currency;
}): RecommendationContext {
  const rulesBySubject = new Map(input.tarotRules.map((rule) => [rule.subject, rule]));

  const emotions: string[] = [];
  const styles: string[] = [];
  const colors: string[] = [];
  const contextWeights: Record<string, number> = {};

  const coveredCards: RevealedTarotCard[] = [];
  for (const card of input.revealedCards) {
    const rule = rulesBySubject.get(tarotSubjectForCard(card));
    if (rule === undefined) continue;
    coveredCards.push(card);
    pushUnique(emotions, rule.payload.emotions);
    pushUnique(styles, rule.payload.styles);
    pushUnique(colors, rule.payload.colors);
    contextWeights[rule.subject] = Number(
      (rule.confidence * TAROT_SOURCE_WEIGHT).toFixed(4)
    );
  }

  // Cards without curated knowledge rules fall back to engine design
  // signals: each card's tone maps onto the color palette and its
  // upright/reversed keywords onto emotion terms.
  if (coveredCards.length < input.revealedCards.length) {
    const uncovered = input.revealedCards.filter((card) => !coveredCards.includes(card));
    pushUnique(colors, fallbackColors(uncovered));
    for (const card of uncovered) {
      pushUnique(emotions, fallbackEmotions(card));
    }
  }

  return {
    contextId: `ctx-${createHash("sha256")
      .update(
        JSON.stringify({
          wristCircumferenceMm: input.wristCircumferenceMm,
          cards: input.revealedCards.map((card) => tarotSubjectForCard(card)),
          signals: input.signals,
          rules: input.tarotRules.map((rule) => rule.subject)
        })
      )
      .digest("hex")
      .slice(0, 12)}`,
    locale: input.locale ?? "zh-CN",
    currency: input.currency ?? "CNY",
    sources: [{ sourceType: "context-source:tarot", weight: TAROT_SOURCE_WEIGHT }],
    hardConstraints: {
      wristCircumferenceMm: input.wristCircumferenceMm,
      ...(input.targetInnerCircumferenceMm === undefined
        ? {}
        : { targetInnerCircumferenceMm: input.targetInnerCircumferenceMm }),
      requiredProductIds: [],
      excludedProductIds: [],
      mustKeepComponentIds: []
    },
    preferences: {
      emotionTags: emotions,
      styleTags: styles,
      colorPreferences: colors,
      visualPreferences: []
    },
    avoidances: { materialIds: [], colorFamilyIds: [] },
    contextWeights
  };
}
