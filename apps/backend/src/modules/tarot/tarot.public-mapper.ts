import {
  CreateTarotSessionResponseSchema,
  GetTarotSessionResponseSchema,
  RevealTarotSessionResponseSchema,
  SaveTarotSessionResponseSchema,
  SelectTarotCardResponseSchema,
  toPublicDesign,
  type CreateTarotSessionResponse,
  type GetTarotSessionResponse,
  type RevealTarotSessionResponse,
  type SaveTarotSessionResponse,
  type SelectTarotCardResponse,
  type TarotPublicSession
} from "@mystcrag/design-contract";
import type { TarotSessionRecord } from "@mystcrag/database";
import { requiredSlotsForSpread } from "@mystcrag/tarot-engine";

import { DomainApiError } from "../../contracts/api-error.js";
import type { TarotDesignReader } from "./tarot.types.js";

export const TAROT_CARD_BACK = Object.freeze({
  assetFile: "mystcrag-tarot-card-back.svg",
  altText: "Mystcrag Tarot card back"
});

type PublicSessionCore = Pick<
  TarotPublicSession,
  | "sessionId"
  | "spreadType"
  | "theme"
  | "status"
  | "revision"
  | "slots"
  | "acceptedSelections"
  | "createdAt"
  | "updatedAt"
> &
  Partial<Pick<TarotPublicSession, "selectedDesignId" | "parentSessionId">>;

function coreFromRecord(
  record: TarotSessionRecord,
  status: TarotPublicSession["status"] = record.status
): PublicSessionCore {
  return {
    sessionId: record.id,
    spreadType: record.spreadType,
    theme: record.theme,
    status,
    revision: record.stateRevision,
    slots: [...requiredSlotsForSpread(record.spreadType)],
    acceptedSelections: record.drawSnapshot.acceptedSelections.map((selection) => ({
      slot: selection.slot,
      displayedPosition: selection.displayedPosition,
      operationId: selection.operationId
    })),
    ...(record.selectedDesignId === null
      ? {}
      : { selectedDesignId: record.selectedDesignId }),
    ...(record.parentSessionId === null
      ? {}
      : { parentSessionId: record.parentSessionId }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

const revealedCardsFromRecord = (record: TarotSessionRecord) =>
  record.drawSnapshot.revealedCards?.map((card) => ({
    slot: card.slot,
    displayedPosition: card.displayedPosition,
    cardId: card.cardId,
    number: card.number,
    nameZh: card.nameZh,
    nameEn: card.nameEn,
    assetFile: card.assetFile,
    orientation: card.orientation,
    keywords: [...card.keywords]
  }));

async function recommendationDetails(
  actorId: string,
  record: TarotSessionRecord,
  designReader: TarotDesignReader | undefined
) {
  if (record.recommendationSnapshot === null) return {};
  if (!designReader) {
    throw new DomainApiError(
      "INTERNAL_ERROR",
      "Tarot recommendation designs are unavailable."
    );
  }
  const recommendations = await Promise.all(
    [...record.recommendations]
      .sort((left, right) => left.rank - right.rank)
      .map(async ({ rank, designId }) => ({
        rank,
        design: toPublicDesign(await designReader.getOwnedDesign(actorId, designId))
      }))
  );
  return {
    interpretation: {
      headline: record.recommendationSnapshot.interpretation.headline,
      summary: record.recommendationSnapshot.interpretation.summary,
      cardReflections: record.recommendationSnapshot.interpretation.cardReflections.map(
        (reflection) => ({ slot: reflection.slot, reflection: reflection.reflection })
      ),
      designRationale: record.recommendationSnapshot.interpretation.designRationale,
      disclaimer: record.recommendationSnapshot.interpretation.disclaimer
    },
    colorStory: {
      primaryColor: record.recommendationSnapshot.colorStory.primaryColor,
      supportColor: record.recommendationSnapshot.colorStory.supportColor,
      accentColor: record.recommendationSnapshot.colorStory.accentColor,
      rationale: record.recommendationSnapshot.colorStory.rationale
    },
    materialRecommendations:
      record.recommendationSnapshot.materialRecommendations.map((material) => ({
        beadProductId: material.beadProductId,
        displayName: material.displayName,
        crystalName: material.crystalName,
        colorTags: [...material.colorTags],
        reason: material.reason
      })),
    recommendations
  };
}

async function fullSessionFromRecord(
  actorId: string,
  record: TarotSessionRecord,
  designReader: TarotDesignReader | undefined
) {
  const revealedCards = revealedCardsFromRecord(record);
  return {
    ...coreFromRecord(record),
    ...(revealedCards === undefined ? {} : { revealedCards }),
    ...(await recommendationDetails(actorId, record, designReader))
  };
}

export function mapCreateTarotResponse(
  requestId: string,
  record: TarotSessionRecord
): CreateTarotSessionResponse {
  return CreateTarotSessionResponseSchema.parse({
    requestId,
    session: coreFromRecord(record, "DRAWING"),
    cardBack: TAROT_CARD_BACK
  });
}

export function mapSelectTarotResponse(
  requestId: string,
  record: TarotSessionRecord
): SelectTarotCardResponse {
  const complete =
    record.drawSnapshot.acceptedSelections.length ===
    requiredSlotsForSpread(record.spreadType).length;
  return SelectTarotCardResponseSchema.parse({
    requestId,
    session: coreFromRecord(record, complete ? "DRAWN" : "DRAWING")
  });
}

export async function mapRevealTarotResponse(
  actorId: string,
  requestId: string,
  record: TarotSessionRecord,
  designReader?: TarotDesignReader
): Promise<RevealTarotSessionResponse> {
  return RevealTarotSessionResponseSchema.parse({
    requestId,
    session: await fullSessionFromRecord(actorId, record, designReader)
  });
}

export async function mapGetTarotResponse(
  actorId: string,
  requestId: string,
  record: TarotSessionRecord,
  designReader?: TarotDesignReader
): Promise<GetTarotSessionResponse> {
  return GetTarotSessionResponseSchema.parse({
    requestId,
    session: await fullSessionFromRecord(actorId, record, designReader)
  });
}

export async function mapSaveTarotResponse(
  actorId: string,
  requestId: string,
  record: TarotSessionRecord,
  designReader?: TarotDesignReader
): Promise<SaveTarotSessionResponse> {
  return SaveTarotSessionResponseSchema.parse({
    requestId,
    session: await fullSessionFromRecord(actorId, record, designReader)
  });
}
