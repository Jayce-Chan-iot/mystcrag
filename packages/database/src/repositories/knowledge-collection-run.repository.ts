import { z } from "zod";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { toPrismaJson } from "../mappers/snapshot.mapper.js";

export type CollectionRunStatus = "RUNNING" | "COMPLETED" | "FAILED";

const CollectionRunErrorSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1)
});

const CollectionRunSourceResultSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(120),
  documentsAdded: z.number().int().min(0),
  duplicateDocuments: z.number().int().min(0),
  candidatesInserted: z.number().int().min(0),
  corroboratedCandidates: z.number().int().min(0),
  duplicateCandidates: z.number().int().min(0)
});

const StartCollectionRunInputSchema = z.strictObject({
  startedAt: z.date()
});

const CompleteCollectionRunInputSchema = z.strictObject({
  finishedAt: z.date(),
  status: z.enum(["COMPLETED", "FAILED"]),
  sourcesCrawled: z.number().int().min(0),
  documentsAdded: z.number().int().min(0),
  documentDuplicates: z.number().int().min(0),
  candidatesInserted: z.number().int().min(0),
  corroboratedCandidates: z.number().int().min(0),
  candidateDuplicates: z.number().int().min(0),
  needsReview: z.number().int().min(0),
  conflicts: z.number().int().min(0),
  errors: z.array(CollectionRunErrorSchema).max(200),
  sourceResults: z.array(CollectionRunSourceResultSchema).max(200)
});

export type CollectionRunError = z.infer<typeof CollectionRunErrorSchema>;
export type CollectionRunSourceResult = z.infer<typeof CollectionRunSourceResultSchema>;
export type StartCollectionRunInput = z.infer<typeof StartCollectionRunInputSchema>;
export type CompleteCollectionRunInput = z.infer<typeof CompleteCollectionRunInputSchema>;

export type PersistedKnowledgeCollectionRun = {
  id: string;
  status: CollectionRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  sourcesCrawled: number;
  documentsAdded: number;
  documentDuplicates: number;
  candidatesInserted: number;
  corroboratedCandidates: number;
  candidateDuplicates: number;
  needsReview: number;
  conflicts: number;
  errors: CollectionRunError[];
  sourceResults: CollectionRunSourceResult[];
};

type RunRow = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  sourcesCrawled: number;
  documentsAdded: number;
  documentDuplicates: number;
  candidatesInserted: number;
  corroboratedCandidates: number;
  candidateDuplicates: number;
  needsReview: number;
  conflicts: number;
  errors: unknown;
  sourceResults: unknown;
};

const MAX_STORED_ERRORS = 50;
const MAX_ERROR_MESSAGE_LENGTH = 280;

/**
 * Error messages come from arbitrary caught exceptions (HTTP bodies, stack
 * traces), so their length is not something the caller can control — normalize
 * instead of rejecting: keep the head of the message and the first errors.
 */
function normalizeErrors(
  errors: readonly CollectionRunError[]
): CollectionRunError[] {
  return errors.slice(0, MAX_STORED_ERRORS).map((error) => ({
    sourceId: error.sourceId,
    message:
      error.message.length <= MAX_ERROR_MESSAGE_LENGTH
        ? error.message
        : `${error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`
  }));
}

function parseRun(row: RunRow): PersistedKnowledgeCollectionRun {
  return {
    id: row.id,
    status: row.status as CollectionRunStatus,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    sourcesCrawled: row.sourcesCrawled,
    documentsAdded: row.documentsAdded,
    documentDuplicates: row.documentDuplicates,
    candidatesInserted: row.candidatesInserted,
    corroboratedCandidates: row.corroboratedCandidates,
    candidateDuplicates: row.candidateDuplicates,
    needsReview: row.needsReview,
    conflicts: row.conflicts,
    errors: Array.isArray(row.errors) ? (row.errors as CollectionRunError[]) : [],
    sourceResults: Array.isArray(row.sourceResults)
      ? (row.sourceResults as CollectionRunSourceResult[])
      : []
  };
}

/**
 * Knowledge Console V1 CollectionRun persistence (task book Track B): every
 * `knowledge:collect` execution leaves exactly one row — RUNNING while the
 * crawl runs, then COMPLETED/FAILED with the run's counters. Console reads are
 * `listRuns` (newest first); there is no update path beyond completion.
 */
export class KnowledgeCollectionRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async startRun(input: StartCollectionRunInput): Promise<PersistedKnowledgeCollectionRun> {
    const parsed = StartCollectionRunInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new PersistenceError("VALIDATION_ERROR", "Collection run start is invalid", parsed.error);
    }
    const row = await this.prisma.knowledgeCollectionRun
      .create({ data: { startedAt: parsed.data.startedAt } })
      .catch(rethrowPersistenceError);
    return parseRun(row);
  }

  async completeRun(
    id: string,
    input: CompleteCollectionRunInput
  ): Promise<PersistedKnowledgeCollectionRun> {
    const parsed = CompleteCollectionRunInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new PersistenceError(
        "VALIDATION_ERROR",
        "Collection run completion is invalid",
        parsed.error
      );
    }
    const { finishedAt, status, errors, sourceResults, ...counters } = parsed.data;
    const row = await this.prisma.knowledgeCollectionRun
      .update({
        where: { id },
        data: {
          finishedAt,
          status,
          ...counters,
          // A pathological crawl (every page failing) must not bloat the row:
          // keep the first errors, they identify the failure pattern.
          errors: toPrismaJson(normalizeErrors(errors)),
          sourceResults: toPrismaJson(sourceResults)
        }
      })
      .catch(rethrowPersistenceError);
    return parseRun(row);
  }

  async listRuns(filter?: { limit?: number }): Promise<PersistedKnowledgeCollectionRun[]> {
    const limit = Math.min(Math.max(filter?.limit ?? 20, 1), 100);
    const rows = await this.prisma.knowledgeCollectionRun
      .findMany({ orderBy: { startedAt: "desc" }, take: limit })
      .catch(rethrowPersistenceError);
    return rows.map(parseRun);
  }
}
