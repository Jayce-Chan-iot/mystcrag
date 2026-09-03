import {
  ArchiveStore,
  ArchiveStoreError,
  type ArchivePutResult,
  computeColorHistogram,
  computeDHash,
  detectAssetSourceKind,
  ImageProcessorError,
  processBeadImage,
  runQualityChecks,
  sha256OfBytes,
  suggestGroups,
  type GroupingCandidate,
  type GroupSimilarityEvidence,
  type GroupSuggestion
} from "@mystcrag/asset-pipeline";
import type {
  AssetJobFailure,
  ClaimedAssetJob,
  CompleteAssetJobResult
} from "@mystcrag/database";
import { PersistenceError } from "@mystcrag/database";
import { AssetSourceFileKindSchema, Sha256Schema } from "@mystcrag/design-contract";
import { z } from "zod";

export const STORAGE_PROVIDER = "local-fs";

const IDENTIFIER = z.string().trim().min(1).max(160);
const ARCHIVE_KEY = z.string().trim().min(1).max(512);

// ---------------------------------------------------------------------------
// Errors and classification
// ---------------------------------------------------------------------------

export class JobExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JobExecutionError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type ClassifiedJobError = AssetJobFailure & { retryable: boolean };

/**
 * Handler failures split into deterministic bugs (bad payload, undecodable
 * content, contract violations — retrying cannot change the outcome) and
 * transient conditions (storage hiccups, unknown errors, database trouble).
 * PersistenceError keeps its own code: CONFLICT/VALIDATION_ERROR are definite
 * outcomes, everything else may be infrastructure and stays retryable.
 */
export function classifyHandlerError(error: unknown): ClassifiedJobError {
  if (error instanceof JobExecutionError) {
    return { code: clamp(error.code, 120), message: clamp(error.message, 4000), retryable: error.retryable };
  }
  if (error instanceof PersistenceError) {
    const deterministic = error.code === "CONFLICT" || error.code === "VALIDATION_ERROR";
    return { code: clamp(error.code, 120), message: clamp(error.message, 4000), retryable: !deterministic };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "UNEXPECTED_HANDLER_ERROR", message: clamp(message, 4000), retryable: true };
}

function clamp(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrapArchiveError(error: unknown, fallbackCode: string): JobExecutionError {
  if (error instanceof JobExecutionError) return error;
  if (error instanceof ArchiveStoreError) {
    const transient = error.code === "WRITE_FAILED" || error.code === "READ_FAILED";
    return new JobExecutionError(error.code, error.message, transient, { cause: error });
  }
  return new JobExecutionError(fallbackCode, messageOf(error), true, { cause: error });
}

// ---------------------------------------------------------------------------
// Internal job payload contracts
// ---------------------------------------------------------------------------
// ClaimedAssetJob.payload is unknown: every handler validates it through these
// strict schemas before use. The payloads are internal processing inputs
// assembled by the import backend (TASK-ASSET-BE-001), deliberately separate
// from the public HTTP DTOs.

export const ArchiveFileJobPayloadSchema = z.strictObject({
  fileId: IDENTIFIER,
  stagingKey: ARCHIVE_KEY,
  sha256: Sha256Schema
});

export const ProcessGroupJobFileSchema = z.strictObject({
  fileId: IDENTIFIER,
  archiveKey: ARCHIVE_KEY,
  sha256: Sha256Schema
});

export const ProcessGroupJobPayloadSchema = z.strictObject({
  groupId: IDENTIFIER,
  processingVersion: z.number().int().positive(),
  files: z.array(ProcessGroupJobFileSchema).min(1)
});

export const GroupSessionJobFileSchema = z.strictObject({
  fileId: IDENTIFIER,
  clientFileId: IDENTIFIER,
  relativePath: z.string().trim().min(1).max(512),
  sha256: Sha256Schema,
  archiveKey: ARCHIVE_KEY,
  byteSize: z.number().int().nonnegative(),
  lastModifiedMs: z.number().int().nonnegative(),
  kind: AssetSourceFileKindSchema
});

export const GroupSessionJobPayloadSchema = z.strictObject({
  files: z.array(GroupSessionJobFileSchema).min(1)
});

export type ArchiveFileJobPayload = z.infer<typeof ArchiveFileJobPayloadSchema>;
export type ProcessGroupJobPayload = z.infer<typeof ProcessGroupJobPayloadSchema>;
export type GroupSessionJobPayload = z.infer<typeof GroupSessionJobPayloadSchema>;

export type ArchiveFileJobResult = Extract<CompleteAssetJobResult, { kind: "ARCHIVE_FILE" }>;
export type GroupSessionJobResult = Extract<CompleteAssetJobResult, { kind: "GROUP_SESSION" }>;
export type ProcessGroupJobResult = Extract<CompleteAssetJobResult, { kind: "PROCESS_GROUP" }>;

export type JobHandlerResult = CompleteAssetJobResult;

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown, jobType: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "payload"}: ${issue.message}`)
      .join("; ");
    throw new JobExecutionError("PAYLOAD_INVALID", `${jobType} payload is invalid: ${details}`, false, {
      cause: result.error
    });
  }
  return result.data;
}

/** The session id embedded in a server-generated archive key. */
function sessionOfArchiveKey(archiveKey: string): string {
  const segments = archiveKey.split("/");
  const sessionId = segments[1] ?? "";
  if (segments[0] !== "imports" || sessionId.length === 0) {
    throw new JobExecutionError("PAYLOAD_INVALID", `Archive key ${archiveKey} does not embed a session id`, false);
  }
  return sessionId;
}

export function parseArchiveFilePayload(job: ClaimedAssetJob): ArchiveFileJobPayload {
  const payload = parsePayload(ArchiveFileJobPayloadSchema, job.payload, "ARCHIVE_FILE");
  if (sessionOfArchiveKey(payload.stagingKey) !== job.sessionId) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      "ARCHIVE_FILE staging key belongs to a different session than the job",
      false
    );
  }
  return payload;
}

export function parseGroupSessionPayload(job: ClaimedAssetJob): GroupSessionJobPayload {
  return parsePayload(GroupSessionJobPayloadSchema, job.payload, "GROUP_SESSION");
}

export function parseProcessGroupPayload(job: ClaimedAssetJob): ProcessGroupJobPayload {
  const payload = parsePayload(ProcessGroupJobPayloadSchema, job.payload, "PROCESS_GROUP");
  const sourceKey = payload.files[0]?.archiveKey ?? "";
  if (sessionOfArchiveKey(sourceKey) !== job.sessionId) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      "PROCESS_GROUP source archive key belongs to a different session than the job",
      false
    );
  }
  return payload;
}

// ---------------------------------------------------------------------------
// ARCHIVE_FILE
// ---------------------------------------------------------------------------

const ORIGINAL_EXTENSIONS: Record<string, string> = {
  ARW: "arw",
  JPEG: "jpg",
  PNG: "png",
  WEBP: "webp"
};

export type ArchiveFileHooks = {
  /**
   * Runs after the verified original is linked into raw/ but before the
   * staging entry is consumed, so a failed business write (e.g. the
   * recordUploadedFile transaction) leaves staging in place for the retry.
   */
  onArchived?: (archived: { sha256: string; archiveKey: string }) => Promise<void>;
};

export async function handleArchiveFile(
  store: ArchiveStore,
  payload: ArchiveFileJobPayload,
  hooks: ArchiveFileHooks = {}
): Promise<ArchiveFileJobResult> {
  let bytes: Uint8Array;
  try {
    bytes = await store.read(payload.stagingKey);
  } catch (error) {
    const transient = error instanceof ArchiveStoreError && error.code === "READ_FAILED";
    throw new JobExecutionError(
      "STAGING_UNAVAILABLE",
      `The staged upload for file ${payload.fileId} could not be read: ${messageOf(error)}`,
      transient,
      { cause: error }
    );
  }

  const actual = sha256OfBytes(bytes);
  if (actual !== payload.sha256) {
    throw new JobExecutionError(
      "STAGING_HASH_MISMATCH",
      `The staged upload for file ${payload.fileId} does not match the claimed SHA-256`,
      false
    );
  }

  const kind = detectAssetSourceKind(bytes);
  if (!kind) {
    throw new JobExecutionError(
      "CONTENT_TYPE_UNKNOWN",
      `The staged upload for file ${payload.fileId} is not an ARW/JPEG/PNG/WebP payload`,
      false
    );
  }
  const extension = ORIGINAL_EXTENSIONS[kind];
  if (!extension) {
    throw new JobExecutionError("UNSUPPORTED_SOURCE_KIND", `Kind ${kind} cannot be archived`, false);
  }

  let put: ArchivePutResult;
  try {
    put = await store.putOriginal({
      sessionId: sessionOfArchiveKey(payload.stagingKey),
      bytes,
      sha256: actual,
      extension
    });
  } catch (error) {
    throw wrapArchiveError(error, "ARCHIVE_WRITE_FAILED");
  }

  await hooks.onArchived?.({ sha256: actual, archiveKey: put.archiveKey });

  try {
    await store.removeStaging(payload.stagingKey);
  } catch (error) {
    throw wrapArchiveError(error, "STAGING_REMOVE_FAILED");
  }

  return { kind: "ARCHIVE_FILE", sha256: actual, archiveKey: put.archiveKey, storageProvider: STORAGE_PROVIDER };
}

// ---------------------------------------------------------------------------
// GROUP_SESSION
// ---------------------------------------------------------------------------

export async function handleGroupSession(
  store: ArchiveStore,
  payload: GroupSessionJobPayload
): Promise<GroupSessionJobResult> {
  const fileIdByClientFileId = new Map(payload.files.map((file) => [file.clientFileId, file.fileId]));
  const toFileId = (clientFileId: string): string =>
    fileIdByClientFileId.get(clientFileId) ?? clientFileId;

  const candidates: GroupingCandidate[] = [];
  for (const file of payload.files) {
    let bytes: Uint8Array;
    try {
      bytes = await store.verifiedRead(file.archiveKey, file.sha256);
    } catch (error) {
      throw wrapArchiveError(error, "ARCHIVE_READ_FAILED");
    }
    let dHash: string | null = null;
    let histogram: number[] | null = null;
    try {
      dHash = await computeDHash(bytes);
      histogram = await computeColorHistogram(bytes);
    } catch {
      // ARW and undecodable originals still participate in grouping through
      // their non-visual signals (exact digest, stem pairing, capture order).
    }
    candidates.push({
      clientFileId: file.clientFileId,
      relativePath: file.relativePath,
      sha256: file.sha256,
      dHash,
      histogram,
      capturedAtMs: file.lastModifiedMs
    });
  }

  const outcome = suggestGroups(candidates);
  const remapEvidence = (evidence: GroupSimilarityEvidence): GroupSimilarityEvidence => ({
    ...evidence,
    fileId: toFileId(evidence.fileId),
    relatedFileId: evidence.relatedFileId === null ? null : toFileId(evidence.relatedFileId),
    exactDuplicateOf: evidence.exactDuplicateOf === null ? null : toFileId(evidence.exactDuplicateOf),
    stemPairedWith: evidence.stemPairedWith === null ? null : toFileId(evidence.stemPairedWith)
  });
  const toGroup = (suggestion: GroupSuggestion, groupId: string) => ({
    groupId,
    memberFileIds: suggestion.memberFileIds.map(toFileId),
    primaryFileId: toFileId(suggestion.memberFileIds[0] ?? ""),
    similarityEvidence: suggestion.evidence.map(remapEvidence)
  });

  return {
    kind: "GROUP_SESSION",
    groups: [
      ...outcome.suggestions.map((suggestion, index) => toGroup(suggestion, `sg-${index + 1}`)),
      ...outcome.reviewSuggestions.map((suggestion, index) => toGroup(suggestion, `rv-${index + 1}`))
    ]
  };
}

// ---------------------------------------------------------------------------
// PROCESS_GROUP
// ---------------------------------------------------------------------------

export async function handleProcessGroup(
  store: ArchiveStore,
  payload: ProcessGroupJobPayload
): Promise<ProcessGroupJobResult> {
  const sessionId = sessionOfArchiveKey(payload.files[0]?.archiveKey ?? "");

  let chosen: { fileId: string; bytes: Uint8Array } | null = null;
  for (const entry of payload.files) {
    if (entry.archiveKey.endsWith(".arw")) continue;
    let bytes: Uint8Array;
    try {
      bytes = await store.verifiedRead(entry.archiveKey, entry.sha256);
    } catch (error) {
      throw wrapArchiveError(error, "ARCHIVE_READ_FAILED");
    }
    const kind = detectAssetSourceKind(bytes);
    if (kind === null || kind === "ARW") continue;
    chosen = { fileId: entry.fileId, bytes };
    break;
  }
  if (!chosen) {
    throw new JobExecutionError(
      "UNSUPPORTED_SOURCE_KIND",
      "The group holds no decodable raster source (ARW originals are archived only)",
      false
    );
  }

  let processed;
  try {
    processed = await processBeadImage({ bytes: chosen.bytes });
  } catch (error) {
    if (error instanceof ImageProcessorError) {
      throw new JobExecutionError(error.code, error.message, false, { cause: error });
    }
    throw new JobExecutionError("PROCESS_FAILED", messageOf(error), true, { cause: error });
  }

  const putVariant = async (fileName: "bead-512.webp" | "thumb-256.webp", bytes: Uint8Array) => {
    try {
      return await store.putProcessed({
        sessionId,
        groupId: payload.groupId,
        processingVersion: payload.processingVersion,
        fileName,
        bytes
      });
    } catch (error) {
      throw wrapArchiveError(error, "ARCHIVE_WRITE_FAILED");
    }
  };
  const mainPut = await putVariant("bead-512.webp", processed.main.bytes);
  await putVariant("thumb-256.webp", processed.thumb.bytes);

  let qc;
  try {
    qc = await runQualityChecks({
      measurements: processed.measurements,
      main: {
        bytes: processed.main.bytes,
        byteSize: processed.main.byteSize,
        widthPx: processed.main.widthPx,
        heightPx: processed.main.heightPx
      },
      thumb: {
        bytes: processed.thumb.bytes,
        byteSize: processed.thumb.byteSize,
        widthPx: processed.thumb.widthPx,
        heightPx: processed.thumb.heightPx
      }
    });
  } catch (error) {
    throw new JobExecutionError("QC_FAILED_TO_RUN", messageOf(error), true, { cause: error });
  }

  return {
    kind: "PROCESS_GROUP",
    processingVersion: payload.processingVersion,
    output: {
      sourceFileId: chosen.fileId,
      purpose: "MAIN",
      storageProvider: STORAGE_PROVIDER,
      storageKey: mainPut.archiveKey,
      outputSha256: mainPut.sha256,
      outputContentType: "image/webp",
      byteSize: mainPut.byteSize,
      widthPx: processed.main.widthPx,
      heightPx: processed.main.heightPx,
      processorVersion: processed.parameters.processorVersion,
      parameters: processed.parameters
    },
    qc
  };
}

// ---------------------------------------------------------------------------
// Composition for the runtime
// ---------------------------------------------------------------------------

export type AssetBusinessRepository = {
  recordUploadedFile(
    fileId: string,
    sha256: string,
    archiveKey: string,
    options?: { storageProvider?: string }
  ): Promise<unknown>;
};

export type JobHandler = (job: ClaimedAssetJob) => Promise<JobHandlerResult>;

export type JobHandlers = {
  ARCHIVE_FILE: JobHandler;
  GROUP_SESSION: JobHandler;
  PROCESS_GROUP: JobHandler;
};

export function createJobHandlers(deps: {
  store: ArchiveStore;
  repository: AssetBusinessRepository;
}): JobHandlers {
  const { store, repository } = deps;
  return {
    ARCHIVE_FILE: async (job) => {
      const payload = parseArchiveFilePayload(job);
      return handleArchiveFile(store, payload, {
        onArchived: async (archived) => {
          await repository.recordUploadedFile(payload.fileId, archived.sha256, archived.archiveKey, {
            storageProvider: STORAGE_PROVIDER
          });
        }
      });
    },
    GROUP_SESSION: async (job) => handleGroupSession(store, parseGroupSessionPayload(job)),
    PROCESS_GROUP: async (job) => handleProcessGroup(store, parseProcessGroupPayload(job))
  };
}
