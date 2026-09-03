import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";
import {
  ASSET_IMPORT_SESSION_STATES,
  CreateAssetImportSessionRequestSchema,
  PublishBeadImageGroupRequestSchema,
  RegisterAssetManifestRequestSchema,
  SaveBeadProductDraftRequestSchema,
  Sha256Schema,
  assetImportCheckpointRank,
  normalizeAssetRelativePath,
  type AssetImportCheckpoint,
  type AssetImportManifestFileEntry,
  type AssetImportSessionState,
  type AssetSourceFileState,
  type CreateAssetImportSessionRequest,
  type PublishBeadImageGroupRequest,
  type RegisterAssetManifestRequest,
  type SaveBeadProductDraftRequest
} from "@mystcrag/design-contract";

import type { Prisma, PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { toPrismaJson } from "../mappers/snapshot.mapper.js";

type Db = PrismaClient | Prisma.TransactionClient;

const CONTROL_CHARACTERS = /[\u0000-\u001f]/;
const MAX_IDENTIFIER_LENGTH = 160;
const DEFAULT_RETRY_DELAY_MS = 60_000;
const PENDING_CURATION_COMPLIANCE_NOTE = "Pending manual curation.";

const UploadedFileHashSchema = z.strictObject({ sha256: Sha256Schema });

const ArchiveKeyFieldSchema = z.strictObject({
  archiveKey: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine(
      (value) => {
        try {
          return normalizeAssetRelativePath(value) === value;
        } catch {
          return false;
        }
      },
      { message: "Archive key must be a server-generated relative storage key" }
    )
});

const StorageProviderFieldSchema = z.strictObject({
  storageProvider: z.string().trim().min(1).max(120)
});

const WorkerIdFieldSchema = z.strictObject({
  workerId: z.string().trim().min(1).max(160)
});

const AssetJobFailureSchema = z.strictObject({
  code: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4_000)
});

const AssetQcCheckSchema = z.strictObject({
  id: z.string().trim().min(1).max(120),
  passed: z.boolean(),
  detail: z.string().max(2_000).nullable().optional(),
  summary: z.string().max(2_000).nullable().optional()
});

const AssetQcResultSchema = z.strictObject({
  passed: z.boolean(),
  checks: z.array(AssetQcCheckSchema).max(200),
  summary: z.string().max(2_000).nullable().optional()
});

const ProcessedOutputSchema = z.strictObject({
  sourceFileId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
  purpose: z.enum(["MAIN", "TEXTURE", "MODEL", "PREVIEW"]),
  storageProvider: z.string().trim().min(1).max(120),
  storageKey: z.string().trim().min(1).max(512),
  outputSha256: Sha256Schema,
  outputContentType: z.enum(["image/webp", "image/png", "image/jpeg"]),
  byteSize: z.number().int().positive(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  processorVersion: z.string().trim().min(1).max(120),
  parameters: z.record(z.string(), z.unknown()).optional()
});

const CompleteArchiveFileJobResultSchema = z.strictObject({
  kind: z.literal("ARCHIVE_FILE"),
  sha256: Sha256Schema,
  archiveKey: ArchiveKeyFieldSchema.shape.archiveKey,
  storageProvider: z.string().trim().min(1).max(120)
});

// Workers report processing output and automatic QC evidence only. Usage
// permissions are human review decisions: strictObject rejects any result
// that tries to smuggle them in before a single row is written.
const CompleteProcessGroupJobResultSchema = z.strictObject({
  kind: z.literal("PROCESS_GROUP"),
  processingVersion: z.number().int().positive(),
  output: ProcessedOutputSchema,
  qc: AssetQcResultSchema
});

// Operator decision recorded by reviewProcessedAsset. Local schema on
// purpose: the accepted design contract has no human asset-review DTO yet
// (Contract blocker — see the delivery report); migrating it into
// @mystcrag/design-contract is a QWEN revision task.
const ProcessedAssetReviewDecisionSchema = z.strictObject({
  usagePermission: z.enum(["UNKNOWN", "OWNED", "GRANTED", "PROHIBITED"]),
  rightsHolder: z.string().trim().min(1).max(300),
  isAuthenticPhotograph: z.boolean(),
  allowPublicDisplay: z.boolean(),
  allowCommercialUse: z.boolean(),
  allowAiTraining: z.boolean(),
  allowAiRecommendation: z.boolean()
});

const CompleteGroupSessionJobResultSchema = z.strictObject({
  kind: z.literal("GROUP_SESSION"),
  groups: z
    .array(
      z.strictObject({
        groupId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
        memberFileIds: z.array(z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH)).min(1),
        primaryFileId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH).optional(),
        similarityEvidence: z.unknown().optional()
      })
    )
    .min(1)
});

const CompleteAssetJobResultSchema = z.discriminatedUnion("kind", [
  CompleteArchiveFileJobResultSchema,
  CompleteProcessGroupJobResultSchema,
  CompleteGroupSessionJobResultSchema
]);

// ---------------------------------------------------------------------------
// Payload fingerprints (idempotency evidence, not secrets)
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Order-independent manifest digest: file order is not identity, content is. */
export function manifestPayloadFingerprint(files: readonly AssetImportManifestFileEntry[]): string {
  const sorted = [...files].sort((left, right) =>
    left.clientFileId < right.clientFileId ? -1 : left.clientFileId > right.clientFileId ? 1 : 0
  );
  return canonicalSha256(sorted);
}

/**
 * Publish payload digest ignoring the idempotency key and the revision guard:
 * a retry carries a different revision once the group moved on, so only the
 * business payload decides whether a replay is identical.
 */
export function publishPayloadFingerprint(input: PublishAssetGroupInput): string {
  const { idempotencyKey, expectedGroupRevision, ...payload } = input;
  void idempotencyKey;
  void expectedGroupRevision;
  return canonicalSha256(payload);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function parseContract<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "payload"}: ${issue.message}`)
      .join("; ");
    throw new PersistenceError("VALIDATION_ERROR", `${label} failed validation: ${details}`);
  }
  return result.data;
}

function invalidParam(field: string, reason: string): PersistenceError {
  return new PersistenceError("VALIDATION_ERROR", `Asset import ${field} is invalid: ${reason}`);
}

function validateIdentifierParam(value: string, field: string): void {
  if (value.length === 0) throw invalidParam(field, "it must not be empty");
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw invalidParam(field, `it exceeds ${MAX_IDENTIFIER_LENGTH} characters`);
  }
  if (CONTROL_CHARACTERS.test(value)) {
    throw invalidParam(field, "control characters are not allowed");
  }
}

function validateWorkerId(workerId: string): void {
  parseContract(WorkerIdFieldSchema, { workerId }, "asset job worker");
}

function validateLeaseUntil(leaseUntil: Date): void {
  if (!(leaseUntil instanceof Date) || Number.isNaN(leaseUntil.getTime())) {
    throw invalidParam("leaseUntil", "a future Date is required");
  }
  if (leaseUntil.getTime() <= Date.now()) {
    throw invalidParam("leaseUntil", "it must be in the future");
  }
}

function validateArchiveKeyValue(archiveKey: string): void {
  parseContract(ArchiveKeyFieldSchema, { archiveKey }, "asset archive key");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function assertEnumValue<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", `Unknown ${field} value '${value}' was persisted`);
  }
  return value as T;
}

const GROUP_STATES = ["SUGGESTED", "CONFIRMED", "NAMED", "PROCESSED", "QC_FAILED", "READY", "PUBLISHED"] as const;
const FILE_STATES = ["PENDING", "UPLOADING", "ARCHIVED", "FAILED", "SKIPPED_DUPLICATE"] as const;
const JOB_STATES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] as const;
const JOB_TYPES = ["ARCHIVE_FILE", "GROUP_SESSION", "PROCESS_GROUP"] as const;
const CURRENCIES = ["CNY", "TWD"] as const;
const USAGE_PERMISSIONS = ["UNKNOWN", "OWNED", "GRANTED", "PROHIBITED"] as const;
const ASSET_STATES = ["DRAFT", "QC_PENDING", "QC_FAILED", "APPROVED", "RETIRED"] as const;
const CHECKPOINTS = ["ARCHIVED", "GROUPED", "LABELED", "PROCESSED", "REVIEWED", "PUBLISHED"] as const;
const BINDING_STATUSES = ["DRAFT", "APPROVED", "RETIRED"] as const;

function assertSessionState(value: string): AssetImportSessionState {
  return assertEnumValue(value, ASSET_IMPORT_SESSION_STATES, "asset import session state");
}

function assertGroupState(value: string): (typeof GROUP_STATES)[number] {
  return assertEnumValue(value, GROUP_STATES, "bead image group state");
}

function assertFileState(value: string): AssetSourceFileState {
  return assertEnumValue(value, FILE_STATES, "asset source file state");
}

function assertJobState(value: string): (typeof JOB_STATES)[number] {
  return assertEnumValue(value, JOB_STATES, "asset processing job state");
}

function assertJobType(value: string): (typeof JOB_TYPES)[number] {
  return assertEnumValue(value, JOB_TYPES, "asset processing job type");
}

function assertCurrency(value: string): (typeof CURRENCIES)[number] {
  return assertEnumValue(value, CURRENCIES, "currency");
}

function assertUsagePermission(value: string): (typeof USAGE_PERMISSIONS)[number] {
  return assertEnumValue(value, USAGE_PERMISSIONS, "asset usage permission");
}

function assertAssetState(value: string): (typeof ASSET_STATES)[number] {
  return assertEnumValue(value, ASSET_STATES, "processed asset state");
}

function assertCheckpoint(value: string | null | undefined): AssetImportCheckpoint | null {
  if (value === null || value === undefined) return null;
  return assertEnumValue(value, CHECKPOINTS, "asset import checkpoint");
}

function assertBindingStatus(value: string): (typeof BINDING_STATUSES)[number] {
  return assertEnumValue(value, BINDING_STATUSES, "product asset binding status");
}

/** Checkpoints only ever move forward; a replayed lower marker never regresses. */
function advanceCheckpoint(current: string | null, next: AssetImportCheckpoint): AssetImportCheckpoint {
  const currentCheckpoint = assertCheckpoint(current);
  if (currentCheckpoint !== null && assetImportCheckpointRank(currentCheckpoint) >= assetImportCheckpointRank(next)) {
    return currentCheckpoint;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Row types (loose on purpose: both the real client and the in-memory test
// double feed these; every read is re-validated through the assert helpers)
// ---------------------------------------------------------------------------

type SessionRow = {
  id: string;
  state: string;
  lastVerifiedCheckpoint: string | null;
  declaredFileCount: number;
  archivedFileCount: number;
  failedFileCount: number;
  skippedFileCount: number;
  declaredBytes: bigint;
  uploadedBytes: bigint;
  manifestIdempotencyKey: string | null;
  manifestFingerprint: string | null;
};

type SourceFileRow = {
  id: string;
  sessionId: string;
  clientFileId: string;
  relativePath: string;
  byteSize: bigint;
  lastModifiedMs: bigint | null;
  kind: string;
  state: string;
  sha256: string | null;
  archiveKey: string | null;
  duplicateOfId: string | null;
  groupId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
};

type GroupRow = {
  id: string;
  sessionId: string;
  state: string;
  revision: number;
  crystalName: string | null;
  crystalId: string | null;
  crystalDraftId: string | null;
};

type JobRow = {
  id: string;
  sessionId: string;
  groupId: string | null;
  jobType: string;
  state: string;
  retryCount: number;
  maxRetries: number;
  workerId: string | null;
  leaseToken: string | null;
  leaseUntil: Date | null;
};

type ProcessedAssetRow = {
  id: string;
  groupId: string;
  purpose: string;
  processingVersion: number;
  state: string;
  assetKey: string | null;
  storageProvider: string;
  storageKey: string;
  outputSha256: string;
  outputContentType: string;
  outputBytes: bigint;
  widthPx: number | null;
  heightPx: number | null;
  usagePermission: string;
  allowPublicDisplay: boolean;
  allowCommercialUse: boolean;
  qcPassedAt: Date | null;
};

type PublicationRow = {
  groupId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  materialProductId: string;
  crystalId: string;
  inventorySnapshotId: string;
  qualityStatement: string;
  qualitySource: string;
  rightsHolder: string;
  usagePermission: string;
  isAuthenticPhotograph: boolean;
  allowAiTraining: boolean;
  allowAiRecommendation: boolean;
  allowCommercialUse: boolean;
  allowPublicDisplay: boolean;
  publishedAssetKeys: string[];
  publishedAt: Date;
};

type ProductDraftRow = {
  groupId: string;
  crystalName: string | null;
  crystalId: string | null;
  crystalDraftId: string | null;
  displayName: string | null;
  sku: string | null;
  materialKey: string | null;
  shape: string | null;
  diameterMm: number | null;
  lengthAlongStringMm: number | null;
  currency: string | null;
  unitPriceMinor: bigint | null;
  costMinor: bigint | null;
  availableQuantity: number | null;
  qualityStatement: string | null;
  qualitySource: string | null;
  textureAssetKey: string | null;
  modelAssetKey: string | null;
  rightsHolder: string | null;
  usagePermission: string | null;
  isAuthenticPhotograph: boolean | null;
  allowAiTraining: boolean | null;
  allowCommercialUse: boolean | null;
  allowPublicDisplay: boolean | null;
  allowAiRecommendation: boolean | null;
};

type CrystalDraftRow = {
  id: string;
  nameCn: string;
  nameEn: string | null;
  mineralName: string;
  colorTags: string[];
  visualTags: string[];
  styleTags: string[];
  priceLevel: number | null;
  gemologicalInfo: unknown;
  complianceNote: string;
  promotedCrystalId: string | null;
};

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type CreateAssetImportSessionInput = CreateAssetImportSessionRequest;

export type CreateAssetImportSessionResult = {
  sessionId: string;
  state: AssetImportSessionState;
  createdAt: Date;
  created: boolean;
};

export type RegisterAssetManifestInput = RegisterAssetManifestRequest;

export type RegisteredAssetFileView = {
  fileId: string;
  clientFileId: string;
  uploadStatus: AssetSourceFileState;
  createdAt: Date;
};

export type RegisterAssetManifestResult = {
  sessionId: string;
  registeredFileCount: number;
  files: RegisteredAssetFileView[];
};

export type ArchivedAssetFileResult = {
  fileId: string;
  uploadStatus: AssetSourceFileState;
  sha256: string | null;
  archiveKey: string | null;
  archivedAt: Date | null;
};

export type AssetJobLease = {
  workerId: string;
  leaseToken: string;
};

export type AssetJobFailure = z.infer<typeof AssetJobFailureSchema>;

export type CompleteAssetJobResult = z.infer<typeof CompleteAssetJobResultSchema>;

export type ClaimedAssetJob = {
  jobId: string;
  sessionId: string;
  groupId: string | null;
  jobType: (typeof JOB_TYPES)[number];
  state: "RUNNING";
  payload: unknown;
  retryCount: number;
  maxRetries: number;
  lease: AssetJobLease;
  leaseUntil: Date;
};

export type CompleteAssetJobOutcome = {
  jobId: string;
  state: "COMPLETED";
  completedAt: Date;
};

export type ProcessedAssetReviewDecision = z.infer<typeof ProcessedAssetReviewDecisionSchema>;

export type ProcessedAssetReviewResult = {
  assetId: string;
  state: "APPROVED";
  assetKey: string;
  approvedAt: Date;
};

export type FailAssetJobOutcome = {
  jobId: string;
  state: "QUEUED" | "FAILED";
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: Date | null;
};

export type SaveGroupDraftInput = SaveBeadProductDraftRequest;

export type SaveGroupDraftResult = {
  groupId: string;
  state: (typeof GROUP_STATES)[number];
  revision: number;
  draftSavedAt: Date;
};

export type PublishAssetGroupInput = PublishBeadImageGroupRequest;

export type PublishAssetGroupResult = {
  groupId: string;
  state: "PUBLISHED";
  materialProductId: string;
  crystalId: string;
  inventorySnapshotId: string;
  publishedAt: Date;
  publishedAssetKeys: string[];
};

export type ApprovedPublicAsset = {
  assetKey: string;
  outputSha256: string;
  storageProvider: string;
  storageKey: string;
  outputContentType: string;
  outputBytes: bigint;
  widthPx: number | null;
  heightPx: number | null;
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class AssetImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createSession(input: CreateAssetImportSessionInput): Promise<CreateAssetImportSessionResult> {
    const request = parseContract(
      CreateAssetImportSessionRequestSchema,
      input,
      "asset import session request"
    );
    validateIdentifierParam(request.idempotencyKey, "idempotencyKey");
    try {
      const row = await this.prisma.assetImportSession.create({
        data: {
          idempotencyKey: request.idempotencyKey,
          state: "CREATED",
          declaredFileCount: 0,
          archivedFileCount: 0,
          failedFileCount: 0,
          skippedFileCount: 0,
          declaredBytes: 0n,
          uploadedBytes: 0n
        }
      });
      return {
        sessionId: row.id,
        state: assertSessionState(row.state),
        createdAt: row.createdAt,
        created: true
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.assetImportSession
          .findUnique({ where: { idempotencyKey: request.idempotencyKey } })
          .catch(rethrowPersistenceError);
        if (existing) {
          return {
            sessionId: existing.id,
            state: assertSessionState(existing.state),
            createdAt: existing.createdAt,
            created: false
          };
        }
      }
      rethrowPersistenceError(error);
    }
  }

  async registerManifest(
    sessionId: string,
    manifest: RegisterAssetManifestInput
  ): Promise<RegisterAssetManifestResult> {
    validateIdentifierParam(sessionId, "sessionId");
    const request = parseContract(
      RegisterAssetManifestRequestSchema,
      manifest,
      "asset manifest request"
    );
    validateIdentifierParam(request.idempotencyKey, "idempotencyKey");
    const fingerprint = manifestPayloadFingerprint(request.files);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const session = await tx.assetImportSession.findUnique({ where: { id: sessionId } });
        if (!session) {
          throw new PersistenceError("NOT_FOUND", `Asset import session ${sessionId} was not found`);
        }
        const state = assertSessionState(session.state);
        if (state !== "CREATED" && state !== "UPLOADING") {
          throw new PersistenceError(
            "CONFLICT",
            `Manifest registration is not allowed while the session is ${state}`
          );
        }

        if (session.manifestIdempotencyKey === request.idempotencyKey) {
          if (session.manifestFingerprint !== fingerprint) {
            throw new PersistenceError(
              "CONFLICT",
              "The manifest idempotency key was already used with a different manifest"
            );
          }
          const rows: SourceFileRow[] = [];
          for (const entry of request.files) {
            const row = await tx.assetSourceFile.findFirst({
              where: { sessionId, clientFileId: entry.clientFileId }
            });
            if (!row) {
              throw new PersistenceError(
                "DATA_INTEGRITY_ERROR",
                `Declared file ${entry.clientFileId} is missing from session ${sessionId}`
              );
            }
            rows.push(row);
          }
          return toRegisterResult(sessionId, rows);
        }

        const registeredRows: SourceFileRow[] = [];
        for (const entry of request.files) {
          const existing = await tx.assetSourceFile.findFirst({
            where: { sessionId, clientFileId: entry.clientFileId }
          });
          if (existing) {
            const consistent =
              existing.relativePath === entry.relativePath &&
              existing.byteSize === BigInt(entry.byteSize) &&
              existing.lastModifiedMs === BigInt(entry.lastModifiedMs) &&
              existing.kind === entry.kind;
            if (!consistent) {
              throw new PersistenceError(
                "CONFLICT",
                `File ${entry.clientFileId} was already declared with different metadata`
              );
            }
            registeredRows.push(existing);
            continue;
          }
          const created = await tx.assetSourceFile.create({
            data: {
              sessionId,
              clientFileId: entry.clientFileId,
              relativePath: entry.relativePath,
              byteSize: BigInt(entry.byteSize),
              lastModifiedMs: BigInt(entry.lastModifiedMs),
              kind: entry.kind,
              state: "PENDING"
            }
          });
          registeredRows.push(created);
        }

        const sessionFiles = await tx.assetSourceFile.findMany({ where: { sessionId } });
        const declaredBytes = sessionFiles.reduce((total, row) => total + (row.byteSize ?? 0n), 0n);
        await tx.assetImportSession.update({
          where: { id: sessionId },
          data: {
            state: state === "CREATED" ? "UPLOADING" : state,
            declaredFileCount: sessionFiles.length,
            declaredBytes,
            manifestIdempotencyKey: request.idempotencyKey,
            manifestFingerprint: fingerprint
          }
        });
        return toRegisterResult(sessionId, registeredRows);
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async recordUploadedFile(
    fileId: string,
    sha256: string,
    archiveKey: string,
    options: { storageProvider?: string } = {}
  ): Promise<ArchivedAssetFileResult> {
    validateIdentifierParam(fileId, "fileId");
    const hashRequest = parseContract(UploadedFileHashSchema, { sha256 }, "uploaded file");
    validateArchiveKeyValue(archiveKey);
    if (options.storageProvider !== undefined) {
      parseContract(StorageProviderFieldSchema, options, "uploaded file");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const file = await tx.assetSourceFile.findUnique({ where: { id: fileId } });
        if (!file) {
          throw new PersistenceError("NOT_FOUND", `Asset source file ${fileId} was not found`);
        }
        const fileState = assertFileState(file.state);

        if (fileState === "ARCHIVED" || fileState === "SKIPPED_DUPLICATE") {
          if (file.sha256 != null && file.sha256 !== hashRequest.sha256) {
            throw new PersistenceError(
              "CONFLICT",
              `File ${fileId} was already recorded with a different SHA-256`
            );
          }
          return {
            fileId,
            uploadStatus: fileState,
            sha256: file.sha256,
            archiveKey: file.archiveKey,
            archivedAt: file.archivedAt
          };
        }

        const duplicate = await tx.assetSourceFile.findFirst({
          where: { sessionId: file.sessionId, state: "ARCHIVED", sha256: hashRequest.sha256 }
        });
        if (duplicate && duplicate.id !== fileId) {
          const updated = await tx.assetSourceFile.update({
            where: { id: fileId },
            data: {
              state: "SKIPPED_DUPLICATE",
              sha256: hashRequest.sha256,
              archiveKey: duplicate.archiveKey,
              duplicateOfId: duplicate.id
            }
          });
          const session = await tx.assetImportSession.findUnique({ where: { id: file.sessionId } });
          if (!session) {
            throw new PersistenceError(
              "DATA_INTEGRITY_ERROR",
              `Asset import session ${file.sessionId} is missing for file ${fileId}`
            );
          }
          await tx.assetImportSession.update({
            where: { id: file.sessionId },
            data: {
              skippedFileCount: (session.skippedFileCount ?? 0) + 1,
              lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "ARCHIVED")
            }
          });
          return {
            fileId,
            uploadStatus: assertFileState(updated.state),
            sha256: updated.sha256,
            archiveKey: updated.archiveKey,
            archivedAt: updated.archivedAt
          };
        }

        const archivedAt = new Date();
        const updated = await tx.assetSourceFile.update({
          where: { id: fileId },
          data: {
            state: "ARCHIVED",
            sha256: hashRequest.sha256,
            archiveKey,
            storageProvider: options.storageProvider ?? file.storageProvider,
            archivedAt
          }
        });
        const session = await tx.assetImportSession.findUnique({ where: { id: file.sessionId } });
        if (!session) {
          throw new PersistenceError(
            "DATA_INTEGRITY_ERROR",
            `Asset import session ${file.sessionId} is missing for file ${fileId}`
          );
        }
        await tx.assetImportSession.update({
          where: { id: file.sessionId },
          data: {
            archivedFileCount: (session.archivedFileCount ?? 0) + 1,
            uploadedBytes: (session.uploadedBytes ?? 0n) + (file.byteSize ?? 0n),
            lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "ARCHIVED")
          }
        });
        return {
          fileId,
          uploadStatus: assertFileState(updated.state),
          sha256: updated.sha256,
          archiveKey: updated.archiveKey,
          archivedAt: updated.archivedAt
        };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Atomically claims the next runnable job with a PostgreSQL lease:
   * `FOR UPDATE SKIP LOCKED` inside a single UPDATE guarantees that two
   * concurrent workers can never observe the same row. A QUEUED job becomes
   * claimable once its retry backoff has elapsed, and a RUNNING job whose
   * lease expired is reclaimed by the next worker so crashed workers cannot
   * strand a job.
   */
  async claimNextJob(workerId: string, leaseUntil: Date): Promise<ClaimedAssetJob | null> {
    validateWorkerId(workerId);
    validateLeaseUntil(leaseUntil);
    const leaseToken = randomUUID();
    // TIMESTAMP(3) columns are timezone-naive and the pg adapter serialises
    // bound dates as UTC, so every timestamp in this statement must come from
    // a bound parameter: server-side now() would be rendered in the session
    // TimeZone and skew lease/retry comparisons by the UTC offset.
    const now = new Date();
    try {
      const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        UPDATE "asset_processing_jobs"
        SET "state" = 'RUNNING',
            "worker_id" = ${workerId},
            "lease_token" = ${leaseToken},
            "lease_until" = ${leaseUntil},
            "claimed_at" = ${now},
            "updated_at" = ${now}
        WHERE "id" = (
          SELECT "id" FROM "asset_processing_jobs"
          WHERE ("state" = 'QUEUED' AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now}))
             OR ("state" = 'RUNNING' AND "lease_until" IS NOT NULL AND "lease_until" < ${now})
          ORDER BY "created_at" ASC, "id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING "id", "session_id", "group_id", "job_type", "payload", "retry_count", "max_retries", "lease_until"
      `;
      const row = rows[0];
      if (!row) return null;
      const jobType = assertJobType(String(row.job_type));
      const claimedLeaseUntil = row.lease_until;
      if (!(claimedLeaseUntil instanceof Date)) {
        throw new PersistenceError("DATA_INTEGRITY_ERROR", "Claimed job lease expiry was not returned");
      }
      return {
        jobId: String(row.id),
        sessionId: String(row.session_id),
        groupId: row.group_id === null ? null : String(row.group_id),
        jobType,
        state: "RUNNING",
        payload: row.payload,
        retryCount: Number(row.retry_count),
        maxRetries: Number(row.max_retries),
        lease: { workerId, leaseToken },
        leaseUntil: claimedLeaseUntil
      };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Extends the lease only when the caller still owns it: a single
   * conditional UPDATE matches jobId + RUNNING + workerId + leaseToken +
   * unexpired leaseUntil. A restarted process reusing the same workerId but
   * holding a stale lease token (its lease expired and was reclaimed) is
   * rejected exactly like a foreign worker.
   */
  async heartbeatJob(jobId: string, lease: AssetJobLease, leaseUntil: Date): Promise<boolean> {
    validateIdentifierParam(jobId, "jobId");
    validateWorkerId(lease.workerId);
    validateIdentifierParam(lease.leaseToken, "leaseToken");
    if (!(leaseUntil instanceof Date) || Number.isNaN(leaseUntil.getTime()) || leaseUntil.getTime() <= Date.now()) {
      return false;
    }
    try {
      const result = await this.prisma.assetProcessingJob.updateMany({
        where: {
          id: jobId,
          state: "RUNNING",
          workerId: lease.workerId,
          leaseToken: lease.leaseToken,
          leaseUntil: { gt: new Date() }
        },
        data: { leaseUntil }
      });
      return result.count === 1;
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Completes a leased job with an atomic compare-and-set: the first
   * statement inside the transaction is a single conditional UPDATE matching
   * jobId + RUNNING + workerId + leaseToken + unexpired leaseUntil. Only the
   * current lease holder can flip the job to COMPLETED, and the row lock the
   * UPDATE takes protects every later write in the transaction — a stale
   * worker whose lease expired and was reclaimed sees zero affected rows and
   * the whole attempt rolls back, leaving the reclaimer's state untouched.
   */
  async completeJob(
    jobId: string,
    result: CompleteAssetJobResult,
    lease: AssetJobLease
  ): Promise<CompleteAssetJobOutcome> {
    validateIdentifierParam(jobId, "jobId");
    validateWorkerId(lease.workerId);
    validateIdentifierParam(lease.leaseToken, "leaseToken");
    const request = parseContract(CompleteAssetJobResultSchema, result, "asset job completion result");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const completedAt = new Date();
        const cas = await tx.assetProcessingJob.updateMany({
          where: {
            id: jobId,
            state: "RUNNING",
            workerId: lease.workerId,
            leaseToken: lease.leaseToken,
            leaseUntil: { gt: new Date() }
          },
          data: {
            state: "COMPLETED",
            result: toPrismaJson(request),
            completedAt,
            workerId: lease.workerId,
            leaseToken: null,
            leaseUntil: null,
            nextAttemptAt: null
          }
        });
        if (cas.count !== 1) {
          throw await this.jobLeaseNotHeld(tx, jobId);
        }

        const job = await tx.assetProcessingJob.findUnique({ where: { id: jobId } });
        if (!job) {
          throw new PersistenceError("DATA_INTEGRITY_ERROR", `Asset processing job ${jobId} vanished mid-transaction`);
        }
        const jobType = assertJobType(job.jobType);
        if (request.kind === "PROCESS_GROUP") {
          await this.applyProcessGroupResult(tx, job, request);
        } else if (request.kind !== jobType) {
          throw new PersistenceError(
            "CONFLICT",
            `Asset processing job ${jobId} is of type ${jobType}, not ${request.kind}`
          );
        }
        return { jobId, state: "COMPLETED", completedAt };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Human approval of a processed asset. Only the current, QC-passed version
   * still sitting in QC_PENDING is approvable; a single conditional UPDATE
   * decides ownership, so two operators racing on the same asset resolve to
   * one winner and one CONFLICT. Approval is the only writer of the usage
   * permission columns and of the public, content-addressed asset key — the
   * minted key is derived from the stored output digest, never from client
   * input.
   */
  async reviewProcessedAsset(
    assetId: string,
    decision: ProcessedAssetReviewDecision
  ): Promise<ProcessedAssetReviewResult> {
    validateIdentifierParam(assetId, "assetId");
    const request = parseContract(
      ProcessedAssetReviewDecisionSchema,
      decision,
      "processed asset review decision"
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const asset = await tx.processedAsset.findUnique({ where: { id: assetId } });
        if (!asset) {
          throw new PersistenceError("NOT_FOUND", `Processed asset ${assetId} was not found`);
        }
        const assetKey = `approved:${asset.outputSha256}`;
        const approvedAt = new Date();
        const cas = await tx.processedAsset.updateMany({
          where: {
            id: assetId,
            state: "QC_PENDING",
            isCurrentVersion: true,
            qcPassedAt: { not: null }
          },
          data: {
            state: "APPROVED",
            assetKey,
            approvedAt,
            usagePermission: request.usagePermission,
            rightsHolder: request.rightsHolder,
            isAuthenticPhotograph: request.isAuthenticPhotograph,
            allowPublicDisplay: request.allowPublicDisplay,
            allowCommercialUse: request.allowCommercialUse,
            allowAiTraining: request.allowAiTraining,
            allowAiRecommendation: request.allowAiRecommendation
          }
        });
        if (cas.count !== 1) {
          throw new PersistenceError(
            "CONFLICT",
            `Processed asset ${assetId} is not a current QC-passed version awaiting human review`
          );
        }
        return { assetId, state: "APPROVED" as const, assetKey, approvedAt };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Fails a leased job with the same atomic lease compare-and-set as
   * completeJob. The retry counters are read only to compute the outcome;
   * ownership is decided exclusively by the conditional UPDATE, so a stale
   * worker can neither enqueue a bogus retry nor terminally fail a job that
   * another worker already reclaimed.
   */
  async failJob(
    jobId: string,
    error: AssetJobFailure,
    retryAt: Date | null,
    lease: AssetJobLease
  ): Promise<FailAssetJobOutcome> {
    validateIdentifierParam(jobId, "jobId");
    validateWorkerId(lease.workerId);
    validateIdentifierParam(lease.leaseToken, "leaseToken");
    const failure = parseContract(AssetJobFailureSchema, error, "asset job failure");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const job = await tx.assetProcessingJob.findUnique({ where: { id: jobId } });
        if (!job) {
          throw new PersistenceError("NOT_FOUND", `Asset processing job ${jobId} was not found`);
        }
        assertJobState(job.state);

        const retryCount = job.retryCount + 1;
        const terminal = retryCount > job.maxRetries;
        const nextAttemptAt = terminal
          ? null
          : (retryAt ?? new Date(Date.now() + DEFAULT_RETRY_DELAY_MS));

        const cas = await tx.assetProcessingJob.updateMany({
          where: {
            id: jobId,
            state: "RUNNING",
            workerId: lease.workerId,
            leaseToken: lease.leaseToken,
            leaseUntil: { gt: new Date() }
          },
          data: {
            state: terminal ? "FAILED" : "QUEUED",
            retryCount,
            nextAttemptAt,
            workerId: null,
            leaseToken: null,
            leaseUntil: null,
            errorCode: failure.code,
            errorMessage: failure.message,
            failedAt: terminal ? new Date() : job.failedAt
          }
        });
        if (cas.count !== 1) {
          throw await this.jobLeaseNotHeld(tx, jobId);
        }
        return {
          jobId,
          state: terminal ? "FAILED" : "QUEUED",
          retryCount,
          maxRetries: job.maxRetries,
          nextAttemptAt
        };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Draft save guarded by a real revision compare-and-set: the first write
   * inside the transaction is a single conditional UPDATE that only matches
   * the group while `revision` still equals `expectedGroupRevision`. Two
   * concurrent saves against the same revision cannot both succeed — the
   * second transaction's UPDATE re-evaluates after the first commits and
   * finds zero rows, so it conflicts and rolls back instead of silently
   * overwriting the winner's draft.
   */
  async saveGroupDraft(groupId: string, input: SaveGroupDraftInput): Promise<SaveGroupDraftResult> {
    validateIdentifierParam(groupId, "groupId");
    const request = parseContract(SaveBeadProductDraftRequestSchema, input, "bead product draft request");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const cas = await tx.beadImageGroup.updateMany({
          where: { id: groupId, revision: request.expectedGroupRevision },
          data: { revision: request.expectedGroupRevision + 1 }
        });
        if (cas.count !== 1) {
          const current = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
          if (!current) {
            throw new PersistenceError("NOT_FOUND", `Bead image group ${groupId} was not found`);
          }
          throw new PersistenceError(
            "CONFLICT",
            `Group revision ${current.revision} does not match the expected revision ${request.expectedGroupRevision}`
          );
        }
        const group = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
        if (!group) {
          throw new PersistenceError("DATA_INTEGRITY_ERROR", `Bead image group ${groupId} vanished mid-transaction`);
        }
        const groupState = assertGroupState(group.state);
        if (groupState === "PUBLISHED") {
          throw new PersistenceError(
            "CONFLICT",
            `Bead image group ${groupId} is already published and cannot be redrafted`
          );
        }

        const existingDraft = await tx.materialProductDraft.findUnique({ where: { groupId } });

        let crystalId = existingDraft?.crystalId ?? null;
        let crystalDraftId = existingDraft?.crystalDraftId ?? null;
        if (request.crystalId !== undefined) {
          crystalId = request.crystalId;
          crystalDraftId = null;
        } else if (request.crystalDraftId !== undefined) {
          const referencedDraft = await tx.crystalDraft.findUnique({
            where: { id: request.crystalDraftId }
          });
          if (!referencedDraft) {
            throw new PersistenceError(
              "NOT_FOUND",
              `Crystal draft ${request.crystalDraftId} was not found`
            );
          }
          crystalDraftId = referencedDraft.id;
          crystalId = null;
        } else if (crystalId === null && crystalDraftId === null && request.crystalName !== undefined) {
          const createdDraft = await tx.crystalDraft.create({
            data: {
              nameCn: request.crystalName,
              mineralName: "UNSPECIFIED",
              complianceNote: PENDING_CURATION_COMPLIANCE_NOTE
            }
          });
          crystalDraftId = createdDraft.id;
        }

        const draftData = {
          crystalName: request.crystalName ?? existingDraft?.crystalName ?? null,
          crystalId,
          crystalDraftId,
          displayName: request.displayName ?? existingDraft?.displayName ?? null,
          sku: request.sku ?? existingDraft?.sku ?? null,
          materialKey: request.materialKey ?? existingDraft?.materialKey ?? null,
          shape: request.shape ?? existingDraft?.shape ?? null,
          diameterMm: request.diameterMm ?? existingDraft?.diameterMm ?? null,
          lengthAlongStringMm: request.lengthAlongStringMm ?? existingDraft?.lengthAlongStringMm ?? null,
          currency: request.currency ?? existingDraft?.currency ?? null,
          unitPriceMinor:
            request.unitPriceMinor !== undefined
              ? BigInt(request.unitPriceMinor)
              : (existingDraft?.unitPriceMinor ?? null),
          costMinor:
            request.costMinor !== undefined ? BigInt(request.costMinor) : (existingDraft?.costMinor ?? null),
          availableQuantity: request.availableQuantity ?? existingDraft?.availableQuantity ?? null,
          qualityStatement: request.qualityStatement ?? existingDraft?.qualityStatement ?? null,
          qualitySource: request.qualitySource ?? existingDraft?.qualitySource ?? null,
          textureAssetKey: request.textureAssetKey ?? existingDraft?.textureAssetKey ?? null,
          modelAssetKey: request.modelAssetKey ?? existingDraft?.modelAssetKey ?? null,
          rightsHolder: request.rightsHolder ?? existingDraft?.rightsHolder ?? null,
          usagePermission: request.usagePermission ?? existingDraft?.usagePermission ?? null,
          isAuthenticPhotograph:
            request.isAuthenticPhotograph ?? existingDraft?.isAuthenticPhotograph ?? null,
          allowAiTraining: request.allowAiTraining ?? existingDraft?.allowAiTraining ?? null,
          allowCommercialUse: request.allowCommercialUse ?? existingDraft?.allowCommercialUse ?? null,
          allowPublicDisplay: request.allowPublicDisplay ?? existingDraft?.allowPublicDisplay ?? null,
          allowAiRecommendation: request.allowAiRecommendation ?? existingDraft?.allowAiRecommendation ?? null
        };
        const draftSavedAt = new Date();
        if (existingDraft) {
          await tx.materialProductDraft.update({
            where: { groupId },
            data: { ...draftData, draftSavedAt }
          });
        } else {
          await tx.materialProductDraft.create({
            data: { groupId, ...draftData, draftSavedAt }
          });
        }

        // A reviewed group stays reviewable while its draft is edited; only
        // unreviewed groups move forward to NAMED. The revision was already
        // advanced by the compare-and-set that opened this transaction.
        const savedState = groupState === "READY" ? "READY" : "NAMED";
        await tx.beadImageGroup.update({
          where: { id: groupId },
          data: {
            state: savedState,
            crystalName: request.crystalName ?? group.crystalName,
            crystalId,
            crystalDraftId
          }
        });
        return {
          groupId,
          state: savedState,
          revision: request.expectedGroupRevision + 1,
          draftSavedAt
        };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async publishGroup(groupId: string, input: PublishAssetGroupInput): Promise<PublishAssetGroupResult> {
    validateIdentifierParam(groupId, "groupId");
    const request = parseContract(
      PublishBeadImageGroupRequestSchema,
      input,
      "bead image group publish request"
    );
    const fingerprint = publishPayloadFingerprint(request);

    const replayed = await this.replayPublication(groupId, request.idempotencyKey, fingerprint, this.prisma);
    if (replayed) return replayed;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const replayedAgain = await this.replayPublication(
          groupId,
          request.idempotencyKey,
          fingerprint,
          tx
        );
        if (replayedAgain) return replayedAgain;

        const group = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
        if (!group) {
          throw new PersistenceError("NOT_FOUND", `Bead image group ${groupId} was not found`);
        }
        const groupState = assertGroupState(group.state);
        if (group.revision !== request.expectedGroupRevision) {
          throw new PersistenceError(
            "CONFLICT",
            `Group revision ${group.revision} does not match the expected revision ${request.expectedGroupRevision}`
          );
        }
        if (groupState !== "READY") {
          throw new PersistenceError(
            "CONFLICT",
            `Bead image group ${groupId} is ${groupState}, not READY`
          );
        }

        const crystalId = await this.resolvePublishCrystal(tx, request);

        const currentAssets = (await tx.processedAsset.findMany({
          where: { groupId, isCurrentVersion: true, state: "APPROVED" }
        })) as unknown as ProcessedAssetRow[];
        if (currentAssets.length === 0) {
          throw new PersistenceError(
            "COMPLIANCE_BLOCKED",
            `Bead image group ${groupId} has no approved current asset version to publish`
          );
        }
        const textureAsset = currentAssets.find((asset) => asset.assetKey === request.textureAssetKey);
        if (!textureAsset) {
          throw new PersistenceError(
            "COMPLIANCE_BLOCKED",
            "textureAssetKey does not match an approved current asset version of the group"
          );
        }
        // Only the assets this request explicitly selects are validated and
        // published. Unrelated current assets of the group — e.g. a private
        // PREVIEW kept for internal review — never block the publication and
        // never appear in the published key set.
        const selectedAssets: ProcessedAssetRow[] = [textureAsset];
        if (request.modelAssetKey !== undefined) {
          const modelAsset = currentAssets.find((asset) => asset.assetKey === request.modelAssetKey);
          if (!modelAsset) {
            throw new PersistenceError(
              "COMPLIANCE_BLOCKED",
              "modelAssetKey does not match an approved current asset version of the group"
            );
          }
          if (modelAsset.id !== textureAsset.id) {
            selectedAssets.push(modelAsset);
          }
        }
        for (const asset of selectedAssets) {
          const permission = assertUsagePermission(asset.usagePermission);
          if (permission !== "OWNED" && permission !== "GRANTED") {
            throw new PersistenceError(
              "COMPLIANCE_BLOCKED",
              `Asset ${String(asset.assetKey)} has usage permission ${permission} and cannot be published`
            );
          }
          if (asset.allowPublicDisplay !== true) {
            throw new PersistenceError(
              "COMPLIANCE_BLOCKED",
              `Asset ${String(asset.assetKey)} is not cleared for public display`
            );
          }
          if (asset.allowCommercialUse !== true) {
            throw new PersistenceError(
              "COMPLIANCE_BLOCKED",
              `Asset ${String(asset.assetKey)} is not cleared for commercial use`
            );
          }
          if (!asset.qcPassedAt) {
            throw new PersistenceError(
              "COMPLIANCE_BLOCKED",
              `Asset ${String(asset.assetKey)} has no recorded QC pass`
            );
          }
          if (asset.assetKey !== `approved:${asset.outputSha256}`) {
            throw new PersistenceError(
              "DATA_INTEGRITY_ERROR",
              `Asset ${String(asset.assetKey)} is not content-addressed by its output digest`
            );
          }
        }

        const now = new Date();
        const product = await tx.materialProduct.create({
          data: {
            id: randomUUID(),
            crystalId,
            sku: request.sku,
            name: request.displayName,
            shape: request.shape,
            diameterMm: request.diameterMm,
            lengthAlongStringMm: request.lengthAlongStringMm ?? null,
            materialKey: request.materialKey,
            modelAssetKey: request.modelAssetKey ?? null,
            textureAssetKey: request.textureAssetKey,
            currency: request.currency,
            unitPriceMinor: BigInt(request.unitPriceMinor),
            unitCostMinor: BigInt(request.costMinor),
            active: true
          }
        });

        const snapshot = await tx.inventorySnapshot.create({
          data: {
            productType: "MATERIAL",
            productId: product.id,
            availableQuantity: request.availableQuantity,
            sourceVersion: `asset-import:${groupId}`
          }
        });

        const bindings: Array<{ asset: ProcessedAssetRow; assetKey: string }> = [
          { asset: textureAsset, assetKey: request.textureAssetKey }
        ];
        if (request.modelAssetKey !== undefined) {
          const modelAsset = currentAssets.find((asset) => asset.assetKey === request.modelAssetKey);
          if (modelAsset) bindings.push({ asset: modelAsset, assetKey: request.modelAssetKey });
        }
        for (const binding of bindings) {
          await tx.productAssetBinding.create({
            data: {
              materialProductId: product.id,
              processedAssetId: binding.asset.id,
              assetKey: binding.assetKey,
              purpose: assertEnumValue(binding.asset.purpose, ["MAIN", "TEXTURE", "MODEL", "PREVIEW"], "asset purpose"),
              bindingStatus: "APPROVED",
              allowPublicDisplay: true,
              allowCommercialUse: true,
              approvedAt: now
            }
          });
        }

        await tx.beadImageGroup.update({
          where: { id: groupId },
          data: { state: "PUBLISHED", revision: group.revision + 1 }
        });

        const session = await tx.assetImportSession.findUnique({ where: { id: group.sessionId } });
        if (!session) {
          throw new PersistenceError(
            "DATA_INTEGRITY_ERROR",
            `Asset import session ${group.sessionId} is missing for group ${groupId}`
          );
        }
        const sessionGroups = await tx.beadImageGroup.findMany({ where: { sessionId: group.sessionId } });
        const allPublished = sessionGroups.every((row) => row.id === groupId || row.state === "PUBLISHED");
        await tx.assetImportSession.update({
          where: { id: group.sessionId },
          data: allPublished
            ? {
                state: "PUBLISHED",
                lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "PUBLISHED")
              }
            : {
                state: "PUBLISHING",
                lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "REVIEWED")
              }
        });

        // Only the assets that actually received an APPROVED binding here are
        // part of the published set; unrelated group assets stay out.
        const publishedAssetKeys = [...new Set(bindings.map((binding) => binding.assetKey))].sort();
        await tx.beadGroupPublication.create({
          data: {
            groupId,
            idempotencyKey: request.idempotencyKey,
            payloadFingerprint: fingerprint,
            materialProductId: product.id,
            crystalId,
            inventorySnapshotId: snapshot.id,
            qualityStatement: request.qualityStatement,
            qualitySource: request.qualitySource,
            rightsHolder: request.rightsHolder,
            usagePermission: request.usagePermission,
            isAuthenticPhotograph: request.isAuthenticPhotograph,
            allowAiTraining: request.allowAiTraining,
            allowAiRecommendation: request.allowAiRecommendation,
            allowCommercialUse: request.allowCommercialUse,
            allowPublicDisplay: request.allowPublicDisplay,
            publishedAssetKeys,
            publishedAt: now
          }
        });

        return {
          groupId,
          state: "PUBLISHED",
          materialProductId: product.id,
          crystalId,
          inventorySnapshotId: snapshot.id,
          publishedAt: now,
          publishedAssetKeys
        };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Approved-only public asset lookup: a key resolves only when the processed
   * asset is APPROVED, public, current, and the product binding that links to
   * THIS processed asset row — carrying the same assetKey — is APPROVED,
   * public and commercial, and its MaterialProduct is still active. Bindings
   * whose processedAssetId and assetKey disagree, private bindings, and
   * inactive products never resolve; drafts, retired and private assets never
   * resolve.
   */
  async findApprovedPublicAsset(assetKey: string): Promise<ApprovedPublicAsset | null> {
    const keyRequest = parseContract(
      z.strictObject({
        assetKey: z
          .string()
          .regex(/^approved:[0-9a-f]{64}$/, "Expected a stable approved asset key of the form approved:<sha256>")
      }),
      { assetKey },
      "approved asset key"
    );

    const asset = await this.prisma.processedAsset.findFirst({
      where: {
        assetKey: keyRequest.assetKey,
        state: "APPROVED",
        allowPublicDisplay: true,
        isCurrentVersion: true
      }
    });
    if (!asset) return null;
    // The binding must point at the very processed asset row that was found
    // AND carry the same key: a binding that reuses this key for a different
    // processed asset, or points at this asset under a different key, is
    // inconsistent evidence and resolves nothing.
    const binding = await this.prisma.productAssetBinding.findFirst({
      where: {
        processedAssetId: asset.id,
        assetKey: keyRequest.assetKey,
        bindingStatus: "APPROVED",
        allowPublicDisplay: true,
        allowCommercialUse: true
      }
    });
    if (!binding) return null;
    const product = await this.prisma.materialProduct.findUnique({
      where: { id: binding.materialProductId }
    });
    if (!product || product.active !== true) return null;
    assertAssetState(asset.state);
    assertBindingStatus(binding.bindingStatus);
    if (asset.assetKey !== `approved:${asset.outputSha256}`) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Asset ${keyRequest.assetKey} is not content-addressed by its output digest`
      );
    }
    return {
      assetKey: asset.assetKey,
      outputSha256: asset.outputSha256,
      storageProvider: asset.storageProvider,
      storageKey: asset.storageKey,
      outputContentType: asset.outputContentType,
      outputBytes: asset.outputBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Explains why a lease compare-and-set matched zero rows. Called only after
   * the CAS failed, so the job either vanished (NOT_FOUND) or is leased by
   * someone else / no longer RUNNING / its lease expired (CONFLICT).
   */
  private async jobLeaseNotHeld(tx: Db, jobId: string): Promise<PersistenceError> {
    const job = await tx.assetProcessingJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return new PersistenceError("NOT_FOUND", `Asset processing job ${jobId} was not found`);
    }
    const state = assertJobState(job.state);
    return new PersistenceError(
      "CONFLICT",
      state === "RUNNING"
        ? `Asset processing job ${jobId} is leased by another worker or the lease expired`
        : `Asset processing job ${jobId} is ${state}, not RUNNING`
    );
  }

  private async replayPublication(
    groupId: string,
    idempotencyKey: string,
    fingerprint: string,
    db: Db
  ): Promise<PublishAssetGroupResult | null> {
    const byKey = await db.beadGroupPublication.findUnique({ where: { idempotencyKey } });
    if (byKey) {
      if (byKey.payloadFingerprint !== fingerprint) {
        throw new PersistenceError(
          "CONFLICT",
          "The publish idempotency key was already used with a different payload"
        );
      }
      if (byKey.groupId !== groupId) {
        throw new PersistenceError(
          "CONFLICT",
          "The publish idempotency key was already used for another group"
        );
      }
      return toPublishResult(byKey as unknown as PublicationRow);
    }
    const byGroup = await db.beadGroupPublication.findUnique({ where: { groupId } });
    if (byGroup) {
      throw new PersistenceError(
        "CONFLICT",
        `Bead image group ${groupId} was already published under a different idempotency key`
      );
    }
    return null;
  }

  private async resolvePublishCrystal(
    tx: Db,
    request: PublishBeadImageGroupRequest
  ): Promise<string> {
    if (request.crystalId !== undefined) {
      const crystal = await tx.crystal.findUnique({ where: { id: request.crystalId } });
      if (!crystal) {
        throw new PersistenceError("NOT_FOUND", `Crystal ${request.crystalId} was not found`);
      }
      return crystal.id;
    }
    const draftId = request.crystalDraftId;
    if (draftId === undefined) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        "Publish request carries neither a crystalId nor a crystalDraftId"
      );
    }
    const draft = (await tx.crystalDraft.findUnique({ where: { id: draftId } })) as unknown as
      | CrystalDraftRow
      | null;
    if (!draft) {
      throw new PersistenceError("NOT_FOUND", `Crystal draft ${draftId} was not found`);
    }
    if (draft.promotedCrystalId) return draft.promotedCrystalId;

    // Fail closed: a formal Crystal is only created from a draft a human has
    // fully curated. The accepted Contract cannot yet transmit these fields,
    // so drafts created through the current API stay unpromotable until a
    // Contract revision lands; no placeholder Crystal is ever produced.
    const missingFields: string[] = [];
    if (draft.nameCn.trim() === "") missingFields.push("nameCn");
    if (draft.nameEn === null || draft.nameEn.trim() === "") missingFields.push("nameEn");
    if (draft.mineralName.trim() === "" || draft.mineralName === "UNSPECIFIED") {
      missingFields.push("mineralName");
    }
    if (draft.colorTags.length === 0) missingFields.push("colorTags");
    if (draft.visualTags.length === 0) missingFields.push("visualTags");
    if (draft.styleTags.length === 0) missingFields.push("styleTags");
    if (draft.priceLevel === null || draft.priceLevel === undefined) missingFields.push("priceLevel");
    if (draft.complianceNote.trim() === "" || draft.complianceNote === PENDING_CURATION_COMPLIANCE_NOTE) {
      missingFields.push("complianceNote");
    }
    if (missingFields.length > 0) {
      throw new PersistenceError(
        "COMPLIANCE_BLOCKED",
        `Crystal draft ${draftId} cannot be promoted: manual curation fields are missing (${missingFields.join(", ")}). ` +
          "The accepted design contract cannot transmit these fields yet; promotion fails closed until a contract revision delivers them."
      );
    }

    const crystal = await tx.crystal.create({
      data: {
        id: randomUUID(),
        nameCn: draft.nameCn,
        nameEn: draft.nameEn!,
        mineralName: draft.mineralName,
        gemologicalInfo: toPrismaJson(draft.gemologicalInfo ?? {}),
        colorTags: [...draft.colorTags],
        visualTags: [...draft.visualTags],
        styleTags: [...draft.styleTags],
        emotionTags: [],
        cultureTags: [],
        priceLevel: draft.priceLevel!,
        complianceNote: draft.complianceNote
      }
    });
    await tx.crystalDraft.update({
      where: { id: draftId },
      data: { promotedCrystalId: crystal.id, promotedAt: new Date() }
    });
    return crystal.id;
  }

  private async applyProcessGroupResult(
    tx: Db,
    job: JobRow,
    request: Extract<CompleteAssetJobResult, { kind: "PROCESS_GROUP" }>
  ): Promise<void> {
    const groupId = job.groupId;
    if (!groupId) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Process group job ${job.id} has no group assignment`
      );
    }
    const group = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", `Bead image group ${groupId} is missing`);
    }
    const sourceFile = await tx.assetSourceFile.findUnique({
      where: { id: request.output.sourceFileId }
    });
    if (!sourceFile) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Source file ${request.output.sourceFileId} was not found`
      );
    }
    if (sourceFile.groupId !== groupId) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Source file ${request.output.sourceFileId} does not belong to group ${groupId}`
      );
    }

    const qcPassed = request.qc.passed;
    if (qcPassed) {
      await tx.processedAsset.updateMany({
        where: { groupId, purpose: request.output.purpose, isCurrentVersion: true },
        data: { isCurrentVersion: false }
      });
    }
    const now = new Date();
    await tx.processedAsset.create({
      data: {
        sourceFileId: request.output.sourceFileId,
        groupId,
        purpose: request.output.purpose,
        processingVersion: request.processingVersion,
        // A QC pass is evidence, not a verdict: the asset waits in QC_PENDING
        // until an operator approves it via reviewProcessedAsset. The neutral
        // permission defaults are written explicitly so a worker completion
        // alone can never leave an approval-shaped row behind.
        state: qcPassed ? "QC_PENDING" : "QC_FAILED",
        storageProvider: request.output.storageProvider,
        storageKey: request.output.storageKey,
        assetKey: null,
        outputSha256: request.output.outputSha256,
        outputBytes: BigInt(request.output.byteSize),
        outputContentType: request.output.outputContentType,
        widthPx: request.output.widthPx ?? null,
        heightPx: request.output.heightPx ?? null,
        processorVersion: request.output.processorVersion,
        parameters: toPrismaJson(request.output.parameters ?? {}),
        qcResult: toPrismaJson(request.qc),
        qcPassedAt: qcPassed ? now : null,
        approvedAt: null,
        usagePermission: "UNKNOWN",
        rightsHolder: null,
        isAuthenticPhotograph: false,
        allowPublicDisplay: false,
        allowCommercialUse: false,
        allowAiTraining: null,
        allowAiRecommendation: null,
        isCurrentVersion: qcPassed
      }
    });

    await tx.beadImageGroup.update({
      where: { id: groupId },
      data: { state: qcPassed ? "READY" : "QC_FAILED" }
    });

    const session = await tx.assetImportSession.findUnique({ where: { id: job.sessionId } });
    if (!session) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Asset import session ${job.sessionId} is missing for job ${job.id}`
      );
    }
    await tx.assetImportSession.update({
      where: { id: job.sessionId },
      data: {
        lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "PROCESSED")
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toRegisterResult(sessionId: string, rows: readonly SourceFileRow[]): RegisterAssetManifestResult {
  return {
    sessionId,
    registeredFileCount: rows.length,
    files: rows.map((row) => ({
      fileId: row.id,
      clientFileId: row.clientFileId,
      uploadStatus: assertFileState(row.state),
      createdAt: row.createdAt
    }))
  };
}

function toPublishResult(row: PublicationRow): PublishAssetGroupResult {
  return {
    groupId: row.groupId,
    state: "PUBLISHED",
    materialProductId: row.materialProductId,
    crystalId: row.crystalId,
    inventorySnapshotId: row.inventorySnapshotId,
    publishedAt: row.publishedAt,
    publishedAssetKeys: [...row.publishedAssetKeys]
  };
}
