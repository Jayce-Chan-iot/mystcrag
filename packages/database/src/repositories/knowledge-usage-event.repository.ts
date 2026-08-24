import { z } from "zod";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { toPrismaJson } from "../mappers/snapshot.mapper.js";

const RecordKnowledgeUsageEventInputSchema = z.strictObject({
  eventType: z.string().trim().min(1).max(64),
  actorId: z.string().trim().min(1).nullable().optional(),
  designId: z.string().trim().min(1).nullable().optional(),
  revisionNumber: z.number().int().positive().nullable().optional(),
  knowledgeVersion: z.string().trim().min(1).nullable().optional(),
  productCatalogVersion: z.string().trim().min(1).nullable().optional(),
  payload: z.record(z.string(), z.unknown())
});

export type RecordKnowledgeUsageEventInput = z.infer<typeof RecordKnowledgeUsageEventInputSchema>;

export type PersistedKnowledgeUsageEvent = {
  id: string;
  eventType: string;
  actorId: string | null;
  designId: string | null;
  revisionNumber: number | null;
  knowledgeVersion: string | null;
  productCatalogVersion: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type ListKnowledgeUsageEventsFilter = {
  eventType?: string;
  actorId?: string;
  designId?: string;
  limit?: number;
};

function validateInputs(inputs: readonly RecordKnowledgeUsageEventInput[]): void {
  if (inputs.length === 0) {
    throw new PersistenceError(
      "VALIDATION_ERROR",
      "At least one knowledge usage event is required"
    );
  }
  if (inputs.length > 500) {
    throw new PersistenceError(
      "VALIDATION_ERROR",
      "A knowledge usage event batch must not exceed 500 events"
    );
  }
  for (const input of inputs) {
    const parsed = RecordKnowledgeUsageEventInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new PersistenceError(
        "VALIDATION_ERROR",
        "Knowledge usage event is invalid",
        parsed.error
      );
    }
  }
}

function toPersistedEvent(row: {
  id: string;
  eventType: string;
  actorId: string | null;
  designId: string | null;
  revisionNumber: number | null;
  knowledgeVersion: string | null;
  productCatalogVersion: string | null;
  payload: unknown;
  createdAt: Date;
}): PersistedKnowledgeUsageEvent {
  return {
    id: row.id,
    eventType: row.eventType,
    actorId: row.actorId,
    designId: row.designId,
    revisionNumber: row.revisionNumber,
    knowledgeVersion: row.knowledgeVersion,
    productCatalogVersion: row.productCatalogVersion,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt
  };
}

/**
 * Append-only observability store for knowledge usage (spec section 11, EPIC
 * 12: collect-only). Rows are immutable — the database trigger rejects updates
 * and deletes, mirroring design_decision_traces.
 */
export class KnowledgeUsageEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordEvents(
    inputs: readonly RecordKnowledgeUsageEventInput[]
  ): Promise<number> {
    validateInputs(inputs);
    const result = await this.prisma.knowledgeUsageEvent
      .createMany({
        data: inputs.map((input) => ({
          eventType: input.eventType,
          actorId: input.actorId ?? null,
          designId: input.designId ?? null,
          revisionNumber: input.revisionNumber ?? null,
          knowledgeVersion: input.knowledgeVersion ?? null,
          productCatalogVersion: input.productCatalogVersion ?? null,
          payload: toPrismaJson(input.payload)
        }))
      })
      .catch(rethrowPersistenceError);
    return result.count;
  }

  async listEvents(
    filter: ListKnowledgeUsageEventsFilter = {}
  ): Promise<PersistedKnowledgeUsageEvent[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    const rows = await this.prisma.knowledgeUsageEvent
      .findMany({
        where: {
          ...(filter.eventType === undefined ? {} : { eventType: filter.eventType }),
          ...(filter.actorId === undefined ? {} : { actorId: filter.actorId }),
          ...(filter.designId === undefined ? {} : { designId: filter.designId })
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit
      })
      .catch(rethrowPersistenceError);
    return rows.map(toPersistedEvent);
  }
}
