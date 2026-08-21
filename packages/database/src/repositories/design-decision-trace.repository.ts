import {
  DesignDecisionTraceSchema,
  type DesignDecisionTrace
} from "@mystcrag/design-contract";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { toPrismaJson } from "../mappers/snapshot.mapper.js";

function validateTrace(input: unknown): DesignDecisionTrace {
  const parsed = DesignDecisionTraceSchema.safeParse(input);
  if (!parsed.success) {
    throw new PersistenceError("VALIDATION_ERROR", "Design decision trace is invalid", parsed.error);
  }
  return parsed.data;
}

/**
 * Sidecar persistence for decision traces (spec section 7.1 / ADR-1): one
 * immutable row per (designId, revisionNumber). Rows are append-only — the
 * database trigger rejects updates and deletes.
 */
export class DesignDecisionTraceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createTrace(
    designId: string,
    revisionNumber: number,
    input: unknown
  ): Promise<DesignDecisionTrace> {
    const trace = validateTrace(input);
    if (trace.designId !== designId || trace.revision !== revisionNumber) {
      throw new PersistenceError(
        "VALIDATION_ERROR",
        "Trace designId/revision must match the persisted design"
      );
    }
    const row = await this.prisma.designDecisionTrace
      .create({
        data: {
          designId,
          revisionNumber,
          trace: toPrismaJson(trace)
        }
      })
      .catch(rethrowPersistenceError);
    return validateTrace(row.trace);
  }

  async getTrace(designId: string, revisionNumber: number): Promise<DesignDecisionTrace | null> {
    const row = await this.prisma.designDecisionTrace
      .findUnique({
        where: { designId_revisionNumber: { designId, revisionNumber } }
      })
      .catch(rethrowPersistenceError);
    if (row === null) return null;
    return validateTrace(row.trace);
  }

  async getLatestTrace(designId: string): Promise<DesignDecisionTrace | null> {
    const row = await this.prisma.designDecisionTrace
      .findFirst({
        where: { designId },
        orderBy: { revisionNumber: "desc" }
      })
      .catch(rethrowPersistenceError);
    if (row === null) return null;
    return validateTrace(row.trace);
  }
}
