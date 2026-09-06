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
  verifyRasterFullyDecodable,
  type GroupingCandidate,
  type GroupSimilarityEvidence,
  type GroupSuggestion,
  type ProcessingOptions,
  type RasterSourceKind
} from "@mystcrag/asset-pipeline";
import type {
  AssetJobFailure,
  ClaimedAssetJob,
  CompleteAssetJobResult,
  RecordUploadedFileContext
} from "@mystcrag/database";
import { PersistenceError } from "@mystcrag/database";
import {
  AssetSourceFileKindSchema,
  normalizeAssetRelativePath,
  ReprocessSettingsSchema,
  Sha256Schema
} from "@mystcrag/design-contract";
import { z } from "zod";

export const STORAGE_PROVIDER = "local-fs";

const IDENTIFIER = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim() === value && !/[\0-\x1f\u007f]/.test(value), {
    message: "Identifier must not contain surrounding whitespace or control characters"
  });
const STORAGE_PATH_SEGMENT = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, {
    message: "Storage path segment must contain only letters, digits, underscores, or hyphens"
  });
const ARCHIVE_KEY = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim() === value, {
    message: "Archive key must not contain surrounding whitespace"
  });

// ---------------------------------------------------------------------------
// Errors and classification
// ---------------------------------------------------------------------------

/**
 * The worker's centralized error-code table. Every code a worker can submit
 * carries exactly one retryability class here, so an operator reading
 * `failJob` evidence never has to guess whether a code is worth a retry.
 * JobExecutionError throw sites must use a code from this table; mapping into
 * the table happens in wrapArchiveError and classifyHandlerError.
 */
export const WORKER_ERROR_CODES = [
  // Deterministic: retrying cannot change the outcome.
  "PAYLOAD_INVALID",
  "UNSUPPORTED_FILE_KIND",
  "UNSUPPORTED_SOURCE_KIND",
  "CORRUPT_FILE_CONTENT",
  "CONTENT_KIND_MISMATCH",
  "STAGING_HASH_MISMATCH",
  "ARCHIVE_VERIFICATION_FAILED",
  "ARCHIVE_CONFLICT",
  "ARCHIVE_ROOT_MISSING",
  "ARCHIVE_ROOT_INSIDE_REPOSITORY",
  "REPOSITORY_ROOT_INVALID",
  "DECODE_FAILED",
  "NO_SUBJECT",
  "SEGMENTATION_FAILED",
  "JOB_LEASE_CONFLICT",
  // Transient: infrastructure trouble a retry may clear.
  "STAGING_UNAVAILABLE",
  "ARCHIVE_READ_FAILED",
  "ARCHIVE_WRITE_FAILED",
  "STORAGE_FULL",
  "PROCESS_FAILED",
  "QC_FAILED_TO_RUN",
  "COMPLETION_REJECTED",
  "UNEXPECTED_HANDLER_ERROR"
] as const;

export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

const TRANSIENT_WORKER_ERROR_CODES: ReadonlySet<string> = new Set([
  "STAGING_UNAVAILABLE",
  "ARCHIVE_READ_FAILED",
  "ARCHIVE_WRITE_FAILED",
  "STORAGE_FULL",
  "PROCESS_FAILED",
  "QC_FAILED_TO_RUN",
  "COMPLETION_REJECTED",
  "UNEXPECTED_HANDLER_ERROR"
]);

/** The single retryability class of a worker error code (table-driven). */
export function isRetryableWorkerErrorCode(code: string): boolean {
  return TRANSIENT_WORKER_ERROR_CODES.has(code);
}

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

/**
 * ArchiveStore failures map onto the worker's stable table by store error
 * code, never by exception text. ENOSPC under a write is surfaced separately
 * as STORAGE_FULL so an operator sees an actionable disk condition.
 */
const ARCHIVE_STORE_ERROR_MAPPING: Record<string, { code: string; retryable: boolean }> = {
  HASH_MISMATCH: { code: "ARCHIVE_VERIFICATION_FAILED", retryable: false },
  KEY_EXISTS_CONTENT_MISMATCH: { code: "ARCHIVE_CONFLICT", retryable: false },
  KEY_INVALID: { code: "PAYLOAD_INVALID", retryable: false },
  ARCHIVE_ROOT_MISSING: { code: "ARCHIVE_ROOT_MISSING", retryable: false },
  ARCHIVE_ROOT_INSIDE_REPOSITORY: { code: "ARCHIVE_ROOT_INSIDE_REPOSITORY", retryable: false },
  REPOSITORY_ROOT_INVALID: { code: "REPOSITORY_ROOT_INVALID", retryable: false },
  READ_FAILED: { code: "ARCHIVE_READ_FAILED", retryable: true },
  WRITE_FAILED: { code: "ARCHIVE_WRITE_FAILED", retryable: true }
};

export function wrapArchiveError(error: unknown, fallbackCode: string): JobExecutionError {
  if (error instanceof JobExecutionError) return error;
  if (error instanceof ArchiveStoreError) {
    if (error.code === "WRITE_FAILED" && isErrorWithCode(error.cause, "ENOSPC")) {
      return new JobExecutionError("STORAGE_FULL", "The archive storage is full; freeing space is required", true, {
        cause: error
      });
    }
    const mapping = ARCHIVE_STORE_ERROR_MAPPING[error.code];
    if (mapping) {
      return new JobExecutionError(mapping.code, error.message, mapping.retryable, { cause: error });
    }
  }
  const retryable = isRetryableWorkerErrorCode(fallbackCode);
  return new JobExecutionError(fallbackCode, messageOf(error), retryable, { cause: error });
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
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

// The shared import-session file limit (design contract) also bounds internal
// job payloads: a session cannot smuggle an unbounded workload past the public
// API through a queued job.
export const MAX_JOB_FILES = 500;

// Byte sizes and timestamps must be positive safe integers: a fractional or
// out-of-range value can never describe a real stored file.
const POSITIVE_SAFE_INTEGER = z
  .number()
  .int()
  .positive()
  .refine((value) => Number.isSafeInteger(value), {
    message: "Value must be a safe integer"
  });

// Paths arrive pre-normalized from the import backend; a path that the shared
// normalizer would still rewrite (trailing spaces, "./", traversal, empty
// segments) is rejected instead of silently repaired.
const SHARED_NORMALIZED_RELATIVE_PATH = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => isSharedNormalizedPath(value), {
    message: "Path must already be a shared-normalized relative path"
  });

function isSharedNormalizedPath(value: string): boolean {
  try {
    return normalizeAssetRelativePath(value) === value;
  } catch {
    return false;
  }
}

export const ProcessGroupJobPayloadSchema = z.strictObject({
  groupId: STORAGE_PATH_SEGMENT,
  processingVersion: POSITIVE_SAFE_INTEGER,
  // The human-confirmed primary (Task 4 puts the reviewed group.primaryFileId
  // here). Optional only for ARW-only groups, which have no raster to process;
  // parseProcessGroupPayload enforces presence whenever the group holds one.
  primaryFileId: IDENTIFIER.optional(),
  files: z.array(ProcessGroupJobFileSchema).min(1).max(MAX_JOB_FILES),
  outputStorageKey: ARCHIVE_KEY,
  settings: ReprocessSettingsSchema.optional()
});

export const GroupSessionJobFileSchema = z.strictObject({
  fileId: IDENTIFIER,
  clientFileId: IDENTIFIER,
  relativePath: SHARED_NORMALIZED_RELATIVE_PATH,
  sha256: Sha256Schema,
  archiveKey: ARCHIVE_KEY,
  byteSize: POSITIVE_SAFE_INTEGER,
  lastModifiedMs: POSITIVE_SAFE_INTEGER,
  kind: AssetSourceFileKindSchema
});

export const GroupSessionJobPayloadSchema = z.strictObject({
  files: z.array(GroupSessionJobFileSchema).min(1).max(MAX_JOB_FILES)
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

// Server-generated key grammar. Staging keys are minted by ArchiveStore
// .putStaging and raw keys by .putOriginal; anything else in a payload is a
// forged or cross-session reference and is rejected before any file is read.
const STAGING_KEY_PATTERN =
  /^imports\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/staging\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const RAW_KEY_PATTERN =
  /^imports\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/raw\/([0-9a-f]{64})\.(arw|jpeg|jpg|png|webp)$/;

function requireStagingKeyForSession(stagingKey: string, sessionId: string): void {
  const match = STAGING_KEY_PATTERN.exec(stagingKey);
  if (match === null) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      "ARCHIVE_FILE staging key must have the exact form imports/<sessionId>/staging/<uuid>",
      false
    );
  }
  if (match[1] !== sessionId) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      "ARCHIVE_FILE staging key belongs to a different session than the job",
      false
    );
  }
}

/** Archive-key extensions that a raw key may legally carry per source kind. */
const RAW_KEY_EXTENSIONS_BY_KIND: Record<string, readonly string[]> = {
  ARW: ["arw"],
  JPEG: ["jpeg", "jpg"],
  PNG: ["png"],
  WEBP: ["webp"]
};

/** The raster kind a raw-key extension declares (undefined for .arw). */
function rasterKindOfRawKeyExtension(extension: string): RasterSourceKind | undefined {
  if (extension === "jpeg" || extension === "jpg") return "JPEG";
  if (extension === "png") return "PNG";
  if (extension === "webp") return "WEBP";
  return undefined;
}

export type ParsedRawKey = {
  sessionId: string;
  digest: string;
  extension: string;
};

function parseRawKey(archiveKey: string, context: string): ParsedRawKey {
  const match = RAW_KEY_PATTERN.exec(archiveKey);
  if (match === null) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      `${context} archive key must have the exact form imports/<sessionId>/raw/<sha256>.<ext>`,
      false
    );
  }
  return { sessionId: match[1]!, digest: match[2]!, extension: match[3]! };
}

function requireRawKeyForSession(archiveKey: string, sessionId: string, context: string): ParsedRawKey {
  const parsed = parseRawKey(archiveKey, context);
  if (parsed.sessionId !== sessionId) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      `${context} archive key belongs to a different session than the job`,
      false
    );
  }
  return parsed;
}

function requireReservedMainOutputKey(
  outputStorageKey: string,
  sessionId: string,
  groupId: string,
  processingVersion: number
): void {
  const expected = `imports/${sessionId}/processed/${groupId}/v${processingVersion}/bead-512.webp`;
  if (outputStorageKey !== expected) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      "PROCESS_GROUP outputStorageKey does not match the database-reserved main output destination",
      false
    );
  }
}

export function parseArchiveFilePayload(job: ClaimedAssetJob): ArchiveFileJobPayload {
  const payload = parsePayload(ArchiveFileJobPayloadSchema, job.payload, "ARCHIVE_FILE");
  requireStagingKeyForSession(payload.stagingKey, job.sessionId);
  return payload;
}

export function parseGroupSessionPayload(job: ClaimedAssetJob): GroupSessionJobPayload {
  const payload = parsePayload(GroupSessionJobPayloadSchema, job.payload, "GROUP_SESSION");
  const fileIds = new Set<string>();
  const clientFileIds = new Set<string>();
  const relativePaths = new Set<string>();
  // One digest describes one content blob; a second declaration under a
  // different kind is a torn write or a forgery and is rejected up front.
  const kindBySha = new Map<string, string>();
  for (const file of payload.files) {
    if (fileIds.has(file.fileId)) {
      throw new JobExecutionError("PAYLOAD_INVALID", `GROUP_SESSION declares fileId ${file.fileId} twice`, false);
    }
    fileIds.add(file.fileId);
    if (clientFileIds.has(file.clientFileId)) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `GROUP_SESSION declares clientFileId ${file.clientFileId} twice`,
        false
      );
    }
    clientFileIds.add(file.clientFileId);
    if (relativePaths.has(file.relativePath)) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `GROUP_SESSION declares relativePath ${file.relativePath} twice`,
        false
      );
    }
    relativePaths.add(file.relativePath);
    const knownKind = kindBySha.get(file.sha256);
    if (knownKind !== undefined && knownKind !== file.kind) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `GROUP_SESSION declares the same SHA-256 under two kinds (${knownKind} and ${file.kind})`,
        false
      );
    }
    kindBySha.set(file.sha256, file.kind);
    const context = `GROUP_SESSION file ${file.fileId}`;
    const parsed = requireRawKeyForSession(file.archiveKey, job.sessionId, context);
    if (parsed.digest !== file.sha256) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `${context} archive key digest does not match the file's SHA-256`,
        false
      );
    }
    const allowedExtensions = RAW_KEY_EXTENSIONS_BY_KIND[file.kind] ?? [];
    if (!allowedExtensions.includes(parsed.extension)) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `${context} archive key extension .${parsed.extension} does not match the declared kind ${file.kind}`,
        false
      );
    }
  }
  return payload;
}

export function parseProcessGroupPayload(job: ClaimedAssetJob): ProcessGroupJobPayload {
  const payload = parsePayload(ProcessGroupJobPayloadSchema, job.payload, "PROCESS_GROUP");
  if (payload.groupId !== job.groupId) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      `PROCESS_GROUP payload group ${payload.groupId} does not match the job's group ${
        job.groupId ?? "(none)"
      }`,
      false
    );
  }
  requireReservedMainOutputKey(
    payload.outputStorageKey,
    job.sessionId,
    payload.groupId,
    payload.processingVersion
  );
  const fileIds = new Set<string>();
  for (const entry of payload.files) {
    if (fileIds.has(entry.fileId)) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `PROCESS_GROUP declares fileId ${entry.fileId} twice`,
        false
      );
    }
    fileIds.add(entry.fileId);
    const context = `PROCESS_GROUP file ${entry.fileId}`;
    const parsed = requireRawKeyForSession(entry.archiveKey, job.sessionId, context);
    if (parsed.digest !== entry.sha256) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `${context} archive key digest does not match the file's SHA-256`,
        false
      );
    }
  }
  validateProcessGroupPrimary(payload);
  return payload;
}

/**
 * The primary contract: PROCESS_GROUP may only process the file a human
 * confirmed. The worker never guesses — without a primary over a group that
 * holds a raster the job is rejected before a single byte is read, so neither
 * clientFileId order nor array order can pick the source by accident. Only an
 * ARW-only group may omit the primary, and it has nothing to process.
 */
function validateProcessGroupPrimary(payload: ProcessGroupJobPayload): void {
  const primary = payload.primaryFileId === undefined
    ? undefined
    : payload.files.find((entry) => entry.fileId === payload.primaryFileId);
  if (payload.primaryFileId !== undefined && primary === undefined) {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      `PROCESS_GROUP primaryFileId ${payload.primaryFileId} is not a member of the group`,
      false
    );
  }
  if (primary === undefined) {
    const groupHoldsRaster = payload.files.some((entry) => {
      const parsed = parseRawKey(entry.archiveKey, "PROCESS_GROUP");
      return parsed.extension !== "arw";
    });
    if (groupHoldsRaster) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        "PROCESS_GROUP over a group holding a raster requires the human-confirmed primaryFileId; array order must never pick the source",
        false
      );
    }
    return;
  }
  const parsed = parseRawKey(primary.archiveKey, "PROCESS_GROUP primary");
  if (parsed.extension === "arw") {
    throw new JobExecutionError(
      "PAYLOAD_INVALID",
      "PROCESS_GROUP primaryFileId must name a JPEG/PNG/WebP original; ARW originals are archived only",
      false
    );
  }
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
   * Runs after the verified original is linked into raw/. A failure here
   * (e.g. the recordUploadedFile transaction) rejects the handler while the
   * staging entry stays in place for the retry.
   */
  onArchived?: (archived: { sha256: string; archiveKey: string }) => Promise<void>;
};

export async function handleArchiveFile(
  store: ArchiveStore,
  payload: ArchiveFileJobPayload,
  hooks: ArchiveFileHooks = {},
  context: JobRunContext = NEVER_LOST_LEASE
): Promise<ArchiveFileJobResult> {
  // Recovery-safe reads are fine on a lost lease, but no new work may start:
  // the guard runs before every expensive step and every side effect.
  context.throwIfLeaseLost();
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
      "UNSUPPORTED_FILE_KIND",
      `The staged upload for file ${payload.fileId} is not an ARW/JPEG/PNG/WebP payload`,
      false
    );
  }
  // A magic-byte sniff is never archiving evidence on its own: JPEG/PNG/WebP
  // originals must fully decode (container parse plus a pixel walk) before
  // anything is archived or recorded, so 3-byte JPEG stubs and truncated
  // rasters fail here instead of entering raw/. ARW needs no Sharp decode —
  // its sensor data is beyond Sharp, the structural ARW check already ran in
  // detectAssetSourceKind.
  if (kind !== "ARW") {
    const verification = await verifyRasterFullyDecodable(bytes, kind as RasterSourceKind);
    if (!verification.ok) {
      if (verification.reason === "kind-mismatch") {
        throw new JobExecutionError(
          "CONTENT_KIND_MISMATCH",
          `The staged upload for file ${payload.fileId} ${verification.detail}`,
          false
        );
      }
      throw new JobExecutionError(
        "CORRUPT_FILE_CONTENT",
        `The staged upload for file ${payload.fileId} cannot be decoded as a ${kind} image (${verification.detail})`,
        false
      );
    }
  }
  const extension = ORIGINAL_EXTENSIONS[kind];
  if (!extension) {
    throw new JobExecutionError("UNSUPPORTED_SOURCE_KIND", `Kind ${kind} cannot be archived`, false);
  }

  let put: ArchivePutResult;
  // putOriginal is a storage side effect: once the lease is known lost the
  // worker must not start it. A put that already finished is content-addressed
  // and idempotent — it may safely remain for the reclaiming worker to reuse.
  context.throwIfLeaseLost();
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

  // onArchived runs the business write (recordUploadedFile): the last boundary
  // where a lost lease must stop the handler instead of writing rows a new
  // lease holder will conflict with.
  context.throwIfLeaseLost();
  await hooks.onArchived?.({ sha256: actual, archiveKey: put.archiveKey });

  // The staging entry is deliberately NOT removed here. It is the recovery
  // input for a retry: if the worker dies (or loses its lease) before
  // completeJob commits, the reclaimed job re-reads staging and completes.
  // Removing it is the runtime's job, strictly after the committed result.
  return { kind: "ARCHIVE_FILE", sha256: actual, archiveKey: put.archiveKey, storageProvider: STORAGE_PROVIDER };
}

// ---------------------------------------------------------------------------
// GROUP_SESSION
// ---------------------------------------------------------------------------

export async function handleGroupSession(
  store: ArchiveStore,
  payload: GroupSessionJobPayload,
  context: JobRunContext = NEVER_LOST_LEASE
): Promise<GroupSessionJobResult> {
  const fileIdByClientFileId = new Map(payload.files.map((file) => [file.clientFileId, file.fileId]));
  const kindByClientFileId = new Map(payload.files.map((file) => [file.clientFileId, file.kind]));
  const toFileId = (clientFileId: string): string =>
    fileIdByClientFileId.get(clientFileId) ?? clientFileId;

  const candidates: GroupingCandidate[] = [];
  for (const file of payload.files) {
    // Verified reads and decodes are the expensive steps of this job; with the
    // lease gone there is no point walking the remaining files.
    context.throwIfLeaseLost();
    let bytes: Uint8Array;
    try {
      bytes = await store.verifiedRead(file.archiveKey, file.sha256);
    } catch (error) {
      throw wrapArchiveError(error, "ARCHIVE_READ_FAILED");
    }
    if (bytes.byteLength !== file.byteSize) {
      throw new JobExecutionError(
        "PAYLOAD_INVALID",
        `File ${file.fileId} byteSize does not match its verified archived content`,
        false
      );
    }
    // The payload's declared kind is cross-checked against the archived
    // content: a real JPEG archived under a .png key passes the key grammar
    // but the sniff sees JPEG. Only after the kinds agree may the declared
    // raster participate; a declared raster that cannot decode fails the job
    // instead of silently grouping on non-visual signals. ARW is the only
    // kind allowed to carry no visual features (Sharp cannot decode sensor
    // data), so it skips the decode gate.
    const actualKind = detectAssetSourceKind(bytes);
    if (actualKind !== file.kind) {
      throw new JobExecutionError(
        "CONTENT_KIND_MISMATCH",
        `File ${file.fileId} is declared ${file.kind} but its archived content is ${
          actualKind ?? "not a recognizable image"
        }`,
        false
      );
    }
    let dHash: string | null = null;
    let histogram: number[] | null = null;
    if (file.kind !== "ARW") {
      const verification = await verifyRasterFullyDecodable(bytes, file.kind as RasterSourceKind);
      if (!verification.ok) {
        if (verification.reason === "kind-mismatch") {
          throw new JobExecutionError(
            "CONTENT_KIND_MISMATCH",
            `File ${file.fileId} ${verification.detail}`,
            false
          );
        }
        throw new JobExecutionError(
          "CORRUPT_FILE_CONTENT",
          `File ${file.fileId} cannot be decoded as a ${file.kind} image (${verification.detail})`,
          false
        );
      }
      dHash = await computeDHash(bytes);
      histogram = await computeColorHistogram(bytes);
    }
    candidates.push({
      clientFileId: file.clientFileId,
      relativePath: file.relativePath,
      sha256: file.sha256,
      kind: file.kind,
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
  const toGroup = (suggestion: GroupSuggestion, groupId: string) => {
    // The suggested primary is a deterministic hint for the human review
    // (first raster member in member order), never a worker decision: an
    // ARW-only group offers no suggestion because only the human can pick,
    // skip, or re-shoot. Task 4 is what copies a human-confirmed primary into
    // PROCESS_GROUP payloads.
    const suggestedPrimaryClient = suggestion.memberFileIds.find(
      (clientFileId) => kindByClientFileId.get(clientFileId) !== "ARW"
    );
    const group: {
      groupId: string;
      memberFileIds: string[];
      primaryFileId?: string;
      similarityEvidence: GroupSimilarityEvidence[];
    } = {
      groupId,
      memberFileIds: suggestion.memberFileIds.map(toFileId),
      similarityEvidence: suggestion.evidence.map(remapEvidence)
    };
    if (suggestedPrimaryClient !== undefined) {
      group.primaryFileId = toFileId(suggestedPrimaryClient);
    }
    return group;
  };

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
  payload: ProcessGroupJobPayload,
  context: JobRunContext = NEVER_LOST_LEASE
): Promise<ProcessGroupJobResult> {
  const sessionId = sessionOfArchiveKey(payload.files[0]?.archiveKey ?? "");
  requireReservedMainOutputKey(
    payload.outputStorageKey,
    sessionId,
    payload.groupId,
    payload.processingVersion
  );

  // Only the human-confirmed primary is processed. parseProcessGroupPayload
  // has already proven the primary is a group member with a raster key (or
  // the group is ARW-only and has nothing to process), so array order has no
  // influence on the source: reversing `files` cannot move the source or
  // change the output bytes.
  const primaryEntry = payload.primaryFileId === undefined
    ? undefined
    : payload.files.find((entry) => entry.fileId === payload.primaryFileId);
  if (!primaryEntry) {
    throw new JobExecutionError(
      "UNSUPPORTED_SOURCE_KIND",
      "The group holds no decodable raster source (ARW originals are archived only)",
      false
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await store.verifiedRead(primaryEntry.archiveKey, primaryEntry.sha256);
  } catch (error) {
    throw wrapArchiveError(error, "ARCHIVE_READ_FAILED");
  }
  // The primary's actual content is re-checked against its raw key: a real
  // PNG archived under a .jpg key is structurally consistent (digest matches
  // the key) but the processed source must never disagree with the kind the
  // key declares.
  const declaredKind = rasterKindOfRawKeyExtension(
    parseRawKey(primaryEntry.archiveKey, "PROCESS_GROUP primary").extension
  );
  if (declaredKind === undefined) {
    throw new JobExecutionError(
      "CONTENT_KIND_MISMATCH",
      `The confirmed primary ${primaryEntry.fileId} does not sit on a JPEG/PNG/WebP raw key`,
      false
    );
  }
  const actualKind = detectAssetSourceKind(bytes);
  if (actualKind !== declaredKind) {
    throw new JobExecutionError(
      "CONTENT_KIND_MISMATCH",
      `The confirmed primary ${primaryEntry.fileId} is stored on a ${declaredKind} key but its content is ${
        actualKind ?? "not a recognizable image"
      }`,
      false
    );
  }
  const verification = await verifyRasterFullyDecodable(bytes, declaredKind);
  if (!verification.ok) {
    if (verification.reason === "kind-mismatch") {
      throw new JobExecutionError(
        "CONTENT_KIND_MISMATCH",
        `The confirmed primary ${primaryEntry.fileId} ${verification.detail}`,
        false
      );
    }
    throw new JobExecutionError(
      "CORRUPT_FILE_CONTENT",
      `The confirmed primary ${primaryEntry.fileId} cannot be decoded as a ${declaredKind} image (${verification.detail})`,
      false
    );
  }
  const chosen = { fileId: primaryEntry.fileId, bytes };

  let processed;
  // processBeadImage is the expensive step (full decode, segmentation, encode);
  // it must not start once the lease is known lost.
  context.throwIfLeaseLost();
  try {
    const options: Partial<ProcessingOptions> = {};
    if (payload.settings?.maskThreshold !== undefined) {
      // The deterministic flood-fill uses a 0..60 RGB-distance window;
      // 0.5 therefore preserves the established default tolerance of 30.
      options.backgroundTolerance = payload.settings.maskThreshold * 60;
    }
    if (payload.settings?.edgeFeatherPx !== undefined) {
      options.maskFeatherSigma = payload.settings.edgeFeatherPx;
    }
    processed = await processBeadImage({
      bytes: chosen.bytes,
      ...(Object.keys(options).length === 0 ? {} : { options })
    });
  } catch (error) {
    if (error instanceof ImageProcessorError) {
      throw new JobExecutionError(error.code, error.message, false, { cause: error });
    }
    throw new JobExecutionError("PROCESS_FAILED", messageOf(error), true, { cause: error });
  }

  const putVariant = async (fileName: "bead-512.webp" | "thumb-256.webp", bytes: Uint8Array) => {
    // Content-addressed processed outputs are idempotent, but a new write must
    // not start after the lease loss; the reclaiming worker reuses what landed.
    context.throwIfLeaseLost();
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
  if (mainPut.archiveKey !== payload.outputStorageKey) {
    throw new JobExecutionError(
      "ARCHIVE_CONFLICT",
      "The processed main output did not land at the database-reserved destination",
      false
    );
  }
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
    options: RecordUploadedFileContext
  ): Promise<unknown>;
};

/**
 * A handler's product: the job result plus an optional post-commit cleanup.
 * The cleanup (e.g. removing an ARCHIVE_FILE staging entry) is executed by
 * the runtime strictly AFTER completeJob commits. Skipping it on a lost lease
 * and tolerating its failure are both intentional: a staging entry that
 * survives is reclaimable, a lost one is not.
 */
export type JobHandlerOutcome = {
  result: JobHandlerResult;
  afterCommit?: () => Promise<void>;
};

/**
 * The runtime's live view of the lease while a handler runs. `signal` aborts
 * the moment a heartbeat reports the lease lost, so a handler can stop before
 * its next side effect instead of writing storage or business rows a new
 * lease holder will conflict with. `throwIfLeaseLost` converts the same state
 * into the stable JOB_LEASE_CONFLICT error for call sites that prefer throws.
 */
export type JobRunContext = {
  readonly signal: AbortSignal;
  throwIfLeaseLost(): void;
};

/** A guard for callers with no lease to watch: never aborts, never throws. */
const NEVER_LOST_LEASE: JobRunContext = {
  signal: new AbortController().signal,
  throwIfLeaseLost: () => {}
};

export type JobHandler = (job: ClaimedAssetJob, context: JobRunContext) => Promise<JobHandlerOutcome>;

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
    ARCHIVE_FILE: async (job, context) => {
      const payload = parseArchiveFilePayload(job);
      const result = await handleArchiveFile(
        store,
        payload,
        {
          onArchived: async (archived) => {
            await repository.recordUploadedFile(payload.fileId, archived.sha256, archived.archiveKey, {
              storageProvider: STORAGE_PROVIDER,
              jobId: job.jobId,
              lease: job.lease
            });
          }
        },
        context
      );
      return {
        result,
        afterCommit: async () => {
          try {
            await store.removeStaging(payload.stagingKey);
          } catch (error) {
            throw wrapArchiveError(error, "STAGING_REMOVE_FAILED");
          }
        }
      };
    },
    GROUP_SESSION: async (job, context) => ({
      result: await handleGroupSession(store, parseGroupSessionPayload(job), context)
    }),
    PROCESS_GROUP: async (job, context) => ({
      result: await handleProcessGroup(store, parseProcessGroupPayload(job), context)
    })
  };
}
