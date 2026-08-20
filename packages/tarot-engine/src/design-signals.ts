import type { RevealedTarotCard, TarotSpreadType, TarotTheme } from "./types";

export const TAROT_DESIGN_RULE_VERSION = "tarot-design-rules-v1";

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
}): {
  palette: { primary: string; support: string; accent: string };
  styleTags: readonly string[];
  themeTags: readonly string[];
  directions: readonly ["BALANCED", "CONTRAST", "NEUTRAL_LED"];
  ruleVersion: string;
} {
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
