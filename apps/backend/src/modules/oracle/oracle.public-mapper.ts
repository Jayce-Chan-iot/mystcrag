import {
  CreateOracleSessionResponseSchema,
  GenerateOracleRecommendationsResponseSchema,
  GetOracleSessionResponseSchema,
  SaveOracleSessionResponseSchema,
  toPublicDesign,
  type CreateOracleSessionResponse,
  type GenerateOracleRecommendationsResponse,
  type GetOracleSessionResponse,
  type OraclePublicSession,
  type SaveOracleSessionResponse
} from "@mystcrag/design-contract";
import type { OracleSessionRecord } from "@mystcrag/database";

import { DomainApiError } from "../../contracts/api-error.js";
import type { OracleDesignReader } from "./oracle.types.js";

const DIRECTIONS = ["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const;

async function sessionFromRecord(
  actorId: string,
  record: OracleSessionRecord,
  designReader?: OracleDesignReader
): Promise<OraclePublicSession> {
  const recommendations = record.recommendations.length === 0
    ? undefined
    : await Promise.all(
        [...record.recommendations]
          .sort((left, right) => left.rank - right.rank)
          .map(async ({ rank, designId }) => {
            if (!designReader) {
              throw new DomainApiError("INTERNAL_ERROR", "Oracle recommendation designs are unavailable.");
            }
            return {
              rank,
              direction: DIRECTIONS[rank - 1]!,
              design: toPublicDesign(await designReader.getOwnedDesign(actorId, designId))
            };
          })
      );
  return {
    sessionId: record.id,
    status: record.status,
    revision: record.stateRevision,
    locale: record.locale,
    currency: record.currency,
    ...(record.wristCircumferenceMm === null ? {} : { wristCircumferenceMm: record.wristCircumferenceMm }),
    ...(record.parentSessionId === null ? {} : { parentSessionId: record.parentSessionId }),
    cast: record.cast,
    signal: record.signal,
    interpretation: record.interpretation,
    ...(recommendations === undefined ? {} : { recommendations }),
    ...(record.selectedDesignId === null ? {} : { selectedDesignId: record.selectedDesignId }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export async function mapCreateOracleResponse(
  actorId: string,
  requestId: string,
  record: OracleSessionRecord,
  designReader?: OracleDesignReader
): Promise<CreateOracleSessionResponse> {
  return CreateOracleSessionResponseSchema.parse({
    requestId,
    session: await sessionFromRecord(actorId, record, designReader)
  });
}

export async function mapGetOracleResponse(
  actorId: string,
  requestId: string,
  record: OracleSessionRecord,
  designReader?: OracleDesignReader
): Promise<GetOracleSessionResponse> {
  return GetOracleSessionResponseSchema.parse({
    requestId,
    session: await sessionFromRecord(actorId, record, designReader)
  });
}

export async function mapRecommendationsOracleResponse(
  actorId: string,
  requestId: string,
  record: OracleSessionRecord,
  designReader?: OracleDesignReader
): Promise<GenerateOracleRecommendationsResponse> {
  return GenerateOracleRecommendationsResponseSchema.parse({
    requestId,
    session: await sessionFromRecord(actorId, record, designReader)
  });
}

export async function mapSaveOracleResponse(
  actorId: string,
  requestId: string,
  record: OracleSessionRecord,
  designReader?: OracleDesignReader
): Promise<SaveOracleSessionResponse> {
  return SaveOracleSessionResponseSchema.parse({
    requestId,
    session: await sessionFromRecord(actorId, record, designReader)
  });
}

export { sessionFromRecord };
