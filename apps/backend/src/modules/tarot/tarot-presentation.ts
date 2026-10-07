import {
  PresentationLocaleSchema,
  TarotPresentationResponseSchema,
  TarotPublicSessionSchema,
  type PresentationLocale,
  type TarotPresentationCardReflection,
  type TarotPresentationResponse,
  type TarotPublicSession
} from "@mystcrag/design-contract";

import {
  tarotCardReflection,
  tarotColorStory,
  tarotDesignRationale,
  tarotDisclaimer,
  tarotPresentationHeadline,
  tarotPresentationSummary
} from "./tarot-presentation.templates.js";

/**
 * Projects a persisted, owner-owned Tarot session into reviewed, read-only display copy for one
 * display locale.
 *
 * It reads only the validated public session facts — canonical spread slots, revealed-card
 * orientation, and the persisted design direction count and bead count — and renders original
 * three-language templates. It never re-draws, re-reveals, re-recommends, calls an entropy source or
 * provider, persists a translation, mutates the session, or invents a card, design ID, price, or
 * stock value. `sourceRevision` always mirrors the authoritative session revision, and card
 * reflections follow the canonical slot order of the spread.
 */
export function projectTarotPresentation(
  session: TarotPublicSession,
  locale: PresentationLocale
): TarotPresentationResponse {
  const source = TarotPublicSessionSchema.parse(session);
  const targetLocale = PresentationLocaleSchema.parse(locale);

  const revealedBySlot = new Map(
    (source.revealedCards ?? []).map((card) => [card.slot, card] as const)
  );

  const cardReflections: TarotPresentationCardReflection[] = source.slots.map((slot) => ({
    slot,
    text: tarotCardReflection(targetLocale, slot, revealedBySlot.get(slot)?.orientation)
  }));

  const recommendations = source.recommendations ?? [];
  const directionCount = recommendations.length;
  const beadCount = recommendations.reduce(
    (total, recommendation) => total + recommendation.design.beads.length,
    0
  );

  return TarotPresentationResponseSchema.parse({
    sessionId: source.sessionId,
    sourceRevision: source.revision,
    locale: targetLocale,
    headline: tarotPresentationHeadline(targetLocale),
    summary: tarotPresentationSummary(targetLocale, source.slots.length, directionCount),
    cardReflections,
    colorStory: tarotColorStory(targetLocale, source.colorStory !== undefined),
    designRationale: tarotDesignRationale(targetLocale, directionCount, beadCount),
    disclaimer: tarotDisclaimer(targetLocale)
  });
}
