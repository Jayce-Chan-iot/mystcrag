import {
  CurrencySchema,
  LocaleSchema,
  OracleSessionStatusSchema,
  type Currency,
  type Locale,
  type OracleCastDto,
  type OracleDesignSignal,
  type OracleInterpretation,
  type OracleSessionStatus
} from "@mystcrag/design-contract";

import type { Prisma, PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import {
  parseOracleCastSnapshot,
  parseOracleInterpretationSnapshot,
  parseOracleSignalSnapshot,
  validateOracleCastSnapshotForWrite,
  validateOracleInterpretationSnapshotForWrite,
  validateOracleSignalSnapshotForWrite
} from "../mappers/oracle-snapshot.mapper.js";
import { toPrismaJson } from "../mappers/snapshot.mapper.js";

export interface OracleDesignRecommendationRecord {
  id: string;
  designId: string;
  rank: number;
  createdAt: Date;
}

export interface OracleSessionRecord {
  id: string;
  ownerId: string;
  operationId: string;
  status: OracleSessionStatus;
  stateRevision: number;
  locale: Locale;
  currency: Currency;
  wristCircumferenceMm: number | null;
  cast: OracleCastDto;
  signal: OracleDesignSignal;
  interpretation: OracleInterpretation;
  algorithmVersion: string;
  ruleVersion: string;
  recommendationOperationId: string | null;
  saveOperationId: string | null;
  selectedDesignId: string | null;
  parentSessionId: string | null;
  recommendations: readonly OracleDesignRecommendationRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrGetOracleSessionRecord {
  ownerId: string;
  operationId: string;
  locale: Locale;
  currency: Currency;
  wristCircumferenceMm?: number;
  cast: OracleCastDto;
  signal: OracleDesignSignal;
  interpretation: OracleInterpretation;
  parentSessionId?: string;
}

export interface SaveOracleRecommendationsRecord {
  ownerId: string;
  sessionId: string;
  operationId: string;
  expectedRevision: number;
  recommendations: readonly { rank: number; designId: string }[];
}

export interface MarkOracleSessionSavedRecord {
  ownerId: string;
  sessionId: string;
  operationId: string;
  expectedRevision: number;
  selectedDesignId: string;
}

export interface OracleSessionRepository {
  createOrGet(input: CreateOrGetOracleSessionRecord): Promise<OracleSessionRecord>;
  getOwned(ownerId: string, sessionId: string): Promise<OracleSessionRecord>;
  saveRecommendations(input: SaveOracleRecommendationsRecord): Promise<OracleSessionRecord>;
  markSaved(input: MarkOracleSessionSavedRecord): Promise<OracleSessionRecord>;
}

type OracleSessionRow = {
  id: string;
  ownerId: string;
  operationId: string;
  status: OracleSessionStatus;
  stateRevision: number;
  locale: string;
  currency: Currency;
  wristCircumferenceMm: number | null;
  castSnapshot: unknown;
  signalSnapshot: unknown;
  interpretationSnapshot: unknown;
  algorithmVersion: string;
  ruleVersion: string;
  recommendationOperationId: string | null;
  saveOperationId: string | null;
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

const relationInclude = {
  recommendations: {
    orderBy: { rank: "asc" as const },
    include: { design: { select: { ownerId: true } } }
  },
  parentSession: { select: { ownerId: true } }
};

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

function assertIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new PersistenceError("VALIDATION_ERROR", `${label} cannot be empty`);
  }
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PersistenceError("VALIDATION_ERROR", "Oracle revision must be a positive integer");
  }
}

function assertWrist(value: number | undefined): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 130 || value > 200)) {
    throw new PersistenceError("VALIDATION_ERROR", "Oracle wrist must be an integer from 130 to 200 mm");
  }
}

function normalizeRecommendationLinks(
  recommendations: readonly { rank: number; designId: string }[],
  code: "VALIDATION_ERROR" | "DATA_INTEGRITY_ERROR"
): Array<{ rank: number; designId: string }> {
  const normalized = recommendations
    .map(({ rank, designId }) => ({ rank, designId }))
    .sort((left, right) => left.rank - right.rank);
  const ranks = normalized.map(({ rank }) => rank);
  const designIds = normalized.map(({ designId }) => designId);
  if (
    normalized.length !== 3 ||
    ranks[0] !== 1 ||
    ranks[1] !== 2 ||
    ranks[2] !== 3 ||
    new Set(designIds).size !== 3 ||
    designIds.some((designId) => designId.trim().length === 0)
  ) {
    throw new PersistenceError(
      code,
      "Oracle recommendations require distinct designs at ranks 1, 2, and 3"
    );
  }
  return normalized;
}

function assertSignalMatchesCast(
  cast: OracleCastDto,
  signal: OracleDesignSignal,
  code: "VALIDATION_ERROR" | "DATA_INTEGRITY_ERROR"
): void {
  if (!sameValue(cast.movingLineIndices, signal.accentLinePositions)) {
    throw new PersistenceError(code, "Oracle signal accents differ from cast moving lines");
  }
}

function mapOracleSession(row: OracleSessionRow): OracleSessionRecord {
  const status = OracleSessionStatusSchema.safeParse(row.status);
  const locale = LocaleSchema.safeParse(row.locale);
  const currency = CurrencySchema.safeParse(row.currency);
  if (!status.success || !locale.success || !currency.success) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle session metadata is invalid");
  }
  const expectedRevision = { CAST: 1, RECOMMENDED: 2, SAVED: 3 }[status.data];
  if (row.stateRevision !== expectedRevision) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle status and state revision disagree");
  }
  if (
    row.wristCircumferenceMm !== null &&
    (!Number.isInteger(row.wristCircumferenceMm) ||
      row.wristCircumferenceMm < 130 ||
      row.wristCircumferenceMm > 200)
  ) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle persisted wrist is invalid");
  }
  if (
    [row.id, row.ownerId, row.operationId, row.algorithmVersion, row.ruleVersion].some(
      (value) => value.trim().length === 0
    ) ||
    [row.recommendationOperationId, row.saveOperationId, row.selectedDesignId].some(
      (value) => value !== null && value.trim().length === 0
    )
  ) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle persisted identifiers are invalid");
  }
  if (
    Number.isNaN(row.createdAt.getTime()) ||
    Number.isNaN(row.updatedAt.getTime()) ||
    row.updatedAt.getTime() < row.createdAt.getTime()
  ) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle persisted timestamps are invalid");
  }
  const cast = parseOracleCastSnapshot(row.castSnapshot);
  const signal = parseOracleSignalSnapshot(row.signalSnapshot);
  const interpretation = parseOracleInterpretationSnapshot(row.interpretationSnapshot);
  assertSignalMatchesCast(cast, signal, "DATA_INTEGRITY_ERROR");
  if (row.algorithmVersion !== cast.algorithm.version || row.ruleVersion !== signal.ruleVersion) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle persisted versions disagree with snapshots");
  }
  if (row.parentSessionId === row.id) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle session cannot parent itself");
  }
  if (row.parentSession !== null && row.parentSession.ownerId !== row.ownerId) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle parent session has another owner");
  }
  if (row.recommendations.some(({ design }) => design.ownerId !== row.ownerId)) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle recommendation has another owner");
  }
  const recommendationLinks = row.recommendations.map(({ rank, designId }) => ({ rank, designId }));
  if (row.status === "CAST") {
    if (
      recommendationLinks.length !== 0 ||
      row.recommendationOperationId !== null ||
      row.saveOperationId !== null ||
      row.selectedDesignId !== null
    ) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", "CAST Oracle session contains later lifecycle data");
    }
  } else {
    normalizeRecommendationLinks(recommendationLinks, "DATA_INTEGRITY_ERROR");
    if (row.recommendationOperationId === null) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", "Oracle recommendation operation is missing");
    }
  }
  if (row.status === "RECOMMENDED" && (row.saveOperationId !== null || row.selectedDesignId !== null)) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "RECOMMENDED Oracle session contains save data");
  }
  if (row.status === "SAVED") {
    if (
      row.saveOperationId === null ||
      row.selectedDesignId === null ||
      !recommendationLinks.some(({ designId }) => designId === row.selectedDesignId)
    ) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", "SAVED Oracle session selection is invalid");
    }
  }

  return {
    id: row.id,
    ownerId: row.ownerId,
    operationId: row.operationId,
    status: status.data,
    stateRevision: row.stateRevision,
    locale: locale.data,
    currency: currency.data,
    wristCircumferenceMm: row.wristCircumferenceMm,
    cast,
    signal,
    interpretation,
    algorithmVersion: row.algorithmVersion,
    ruleVersion: row.ruleVersion,
    recommendationOperationId: row.recommendationOperationId,
    saveOperationId: row.saveOperationId,
    selectedDesignId: row.selectedDesignId,
    parentSessionId: row.parentSessionId,
    recommendations: row.recommendations.map(({ design: _design, ...recommendation }) => recommendation),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function getOwnedRow(
  client: PrismaClient | Prisma.TransactionClient,
  ownerId: string,
  sessionId: string
): Promise<OracleSessionRow> {
  const row = await client.oracleSession.findFirst({
    where: { id: sessionId, ownerId },
    include: relationInclude
  });
  if (!row) throw new PersistenceError("NOT_FOUND", "Oracle session not found");
  return row as OracleSessionRow;
}

async function lockOwnedSession(
  client: Prisma.TransactionClient,
  ownerId: string,
  sessionId: string
): Promise<void> {
  const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "oracle_sessions" WHERE "id" = $1 AND "owner_id" = $2 FOR UPDATE',
    sessionId,
    ownerId
  );
  if (rows.length !== 1) {
    throw new PersistenceError("NOT_FOUND", "Oracle session not found");
  }
}

function sameCreateFingerprint(
  current: OracleSessionRecord,
  input: CreateOrGetOracleSessionRecord
): boolean {
  return (
    current.locale === input.locale &&
    current.currency === input.currency &&
    current.wristCircumferenceMm === (input.wristCircumferenceMm ?? null) &&
    current.parentSessionId === (input.parentSessionId ?? null)
  );
}

export class OracleSessionRepositoryImpl implements OracleSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createOrGet(input: CreateOrGetOracleSessionRecord): Promise<OracleSessionRecord> {
    assertIdentifier(input.ownerId, "Oracle owner ID");
    assertIdentifier(input.operationId, "Oracle operation ID");
    const locale = LocaleSchema.safeParse(input.locale);
    const currency = CurrencySchema.safeParse(input.currency);
    assertWrist(input.wristCircumferenceMm);
    if (!locale.success || !currency.success) {
      throw new PersistenceError("VALIDATION_ERROR", "Oracle locale or currency is invalid");
    }
    const cast = validateOracleCastSnapshotForWrite(input.cast);
    const signal = validateOracleSignalSnapshotForWrite(input.signal);
    const interpretation = validateOracleInterpretationSnapshotForWrite(input.interpretation);
    assertSignalMatchesCast(cast, signal, "VALIDATION_ERROR");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.oracleSession.findUnique({
          where: { ownerId_operationId: { ownerId: input.ownerId, operationId: input.operationId } },
          include: relationInclude
        });
        if (existing !== null) {
          const current = mapOracleSession(existing as OracleSessionRow);
          if (!sameCreateFingerprint(current, input)) {
            throw new PersistenceError("CONFLICT", "Oracle operation ID was reused with different durable input");
          }
          return current;
        }
        if (input.parentSessionId !== undefined) {
          const parentCount = await tx.oracleSession.count({
            where: { id: input.parentSessionId, ownerId: input.ownerId }
          });
          if (parentCount !== 1) {
            throw new PersistenceError("NOT_FOUND", "Oracle parent session not found");
          }
        }
        const created = await tx.oracleSession.create({
          data: {
            ownerId: input.ownerId,
            operationId: input.operationId,
            locale: locale.data,
            currency: currency.data,
            wristCircumferenceMm: input.wristCircumferenceMm,
            castSnapshot: toPrismaJson(cast),
            signalSnapshot: toPrismaJson(signal),
            interpretationSnapshot: toPrismaJson(interpretation),
            algorithmVersion: cast.algorithm.version,
            ruleVersion: signal.ruleVersion,
            parentSessionId: input.parentSessionId
          },
          include: relationInclude
        });
        return mapOracleSession(created as OracleSessionRow);
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === "P2002") {
        const winner = await this.prisma.oracleSession.findUnique({
          where: { ownerId_operationId: { ownerId: input.ownerId, operationId: input.operationId } },
          include: relationInclude
        });
        if (winner !== null) {
          const current = mapOracleSession(winner as OracleSessionRow);
          if (sameCreateFingerprint(current, input)) return current;
          throw new PersistenceError("CONFLICT", "Oracle operation ID was reused with different durable input");
        }
      }
      return rethrowPersistenceError(error);
    }
  }

  async getOwned(ownerId: string, sessionId: string): Promise<OracleSessionRecord> {
    const row = await getOwnedRow(this.prisma, ownerId, sessionId).catch(rethrowPersistenceError);
    return mapOracleSession(row);
  }

  async saveRecommendations(input: SaveOracleRecommendationsRecord): Promise<OracleSessionRecord> {
    assertIdentifier(input.operationId, "Oracle recommendation operation ID");
    assertRevision(input.expectedRevision);
    const recommendations = normalizeRecommendationLinks(input.recommendations, "VALIDATION_ERROR");

    return this.prisma.$transaction(async (tx) => {
      await lockOwnedSession(tx, input.ownerId, input.sessionId);
      const current = mapOracleSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
      if (current.status === "RECOMMENDED" || current.status === "SAVED") {
        if (current.recommendationOperationId === input.operationId) {
          if (!sameValue(
            current.recommendations.map(({ rank, designId }) => ({ rank, designId })),
            recommendations
          )) {
            throw new PersistenceError("CONFLICT", "Oracle recommendation operation changed content");
          }
          return current;
        }
        throw new PersistenceError("CONFLICT", "Oracle recommendations already exist");
      }
      if (current.stateRevision !== input.expectedRevision) {
        throw new PersistenceError("CONFLICT", "Oracle session revision conflict");
      }
      const ownedDesignCount = await tx.design.count({
        where: {
          id: { in: recommendations.map(({ designId }) => designId) },
          ownerId: input.ownerId,
          deletedAt: null
        }
      });
      if (ownedDesignCount !== 3) {
        throw new PersistenceError("NOT_FOUND", "Oracle recommendation design not found");
      }
      const updated = await tx.oracleSession.updateMany({
        where: {
          id: input.sessionId,
          ownerId: input.ownerId,
          status: "CAST",
          stateRevision: input.expectedRevision
        },
        data: {
          status: "RECOMMENDED",
          stateRevision: input.expectedRevision + 1,
          recommendationOperationId: input.operationId
        }
      });
      if (updated.count !== 1) {
        const latest = mapOracleSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
        if (
          (latest.status === "RECOMMENDED" || latest.status === "SAVED") &&
          latest.recommendationOperationId === input.operationId &&
          sameValue(
            latest.recommendations.map(({ rank, designId }) => ({ rank, designId })),
            recommendations
          )
        ) {
          return latest;
        }
        throw new PersistenceError("CONFLICT", "Oracle session revision conflict");
      }
      await tx.oracleDesignRecommendation.createMany({
        data: recommendations.map(({ rank, designId }) => ({
          sessionId: input.sessionId,
          designId,
          rank
        }))
      });
      return mapOracleSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
    }).catch(rethrowPersistenceError);
  }

  async markSaved(input: MarkOracleSessionSavedRecord): Promise<OracleSessionRecord> {
    assertIdentifier(input.operationId, "Oracle save operation ID");
    assertIdentifier(input.selectedDesignId, "Oracle selected design ID");
    assertRevision(input.expectedRevision);

    return this.prisma.$transaction(async (tx) => {
      await lockOwnedSession(tx, input.ownerId, input.sessionId);
      const current = mapOracleSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
      if (current.status === "SAVED") {
        if (
          current.saveOperationId === input.operationId &&
          current.selectedDesignId === input.selectedDesignId
        ) {
          return current;
        }
        throw new PersistenceError("CONFLICT", "Oracle save operation changed selection");
      }
      if (current.status !== "RECOMMENDED") {
        throw new PersistenceError("CONFLICT", "Oracle session is not ready to save");
      }
      if (current.stateRevision !== input.expectedRevision) {
        throw new PersistenceError("CONFLICT", "Oracle session revision conflict");
      }
      if (!current.recommendations.some(({ designId }) => designId === input.selectedDesignId)) {
        throw new PersistenceError(
          "VALIDATION_ERROR",
          "Selected design must be an Oracle session recommendation"
        );
      }
      const updated = await tx.oracleSession.updateMany({
        where: {
          id: input.sessionId,
          ownerId: input.ownerId,
          status: "RECOMMENDED",
          stateRevision: input.expectedRevision
        },
        data: {
          status: "SAVED",
          stateRevision: input.expectedRevision + 1,
          saveOperationId: input.operationId,
          selectedDesignId: input.selectedDesignId
        }
      });
      if (updated.count !== 1) {
        const latest = mapOracleSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
        if (
          latest.status === "SAVED" &&
          latest.saveOperationId === input.operationId &&
          latest.selectedDesignId === input.selectedDesignId
        ) {
          return latest;
        }
        throw new PersistenceError("CONFLICT", "Oracle session revision conflict");
      }
      return mapOracleSession(await getOwnedRow(tx, input.ownerId, input.sessionId));
    }).catch(rethrowPersistenceError);
  }
}
