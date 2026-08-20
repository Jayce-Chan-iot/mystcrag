import {
  PersistenceError,
  type CreateTarotSessionRecord,
  type MarkTarotSessionSavedRecord,
  type SaveTarotRecommendationsRecord,
  type TarotDrawSnapshot,
  type TarotSessionRecord,
  type TarotSessionRepository,
  type UpdateTarotDrawRecord
} from "@mystcrag/database";
import type {
  RandomSource,
  RevealedTarotCard
} from "@mystcrag/tarot-engine";

export const tarotTestNow = new Date("2026-08-20T12:00:00.000Z");

export class ZeroRandomSource implements RandomSource {
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("Expected a positive random upper bound");
    }
    return 0;
  }
}

export const cloneTestValue = <T>(value: T): T => structuredClone(value);

export const toTestDrawSnapshot = (
  state: TarotSessionRecord["privateDeckState"],
  cards?: readonly RevealedTarotCard[]
): TarotDrawSnapshot => ({
  acceptedSelections: state.selections.map((selection) => ({ ...selection })),
  ...(cards
    ? {
        revealedCards: cards.map((card) => ({
          slot: card.slot,
          displayedPosition: card.displayedPosition,
          cardId: card.id,
          number: card.number,
          nameZh: card.nameZh,
          nameEn: card.nameEn,
          assetFile: card.assetFile,
          orientation: card.orientation,
          keywords: [
            ...(card.orientation === "UPRIGHT"
              ? card.uprightKeywords
              : card.reversedKeywords)
          ]
        }))
      }
    : {})
});

export class InMemoryTarotRepository implements TarotSessionRepository {
  private readonly records = new Map<string, TarotSessionRecord>();
  private sequence = 0;

  seed(record: TarotSessionRecord): void {
    this.records.set(record.id, cloneTestValue(record));
  }

  readPrivate(sessionId: string): TarotSessionRecord {
    const record = this.records.get(sessionId);
    if (!record) throw new Error(`Missing test Tarot session ${sessionId}`);
    return cloneTestValue(record);
  }

  async create(input: CreateTarotSessionRecord): Promise<TarotSessionRecord> {
    if (input.parentSessionId !== undefined) {
      this.requireOwned(input.ownerId, input.parentSessionId);
    }
    const createdAt = new Date(tarotTestNow.getTime() + this.sequence * 1_000);
    const record: TarotSessionRecord = {
      id: `tarot-session-${++this.sequence}`,
      ownerId: input.ownerId,
      spreadType: input.spreadType,
      theme: input.theme,
      status: "DRAWING",
      stateRevision: 1,
      deckVersion: input.deckVersion,
      ruleVersion: input.ruleVersion,
      privateDeckState: cloneTestValue(input.privateDeckState),
      drawSnapshot: cloneTestValue(input.drawSnapshot),
      recommendationSnapshot: null,
      questionCiphertext: null,
      questionSavedAt: null,
      selectedDesignId: null,
      parentSessionId: input.parentSessionId ?? null,
      recommendations: [],
      createdAt,
      updatedAt: createdAt
    };
    this.records.set(record.id, record);
    return cloneTestValue(record);
  }

  async getOwned(ownerId: string, sessionId: string): Promise<TarotSessionRecord> {
    return cloneTestValue(this.requireOwned(ownerId, sessionId));
  }

  async updateDraw(input: UpdateTarotDrawRecord): Promise<TarotSessionRecord> {
    const current = this.requireOwned(input.ownerId, input.sessionId);
    const existing = input.operationId
      ? current.privateDeckState.selections.find(
          (selection) => selection.operationId === input.operationId
        )
      : undefined;
    if (existing) {
      const retry = input.privateDeckState.selections.find(
        (selection) => selection.operationId === input.operationId
      );
      if (
        retry?.slot !== existing.slot ||
        retry.displayedPosition !== existing.displayedPosition
      ) {
        throw new PersistenceError(
          "CONFLICT",
          "Tarot operation ID was reused with different input"
        );
      }
      return cloneTestValue(current);
    }
    const exactRevealRetry =
      input.operationId === undefined &&
      current.status === "DRAWN" &&
      JSON.stringify(current.privateDeckState) === JSON.stringify(input.privateDeckState) &&
      JSON.stringify(current.drawSnapshot) === JSON.stringify(input.drawSnapshot) &&
      (input.expectedRevision === current.stateRevision ||
        input.expectedRevision === current.stateRevision - 1);
    if (exactRevealRetry) return cloneTestValue(current);
    if (current.stateRevision !== input.expectedRevision) {
      throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
    }
    if (current.status !== "DRAWING") {
      throw new PersistenceError("CONFLICT", "Tarot draw is immutable");
    }
    const updated: TarotSessionRecord = {
      ...current,
      status: input.status,
      stateRevision: current.stateRevision + 1,
      privateDeckState: cloneTestValue(input.privateDeckState),
      drawSnapshot: cloneTestValue(input.drawSnapshot),
      updatedAt: new Date(current.updatedAt.getTime() + 1_000)
    };
    this.records.set(updated.id, updated);
    return cloneTestValue(updated);
  }

  async saveRecommendations(
    input: SaveTarotRecommendationsRecord
  ): Promise<TarotSessionRecord> {
    const current = this.requireOwned(input.ownerId, input.sessionId);
    if (current.status === "RECOMMENDED" || current.status === "SAVED") {
      const sameRecommendations = JSON.stringify(
        current.recommendations.map(({ rank, designId }) => ({ rank, designId }))
      ) === JSON.stringify(input.recommendations);
      const sameSnapshot = JSON.stringify(current.recommendationSnapshot) ===
        JSON.stringify(input.recommendationSnapshot);
      if (sameRecommendations && sameSnapshot) return cloneTestValue(current);
      throw new PersistenceError("CONFLICT", "Tarot recommendations already exist");
    }
    if (current.status !== "DRAWN") {
      throw new PersistenceError("CONFLICT", "Tarot session is not ready for recommendations");
    }
    if (current.stateRevision !== input.expectedRevision) {
      throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
    }
    const updatedAt = new Date(current.updatedAt.getTime() + 1_000);
    const updated: TarotSessionRecord = {
      ...current,
      status: "RECOMMENDED",
      stateRevision: current.stateRevision + 1,
      recommendationSnapshot: cloneTestValue(input.recommendationSnapshot),
      questionCiphertext: input.questionCiphertext ?? null,
      questionSavedAt: input.questionSavedAt ?? null,
      recommendations: input.recommendations.map(({ rank, designId }) => ({
        id: `recommendation-${current.id}-${rank}`,
        rank,
        designId,
        createdAt: updatedAt
      })),
      updatedAt
    };
    this.records.set(updated.id, updated);
    return cloneTestValue(updated);
  }

  async markSaved(input: MarkTarotSessionSavedRecord): Promise<TarotSessionRecord> {
    const current = this.requireOwned(input.ownerId, input.sessionId);
    if (current.status === "SAVED") {
      if (
        current.selectedDesignId === (input.selectedDesignId ?? null) &&
        (input.expectedRevision === current.stateRevision ||
          input.expectedRevision === current.stateRevision - 1)
      ) {
        return cloneTestValue(current);
      }
      throw new PersistenceError("CONFLICT", "Tarot session was already saved");
    }
    if (current.status !== "RECOMMENDED") {
      throw new PersistenceError("CONFLICT", "Tarot session is not ready to save");
    }
    if (current.stateRevision !== input.expectedRevision) {
      throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
    }
    if (
      input.selectedDesignId !== undefined &&
      !current.recommendations.some(
        (recommendation) => recommendation.designId === input.selectedDesignId
      )
    ) {
      throw new PersistenceError(
        "VALIDATION_ERROR",
        "Selected design must be a session recommendation"
      );
    }
    const updated: TarotSessionRecord = {
      ...current,
      status: "SAVED",
      stateRevision: current.stateRevision + 1,
      selectedDesignId: input.selectedDesignId ?? null,
      updatedAt: new Date(current.updatedAt.getTime() + 1_000)
    };
    this.records.set(updated.id, updated);
    return cloneTestValue(updated);
  }

  private requireOwned(ownerId: string, sessionId: string): TarotSessionRecord {
    const record = this.records.get(sessionId);
    if (!record || record.ownerId !== ownerId) {
      throw new PersistenceError("NOT_FOUND", "Tarot session not found");
    }
    return record;
  }
}
