import type {
  CreateTarotSessionRequest,
  CreateTarotSessionResponse,
  GetTarotSessionResponse,
  RevealTarotSessionRequest,
  RevealTarotSessionResponse,
  SaveTarotSessionRequest,
  SaveTarotSessionResponse,
  SelectTarotCardRequest,
  SelectTarotCardResponse
} from "@mystcrag/design-contract";
import type {
  TarotDrawSnapshot,
  TarotSessionRepository
} from "@mystcrag/database";
import {
  TAROT_DESIGN_RULE_VERSION,
  createPrivateDrawState,
  revealDraw,
  selectPosition,
  type RandomSource,
  type RevealedTarotCard
} from "@mystcrag/tarot-engine";

import { DomainApiError } from "../../contracts/api-error.js";
import {
  mapCreateTarotResponse,
  mapGetTarotResponse,
  mapRevealTarotResponse,
  mapSaveTarotResponse,
  mapSelectTarotResponse
} from "./tarot.public-mapper.js";
import type { TarotApiService, TarotDesignReader } from "./tarot.types.js";

const TAROT_DECK_VERSION = "rws-major-minor-v1";

const drawSnapshotFromState = (
  state: Parameters<typeof selectPosition>[0],
  cards?: readonly RevealedTarotCard[]
): TarotDrawSnapshot => ({
  acceptedSelections: state.selections.map((selection) => ({
    slot: selection.slot,
    displayedPosition: selection.displayedPosition,
    operationId: selection.operationId
  })),
  ...(cards === undefined
    ? {}
    : {
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
      })
});

function conflictFromEngine(error: unknown): never {
  if (error instanceof Error) {
    throw new DomainApiError("CONFLICT", error.message);
  }
  throw error;
}

export class TarotService implements TarotApiService {
  constructor(
    private readonly dependencies: {
      readonly repository: TarotSessionRepository;
      readonly random: RandomSource;
      readonly designReader?: TarotDesignReader;
    }
  ) {}

  async create(
    actorId: string,
    input: CreateTarotSessionRequest
  ): Promise<CreateTarotSessionResponse> {
    const privateDeckState = createPrivateDrawState({
      spreadType: input.spreadType,
      random: this.dependencies.random
    });
    const record = await this.dependencies.repository.create({
      ownerId: actorId,
      spreadType: input.spreadType,
      theme: input.theme,
      deckVersion: TAROT_DECK_VERSION,
      ruleVersion: TAROT_DESIGN_RULE_VERSION,
      privateDeckState,
      drawSnapshot: drawSnapshotFromState(privateDeckState),
      ...(input.parentSessionId === undefined
        ? {}
        : { parentSessionId: input.parentSessionId })
    });
    return mapCreateTarotResponse(input.requestId, record);
  }

  async select(
    actorId: string,
    sessionId: string,
    input: SelectTarotCardRequest
  ): Promise<SelectTarotCardResponse> {
    const current = await this.dependencies.repository.getOwned(actorId, sessionId);
    if (current.status !== "DRAWING" || current.privateDeckState.revealed) {
      throw new DomainApiError("CONFLICT", "Completed Tarot draws are immutable.");
    }
    const existingOperation = current.privateDeckState.selections.some(
      (selection) => selection.operationId === input.operationId
    );
    if (!existingOperation && current.stateRevision !== input.expectedRevision) {
      throw new DomainApiError("CONFLICT", "Tarot session revision conflict.");
    }

    let nextState;
    try {
      nextState = selectPosition(current.privateDeckState, {
        slot: input.slot,
        displayedPosition: input.displayedPosition,
        expectedRevision: current.privateDeckState.revision,
        operationId: input.operationId
      });
    } catch (error) {
      conflictFromEngine(error);
    }
    const record = await this.dependencies.repository.updateDraw({
      ownerId: actorId,
      sessionId,
      expectedRevision: input.expectedRevision,
      operationId: input.operationId,
      status: "DRAWING",
      privateDeckState: nextState,
      drawSnapshot: drawSnapshotFromState(nextState)
    });
    return mapSelectTarotResponse(input.requestId, record);
  }

  async reveal(
    actorId: string,
    sessionId: string,
    input: RevealTarotSessionRequest
  ): Promise<RevealTarotSessionResponse> {
    const current = await this.dependencies.repository.getOwned(actorId, sessionId);
    if (current.status !== "DRAWING" && current.status !== "DRAWN") {
      throw new DomainApiError("CONFLICT", "Tarot session cannot be revealed in its current state.");
    }
    if (
      current.status === "DRAWING" &&
      current.stateRevision !== input.expectedRevision
    ) {
      throw new DomainApiError("CONFLICT", "Tarot session revision conflict.");
    }
    if (
      current.status === "DRAWN" &&
      input.expectedRevision !== current.stateRevision &&
      input.expectedRevision !== current.stateRevision - 1
    ) {
      throw new DomainApiError("CONFLICT", "Tarot session revision conflict.");
    }

    let revealed;
    try {
      revealed = revealDraw(
        current.privateDeckState,
        current.privateDeckState.revision
      );
    } catch (error) {
      conflictFromEngine(error);
    }
    const record = await this.dependencies.repository.updateDraw({
      ownerId: actorId,
      sessionId,
      expectedRevision: input.expectedRevision,
      status: "DRAWN",
      privateDeckState: revealed.state,
      drawSnapshot: drawSnapshotFromState(revealed.state, revealed.cards)
    });
    return mapRevealTarotResponse(
      actorId,
      input.requestId,
      record,
      this.dependencies.designReader
    );
  }

  async get(actorId: string, sessionId: string): Promise<GetTarotSessionResponse> {
    const record = await this.dependencies.repository.getOwned(actorId, sessionId);
    return mapGetTarotResponse(
      actorId,
      `restore-${record.id}`,
      record,
      this.dependencies.designReader
    );
  }

  async save(
    actorId: string,
    sessionId: string,
    input: SaveTarotSessionRequest
  ): Promise<SaveTarotSessionResponse> {
    const record = await this.dependencies.repository.markSaved({
      ownerId: actorId,
      sessionId,
      expectedRevision: input.expectedRevision,
      ...(input.selectedDesignId === undefined
        ? {}
        : { selectedDesignId: input.selectedDesignId })
    });
    return mapSaveTarotResponse(
      actorId,
      input.requestId,
      record,
      this.dependencies.designReader
    );
  }
}
