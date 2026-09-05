import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";
import {
  ASSET_IMPORT_SESSION_STATES,
  ApprovedAssetKeySchema,
  AssetSourceFileKindSchema,
  CancelAssetImportSessionRequestSchema,
  CreateAssetImportSessionRequestSchema,
  ListAssetImportSessionsQuerySchema,
  PublishBeadImageGroupRequestSchema,
  ReprocessBeadImageGroupRequestSchema,
  RegisterAssetManifestRequestSchema,
  ReviewProcessedAssetRequestSchema,
  SaveBeadProductDraftRequestSchema,
  SelectProcessedVersionRequestSchema,
  Sha256Schema,
  StartAssetImportGroupingRequestSchema,
  StartAssetImportProcessingRequestSchema,
  UploadAssetFileParamsSchema,
  UpdateBeadImageGroupRequestSchema,
  UpdateCrystalDraftCurationRequestSchema,
  assetImportCheckpointRank,
  canTransitionAssetImportSession,
  missingCrystalDraftCurationFields,
  normalizeAssetRelativePath,
  type AssetImportCheckpoint,
  type AssetImportManifestFileEntry,
  type AssetImportSessionState,
  type AssetSourceFileState,
  type CancelAssetImportSessionRequest,
  type CreateAssetImportSessionRequest,
  type CrystalDraftCurationField,
  type ListAssetImportSessionsQuery,
  type PublishBeadImageGroupRequest,
  type ReprocessBeadImageGroupRequest,
  type RegisterAssetManifestRequest,
  type ReviewProcessedAssetRequest,
  type SaveBeadProductDraftRequest,
  type SelectProcessedVersionRequest,
  type StartAssetImportGroupingRequest,
  type StartAssetImportProcessingRequest,
  type UpdateBeadImageGroupRequest,
  type UpdateCrystalDraftCurationRequest,
  type UploadAssetFileParams
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

const CompleteGroupSessionJobResultSchema = z
  .strictObject({
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
  })
  .superRefine((result, context) => {
    const groupIds = new Set<string>();
    const memberIds = new Set<string>();
    result.groups.forEach((group, groupIndex) => {
      if (groupIds.has(group.groupId)) {
        context.addIssue({
          code: "custom",
          message: "GROUP_SESSION group ids must be unique",
          path: ["groups", groupIndex, "groupId"]
        });
      }
      groupIds.add(group.groupId);
      group.memberFileIds.forEach((fileId, fileIndex) => {
        if (memberIds.has(fileId)) {
          context.addIssue({
            code: "custom",
            message: "A source file may belong to only one suggested group",
            path: ["groups", groupIndex, "memberFileIds", fileIndex]
          });
        }
        memberIds.add(fileId);
      });
      if (group.primaryFileId !== undefined && !group.memberFileIds.includes(group.primaryFileId)) {
        context.addIssue({
          code: "custom",
          message: "The primary source file must belong to its suggested group",
          path: ["groups", groupIndex, "primaryFileId"]
        });
      }
    });
  });

const CompleteAssetJobResultSchema = z.discriminatedUnion("kind", [
  CompleteArchiveFileJobResultSchema,
  CompleteProcessGroupJobResultSchema,
  CompleteGroupSessionJobResultSchema
]);

const ActorIdSchema = z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH);

const EnqueueArchiveFileInputSchema = z.strictObject({
  sessionId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
  fileId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
  idempotencyKey: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
  stagingKey: z.string().trim().min(1).max(512),
  sha256: Sha256Schema
});

const EnqueuedAssetJobReplaySchema = z.strictObject({
  jobId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  jobState: z.literal("QUEUED")
});

const StartAssetImportWorkReplaySchema = z.strictObject({
  sessionId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  state: z.literal("PROCESSING"),
  queuedJobCount: z.number().int().nonnegative(),
  startedAt: z.iso.datetime()
});

const ReprocessAssetGroupReplaySchema = z.strictObject({
  groupId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  jobId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  jobState: z.literal("QUEUED"),
  processingVersion: z.number().int().positive()
});

const ProcessedAssetReviewReplaySchema = z.strictObject({
  groupId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  processedAssetId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  reviewAction: z.enum(["APPROVE", "REJECT"]),
  state: z.enum(["APPROVED", "RETIRED"]),
  revision: z.number().int().positive(),
  reviewedAt: z.iso.datetime()
});

const CrystalDraftCurationReplaySchema = z.strictObject({
  crystalDraftId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  revision: z.number().int().positive(),
  curationComplete: z.boolean(),
  missingFields: z.array(z.enum([
    "NAME_CN",
    "NAME_EN",
    "MINERAL_NAME",
    "COLOR_TAGS",
    "VISUAL_TAGS",
    "STYLE_TAGS",
    "PRICE_LEVEL",
    "COMPLIANCE_NOTE"
  ])),
  promotionEligible: z.boolean(),
  updatedAt: z.iso.datetime()
});

const CancelAssetImportSessionReplaySchema = z.strictObject({
  sessionId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  state: z.literal("CANCELLED"),
  cancelledAt: z.iso.datetime()
});

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

function operationPayloadFingerprint(value: unknown): string {
  return canonicalSha256(value);
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

function validateActorId(actorId: string): void {
  parseContract(ActorIdSchema, actorId, "asset import actor");
}

function validateStagingKey(stagingKey: string, sessionId: string): void {
  validateArchiveKeyValue(stagingKey);
  const segments = stagingKey.split("/");
  const token = segments[3];
  if (
    segments.length !== 4 ||
    segments[0] !== "imports" ||
    segments[1] !== sessionId ||
    segments[2] !== "staging" ||
    token === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
  ) {
    throw invalidParam(
      "stagingKey",
      "it must be a server-generated key for this session"
    );
  }
}

function toSafeNumber(value: bigint | number, field: string): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", `${field} is not a non-negative safe integer`);
  }
  return numberValue;
}

function parsePersistedOperationResult<T>(
  schema: z.ZodType<T>,
  input: unknown,
  label: string
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", `${label} replay result failed validation`);
  }
  return result.data;
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
  createdAt: Date;
  updatedAt: Date;
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
  storageProvider: string | null;
  duplicateOfId: string | null;
  groupId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type GroupRow = {
  id: string;
  sessionId: string;
  state: string;
  revision: number;
  crystalName: string | null;
  primaryFileId: string | null;
  similarityEvidence: unknown;
  crystalId: string | null;
  crystalDraftId: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  payload: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
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
  qcResult: unknown;
  isCurrentVersion: boolean;
  approvedAt: Date | null;
  updatedAt: Date;
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
  revision: number;
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
  updatedAt: Date;
};

type OperationRow = {
  operationType: string;
  idempotencyKey: string;
  aggregateId: string;
  payloadFingerprint: string;
  requestPayload: unknown;
  resultPayload: unknown;
  actorId: string | null;
  reviewNote: string | null;
  createdAt: Date;
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

export type ProcessedAssetReviewInput = ReviewProcessedAssetRequest;

export type ProcessedAssetReviewResult = {
  groupId: string;
  processedAssetId: string;
  reviewAction: "APPROVE" | "REJECT";
  state: "APPROVED" | "RETIRED";
  revision: number;
  reviewedAt: Date;
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
  crystalDraftId: string | null;
  crystalDraftRevision: number | null;
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

export type ResolvedAssetUploadTarget = {
  sessionId: string;
  fileId: string;
  clientFileId: string;
  relativePath: string;
  kind: "ARW" | "JPEG" | "PNG" | "WEBP";
  byteSize: number;
  state: "UPLOADING";
  declaredSha256: string | null;
};

export type EnqueueArchiveFileInput = z.infer<typeof EnqueueArchiveFileInputSchema>;

export type EnqueuedAssetJob = {
  jobId: string;
  jobState: "QUEUED";
};

export type StartAssetImportWorkResult = {
  sessionId: string;
  state: "PROCESSING";
  queuedJobCount: number;
  startedAt: Date;
};

export type ReprocessAssetGroupResult = {
  groupId: string;
  jobId: string;
  jobState: "QUEUED";
  processingVersion: number;
};

export type UpdateAssetGroupResult = {
  groupId: string;
  state: (typeof GROUP_STATES)[number];
  revision: number;
  memberFileIds: string[];
  primaryFileId?: string;
  crystalName?: string;
};

export type SelectProcessedVersionResult = {
  groupId: string;
  state: (typeof GROUP_STATES)[number];
  selectedProcessingVersion: number;
  updatedAt: Date;
};

export type GroupDraftCompletenessResult = {
  groupId: string;
  state: (typeof GROUP_STATES)[number];
  complete: boolean;
  missingFields: string[];
  checkedAt: Date;
};

export type CrystalDraftCurationResult = {
  crystalDraftId: string;
  revision: number;
  curationComplete: boolean;
  missingFields: CrystalDraftCurationField[];
  promotionEligible: boolean;
  updatedAt: Date;
};

export type CancelAssetImportSessionResult = {
  sessionId: string;
  state: "CANCELLED";
  cancelledAt: Date;
};

export type AssetImportJobView = {
  jobId: string;
  groupId: string | null;
  jobType: (typeof JOB_TYPES)[number];
  state: (typeof JOB_STATES)[number];
  retryCount: number;
  maxRetries: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type AssetImportSessionDetail = {
  sessionId: string;
  state: AssetImportSessionState;
  createdAt: Date;
  updatedAt: Date;
  lastVerifiedCheckpoint: AssetImportCheckpoint | null;
  declaredFileCount: number;
  uploadedFileCount: number;
  archivedFileCount: number;
  failedFileCount: number;
  skippedFileCount: number;
  declaredBytes: number;
  uploadedBytes: number;
  files: Array<{
    fileId: string;
    clientFileId: string;
    relativePath: string;
    kind: "ARW" | "JPEG" | "PNG" | "WEBP";
    state: AssetSourceFileState;
    byteSize: number;
    sha256?: string;
    archiveKey?: string;
    storageProvider?: string;
    groupId: string | null;
  }>;
  groups: Array<{
    groupId: string;
    state: (typeof GROUP_STATES)[number];
    memberFileIds: string[];
    primaryFileId?: string;
    crystalName?: string;
    revision: number;
    processedAssets: Array<{
      processedAssetId: string;
      processingVersion: number;
      state: (typeof ASSET_STATES)[number];
      isCurrent: boolean;
      qcPassed: boolean | null;
      qcIssues: string[];
    }>;
    crystalDraft: {
      crystalDraftId: string;
      revision: number;
      curationComplete: boolean;
      missingFields: CrystalDraftCurationField[];
      promotionEligible: boolean;
    } | null;
  }>;
  jobs: AssetImportJobView[];
};

export type ListAssetImportSessionsResult = {
  sessions: Array<{
    sessionId: string;
    state: AssetImportSessionState;
    lastVerifiedCheckpoint: AssetImportCheckpoint | null;
    declaredFileCount: number;
    archivedFileCount: number;
    failedFileCount: number;
    groupCount: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  nextCursor: string | null;
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
              state: "PENDING",
              groupId: null
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

  /** Internal orchestration projection. The Backend owns the final public DTO. */
  async getSession(sessionId: string): Promise<AssetImportSessionDetail> {
    validateIdentifierParam(sessionId, "sessionId");
    try {
      const session = (await this.prisma.assetImportSession.findUnique({
        where: { id: sessionId }
      })) as unknown as SessionRow | null;
      if (!session) {
        throw new PersistenceError("NOT_FOUND", `Asset import session ${sessionId} was not found`);
      }
      const files = (await this.prisma.assetSourceFile.findMany({
        where: { sessionId }
      })) as unknown as SourceFileRow[];
      const groups = (await this.prisma.beadImageGroup.findMany({
        where: { sessionId }
      })) as unknown as GroupRow[];
      const jobs = (await this.prisma.assetProcessingJob.findMany({
        where: { sessionId }
      })) as unknown as JobRow[];
      const assets = groups.length === 0
        ? []
        : (await this.prisma.processedAsset.findMany({
            where: { groupId: { in: groups.map((group) => group.id) } }
          })) as unknown as ProcessedAssetRow[];
      const draftIds = groups
        .map((group) => group.crystalDraftId)
        .filter((id): id is string => id !== null);
      const drafts = draftIds.length === 0
        ? []
        : (await this.prisma.crystalDraft.findMany({
            where: { id: { in: draftIds } }
          })) as unknown as CrystalDraftRow[];
      const draftProjections = new Map<string, AssetImportSessionDetail["groups"][number]["crystalDraft"]>();
      for (const draft of drafts) {
        draftProjections.set(draft.id, await this.toCrystalDraftProjection(this.prisma, draft));
      }

      const sortedFiles = [...files].sort((left, right) => compareStable(left.id, right.id));
      const sortedGroups = [...groups].sort((left, right) => compareStable(left.id, right.id));
      const sortedJobs = [...jobs].sort((left, right) => compareStable(left.id, right.id));
      return {
        sessionId: session.id,
        state: assertSessionState(session.state),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastVerifiedCheckpoint: assertCheckpoint(session.lastVerifiedCheckpoint),
        declaredFileCount: session.declaredFileCount,
        uploadedFileCount: session.archivedFileCount + session.skippedFileCount,
        archivedFileCount: session.archivedFileCount,
        failedFileCount: session.failedFileCount,
        skippedFileCount: session.skippedFileCount,
        declaredBytes: toSafeNumber(session.declaredBytes, "asset import declaredBytes"),
        uploadedBytes: toSafeNumber(session.uploadedBytes, "asset import uploadedBytes"),
        files: sortedFiles.map((file) => ({
          fileId: file.id,
          clientFileId: file.clientFileId,
          relativePath: file.relativePath,
          kind: assertEnumValue(file.kind, ["ARW", "JPEG", "PNG", "WEBP"], "asset source file kind"),
          state: assertFileState(file.state),
          byteSize: toSafeNumber(file.byteSize, "asset source file byteSize"),
          ...(file.sha256 === null ? {} : { sha256: file.sha256 }),
          ...(file.archiveKey === null ? {} : { archiveKey: file.archiveKey }),
          ...(file.storageProvider === null ? {} : { storageProvider: file.storageProvider }),
          groupId: file.groupId
        })),
        groups: await Promise.all(sortedGroups.map(async (group) => {
          const groupAssets = assets
            .filter((asset) => asset.groupId === group.id)
            .sort((left, right) =>
              left.processingVersion - right.processingVersion || compareStable(left.id, right.id)
            );
          return {
            groupId: group.id,
            state: assertGroupState(group.state),
            memberFileIds: sortedFiles.filter((file) => file.groupId === group.id).map((file) => file.id),
            ...(group.primaryFileId === null ? {} : { primaryFileId: group.primaryFileId }),
            ...(group.crystalName === null ? {} : { crystalName: group.crystalName }),
            revision: group.revision,
            processedAssets: groupAssets.map((asset) => toProcessedAssetReviewView(asset)),
            crystalDraft: group.crystalDraftId === null
              ? null
              : (draftProjections.get(group.crystalDraftId) ?? null)
          };
        })),
        jobs: sortedJobs.map((job) => ({
          jobId: job.id,
          groupId: job.groupId,
          jobType: assertJobType(job.jobType),
          state: assertJobState(job.state),
          retryCount: job.retryCount,
          maxRetries: job.maxRetries,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          completedAt: job.completedAt
        }))
      };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async listSessions(query: ListAssetImportSessionsQuery = {}): Promise<ListAssetImportSessionsResult> {
    const request = parseContract(ListAssetImportSessionsQuerySchema, query, "asset import session list query");
    try {
      const rows = (await this.prisma.assetImportSession.findMany({
        where: request.state === undefined ? {} : { state: request.state }
      })) as unknown as SessionRow[];
      const sorted = [...rows].sort((left, right) => {
        const time = right.createdAt.getTime() - left.createdAt.getTime();
        return time !== 0 ? time : compareStable(right.id, left.id);
      });
      let start = 0;
      if (request.cursor !== undefined) {
        const cursorIndex = sorted.findIndex((row) => row.id === request.cursor);
        if (cursorIndex < 0) {
          throw new PersistenceError("NOT_FOUND", `Asset import session cursor ${request.cursor} was not found`);
        }
        start = cursorIndex + 1;
      }
      const limit = request.limit ?? 20;
      const page = sorted.slice(start, start + limit);
      const groups = page.length === 0
        ? []
        : (await this.prisma.beadImageGroup.findMany({
            where: { sessionId: { in: page.map((row) => row.id) } }
          })) as unknown as GroupRow[];
      return {
        sessions: page.map((row) => ({
          sessionId: row.id,
          state: assertSessionState(row.state),
          lastVerifiedCheckpoint: assertCheckpoint(row.lastVerifiedCheckpoint),
          declaredFileCount: row.declaredFileCount,
          archivedFileCount: row.archivedFileCount,
          failedFileCount: row.failedFileCount,
          groupCount: groups.filter((group) => group.sessionId === row.id).length,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })),
        nextCursor: start + limit < sorted.length ? page.at(-1)?.id ?? null : null
      };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Resolves and reserves exactly one registered upload target. Cross-session
   * ids deliberately map to NOT_FOUND so one admin session cannot probe
   * another session's manifest. The declared byte count is authoritative.
   */
  async resolveUploadTarget(input: UploadAssetFileParams): Promise<ResolvedAssetUploadTarget> {
    const request = parseContract(UploadAssetFileParamsSchema, input, "asset upload target");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const file = (await tx.assetSourceFile.findFirst({
          where: { id: request.fileId, sessionId: request.sessionId }
        })) as unknown as SourceFileRow | null;
        if (!file) {
          throw new PersistenceError("NOT_FOUND", "The asset source file was not found in this session");
        }
        const session = await tx.assetImportSession.findUnique({ where: { id: request.sessionId } });
        if (!session) {
          throw new PersistenceError("NOT_FOUND", `Asset import session ${request.sessionId} was not found`);
        }
        const state = assertFileState(file.state);
        if (state !== "PENDING" && state !== "FAILED" && state !== "UPLOADING") {
          throw new PersistenceError("CONFLICT", `Asset source file ${request.fileId} is ${state}, not mutable`);
        }
        const byteSize = toSafeNumber(file.byteSize, "asset source file byteSize");
        if (request.contentLengthBytes !== byteSize) {
          throw new PersistenceError(
            "CONFLICT",
            `Upload length ${request.contentLengthBytes} does not match the declared ${byteSize} bytes`
          );
        }
        const kind = assertEnumValue(file.kind, ["ARW", "JPEG", "PNG", "WEBP"], "asset source file kind");
        const updated = await tx.assetSourceFile.updateMany({
          where: { id: file.id, sessionId: request.sessionId, state: { in: ["PENDING", "FAILED", "UPLOADING"] } },
          data: { state: "UPLOADING" }
        });
        if (updated.count !== 1) {
          throw new PersistenceError("CONFLICT", `Asset source file ${request.fileId} is no longer mutable`);
        }
        return {
          sessionId: request.sessionId,
          fileId: file.id,
          clientFileId: file.clientFileId,
          relativePath: file.relativePath,
          kind,
          byteSize,
          state: "UPLOADING" as const,
          declaredSha256: request.declaredSha256 ?? null
        };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async enqueueArchiveFile(input: EnqueueArchiveFileInput): Promise<EnqueuedAssetJob> {
    const request = parseContract(EnqueueArchiveFileInputSchema, input, "archive file enqueue request");
    validateStagingKey(request.stagingKey, request.sessionId);
    return this.runIdempotentOperation({
      operationType: "ENQUEUE_ARCHIVE_FILE",
      idempotencyKey: request.idempotencyKey,
      aggregateId: request.fileId,
      requestPayload: request,
      decode: (payload) => parsePersistedOperationResult(
        EnqueuedAssetJobReplaySchema,
        payload,
        "archive file enqueue"
      ),
      execute: async (tx) => {
        const file = await tx.assetSourceFile.findFirst({
          where: { id: request.fileId, sessionId: request.sessionId }
        });
        if (!file) {
          throw new PersistenceError("NOT_FOUND", "The asset source file was not found in this session");
        }
        const fileState = assertFileState(file.state);
        if (fileState !== "UPLOADING") {
          throw new PersistenceError(
            "CONFLICT",
            `Asset source file ${request.fileId} is ${fileState}, not ready for archival`
          );
        }
        const session = await tx.assetImportSession.findUnique({ where: { id: request.sessionId } });
        if (!session) {
          throw new PersistenceError("NOT_FOUND", `Asset import session ${request.sessionId} was not found`);
        }
        const sessionState = assertSessionState(session.state);
        if (sessionState !== "UPLOADING" && sessionState !== "ARCHIVING") {
          throw new PersistenceError(
            "CONFLICT",
            `Archival cannot be queued while session ${request.sessionId} is ${sessionState}`
          );
        }
        const job = await tx.assetProcessingJob.create({
          data: {
            sessionId: request.sessionId,
            groupId: null,
            jobType: "ARCHIVE_FILE",
            state: "QUEUED",
            payload: toPrismaJson({
              fileId: request.fileId,
              stagingKey: request.stagingKey,
              sha256: request.sha256
            }),
            maxRetries: 3
          }
        });
        if (sessionState === "UPLOADING") {
          await tx.assetImportSession.update({
            where: { id: request.sessionId },
            data: { state: "ARCHIVING" }
          });
        }
        const result = { jobId: job.id, jobState: "QUEUED" as const };
        return { value: result, persistedResult: result };
      }
    });
  }

  async startGrouping(
    sessionId: string,
    input: StartAssetImportGroupingRequest
  ): Promise<StartAssetImportWorkResult> {
    validateIdentifierParam(sessionId, "sessionId");
    const request = parseContract(
      StartAssetImportGroupingRequestSchema,
      input,
      "asset grouping start request"
    );
    return this.runIdempotentOperation({
      operationType: "START_GROUPING",
      idempotencyKey: request.idempotencyKey,
      aggregateId: sessionId,
      requestPayload: request,
      decode: (payload) => {
        const stored = parsePersistedOperationResult(
          StartAssetImportWorkReplaySchema,
          payload,
          "asset grouping start"
        );
        return { ...stored, startedAt: new Date(stored.startedAt) };
      },
      execute: async (tx) => {
        const session = await tx.assetImportSession.findUnique({ where: { id: sessionId } });
        if (!session) {
          throw new PersistenceError("NOT_FOUND", `Asset import session ${sessionId} was not found`);
        }
        const state = assertSessionState(session.state);
        if (state !== "ARCHIVING") {
          throw new PersistenceError(
            "CONFLICT",
            `Grouping cannot start while asset import session ${sessionId} is ${state}`
          );
        }
        const files = (await tx.assetSourceFile.findMany({ where: { sessionId } })) as unknown as SourceFileRow[];
        if (files.length === 0) {
          throw new PersistenceError("CONFLICT", "Grouping requires at least one registered source file");
        }
        const incomplete = files.find((file) => {
          const fileState = assertFileState(file.state);
          return fileState !== "ARCHIVED" && fileState !== "SKIPPED_DUPLICATE";
        });
        if (incomplete) {
          throw new PersistenceError(
            "CONFLICT",
            `Source file ${incomplete.id} is not archive-verified`
          );
        }
        const archived = files.filter((file) => assertFileState(file.state) === "ARCHIVED");
        if (archived.length === 0) {
          throw new PersistenceError("CONFLICT", "Grouping requires at least one unique archived source file");
        }
        const payloadFiles = archived
          .sort((left, right) => compareStable(left.id, right.id))
          .map((file) => {
            if (!file.sha256 || !file.archiveKey || file.lastModifiedMs === null) {
              throw new PersistenceError(
                "DATA_INTEGRITY_ERROR",
                `Archived source file ${file.id} is missing verified grouping metadata`
              );
            }
            return {
              fileId: file.id,
              clientFileId: file.clientFileId,
              relativePath: file.relativePath,
              sha256: file.sha256,
              archiveKey: file.archiveKey,
              byteSize: toSafeNumber(file.byteSize, "asset source file byteSize"),
              lastModifiedMs: toSafeNumber(file.lastModifiedMs, "asset source file lastModifiedMs"),
              kind: assertEnumValue(file.kind, ["ARW", "JPEG", "PNG", "WEBP"], "asset source file kind")
            };
          });
        await tx.assetProcessingJob.create({
          data: {
            sessionId,
            groupId: null,
            jobType: "GROUP_SESSION",
            state: "QUEUED",
            payload: toPrismaJson({ files: payloadFiles }),
            maxRetries: 3
          }
        });
        const startedAt = new Date();
        await tx.assetImportSession.update({
          where: { id: sessionId },
          data: { state: "PROCESSING" }
        });
        const value = {
          sessionId,
          state: "PROCESSING" as const,
          queuedJobCount: 1,
          startedAt
        };
        return { value, persistedResult: { ...value, startedAt: startedAt.toISOString() } };
      }
    });
  }

  async startProcessing(
    sessionId: string,
    input: StartAssetImportProcessingRequest
  ): Promise<StartAssetImportWorkResult> {
    validateIdentifierParam(sessionId, "sessionId");
    const request = parseContract(
      StartAssetImportProcessingRequestSchema,
      input,
      "asset processing start request"
    );
    return this.runIdempotentOperation({
      operationType: "START_PROCESSING",
      idempotencyKey: request.idempotencyKey,
      aggregateId: sessionId,
      requestPayload: request,
      decode: (payload) => {
        const stored = parsePersistedOperationResult(
          StartAssetImportWorkReplaySchema,
          payload,
          "asset processing start"
        );
        return { ...stored, startedAt: new Date(stored.startedAt) };
      },
      execute: async (tx) => {
        const session = await tx.assetImportSession.findUnique({ where: { id: sessionId } });
        if (!session) {
          throw new PersistenceError("NOT_FOUND", `Asset import session ${sessionId} was not found`);
        }
        const state = assertSessionState(session.state);
        if (state !== "NEEDS_REVIEW" && state !== "PARTIALLY_FAILED") {
          throw new PersistenceError(
            "CONFLICT",
            `Processing cannot start while asset import session ${sessionId} is ${state}`
          );
        }
        const activeJobs = await tx.assetProcessingJob.findMany({
          where: { sessionId, jobType: "PROCESS_GROUP", state: { in: ["QUEUED", "RUNNING"] } }
        });
        if (activeJobs.length > 0) {
          throw new PersistenceError("CONFLICT", "The session already has active processing jobs");
        }
        const groups = (await tx.beadImageGroup.findMany({ where: { sessionId } })) as unknown as GroupRow[];
        const eligible = groups.filter((group) => {
          const groupState = assertGroupState(group.state);
          return groupState === "CONFIRMED" || groupState === "NAMED" || groupState === "QC_FAILED";
        });
        if (eligible.length === 0) {
          throw new PersistenceError("CONFLICT", "No confirmed or named group is ready for processing");
        }
        for (const group of eligible.sort((left, right) => compareStable(left.id, right.id))) {
          const groupFiles = (await tx.assetSourceFile.findMany({
            where: { sessionId, groupId: group.id, state: "ARCHIVED" }
          })) as unknown as SourceFileRow[];
          if (groupFiles.length === 0) {
            throw new PersistenceError("CONFLICT", `Bead image group ${group.id} has no archived source file`);
          }
          const assets = (await tx.processedAsset.findMany({ where: { groupId: group.id } })) as unknown as ProcessedAssetRow[];
          const processingVersion = assets.reduce(
            (maximum, asset) => Math.max(maximum, asset.processingVersion),
            0
          ) + 1;
          const payloadFiles = groupFiles
            .sort((left, right) => compareStable(left.id, right.id))
            .map((file) => {
              if (!file.sha256 || !file.archiveKey) {
                throw new PersistenceError(
                  "DATA_INTEGRITY_ERROR",
                  `Archived source file ${file.id} is missing verified processing metadata`
                );
              }
              return { fileId: file.id, archiveKey: file.archiveKey, sha256: file.sha256 };
            });
          if (group.primaryFileId !== null && !groupFiles.some((file) => file.id === group.primaryFileId)) {
            throw new PersistenceError(
              "DATA_INTEGRITY_ERROR",
              `Primary source file ${group.primaryFileId} is not an archived member of group ${group.id}`
            );
          }
          await tx.assetProcessingJob.create({
            data: {
              sessionId,
              groupId: group.id,
              jobType: "PROCESS_GROUP",
              state: "QUEUED",
              payload: toPrismaJson({
                groupId: group.id,
                processingVersion,
                ...(group.primaryFileId === null ? {} : { primaryFileId: group.primaryFileId }),
                files: payloadFiles
              }),
              maxRetries: 3
            }
          });
          await tx.beadImageGroup.update({
            where: { id: group.id },
            data: { state: "PROCESSED" }
          });
        }
        const startedAt = new Date();
        await tx.assetImportSession.update({
          where: { id: sessionId },
          data: { state: "PROCESSING" }
        });
        const value = {
          sessionId,
          state: "PROCESSING" as const,
          queuedJobCount: eligible.length,
          startedAt
        };
        return { value, persistedResult: { ...value, startedAt: startedAt.toISOString() } };
      }
    });
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
              ...((session.archivedFileCount ?? 0) + (session.skippedFileCount ?? 0) + 1 ===
              session.declaredFileCount
                ? {
                    state: "ARCHIVING",
                    lastVerifiedCheckpoint: advanceCheckpoint(
                      session.lastVerifiedCheckpoint,
                      "ARCHIVED"
                    )
                  }
                : {})
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
            ...((session.archivedFileCount ?? 0) + 1 + (session.skippedFileCount ?? 0) ===
            session.declaredFileCount
              ? {
                  state: "ARCHIVING",
                  lastVerifiedCheckpoint: advanceCheckpoint(
                    session.lastVerifiedCheckpoint,
                    "ARCHIVED"
                  )
                }
              : {})
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
        } else if (request.kind === "GROUP_SESSION") {
          await this.applyGroupSessionResult(tx, job, request);
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
   * Contract-owned, idempotent human review. Approval alone mints the public
   * content key; rejection retires the reviewed output and cannot write any
   * permission grant. The group revision CAS and immutable audit operation
   * are committed in the same transaction.
   */
  async reviewProcessedAsset(
    groupId: string,
    assetId: string,
    input: ProcessedAssetReviewInput,
    actorId: string
  ): Promise<ProcessedAssetReviewResult> {
    validateIdentifierParam(groupId, "groupId");
    validateIdentifierParam(assetId, "assetId");
    validateActorId(actorId);
    const request = parseContract(
      ReviewProcessedAssetRequestSchema,
      input,
      "processed asset review request"
    );
    if (request.processedAssetId !== assetId) {
      throw new PersistenceError(
        "CONFLICT",
        "The processed asset route id does not match the reviewed request"
      );
    }
    return this.runIdempotentOperation({
      operationType: "REVIEW_PROCESSED_ASSET",
      idempotencyKey: request.idempotencyKey,
      aggregateId: assetId,
      requestPayload: request,
      actorId,
      reviewNote: request.reviewNote,
      decode: (payload) => {
        const stored = parsePersistedOperationResult(
          ProcessedAssetReviewReplaySchema,
          payload,
          "processed asset review"
        );
        return { ...stored, reviewedAt: new Date(stored.reviewedAt) };
      },
      execute: async (tx) => {
        const groupCas = await tx.beadImageGroup.updateMany({
          where: { id: groupId, revision: request.expectedGroupRevision },
          data: { revision: request.expectedGroupRevision + 1 }
        });
        if (groupCas.count !== 1) {
          const group = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
          if (!group) {
            throw new PersistenceError("NOT_FOUND", `Bead image group ${groupId} was not found`);
          }
          throw new PersistenceError(
            "CONFLICT",
            `Group revision ${group.revision} does not match the expected revision ${request.expectedGroupRevision}`
          );
        }
        const asset = await tx.processedAsset.findFirst({ where: { id: assetId, groupId } });
        if (!asset) {
          throw new PersistenceError("NOT_FOUND", "The processed asset was not found in this group");
        }
        const reviewedAt = new Date();
        if (request.action === "APPROVE") {
          const assetKey = `approved:${asset.outputSha256}`;
          const assetCas = await tx.processedAsset.updateMany({
            where: {
              id: assetId,
              groupId,
              state: "QC_PENDING",
              isCurrentVersion: true,
              qcPassedAt: { not: null }
            },
            data: {
              state: "APPROVED",
              assetKey,
              approvedAt: reviewedAt,
              usagePermission: request.usagePermission,
              rightsHolder: request.rightsHolder,
              isAuthenticPhotograph: request.isAuthenticPhotograph,
              allowPublicDisplay: request.allowPublicDisplay,
              allowCommercialUse: request.allowCommercialUse,
              allowAiTraining: request.allowAiTraining,
              allowAiRecommendation: request.allowAiRecommendation
            }
          });
          if (assetCas.count !== 1) {
            throw new PersistenceError(
              "CONFLICT",
              `Processed asset ${assetId} is not a current QC-passed version awaiting approval`
            );
          }
          await tx.beadImageGroup.update({
            where: { id: groupId },
            data: { state: "READY" }
          });
        } else {
          const assetState = assertAssetState(asset.state);
          if (assetState !== "QC_PENDING" && assetState !== "QC_FAILED") {
            throw new PersistenceError(
              "CONFLICT",
              `Processed asset ${assetId} is ${assetState}, not eligible for rejection`
            );
          }
          const assetCas = await tx.processedAsset.updateMany({
            where: { id: assetId, groupId, state: { in: ["QC_PENDING", "QC_FAILED"] } },
            data: {
              state: "RETIRED",
              assetKey: null,
              approvedAt: null,
              usagePermission: "UNKNOWN",
              rightsHolder: null,
              isAuthenticPhotograph: false,
              allowPublicDisplay: false,
              allowCommercialUse: false,
              allowAiTraining: null,
              allowAiRecommendation: null,
              isCurrentVersion: false
            }
          });
          if (assetCas.count !== 1) {
            throw new PersistenceError("CONFLICT", `Processed asset ${assetId} changed during review`);
          }
          await tx.beadImageGroup.update({ where: { id: groupId }, data: { state: "QC_FAILED" } });
        }

        const group = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
        if (!group) {
          throw new PersistenceError("DATA_INTEGRITY_ERROR", `Bead image group ${groupId} vanished during review`);
        }
        const session = await tx.assetImportSession.findUnique({ where: { id: group.sessionId } });
        if (!session) {
          throw new PersistenceError(
            "DATA_INTEGRITY_ERROR",
            `Asset import session ${group.sessionId} is missing for group ${groupId}`
          );
        }
        await tx.assetImportSession.update({
          where: { id: group.sessionId },
          data: {
            state: "NEEDS_REVIEW",
            lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "REVIEWED")
          }
        });
        const value = {
          groupId,
          processedAssetId: assetId,
          reviewAction: request.action,
          state: request.action === "APPROVE" ? "APPROVED" as const : "RETIRED" as const,
          revision: request.expectedGroupRevision + 1,
          reviewedAt
        };
        return {
          value,
          persistedResult: { ...value, reviewedAt: reviewedAt.toISOString() }
        };
      }
    });
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

  async updateGroup(groupId: string, input: UpdateBeadImageGroupRequest): Promise<UpdateAssetGroupResult> {
    validateIdentifierParam(groupId, "groupId");
    const request = parseContract(UpdateBeadImageGroupRequestSchema, input, "bead image group update");
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cas = await tx.beadImageGroup.updateMany({
          where: { id: groupId, revision: request.expectedGroupRevision },
          data: { revision: request.expectedGroupRevision + 1 }
        });
        if (cas.count !== 1) {
          throw await this.groupRevisionNotHeld(tx, groupId, request.expectedGroupRevision);
        }
        const group = (await tx.beadImageGroup.findUnique({ where: { id: groupId } })) as unknown as GroupRow | null;
        if (!group) {
          throw new PersistenceError("DATA_INTEGRITY_ERROR", `Bead image group ${groupId} vanished during update`);
        }
        const state = assertGroupState(group.state);
        if (state === "PUBLISHED") {
          throw new PersistenceError("CONFLICT", `Published group ${groupId} cannot be edited`);
        }
        const members = (await tx.assetSourceFile.findMany({ where: { groupId } })) as unknown as SourceFileRow[];
        const memberIds = new Set(members.map((file) => file.id));

        if (request.action === "SET_NAME") {
          await tx.beadImageGroup.update({
            where: { id: groupId },
            data: { crystalName: request.crystalName, state: "NAMED" }
          });
          const session = await tx.assetImportSession.findUnique({ where: { id: group.sessionId } });
          if (!session) {
            throw new PersistenceError("DATA_INTEGRITY_ERROR", `Session ${group.sessionId} is missing`);
          }
          await tx.assetImportSession.update({
            where: { id: group.sessionId },
            data: { lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "LABELED") }
          });
        } else if (request.action === "SET_PRIMARY") {
          if (!memberIds.has(request.primaryFileId)) {
            throw new PersistenceError(
              "CONFLICT",
              `Primary source file ${request.primaryFileId} is not a member of group ${groupId}`
            );
          }
          const primary = members.find((file) => file.id === request.primaryFileId)!;
          if (assertFileState(primary.state) !== "ARCHIVED") {
            throw new PersistenceError("CONFLICT", "Only an archived source file can be primary");
          }
          await tx.beadImageGroup.update({
            where: { id: groupId },
            data: { primaryFileId: request.primaryFileId, state: state === "SUGGESTED" ? "CONFIRMED" : state }
          });
        } else if (request.action === "IGNORE_FILES") {
          const requested = new Set(request.fileIds);
          if (requested.size !== request.fileIds.length || request.fileIds.some((id) => !memberIds.has(id))) {
            throw new PersistenceError("CONFLICT", "Ignored files must be unique members of the edited group");
          }
          if (members.length - requested.size < 1) {
            throw new PersistenceError("CONFLICT", "Ignoring files cannot leave a persisted group empty");
          }
          await tx.assetSourceFile.updateMany({
            where: { id: { in: request.fileIds }, groupId },
            data: { groupId: null }
          });
          if (group.primaryFileId !== null && requested.has(group.primaryFileId)) {
            await tx.beadImageGroup.update({ where: { id: groupId }, data: { primaryFileId: null } });
          }
        } else if (request.action === "MOVE_FILES") {
          const requested = new Set(request.fileIds);
          if (request.targetGroupId === groupId) {
            throw new PersistenceError("CONFLICT", "Files must move to a different group");
          }
          if (members.length - requested.size < 1 || request.fileIds.some((id) => !memberIds.has(id))) {
            throw new PersistenceError(
              "CONFLICT",
              "Moved files must be current members and cannot leave the source group empty"
            );
          }
          const target = (await tx.beadImageGroup.findUnique({
            where: { id: request.targetGroupId }
          })) as unknown as GroupRow | null;
          if (!target || target.sessionId !== group.sessionId) {
            throw new PersistenceError("NOT_FOUND", "The target group was not found in this session");
          }
          if (assertGroupState(target.state) === "PUBLISHED") {
            throw new PersistenceError("CONFLICT", "Files cannot move into a published group");
          }
          const targetCas = await tx.beadImageGroup.updateMany({
            where: { id: target.id, revision: target.revision },
            data: { revision: target.revision + 1 }
          });
          if (targetCas.count !== 1) {
            throw new PersistenceError("CONFLICT", "The target group changed during the move");
          }
          await tx.assetSourceFile.updateMany({
            where: { id: { in: request.fileIds }, groupId },
            data: { groupId: target.id }
          });
          if (group.primaryFileId !== null && requested.has(group.primaryFileId)) {
            await tx.beadImageGroup.update({ where: { id: groupId }, data: { primaryFileId: null } });
          }
        } else if (request.action === "MERGE_GROUPS") {
          const sourceIds = [...new Set(request.sourceGroupIds)];
          if (sourceIds.length !== request.sourceGroupIds.length || !sourceIds.includes(groupId)) {
            throw new PersistenceError(
              "CONFLICT",
              "MERGE_GROUPS must name each source once and include the route group"
            );
          }
          for (const sourceId of sourceIds.sort(compareStable)) {
            if (sourceId === groupId) continue;
            const source = (await tx.beadImageGroup.findUnique({ where: { id: sourceId } })) as unknown as GroupRow | null;
            if (!source || source.sessionId !== group.sessionId) {
              throw new PersistenceError("NOT_FOUND", `Merge source group ${sourceId} was not found in this session`);
            }
            if (assertGroupState(source.state) === "PUBLISHED") {
              throw new PersistenceError("CONFLICT", `Published group ${sourceId} cannot be merged`);
            }
            const attachedAssets = await tx.processedAsset.findMany({ where: { groupId: sourceId } });
            const attachedJobs = await tx.assetProcessingJob.findMany({ where: { groupId: sourceId } });
            const attachedDraft = await tx.materialProductDraft.findUnique({ where: { groupId: sourceId } });
            if (attachedAssets.length > 0 || attachedJobs.length > 0 || attachedDraft) {
              throw new PersistenceError(
                "CONFLICT",
                `Group ${sourceId} has downstream records and cannot be destructively merged`
              );
            }
            await tx.assetSourceFile.updateMany({ where: { groupId: sourceId }, data: { groupId } });
            await tx.beadImageGroup.deleteMany({ where: { id: sourceId } });
          }
          await tx.beadImageGroup.update({
            where: { id: groupId },
            data: { state: state === "SUGGESTED" ? "CONFIRMED" : state }
          });
        } else if (request.action === "SPLIT_GROUP") {
          const flattened = request.partitions.flat();
          if (
            flattened.length !== memberIds.size ||
            flattened.some((id) => !memberIds.has(id)) ||
            new Set(flattened).size !== flattened.length
          ) {
            throw new PersistenceError("CONFLICT", "Split partitions must exactly cover current group membership");
          }
          const [retained, ...createdPartitions] = request.partitions;
          if (!retained) {
            throw new PersistenceError("DATA_INTEGRITY_ERROR", "Split request has no retained partition");
          }
          for (const partition of createdPartitions) {
            const created = await tx.beadImageGroup.create({
              data: {
                id: randomUUID(),
                sessionId: group.sessionId,
                state: "CONFIRMED",
                revision: 1,
                primaryFileId: partition[0] ?? null,
                similarityEvidence: toPrismaJson({ source: "HUMAN_SPLIT", fromGroupId: groupId })
              }
            });
            await tx.assetSourceFile.updateMany({
              where: { id: { in: partition }, groupId },
              data: { groupId: created.id }
            });
          }
          await tx.beadImageGroup.update({
            where: { id: groupId },
            data: {
              state: "CONFIRMED",
              primaryFileId:
                group.primaryFileId !== null && retained.includes(group.primaryFileId)
                  ? group.primaryFileId
                  : retained[0] ?? null
            }
          });
        }
        return this.toGroupUpdateResult(tx, groupId);
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async reprocessGroup(
    groupId: string,
    input: ReprocessBeadImageGroupRequest
  ): Promise<ReprocessAssetGroupResult> {
    validateIdentifierParam(groupId, "groupId");
    const request = parseContract(ReprocessBeadImageGroupRequestSchema, input, "bead image group reprocess request");
    return this.runIdempotentOperation({
      operationType: "REPROCESS_GROUP",
      idempotencyKey: request.idempotencyKey,
      aggregateId: groupId,
      requestPayload: request,
      decode: (payload) => parsePersistedOperationResult(
        ReprocessAssetGroupReplaySchema,
        payload,
        "bead image group reprocess"
      ),
      execute: async (tx) => {
        const cas = await tx.beadImageGroup.updateMany({
          where: {
            id: groupId,
            revision: request.expectedGroupRevision,
            state: { not: "PUBLISHED" }
          },
          data: { revision: request.expectedGroupRevision + 1, state: "PROCESSED" }
        });
        if (cas.count !== 1) {
          throw await this.groupRevisionNotHeld(tx, groupId, request.expectedGroupRevision);
        }
        const group = (await tx.beadImageGroup.findUnique({ where: { id: groupId } })) as unknown as GroupRow | null;
        if (!group) {
          throw new PersistenceError("DATA_INTEGRITY_ERROR", `Bead image group ${groupId} vanished`);
        }
        assertGroupState(group.state);
        const active = await tx.assetProcessingJob.findMany({
          where: { groupId, jobType: "PROCESS_GROUP", state: { in: ["QUEUED", "RUNNING"] } }
        });
        if (active.length > 0) {
          throw new PersistenceError("CONFLICT", `Bead image group ${groupId} already has active processing work`);
        }
        const files = (await tx.assetSourceFile.findMany({
          where: { groupId, sessionId: group.sessionId, state: "ARCHIVED" }
        })) as unknown as SourceFileRow[];
        if (files.length === 0) {
          throw new PersistenceError("CONFLICT", `Bead image group ${groupId} has no archived source file`);
        }
        const assets = (await tx.processedAsset.findMany({ where: { groupId } })) as unknown as ProcessedAssetRow[];
        const processingVersion = assets.reduce(
          (maximum, asset) => Math.max(maximum, asset.processingVersion),
          0
        ) + 1;
        const payloadFiles = files.sort((left, right) => compareStable(left.id, right.id)).map((file) => {
          if (!file.sha256 || !file.archiveKey) {
            throw new PersistenceError("DATA_INTEGRITY_ERROR", `Source file ${file.id} lacks archive evidence`);
          }
          return { fileId: file.id, archiveKey: file.archiveKey, sha256: file.sha256 };
        });
        const job = await tx.assetProcessingJob.create({
          data: {
            sessionId: group.sessionId,
            groupId,
            jobType: "PROCESS_GROUP",
            state: "QUEUED",
            payload: toPrismaJson({
              groupId,
              processingVersion,
              ...(group.primaryFileId === null ? {} : { primaryFileId: group.primaryFileId }),
              files: payloadFiles,
              ...(request.settings === undefined ? {} : { settings: request.settings })
            }),
            maxRetries: 3
          }
        });
        await tx.assetImportSession.update({ where: { id: group.sessionId }, data: { state: "PROCESSING" } });
        const value = { groupId, jobId: job.id, jobState: "QUEUED" as const, processingVersion };
        return { value, persistedResult: value };
      }
    });
  }

  async selectProcessedVersion(
    groupId: string,
    input: SelectProcessedVersionRequest
  ): Promise<SelectProcessedVersionResult> {
    validateIdentifierParam(groupId, "groupId");
    const request = parseContract(
      SelectProcessedVersionRequestSchema,
      input,
      "processed asset version selection"
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cas = await tx.beadImageGroup.updateMany({
          where: { id: groupId, revision: request.expectedGroupRevision },
          data: { revision: request.expectedGroupRevision + 1 }
        });
        if (cas.count !== 1) {
          throw await this.groupRevisionNotHeld(tx, groupId, request.expectedGroupRevision);
        }
        const group = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
        if (!group) {
          throw new PersistenceError("DATA_INTEGRITY_ERROR", `Bead image group ${groupId} vanished`);
        }
        if (assertGroupState(group.state) === "PUBLISHED") {
          throw new PersistenceError("CONFLICT", "Published groups cannot change processed version");
        }
        const selected = await tx.processedAsset.findMany({
          where: { groupId, processingVersion: request.processingVersion }
        });
        if (selected.length !== 1) {
          throw new PersistenceError(
            selected.length === 0 ? "NOT_FOUND" : "DATA_INTEGRITY_ERROR",
            `Processing version ${request.processingVersion} must identify exactly one group asset`
          );
        }
        await tx.processedAsset.updateMany({
          where: { groupId, isCurrentVersion: true },
          data: { isCurrentVersion: false }
        });
        await tx.processedAsset.update({
          where: { id: selected[0]!.id },
          data: { isCurrentVersion: true }
        });
        const updatedAt = new Date();
        await tx.beadImageGroup.update({ where: { id: groupId }, data: { state: "PROCESSED", updatedAt } });
        return {
          groupId,
          state: "PROCESSED",
          selectedProcessingVersion: request.processingVersion,
          updatedAt
        };
      });
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async updateCrystalDraft(
    crystalDraftId: string,
    input: UpdateCrystalDraftCurationRequest,
    actorId: string
  ): Promise<CrystalDraftCurationResult> {
    validateIdentifierParam(crystalDraftId, "crystalDraftId");
    validateActorId(actorId);
    const request = parseContract(
      UpdateCrystalDraftCurationRequestSchema,
      input,
      "crystal draft curation request"
    );
    return this.runIdempotentOperation({
      operationType: "CURATE_CRYSTAL_DRAFT",
      idempotencyKey: request.idempotencyKey,
      aggregateId: crystalDraftId,
      requestPayload: request,
      actorId,
      decode: (payload) => {
        const stored = parsePersistedOperationResult(
          CrystalDraftCurationReplaySchema,
          payload,
          "crystal draft curation"
        );
        return { ...stored, updatedAt: new Date(stored.updatedAt) };
      },
      execute: async (tx) => {
        const updatedAt = new Date();
        const { idempotencyKey, expectedRevision, ...curation } = request;
        void idempotencyKey;
        const cas = await tx.crystalDraft.updateMany({
          where: { id: crystalDraftId, revision: expectedRevision, promotedCrystalId: null },
          data: { ...curation, revision: expectedRevision + 1, updatedAt }
        });
        if (cas.count !== 1) {
          const current = await tx.crystalDraft.findUnique({ where: { id: crystalDraftId } });
          if (!current) {
            throw new PersistenceError("NOT_FOUND", `Crystal draft ${crystalDraftId} was not found`);
          }
          if (current.promotedCrystalId) {
            throw new PersistenceError("CONFLICT", `Crystal draft ${crystalDraftId} is already promoted`);
          }
          throw new PersistenceError(
            "CONFLICT",
            `Crystal draft revision ${current.revision} does not match expected revision ${expectedRevision}`
          );
        }
        const draft = (await tx.crystalDraft.findUnique({ where: { id: crystalDraftId } })) as unknown as CrystalDraftRow | null;
        if (!draft) {
          throw new PersistenceError("DATA_INTEGRITY_ERROR", `Crystal draft ${crystalDraftId} vanished`);
        }
        const projection = await this.toCrystalDraftProjection(tx, draft);
        const value = { ...projection, updatedAt };
        return { value, persistedResult: { ...value, updatedAt: updatedAt.toISOString() } };
      }
    });
  }

  async cancelSession(
    sessionId: string,
    input: CancelAssetImportSessionRequest,
    actorId: string
  ): Promise<CancelAssetImportSessionResult> {
    validateIdentifierParam(sessionId, "sessionId");
    validateActorId(actorId);
    const request = parseContract(
      CancelAssetImportSessionRequestSchema,
      input,
      "asset import cancellation request"
    );
    return this.runIdempotentOperation({
      operationType: "CANCEL_SESSION",
      idempotencyKey: request.idempotencyKey,
      aggregateId: sessionId,
      requestPayload: request,
      actorId,
      decode: (payload) => {
        const stored = parsePersistedOperationResult(
          CancelAssetImportSessionReplaySchema,
          payload,
          "asset import cancellation"
        );
        return { ...stored, cancelledAt: new Date(stored.cancelledAt) };
      },
      execute: async (tx) => {
        const session = await tx.assetImportSession.findUnique({ where: { id: sessionId } });
        if (!session) {
          throw new PersistenceError("NOT_FOUND", `Asset import session ${sessionId} was not found`);
        }
        const state = assertSessionState(session.state);
        if (!canTransitionAssetImportSession(state, "CANCELLED")) {
          throw new PersistenceError("CONFLICT", `Asset import session ${sessionId} is terminal in ${state}`);
        }
        const cancelledAt = new Date();
        await tx.assetImportSession.update({
          where: { id: sessionId },
          data: { state: "CANCELLED", updatedAt: cancelledAt }
        });
        await tx.assetProcessingJob.updateMany({
          where: { sessionId, state: { in: ["QUEUED", "RUNNING"] } },
          data: {
            state: "FAILED",
            workerId: null,
            leaseToken: null,
            leaseUntil: null,
            nextAttemptAt: null,
            errorCode: "SESSION_CANCELLED",
            errorMessage: "The owning asset import session was cancelled",
            failedAt: cancelledAt
          }
        });
        const value = { sessionId, state: "CANCELLED" as const, cancelledAt };
        return { value, persistedResult: { ...value, cancelledAt: cancelledAt.toISOString() } };
      }
    });
  }

  async checkGroupDraftCompleteness(groupId: string): Promise<GroupDraftCompletenessResult> {
    validateIdentifierParam(groupId, "groupId");
    try {
      const group = await this.prisma.beadImageGroup.findUnique({ where: { id: groupId } });
      if (!group) {
        throw new PersistenceError("NOT_FOUND", `Bead image group ${groupId} was not found`);
      }
      const draft = (await this.prisma.materialProductDraft.findUnique({
        where: { groupId }
      })) as unknown as ProductDraftRow | null;
      const missingFields = missingProductDraftFields(draft);
      return {
        groupId,
        state: assertGroupState(group.state),
        complete: missingFields.length === 0,
        missingFields,
        checkedAt: new Date()
      };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async getPublishResult(groupId: string): Promise<PublishAssetGroupResult> {
    validateIdentifierParam(groupId, "groupId");
    try {
      const row = await this.prisma.beadGroupPublication.findUnique({ where: { groupId } });
      if (!row) {
        throw new PersistenceError("NOT_FOUND", `No publication exists for bead image group ${groupId}`);
      }
      return toPublishResult(row as unknown as PublicationRow);
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
        const crystalDraft = crystalDraftId === null
          ? null
          : await tx.crystalDraft.findUnique({ where: { id: crystalDraftId } });
        if (crystalDraftId !== null && !crystalDraft) {
          throw new PersistenceError(
            "DATA_INTEGRITY_ERROR",
            `Crystal draft ${crystalDraftId} vanished while saving group ${groupId}`
          );
        }
        return {
          groupId,
          state: savedState,
          revision: request.expectedGroupRevision + 1,
          crystalDraftId,
          crystalDraftRevision: crystalDraft?.revision ?? null,
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

  private async runIdempotentOperation<T>(spec: {
    operationType: string;
    idempotencyKey: string;
    aggregateId: string;
    requestPayload: unknown;
    actorId?: string;
    reviewNote?: string;
    decode: (payload: unknown) => T;
    execute: (tx: Prisma.TransactionClient) => Promise<{ value: T; persistedResult: unknown }>;
  }): Promise<T> {
    validateIdentifierParam(spec.operationType, "operationType");
    validateIdentifierParam(spec.idempotencyKey, "idempotencyKey");
    validateIdentifierParam(spec.aggregateId, "aggregateId");
    const fingerprint = operationPayloadFingerprint(spec.requestPayload);
    const replay = async (db: Db): Promise<T | null> => {
      const row = (await db.assetImportOperation.findUnique({
        where: {
          operationType_idempotencyKey: {
            operationType: spec.operationType,
            idempotencyKey: spec.idempotencyKey
          }
        }
      })) as unknown as OperationRow | null;
      if (!row) return null;
      if (row.aggregateId !== spec.aggregateId || row.payloadFingerprint !== fingerprint) {
        throw new PersistenceError(
          "CONFLICT",
          `Idempotency key ${spec.idempotencyKey} was already used with different ${spec.operationType} input`
        );
      }
      return spec.decode(row.resultPayload);
    };

    try {
      const existing = await replay(this.prisma);
      if (existing !== null) return existing;
      return await this.prisma.$transaction(async (tx) => {
        const replayed = await replay(tx);
        if (replayed !== null) return replayed;
        const executed = await spec.execute(tx);
        await tx.assetImportOperation.create({
          data: {
            operationType: spec.operationType,
            idempotencyKey: spec.idempotencyKey,
            aggregateId: spec.aggregateId,
            payloadFingerprint: fingerprint,
            requestPayload: toPrismaJson(spec.requestPayload),
            resultPayload: toPrismaJson(executed.persistedResult),
            actorId: spec.actorId ?? null,
            reviewNote: spec.reviewNote ?? null
          }
        });
        return executed.value;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await replay(this.prisma).catch(rethrowPersistenceError);
        if (winner !== null) return winner;
      }
      rethrowPersistenceError(error);
    }
  }

  private async groupRevisionNotHeld(
    tx: Db,
    groupId: string,
    expectedRevision: number
  ): Promise<PersistenceError> {
    const group = await tx.beadImageGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      return new PersistenceError("NOT_FOUND", `Bead image group ${groupId} was not found`);
    }
    return new PersistenceError(
      "CONFLICT",
      `Group revision ${group.revision} does not match the expected revision ${expectedRevision}`
    );
  }

  private async toGroupUpdateResult(tx: Db, groupId: string): Promise<UpdateAssetGroupResult> {
    const group = (await tx.beadImageGroup.findUnique({ where: { id: groupId } })) as unknown as GroupRow | null;
    if (!group) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", `Bead image group ${groupId} vanished`);
    }
    const files = (await tx.assetSourceFile.findMany({ where: { groupId } })) as unknown as SourceFileRow[];
    return {
      groupId,
      state: assertGroupState(group.state),
      revision: group.revision,
      memberFileIds: files.map((file) => file.id).sort(compareStable),
      ...(group.primaryFileId === null ? {} : { primaryFileId: group.primaryFileId }),
      ...(group.crystalName === null ? {} : { crystalName: group.crystalName })
    };
  }

  private async toCrystalDraftProjection(
    db: Db,
    draft: CrystalDraftRow
  ): Promise<NonNullable<AssetImportSessionDetail["groups"][number]["crystalDraft"]>> {
    const missingFields = missingCrystalDraftCurationFields(draft);
    const normalizedNameCn = draft.nameCn.trim().toLocaleLowerCase("en-US");
    const normalizedNameEn = draft.nameEn?.trim().toLocaleLowerCase("en-US") ?? null;
    const crystals = await db.crystal.findMany({});
    const duplicate = crystals.some((crystal) => {
      const nameCn = crystal.nameCn.trim().toLocaleLowerCase("en-US");
      const nameEn = crystal.nameEn.trim().toLocaleLowerCase("en-US");
      return nameCn === normalizedNameCn || (normalizedNameEn !== null && nameEn === normalizedNameEn);
    });
    return {
      crystalDraftId: draft.id,
      revision: draft.revision,
      curationComplete: missingFields.length === 0,
      missingFields,
      promotionEligible:
        missingFields.length === 0 && draft.promotedCrystalId == null && !duplicate
    };
  }

  private async applyGroupSessionResult(
    tx: Db,
    job: JobRow,
    request: Extract<CompleteAssetJobResult, { kind: "GROUP_SESSION" }>
  ): Promise<void> {
    if (job.groupId !== null) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Group session job ${job.id} must not carry a group assignment`
      );
    }
    const session = await tx.assetImportSession.findUnique({ where: { id: job.sessionId } });
    if (!session) {
      throw new PersistenceError("DATA_INTEGRITY_ERROR", `Session ${job.sessionId} is missing for job ${job.id}`);
    }
    if (assertSessionState(session.state) !== "PROCESSING") {
      throw new PersistenceError("CONFLICT", `Session ${job.sessionId} is not processing grouping work`);
    }
    const existingGroups = await tx.beadImageGroup.findMany({ where: { sessionId: job.sessionId } });
    if (existingGroups.length > 0) {
      throw new PersistenceError(
        "CONFLICT",
        `Session ${job.sessionId} already has materialized groups`
      );
    }
    const archivedFiles = (await tx.assetSourceFile.findMany({
      where: { sessionId: job.sessionId, state: "ARCHIVED" }
    })) as unknown as SourceFileRow[];
    const expected = new Set(archivedFiles.map((file) => file.id));
    const received = new Set(request.groups.flatMap((group) => group.memberFileIds));
    if (
      expected.size !== received.size ||
      [...expected].some((fileId) => !received.has(fileId))
    ) {
      throw new PersistenceError(
        "CONFLICT",
        "GROUP_SESSION result must cover every unique archived file exactly once"
      );
    }
    for (const group of request.groups) {
      await tx.beadImageGroup.create({
        data: {
          id: group.groupId,
          sessionId: job.sessionId,
          state: "SUGGESTED",
          revision: 1,
          primaryFileId: group.primaryFileId ?? null,
          similarityEvidence: toPrismaJson(group.similarityEvidence ?? {})
        }
      });
      const assigned = await tx.assetSourceFile.updateMany({
        where: {
          id: { in: group.memberFileIds },
          sessionId: job.sessionId,
          state: "ARCHIVED",
          groupId: null
        },
        data: { groupId: group.groupId }
      });
      if (assigned.count !== group.memberFileIds.length) {
        throw new PersistenceError(
          "CONFLICT",
          `One or more source files changed while materializing group ${group.groupId}`
        );
      }
    }
    await tx.assetImportSession.update({
      where: { id: job.sessionId },
      data: {
        state: "NEEDS_REVIEW",
        lastVerifiedCheckpoint: advanceCheckpoint(session.lastVerifiedCheckpoint, "GROUPED")
      }
    });
  }

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

    // Fail closed: only the restored, human-authored Contract fields may
    // promote a draft, and an authoritative duplicate-Crystal match still
    // requires an operator to select the existing Crystal instead.
    const projection = await this.toCrystalDraftProjection(tx, draft);
    const missingFields = projection.missingFields;
    if (missingFields.length > 0) {
      throw new PersistenceError(
        "COMPLIANCE_BLOCKED",
        `Crystal draft ${draftId} cannot be promoted: manual curation fields are missing (${missingFields.join(", ")})`
      );
    }
    if (!projection.promotionEligible) {
      throw new PersistenceError(
        "CONFLICT",
        `Crystal draft ${draftId} duplicates an existing Crystal and must be resolved explicitly`
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
    if (group.sessionId !== job.sessionId) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Process group job ${job.id} and group ${groupId} belong to different sessions`
      );
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
    if (sourceFile.sessionId !== job.sessionId) {
      throw new PersistenceError(
        "DATA_INTEGRITY_ERROR",
        `Source file ${request.output.sourceFileId} belongs to a different session than job ${job.id}`
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
    const activeJobs = await tx.assetProcessingJob.findMany({
      where: {
        sessionId: job.sessionId,
        jobType: "PROCESS_GROUP",
        state: { in: ["QUEUED", "RUNNING"] }
      }
    });
    if (activeJobs.length === 0) {
      await tx.assetImportSession.update({
        where: { id: job.sessionId },
        data: { state: "NEEDS_REVIEW" }
      });
    }
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

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toProcessedAssetReviewView(
  asset: ProcessedAssetRow
): AssetImportSessionDetail["groups"][number]["processedAssets"][number] {
  const state = assertAssetState(asset.state);
  const parsed = AssetQcResultSchema.safeParse(asset.qcResult);
  if (!parsed.success) {
    throw new PersistenceError(
      "DATA_INTEGRITY_ERROR",
      `Processed asset ${asset.id} carries malformed QC evidence`
    );
  }
  const qcPassed = state === "DRAFT" ? null : parsed.data.passed;
  const qcIssues = parsed.data.checks
    .filter((check) => !check.passed)
    .map((check) => check.detail ?? check.summary ?? check.id);
  return {
    processedAssetId: asset.id,
    processingVersion: asset.processingVersion,
    state,
    isCurrent: asset.isCurrentVersion,
    qcPassed,
    qcIssues
  };
}

function missingProductDraftFields(draft: ProductDraftRow | null): string[] {
  if (!draft) {
    return [
      "CRYSTAL_NAME",
      "CRYSTAL_REFERENCE",
      "PRODUCT_NAME",
      "SKU",
      "SHAPE",
      "DIMENSIONS",
      "QUALITY_STATEMENT",
      "QUALITY_SOURCE",
      "MATERIAL_KEY",
      "TEXTURE_ASSET_KEY",
      "CURRENCY",
      "UNIT_PRICE",
      "COST",
      "AVAILABLE_QUANTITY",
      "RIGHTS_HOLDER",
      "USAGE_PERMISSION",
      "AUTHENTIC_PHOTO_DECLARATION",
      "AI_TRAINING_DECISION",
      "COMMERCIAL_USE_DECISION",
      "PUBLIC_DISPLAY_DECISION",
      "AI_RECOMMENDATION_DECISION"
    ];
  }
  const missing: string[] = [];
  if (!draft.crystalName?.trim()) missing.push("CRYSTAL_NAME");
  if ((draft.crystalId === null) === (draft.crystalDraftId === null)) missing.push("CRYSTAL_REFERENCE");
  if (!draft.displayName?.trim()) missing.push("PRODUCT_NAME");
  if (!draft.sku?.trim()) missing.push("SKU");
  if (!draft.shape) missing.push("SHAPE");
  if (draft.diameterMm === null || draft.diameterMm <= 0) missing.push("DIMENSIONS");
  if (!draft.qualityStatement?.trim()) missing.push("QUALITY_STATEMENT");
  if (!draft.qualitySource?.trim()) missing.push("QUALITY_SOURCE");
  if (!draft.materialKey?.trim()) missing.push("MATERIAL_KEY");
  if (!draft.textureAssetKey || !ApprovedAssetKeySchema.safeParse(draft.textureAssetKey).success) {
    missing.push("TEXTURE_ASSET_KEY");
  }
  if (!draft.currency) missing.push("CURRENCY");
  if (draft.unitPriceMinor === null) missing.push("UNIT_PRICE");
  if (draft.costMinor === null) missing.push("COST");
  if (draft.availableQuantity === null) missing.push("AVAILABLE_QUANTITY");
  if (!draft.rightsHolder?.trim()) missing.push("RIGHTS_HOLDER");
  if (draft.usagePermission === null) missing.push("USAGE_PERMISSION");
  if (draft.isAuthenticPhotograph === null) missing.push("AUTHENTIC_PHOTO_DECLARATION");
  if (draft.allowAiTraining === null) missing.push("AI_TRAINING_DECISION");
  if (draft.allowCommercialUse === null) missing.push("COMMERCIAL_USE_DECISION");
  if (draft.allowPublicDisplay === null) missing.push("PUBLIC_DISPLAY_DECISION");
  if (draft.allowAiRecommendation === null) missing.push("AI_RECOMMENDATION_DECISION");
  return missing;
}
