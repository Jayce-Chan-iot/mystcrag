import {
  TarotSpreadTypeSchema,
  TarotThemeSchema,
  type TarotSessionStatus,
  type TarotSpreadType,
  type TarotTheme
} from "@mystcrag/design-contract";
import { revealDraw, type PrivateDrawState } from "@mystcrag/tarot-engine";

import type { Prisma, PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import {
  parseDrawSnapshot,
  parsePrivateDrawState,
  parseRecommendationSnapshot,
  validateDrawSnapshotForWrite,
  validatePrivateDrawStateForWrite,
  validateRecommendationSnapshotForWrite,
  type TarotDrawSnapshot,
  type TarotRecommendationSnapshot
} from "../mappers/tarot-snapshot.mapper.js";
import { toPrismaJson } from "../mappers/snapshot.mapper.js";

export type { TarotDrawSnapshot, TarotRecommendationSnapshot } from "../mappers/tarot-snapshot.mapper.js";

export interface TarotDesignRecommendationRecord {
  id: string;
  designId: string;
  rank: number;
  createdAt: Date;
}

export interface TarotSessionRecord {
  id: string;
  ownerId: string;
  spreadType: TarotSpreadType;
  theme: TarotTheme;
  status: TarotSessionStatus;
  stateRevision: number;
  deckVersion: string;
  ruleVersion: string;
  privateDeckState: PrivateDrawState;
  drawSnapshot: TarotDrawSnapshot;
  recommendationSnapshot: TarotRecommendationSnapshot | null;
  questionCiphertext: string | null;
  questionSavedAt: Date | null;
  selectedDesignId: string | null;
  parentSessionId: string | null;
  recommendations: readonly TarotDesignRecommendationRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTarotSessionRecord {
  ownerId: string;
  spreadType: TarotSpreadType;
  theme: TarotTheme;
  deckVersion: string;
  ruleVersion: string;
  privateDeckState: PrivateDrawState;
  drawSnapshot: TarotDrawSnapshot;
  parentSessionId?: string;
}

export interface UpdateTarotDrawRecord {
  ownerId: string;
  sessionId: string;
  expectedRevision: number;
  operationId?: string;
  status: "DRAWING" | "DRAWN";
  privateDeckState: PrivateDrawState;
  drawSnapshot: TarotDrawSnapshot;
}

export interface SaveTarotRecommendationsRecord {
  ownerId: string;
  sessionId: string;
  expectedRevision: number;
  recommendationSnapshot: TarotRecommendationSnapshot;
  recommendations: readonly { rank: number; designId: string }[];
  questionCiphertext?: string;
  questionSavedAt?: Date;
}

export interface MarkTarotSessionSavedRecord {
  ownerId: string;
  sessionId: string;
  expectedRevision: number;
  selectedDesignId?: string;
}

export interface TarotSessionRepository {
  create(input: CreateTarotSessionRecord): Promise<TarotSessionRecord>;
  getOwned(ownerId: string, sessionId: string): Promise<TarotSessionRecord>;
  updateDraw(input: UpdateTarotDrawRecord): Promise<TarotSessionRecord>;
  saveRecommendations(input: SaveTarotRecommendationsRecord): Promise<TarotSessionRecord>;
  markSaved(input: MarkTarotSessionSavedRecord): Promise<TarotSessionRecord>;
}

type TarotSessionRow = {
  id: string;
  ownerId: string;
  spreadType: TarotSpreadType;
  theme: string;
  status: TarotSessionStatus;
  stateRevision: number;
  deckVersion: string;
  ruleVersion: string;
  privateDeckState: unknown;
  drawSnapshot: unknown;
  recommendationSnapshot: unknown | null;
  questionCiphertext: string | null;
  questionSavedAt: Date | null;
  selectedDesignId: string | null;
  parentSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  recommendations: Array<{
    id: string;
    designId: string;
    rank: number;
    createdAt: Date;
    design: { ownerId: string };
  }>;
  parentSession: { ownerId: string } | null;
};

const recommendationInclude = {
  recommendations: {
    orderBy: { rank: "asc" as const },
    include: { design: { select: { ownerId: true } } }
  },
  parentSession: { select: { ownerId: true } }
};

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const sameQuestionPersistenceIntent = (
  current: Pick<TarotSessionRecord, "questionCiphertext" | "questionSavedAt">,
  requested: { questionCiphertext: string | null; questionSavedAt: Date | null }
): boolean =>
  current.questionCiphertext === requested.questionCiphertext &&
  (current.questionSavedAt === null
    ? requested.questionSavedAt === null
    : requested.questionSavedAt !== null &&
      current.questionSavedAt.getTime() === requested.questionSavedAt.getTime());

const sameRecommendationWrite = (
  current: TarotSessionRecord,
  recommendationSnapshot: TarotRecommendationSnapshot,
  recommendations: readonly { rank: number; designId: string }[],
  question: { questionCiphertext: string | null; questionSavedAt: Date | null }
): boolean =>
  sameValue(current.recommendationSnapshot, recommendationSnapshot) &&
  sameQuestionPersistenceIntent(current, question) &&
  sameValue(
    current.recommendations.map(({ rank, designId }) => ({ rank, designId })),
    recommendations
  );

function assertQuestionPair(
  ciphertext: string | undefined,
  savedAt: Date | undefined
): { questionCiphertext: string | null; questionSavedAt: Date | null } {
  if ((ciphertext === undefined) !== (savedAt === undefined)) {
    throw new PersistenceError(
      "VALIDATION_ERROR",
      "Question ciphertext and saved timestamp must be provided together"
    );
  }
  if (ciphertext !== undefined && ciphertext.trim().length === 0) {
    throw new PersistenceError("VALIDATION_ERROR", "Question ciphertext cannot be empty");
  }
  if (savedAt !== undefined && Number.isNaN(savedAt.getTime())) {
    throw new PersistenceError("VALIDATION_ERROR", "Question saved timestamp is invalid");
  }
  return {
    questionCiphertext: ciphertext ?? null,
    questionSavedAt: savedAt ?? null
  };
}

function assertSnapshotMatchesPrivateState(
  privateState: PrivateDrawState,
  snapshot: TarotDrawSnapshot,
  errorCode: "VALIDATION_ERROR" | "DATA_INTEGRITY_ERROR"
): void {
  if (
    !sameValue(privateState.selections, snapshot.acceptedSelections) ||
    privateState.revealed !== (snapshot.revealedCards !== undefined)
  ) {
    throw new PersistenceError(errorCode, "Tarot private state and draw snapshot differ");
  }
  if (snapshot.revealedCards !== undefined) {
    let authoritativeCards;
    try {
      authoritativeCards = revealDraw(privateState, privateState.revision).cards;
    } catch (error) {
      throw new PersistenceError(
        errorCode,
        "Tarot private deck cannot reproduce the persisted reveal",
        error
      );
    }
    const authoritativeSnapshot = authoritativeCards.map((card) => ({
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
    }));
    if (!sameValue(snapshot.revealedCards, authoritativeSnapshot)) {
      throw new PersistenceError(
        errorCode,
        "Tarot reveal does not match the authoritative private deck"
      );
    }
  }
}

function assertRecommendationLinks(
  recommendations: readonly { rank: number; designId: string }[],
  errorCode: "VALIDATION_ERROR" | "DATA_INTEGRITY_ERROR"
): void {
  const ranks = recommendations.map(({ rank }) => rank).sort((left, right) => left - right);
  const designIds = recommendations.map(({ designId }) => designId);
  if (
    recommendations.length !== 3 ||
    ranks[0] !== 1 ||
    ranks[1] !== 2 ||
    ranks[2] !== 3 ||
    new Set(designIds).size !== 3 ||
    designIds.some((designId) => designId.trim().length === 0)
  ) {
    throw new PersistenceError(
      errorCode,
      "Tarot recommendations require distinct designs at ranks 1, 2, and 3"
    );
  }
}

function mapTarotSession(row: TarotSessionRow): TarotSessionRecord {
  const spreadType = TarotSpreadTypeSchema.safeParse(row.spreadType);
  const theme = TarotThemeSchema.safeParse(row.theme);
  if (!spreadType.success || !theme.success) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot session metadata is invalid");
  }
  if (!Number.isSafeInteger(row.stateRevision) || row.stateRevision < 1) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot state revision is invalid");
  }
  if (row.deckVersion.trim().length === 0 || row.ruleVersion.trim().length === 0) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot version metadata is invalid");
  }
  const privateDeckState = parsePrivateDrawState(row.privateDeckState);
  const drawSnapshot = parseDrawSnapshot(row.drawSnapshot);
  const recommendationSnapshot =
    row.recommendationSnapshot === null
      ? null
      : parseRecommendationSnapshot(row.recommendationSnapshot);

  assertSnapshotMatchesPrivateState(privateDeckState, drawSnapshot, "DATA_INTEGRITY_ERROR");
  if (privateDeckState.spreadType !== spreadType.data) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot spread metadata differs from private state");
  }
  if ((row.questionCiphertext === null) !== (row.questionSavedAt === null)) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Saved question metadata is incomplete");
  }
  if (row.questionCiphertext !== null && row.questionCiphertext.trim().length === 0) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Saved question ciphertext is invalid");
  }
  if (row.parentSessionId === row.id) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot session cannot parent itself");
  }
  if (row.parentSession !== null && row.parentSession.ownerId !== row.ownerId) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot redraw parent has another owner");
  }

  const hasRecommendations = recommendationSnapshot !== null;
  if (hasRecommendations) {
    assertRecommendationLinks(row.recommendations, "DATA_INTEGRITY_ERROR");
    if (row.recommendations.some(({ design }) => design.ownerId !== row.ownerId)) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot recommendation has another owner");
    }
  } else if (row.recommendations.length !== 0) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot recommendation links lack a snapshot");
  }
  if (
    (row.status === "DRAWING" && privateDeckState.revealed) ||
    (row.status === "DRAWN" && (!privateDeckState.revealed || hasRecommendations)) ||
    ((row.status === "RECOMMENDED" || row.status === "SAVED") &&
      (!privateDeckState.revealed || !hasRecommendations))
  ) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Tarot status and snapshots are inconsistent");
  }
  if (
    row.selectedDesignId !== null &&
    !row.recommendations.some(({ designId }) => designId === row.selectedDesignId)
  ) {
    throw new PersistenceError(
      "DATA_INTEGRITY_ERROR",
      "Selected Tarot design is not a session recommendation"
    );
  }
  if (row.selectedDesignId !== null && row.status !== "SAVED") {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Only saved Tarot sessions select a design");
  }

  return {
    id: row.id,
    ownerId: row.ownerId,
    spreadType: spreadType.data,
    theme: theme.data,
    status: row.status,
    stateRevision: row.stateRevision,
    deckVersion: row.deckVersion,
    ruleVersion: row.ruleVersion,
    privateDeckState,
    drawSnapshot,
    recommendationSnapshot,
    questionCiphertext: row.questionCiphertext,
    questionSavedAt: row.questionSavedAt,
    selectedDesignId: row.selectedDesignId,
    parentSessionId: row.parentSessionId,
    recommendations: row.recommendations.map(({ design: _design, ...recommendation }) => recommendation),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function validateDrawWrite(
  input: UpdateTarotDrawRecord
): { privateDeckState: PrivateDrawState; drawSnapshot: TarotDrawSnapshot } {
  const privateDeckState = validatePrivateDrawStateForWrite(input.privateDeckState);
  const drawSnapshot = validateDrawSnapshotForWrite(input.drawSnapshot);
  assertSnapshotMatchesPrivateState(privateDeckState, drawSnapshot, "VALIDATION_ERROR");
  if (
    (input.status === "DRAWING" && privateDeckState.revealed) ||
    (input.status === "DRAWN" && !privateDeckState.revealed)
  ) {
    throw new PersistenceError("VALIDATION_ERROR", "Draw status and private state differ");
  }
  return { privateDeckState, drawSnapshot };
}

async function getOwnedRow(
  client: PrismaClient | Prisma.TransactionClient,
  ownerId: string,
  sessionId: string
): Promise<TarotSessionRow> {
  const row = await client.tarotSession.findFirst({
    where: { id: sessionId, ownerId },
    include: recommendationInclude
  });
  if (!row) throw new PersistenceError("NOT_FOUND", "Tarot session not found");
  return row as TarotSessionRow;
}

function drawTransitionIsValid(
  current: TarotSessionRecord,
  next: PrivateDrawState,
  operationId: string | undefined
): boolean {
  if (operationId !== undefined) {
    const nextSelection = next.selections.find((selection) => selection.operationId === operationId);
    return Boolean(
      nextSelection &&
        current.status === "DRAWING" &&
        !current.privateDeckState.revealed &&
        !next.revealed &&
        next.revision === current.privateDeckState.revision + 1 &&
        next.selections.length === current.privateDeckState.selections.length + 1 &&
        sameValue(
          next.selections.slice(0, -1),
          current.privateDeckState.selections
        ) &&
        next.selections.at(-1)?.operationId === operationId
    );
  }
  return Boolean(
    current.status === "DRAWING" &&
      !current.privateDeckState.revealed &&
      next.revealed &&
      next.revision === current.privateDeckState.revision + 1 &&
      sameValue(next.selections, current.privateDeckState.selections)
  );
}

function operationMatchesAcceptedSelection(
  current: TarotSessionRecord,
  next: PrivateDrawState,
  operationId: string
): boolean {
  const existing = current.privateDeckState.selections.find(
    (selection) => selection.operationId === operationId
  );
  if (existing === undefined) return false;

  const retrySelection = next.selections.find(
    (selection) => selection.operationId === operationId
  );
  if (
    retrySelection?.slot !== existing.slot ||
    retrySelection.displayedPosition !== existing.displayedPosition
  ) {
    throw new PersistenceError("CONFLICT", "Tarot operation ID was reused with different input");
  }
  return true;
}

function allowsExactNoOp(
  expectedRevision: number,
  currentRevision: number,
  operationWasImmediatelyPreceding: boolean
): boolean {
  return (
    expectedRevision === currentRevision ||
    (operationWasImmediatelyPreceding && expectedRevision === currentRevision - 1)
  );
}

export class TarotSessionRepositoryImpl implements TarotSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateTarotSessionRecord): Promise<TarotSessionRecord> {
    const spreadType = TarotSpreadTypeSchema.safeParse(input.spreadType);
    const theme = TarotThemeSchema.safeParse(input.theme);
    if (!spreadType.success || !theme.success) {
      throw new PersistenceError("VALIDATION_ERROR", "Tarot session metadata is invalid");
    }
    if (input.deckVersion.trim().length === 0 || input.ruleVersion.trim().length === 0) {
      throw new PersistenceError("VALIDATION_ERROR", "Tarot versions cannot be empty");
    }
    const privateDeckState = validatePrivateDrawStateForWrite(input.privateDeckState);
    const drawSnapshot = validateDrawSnapshotForWrite(input.drawSnapshot);
    assertSnapshotMatchesPrivateState(privateDeckState, drawSnapshot, "VALIDATION_ERROR");
    if (
      privateDeckState.spreadType !== spreadType.data ||
      privateDeckState.revision !== 0 ||
      privateDeckState.revealed ||
      privateDeckState.selections.length !== 0
    ) {
      throw new PersistenceError("VALIDATION_ERROR", "New Tarot sessions require a fresh private draw state");
    }
    return this.prisma.$transaction(async (tx) => {
      if (input.parentSessionId !== undefined) {
        const parentCount = await tx.tarotSession.count({
          where: { id: input.parentSessionId, ownerId: input.ownerId }
        });
        if (parentCount !== 1) {
          throw new PersistenceError("NOT_FOUND", "Tarot parent session not found");
        }
      }
      const row = await tx.tarotSession.create({
        data: {
          ownerId: input.ownerId,
          spreadType: spreadType.data,
          theme: theme.data,
          deckVersion: input.deckVersion,
          ruleVersion: input.ruleVersion,
          privateDeckState: toPrismaJson(privateDeckState),
          drawSnapshot: toPrismaJson(drawSnapshot),
          parentSessionId: input.parentSessionId
        },
        include: recommendationInclude
      });
      return mapTarotSession(row as TarotSessionRow);
    }).catch(rethrowPersistenceError);
  }

  async getOwned(ownerId: string, sessionId: string): Promise<TarotSessionRecord> {
    const row = await getOwnedRow(this.prisma, ownerId, sessionId).catch(rethrowPersistenceError);
    return mapTarotSession(row);
  }

  async updateDraw(input: UpdateTarotDrawRecord): Promise<TarotSessionRecord> {
    const next = validateDrawWrite(input);
    return this.prisma.$transaction(async (tx) => {
      const current = mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
      if (input.operationId !== undefined) {
        if (operationMatchesAcceptedSelection(current, next.privateDeckState, input.operationId)) {
          return current;
        }
      } else if (
        current.status === input.status &&
        sameValue(current.privateDeckState, next.privateDeckState) &&
        sameValue(current.drawSnapshot, next.drawSnapshot)
      ) {
        if (!allowsExactNoOp(input.expectedRevision, current.stateRevision, current.status === "DRAWN")) {
          throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
        }
        return current;
      }

      if (current.stateRevision !== input.expectedRevision) {
        throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
      }
      if (!drawTransitionIsValid(current, next.privateDeckState, input.operationId)) {
        throw new PersistenceError("VALIDATION_ERROR", "Invalid Tarot draw state transition");
      }
      const update = await tx.tarotSession.updateMany({
        where: {
          id: input.sessionId,
          ownerId: input.ownerId,
          stateRevision: input.expectedRevision
        },
        data: {
          status: input.status,
          stateRevision: input.expectedRevision + 1,
          privateDeckState: toPrismaJson(next.privateDeckState),
          drawSnapshot: toPrismaJson(next.drawSnapshot)
        }
      });
      if (update.count !== 1) {
        const latest = mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
        if (
          input.operationId !== undefined &&
          operationMatchesAcceptedSelection(latest, next.privateDeckState, input.operationId)
        ) {
          return latest;
        }
        throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
      }
      return mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
    }).catch(rethrowPersistenceError);
  }

  async saveRecommendations(input: SaveTarotRecommendationsRecord): Promise<TarotSessionRecord> {
    const recommendationSnapshot = validateRecommendationSnapshotForWrite(
      input.recommendationSnapshot
    );
    assertRecommendationLinks(input.recommendations, "VALIDATION_ERROR");
    const question = assertQuestionPair(input.questionCiphertext, input.questionSavedAt);
    const normalizedRecommendations = [...input.recommendations].sort(
      (left, right) => left.rank - right.rank
    );

    return this.prisma.$transaction(async (tx) => {
      const current = mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
      if (current.status === "RECOMMENDED" || current.status === "SAVED") {
        if (sameRecommendationWrite(
          current,
          recommendationSnapshot,
          normalizedRecommendations,
          question
        )) {
          if (
            !allowsExactNoOp(
              input.expectedRevision,
              current.stateRevision,
              current.status === "RECOMMENDED"
            )
          ) {
            throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
          }
          return current;
        }
        throw new PersistenceError("CONFLICT", "Tarot recommendations already exist");
      }
      if (current.status !== "DRAWN") {
        throw new PersistenceError("CONFLICT", "Tarot session is not ready for recommendations");
      }
      if (current.stateRevision !== input.expectedRevision) {
        throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
      }
      const ownedDesignCount = await tx.design.count({
        where: {
          id: { in: normalizedRecommendations.map(({ designId }) => designId) },
          ownerId: input.ownerId,
          deletedAt: null
        }
      });
      if (ownedDesignCount !== 3) {
        throw new PersistenceError("NOT_FOUND", "Tarot recommendation design not found");
      }
      const update = await tx.tarotSession.updateMany({
        where: {
          id: input.sessionId,
          ownerId: input.ownerId,
          stateRevision: input.expectedRevision
        },
        data: {
          status: "RECOMMENDED",
          stateRevision: input.expectedRevision + 1,
          recommendationSnapshot: toPrismaJson(recommendationSnapshot),
          ...question
        }
      });
      if (update.count !== 1) {
        const latest = mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
        if (
          latest.status === "RECOMMENDED" &&
          allowsExactNoOp(input.expectedRevision, latest.stateRevision, true) &&
          sameRecommendationWrite(
            latest,
            recommendationSnapshot,
            normalizedRecommendations,
            question
          )
        ) {
          return latest;
        }
        throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
      }
      await tx.tarotDesignRecommendation.createMany({
        data: normalizedRecommendations.map(({ rank, designId }) => ({
          sessionId: input.sessionId,
          designId,
          rank
        }))
      });
      return mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
    }).catch(rethrowPersistenceError);
  }

  async markSaved(input: MarkTarotSessionSavedRecord): Promise<TarotSessionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const current = mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
      const selectedDesignId = input.selectedDesignId ?? null;
      if (current.status === "SAVED") {
        if (current.selectedDesignId === selectedDesignId) {
          if (!allowsExactNoOp(input.expectedRevision, current.stateRevision, true)) {
            throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
          }
          return current;
        }
        throw new PersistenceError("CONFLICT", "Tarot session was saved with another design");
      }
      if (current.status !== "RECOMMENDED") {
        throw new PersistenceError("CONFLICT", "Tarot session is not ready to save");
      }
      if (current.stateRevision !== input.expectedRevision) {
        throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
      }
      if (
        selectedDesignId !== null &&
        !current.recommendations.some(({ designId }) => designId === selectedDesignId)
      ) {
        throw new PersistenceError(
          "VALIDATION_ERROR",
          "Selected design must be a recommendation for this Tarot session"
        );
      }
      const update = await tx.tarotSession.updateMany({
        where: {
          id: input.sessionId,
          ownerId: input.ownerId,
          stateRevision: input.expectedRevision
        },
        data: {
          status: "SAVED",
          stateRevision: input.expectedRevision + 1,
          selectedDesignId
        }
      });
      if (update.count !== 1) {
        throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
      }
      return mapTarotSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
    }).catch(rethrowPersistenceError);
  }
}
