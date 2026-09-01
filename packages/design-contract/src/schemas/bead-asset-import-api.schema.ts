import { z } from "zod";

import { BeadShapeSchema } from "./bead.schema";
import {
  IdentifierSchema,
  MillimeterSchema,
  MinorAmountSchema,
  NonEmptyTextSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  SafeIntegerSchema
} from "./component.schema";
import { CurrencySchema, IsoDateTimeSchema } from "./metadata.schema";

/**
 * Bead Asset Import admin contract (TASK-ASSET-CONTRACT-001). Defines the
 * session state machine, recovery checkpoints, manifest/upload DTOs, group
 * review actions, draft save/completeness, the publication request/response,
 * the approved public asset key and resolver contract, and the stable error
 * contract. Storage layout, image processing, persistence and routing are
 * owned by the worker/backend/database tasks; the client never submits
 * filesystem paths, private archive keys or processing results.
 */

export const ASSET_IMPORT_SESSION_STATES = [
  "CREATED",
  "UPLOADING",
  "ARCHIVING",
  "PROCESSING",
  "NEEDS_REVIEW",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "PUBLISHED",
  "PARTIALLY_FAILED",
  "FAILED",
  "CANCELLED"
] as const;

export const AssetImportSessionStateSchema = z.enum(ASSET_IMPORT_SESSION_STATES);
export type AssetImportSessionState = z.infer<typeof AssetImportSessionStateSchema>;

export const ASSET_IMPORT_SESSION_TERMINAL_STATES: readonly AssetImportSessionState[] = [
  "PUBLISHED",
  "FAILED",
  "CANCELLED"
];

export const ASSET_IMPORT_SESSION_TRANSITIONS: Record<AssetImportSessionState, readonly AssetImportSessionState[]> = {
  CREATED: ["UPLOADING", "FAILED", "CANCELLED"],
  UPLOADING: ["ARCHIVING", "FAILED", "CANCELLED"],
  ARCHIVING: ["PROCESSING", "PARTIALLY_FAILED", "FAILED", "CANCELLED"],
  PROCESSING: ["NEEDS_REVIEW", "PARTIALLY_FAILED", "FAILED", "CANCELLED"],
  NEEDS_REVIEW: ["READY_TO_PUBLISH", "PROCESSING", "FAILED", "CANCELLED"],
  READY_TO_PUBLISH: ["PUBLISHING", "NEEDS_REVIEW", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "PARTIALLY_FAILED", "CANCELLED"],
  PUBLISHED: [],
  PARTIALLY_FAILED: ["PROCESSING", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
  FAILED: [],
  CANCELLED: []
};

export function canTransitionAssetImportSession(
  from: AssetImportSessionState,
  to: AssetImportSessionState
): boolean {
  return ASSET_IMPORT_SESSION_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Verified recovery checkpoints (spec §11). These are interruption-recovery
 * markers recorded on the session, not session states: a crashed or cancelled
 * run resumes from the last verified checkpoint.
 */
export const ASSET_IMPORT_CHECKPOINTS = [
  "ARCHIVED",
  "GROUPED",
  "LABELED",
  "PROCESSED",
  "REVIEWED",
  "PUBLISHED"
] as const;

export const AssetImportCheckpointSchema = z.enum(ASSET_IMPORT_CHECKPOINTS);
export type AssetImportCheckpoint = z.infer<typeof AssetImportCheckpointSchema>;

export function assetImportCheckpointRank(checkpoint: AssetImportCheckpoint): number {
  return ASSET_IMPORT_CHECKPOINTS.indexOf(checkpoint);
}

export const AssetSourceFileKindSchema = z.enum(["ARW", "JPEG", "PNG", "WEBP"]);
export type AssetSourceFileKind = z.infer<typeof AssetSourceFileKindSchema>;

export const AssetSourceFileStateSchema = z.enum([
  "PENDING",
  "UPLOADING",
  "ARCHIVED",
  "FAILED",
  "SKIPPED_DUPLICATE"
]);
export type AssetSourceFileState = z.infer<typeof AssetSourceFileStateSchema>;

export const ASSET_SOURCE_FILE_TRANSITIONS: Record<AssetSourceFileState, readonly AssetSourceFileState[]> = {
  PENDING: ["UPLOADING", "SKIPPED_DUPLICATE"],
  UPLOADING: ["ARCHIVED", "FAILED"],
  ARCHIVED: [],
  FAILED: ["UPLOADING"],
  SKIPPED_DUPLICATE: []
};

export const BeadImageGroupStateSchema = z.enum([
  "SUGGESTED",
  "CONFIRMED",
  "NAMED",
  "PROCESSED",
  "QC_FAILED",
  "READY",
  "PUBLISHED"
]);
export type BeadImageGroupState = z.infer<typeof BeadImageGroupStateSchema>;

export const ProcessedAssetStateSchema = z.enum([
  "DRAFT",
  "QC_PENDING",
  "QC_FAILED",
  "APPROVED",
  "RETIRED"
]);
export type ProcessedAssetState = z.infer<typeof ProcessedAssetStateSchema>;

export const AssetProcessingJobStateSchema = z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED"]);
export type AssetProcessingJobState = z.infer<typeof AssetProcessingJobStateSchema>;

/**
 * Configurable ceiling defaults. They must cover the known acceptance batch
 * (127 files / ~1.4 GiB) with headroom; backends may enforce lower values.
 */
export const ASSET_MANIFEST_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 256 * 1024 * 1024,
  maxSessionBytes: 8 * 1024 * 1024 * 1024
} as const;

const MAX_RELATIVE_PATH_LENGTH = 512;

const ASSET_SOURCE_FILE_EXTENSIONS: Record<AssetSourceFileKind, readonly string[]> = {
  ARW: ["arw"],
  JPEG: ["jpg", "jpeg"],
  PNG: ["png"],
  WEBP: ["webp"]
};

export function assetSourceFileExtension(relativePath: string): string | null {
  const lastSegment = relativePath.split("/").at(-1) ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return null;
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

export function isAllowedAssetSourceExtension(relativePath: string): boolean {
  const extension = assetSourceFileExtension(relativePath);
  if (!extension) return false;
  return Object.values(ASSET_SOURCE_FILE_EXTENSIONS).some((extensions) => extensions.includes(extension));
}

/**
 * Normalizes a client-declared relative path and fails closed on absolute
 * paths, drive letters, home references, traversal segments, backslashes,
 * empty segments and control characters. Only the returned form is ever
 * stored; archive keys are server-generated separately.
 */
export function normalizeAssetRelativePath(raw: string): string {
  const path = raw.trim();
  if (path.length === 0 || path.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new Error("Asset relative path must be 1-512 characters long");
  }
  if (path.startsWith("/") || path.startsWith("~") || path.includes("\\")) {
    throw new Error("Asset relative path must not be absolute");
  }
  if (/^[A-Za-z]:/.test(path)) {
    throw new Error("Asset relative path must not use a drive letter");
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "") throw new Error("Asset relative path must not contain empty segments");
    if (segment === ".") continue;
    if (segment === "..") throw new Error("Asset relative path must not traverse upwards");
    if (/[\0-\x1f]/.test(segment)) throw new Error("Asset relative path must not contain control characters");
    segments.push(segment);
  }
  if (segments.length === 0) throw new Error("Asset relative path must name a file");
  return segments.join("/");
}

function isNormalizedAssetRelativePath(value: string): boolean {
  try {
    return normalizeAssetRelativePath(value) === value;
  } catch {
    return false;
  }
}

const AssetRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine(isNormalizedAssetRelativePath, {
    message: "Path must be a normalized relative path without traversal"
  });

export const Sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 hex digest");

/** Private server-generated archive keys; never exposed in public responses. */
const AssetArchiveKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine(isNormalizedAssetRelativePath, {
    message: "Archive key must be a server-generated relative storage key"
  });

/**
 * Stable public keys for approved, published assets. Content-addressed and
 * deliberately unlike archive paths so private archive keys, client paths and
 * draft-relative paths can never parse as a public approved key.
 */
const APPROVED_ASSET_KEY_PATTERN = /^approved:[0-9a-f]{64}$/;
export const ApprovedAssetKeySchema = z
  .string()
  .regex(APPROVED_ASSET_KEY_PATTERN, "Expected a stable approved asset key of the form approved:<sha256>");
export type ApprovedAssetKey = z.infer<typeof ApprovedAssetKeySchema>;

const IdempotencyKeySchema = IdentifierSchema;
const ExpectedRevisionSchema = PositiveSafeIntegerSchema;

export const AssetImportManifestFileEntrySchema = z
  .strictObject({
    clientFileId: IdentifierSchema,
    relativePath: AssetRelativePathSchema,
    byteSize: SafeIntegerSchema.positive().max(ASSET_MANIFEST_LIMITS.maxFileBytes),
    lastModifiedMs: PositiveSafeIntegerSchema,
    kind: AssetSourceFileKindSchema
  })
  .refine(
    (entry) => {
      const extension = assetSourceFileExtension(entry.relativePath);
      return extension !== null && ASSET_SOURCE_FILE_EXTENSIONS[entry.kind].includes(extension);
    },
    { message: "File extension must match the declared kind (ARW/JPEG/PNG/WEBP only)", path: ["kind"] }
  );

export type AssetImportManifestFileEntry = z.infer<typeof AssetImportManifestFileEntrySchema>;

export const CreateAssetImportSessionRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema
});
export type CreateAssetImportSessionRequest = z.infer<typeof CreateAssetImportSessionRequestSchema>;

export const CreateAssetImportSessionResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  state: z.literal("CREATED"),
  createdAt: IsoDateTimeSchema
});
export type CreateAssetImportSessionResponse = z.infer<typeof CreateAssetImportSessionResponseSchema>;

export const RegisterAssetManifestParamsSchema = z.strictObject({
  sessionId: IdentifierSchema
});
export type RegisterAssetManifestParams = z.infer<typeof RegisterAssetManifestParamsSchema>;

export const RegisterAssetManifestRequestSchema = z
  .strictObject({
    idempotencyKey: IdempotencyKeySchema,
    files: z.array(AssetImportManifestFileEntrySchema).min(1).max(ASSET_MANIFEST_LIMITS.maxFiles)
  })
  .superRefine((request, context) => {
    const seenClientFileIds = new Set<string>();
    const seenRelativePaths = new Set<string>();
    let totalBytes = 0;
    request.files.forEach((file, index) => {
      if (seenClientFileIds.has(file.clientFileId)) {
        context.addIssue({
          code: "custom",
          message: "clientFileId must be unique within one manifest",
          path: ["files", index, "clientFileId"]
        });
      }
      seenClientFileIds.add(file.clientFileId);
      if (seenRelativePaths.has(file.relativePath)) {
        context.addIssue({
          code: "custom",
          message: "relativePath must be unique within one manifest",
          path: ["files", index, "relativePath"]
        });
      }
      seenRelativePaths.add(file.relativePath);
      totalBytes += file.byteSize;
    });
    if (totalBytes > ASSET_MANIFEST_LIMITS.maxSessionBytes) {
      context.addIssue({
        code: "custom",
        message: `Manifest exceeds the session byte limit of ${ASSET_MANIFEST_LIMITS.maxSessionBytes}`,
        path: ["files"]
      });
    }
  });
export type RegisterAssetManifestRequest = z.infer<typeof RegisterAssetManifestRequestSchema>;

export const RegisteredAssetFileSchema = z.strictObject({
  fileId: IdentifierSchema,
  clientFileId: IdentifierSchema,
  uploadStatus: AssetSourceFileStateSchema,
  createdAt: IsoDateTimeSchema
});
export type RegisteredAssetFile = z.infer<typeof RegisteredAssetFileSchema>;

export const RegisterAssetManifestResponseSchema = z
  .strictObject({
    sessionId: IdentifierSchema,
    registeredFileCount: NonNegativeSafeIntegerSchema,
    files: z.array(RegisteredAssetFileSchema)
  })
  .superRefine((response, context) => {
    if (response.registeredFileCount !== response.files.length) {
      context.addIssue({
        code: "custom",
        message: "registeredFileCount must equal the files array length",
        path: ["registeredFileCount"]
      });
    }
  });
export type RegisterAssetManifestResponse = z.infer<typeof RegisterAssetManifestResponseSchema>;

export const UploadAssetFileParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  fileId: IdentifierSchema,
  contentLengthBytes: SafeIntegerSchema.positive().max(ASSET_MANIFEST_LIMITS.maxFileBytes),
  declaredSha256: Sha256Schema.optional()
});
export type UploadAssetFileParams = z.infer<typeof UploadAssetFileParamsSchema>;

export const UploadAssetFileResponseSchema = z
  .strictObject({
    fileId: IdentifierSchema,
    uploadStatus: AssetSourceFileStateSchema,
    byteSize: NonNegativeSafeIntegerSchema,
    sha256: Sha256Schema.optional(),
    archiveKey: AssetArchiveKeySchema.optional(),
    archivedAt: IsoDateTimeSchema.optional()
  })
  .superRefine((response, context) => {
    if (response.uploadStatus === "ARCHIVED") {
      if (!response.sha256) {
        context.addIssue({ code: "custom", message: "Archived files must carry a verified SHA-256", path: ["sha256"] });
      }
      if (!response.archiveKey) {
        context.addIssue({ code: "custom", message: "Archived files must carry a server archive key", path: ["archiveKey"] });
      }
      if (!response.archivedAt) {
        context.addIssue({ code: "custom", message: "Archived files must carry an archivedAt timestamp", path: ["archivedAt"] });
      }
    }
  });
export type UploadAssetFileResponse = z.infer<typeof UploadAssetFileResponseSchema>;

export const AssetImportSessionFileViewSchema = z.strictObject({
  fileId: IdentifierSchema,
  clientFileId: IdentifierSchema,
  relativePath: AssetRelativePathSchema,
  kind: AssetSourceFileKindSchema,
  state: AssetSourceFileStateSchema,
  byteSize: NonNegativeSafeIntegerSchema,
  sha256: Sha256Schema.optional(),
  archiveKey: AssetArchiveKeySchema.optional()
});
export type AssetImportSessionFileView = z.infer<typeof AssetImportSessionFileViewSchema>;

export const AssetImportSessionGroupViewSchema = z.strictObject({
  groupId: IdentifierSchema,
  state: BeadImageGroupStateSchema,
  memberFileIds: z.array(IdentifierSchema).min(1),
  primaryFileId: IdentifierSchema.optional(),
  crystalName: NonEmptyTextSchema.optional(),
  revision: PositiveSafeIntegerSchema
});
export type AssetImportSessionGroupView = z.infer<typeof AssetImportSessionGroupViewSchema>;

export const AssetImportSessionResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  state: AssetImportSessionStateSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  lastVerifiedCheckpoint: AssetImportCheckpointSchema.nullable(),
  declaredFileCount: NonNegativeSafeIntegerSchema,
  uploadedFileCount: NonNegativeSafeIntegerSchema,
  archivedFileCount: NonNegativeSafeIntegerSchema,
  failedFileCount: NonNegativeSafeIntegerSchema,
  declaredBytes: NonNegativeSafeIntegerSchema,
  uploadedBytes: NonNegativeSafeIntegerSchema,
  files: z.array(AssetImportSessionFileViewSchema),
  groups: z.array(AssetImportSessionGroupViewSchema)
});
export type AssetImportSessionResponse = z.infer<typeof AssetImportSessionResponseSchema>;

export const ListAssetImportSessionsQuerySchema = z.strictObject({
  state: AssetImportSessionStateSchema.optional(),
  limit: PositiveSafeIntegerSchema.min(1).max(100).optional(),
  cursor: IdentifierSchema.optional()
});
export type ListAssetImportSessionsQuery = z.infer<typeof ListAssetImportSessionsQuerySchema>;

export const AssetImportSessionSummarySchema = z.strictObject({
  sessionId: IdentifierSchema,
  state: AssetImportSessionStateSchema,
  lastVerifiedCheckpoint: AssetImportCheckpointSchema.nullable(),
  declaredFileCount: NonNegativeSafeIntegerSchema,
  archivedFileCount: NonNegativeSafeIntegerSchema,
  failedFileCount: NonNegativeSafeIntegerSchema,
  groupCount: NonNegativeSafeIntegerSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
});
export type AssetImportSessionSummary = z.infer<typeof AssetImportSessionSummarySchema>;

export const ListAssetImportSessionsResponseSchema = z.strictObject({
  sessions: z.array(AssetImportSessionSummarySchema),
  nextCursor: IdentifierSchema.nullable()
});
export type ListAssetImportSessionsResponse = z.infer<typeof ListAssetImportSessionsResponseSchema>;

export const CancelAssetImportSessionParamsSchema = z.strictObject({
  sessionId: IdentifierSchema
});
export type CancelAssetImportSessionParams = z.infer<typeof CancelAssetImportSessionParamsSchema>;

export const CancelAssetImportSessionRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema
});
export type CancelAssetImportSessionRequest = z.infer<typeof CancelAssetImportSessionRequestSchema>;

export const CancelAssetImportSessionResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  state: z.literal("CANCELLED"),
  cancelledAt: IsoDateTimeSchema
});
export type CancelAssetImportSessionResponse = z.infer<typeof CancelAssetImportSessionResponseSchema>;

export const StartAssetImportGroupingParamsSchema = z.strictObject({
  sessionId: IdentifierSchema
});
export type StartAssetImportGroupingParams = z.infer<typeof StartAssetImportGroupingParamsSchema>;

export const StartAssetImportGroupingRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema
});
export type StartAssetImportGroupingRequest = z.infer<typeof StartAssetImportGroupingRequestSchema>;

export const StartAssetImportGroupingResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  state: z.literal("PROCESSING"),
  queuedJobCount: NonNegativeSafeIntegerSchema,
  startedAt: IsoDateTimeSchema
});
export type StartAssetImportGroupingResponse = z.infer<typeof StartAssetImportGroupingResponseSchema>;

export const StartAssetImportProcessingParamsSchema = z.strictObject({
  sessionId: IdentifierSchema
});
export type StartAssetImportProcessingParams = z.infer<typeof StartAssetImportProcessingParamsSchema>;

export const StartAssetImportProcessingRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema
});
export type StartAssetImportProcessingRequest = z.infer<typeof StartAssetImportProcessingRequestSchema>;

export const StartAssetImportProcessingResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  state: z.literal("PROCESSING"),
  queuedJobCount: NonNegativeSafeIntegerSchema,
  startedAt: IsoDateTimeSchema
});
export type StartAssetImportProcessingResponse = z.infer<typeof StartAssetImportProcessingResponseSchema>;

const SetGroupNameActionSchema = z.strictObject({
  action: z.literal("SET_NAME"),
  expectedGroupRevision: ExpectedRevisionSchema,
  crystalName: z.string().trim().min(1).max(120)
});

const MergeGroupsActionSchema = z.strictObject({
  action: z.literal("MERGE_GROUPS"),
  expectedGroupRevision: ExpectedRevisionSchema,
  sourceGroupIds: z.array(IdentifierSchema).min(2)
});

const SplitGroupActionSchema = z
  .strictObject({
    action: z.literal("SPLIT_GROUP"),
    expectedGroupRevision: ExpectedRevisionSchema,
    partitions: z.array(z.array(IdentifierSchema).min(1)).min(2)
  })
  .refine(
    (action) => {
      const seen = new Set<string>();
      for (const partition of action.partitions) {
        for (const fileId of partition) {
          if (seen.has(fileId)) return false;
          seen.add(fileId);
        }
      }
      return true;
    },
    { message: "A file may appear in only one partition", path: ["partitions"] }
  );

const MoveFilesActionSchema = z
  .strictObject({
    action: z.literal("MOVE_FILES"),
    expectedGroupRevision: ExpectedRevisionSchema,
    fileIds: z.array(IdentifierSchema).min(1),
    targetGroupId: IdentifierSchema
  })
  .refine((action) => new Set(action.fileIds).size === action.fileIds.length, {
    message: "fileIds must be unique",
    path: ["fileIds"]
  });

/**
 * Membership is authoritative on the backend: it is checked against the
 * groupId and expectedGroupRevision, never against a client-supplied list.
 */
const SetPrimaryFileActionSchema = z.strictObject({
  action: z.literal("SET_PRIMARY"),
  expectedGroupRevision: ExpectedRevisionSchema,
  primaryFileId: IdentifierSchema
});

const IgnoreFilesActionSchema = z.strictObject({
  action: z.literal("IGNORE_FILES"),
  expectedGroupRevision: ExpectedRevisionSchema,
  fileIds: z.array(IdentifierSchema).min(1),
  reason: NonEmptyTextSchema
});

export const UpdateBeadImageGroupParamsSchema = z.strictObject({
  groupId: IdentifierSchema
});
export type UpdateBeadImageGroupParams = z.infer<typeof UpdateBeadImageGroupParamsSchema>;

export const UpdateBeadImageGroupRequestSchema = z.discriminatedUnion("action", [
  SetGroupNameActionSchema,
  MergeGroupsActionSchema,
  SplitGroupActionSchema,
  MoveFilesActionSchema,
  SetPrimaryFileActionSchema,
  IgnoreFilesActionSchema
]);
export type UpdateBeadImageGroupRequest = z.infer<typeof UpdateBeadImageGroupRequestSchema>;

export const UpdateBeadImageGroupResponseSchema = z.strictObject({
  groupId: IdentifierSchema,
  state: BeadImageGroupStateSchema,
  revision: PositiveSafeIntegerSchema,
  memberFileIds: z.array(IdentifierSchema),
  primaryFileId: IdentifierSchema.optional(),
  crystalName: NonEmptyTextSchema.optional()
});
export type UpdateBeadImageGroupResponse = z.infer<typeof UpdateBeadImageGroupResponseSchema>;

export const ReprocessSettingsSchema = z.strictObject({
  maskThreshold: z.number().min(0).max(1).optional(),
  edgeFeatherPx: z.number().min(0).max(8).optional()
});
export type ReprocessSettings = z.infer<typeof ReprocessSettingsSchema>;

export const ReprocessBeadImageGroupParamsSchema = z.strictObject({
  groupId: IdentifierSchema
});
export type ReprocessBeadImageGroupParams = z.infer<typeof ReprocessBeadImageGroupParamsSchema>;

export const ReprocessBeadImageGroupRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  expectedGroupRevision: ExpectedRevisionSchema,
  settings: ReprocessSettingsSchema.optional()
});
export type ReprocessBeadImageGroupRequest = z.infer<typeof ReprocessBeadImageGroupRequestSchema>;

export const ReprocessBeadImageGroupResponseSchema = z.strictObject({
  groupId: IdentifierSchema,
  jobId: IdentifierSchema,
  jobState: AssetProcessingJobStateSchema,
  processingVersion: PositiveSafeIntegerSchema
});
export type ReprocessBeadImageGroupResponse = z.infer<typeof ReprocessBeadImageGroupResponseSchema>;

export const SelectProcessedVersionParamsSchema = z.strictObject({
  groupId: IdentifierSchema
});
export type SelectProcessedVersionParams = z.infer<typeof SelectProcessedVersionParamsSchema>;

export const SelectProcessedVersionRequestSchema = z.strictObject({
  expectedGroupRevision: ExpectedRevisionSchema,
  processingVersion: PositiveSafeIntegerSchema
});
export type SelectProcessedVersionRequest = z.infer<typeof SelectProcessedVersionRequestSchema>;

export const SelectProcessedVersionResponseSchema = z.strictObject({
  groupId: IdentifierSchema,
  state: BeadImageGroupStateSchema,
  selectedProcessingVersion: PositiveSafeIntegerSchema,
  updatedAt: IsoDateTimeSchema
});
export type SelectProcessedVersionResponse = z.infer<typeof SelectProcessedVersionResponseSchema>;

/**
 * General draft permission vocabulary. UNKNOWN and PROHIBITED records may be
 * saved locally for review but can never be published; publication uses the
 * narrower PublishAssetUsagePermissionSchema below.
 */
export const AssetUsagePermissionSchema = z.enum(["UNKNOWN", "OWNED", "GRANTED", "PROHIBITED"]);
export type AssetUsagePermission = z.infer<typeof AssetUsagePermissionSchema>;

export const PublishAssetUsagePermissionSchema = z.enum(["OWNED", "GRANTED"]);
export type PublishAssetUsagePermission = z.infer<typeof PublishAssetUsagePermissionSchema>;

const BEAD_PRODUCT_DRAFT_FIELDS = [
  "crystalName",
  "crystalId",
  "crystalDraftId",
  "displayName",
  "sku",
  "materialKey",
  "shape",
  "diameterMm",
  "lengthAlongStringMm",
  "currency",
  "unitPriceMinor",
  "costMinor",
  "availableQuantity",
  "qualityStatement",
  "qualitySource",
  "textureAssetKey",
  "modelAssetKey",
  "rightsHolder",
  "usagePermission",
  "isAuthenticPhotograph",
  "allowAiTraining",
  "allowCommercialUse",
  "allowPublicDisplay",
  "allowAiRecommendation"
] as const;

export const SaveBeadProductDraftParamsSchema = z.strictObject({
  groupId: IdentifierSchema
});
export type SaveBeadProductDraftParams = z.infer<typeof SaveBeadProductDraftParamsSchema>;

export const SaveBeadProductDraftRequestSchema = z
  .strictObject({
    expectedGroupRevision: ExpectedRevisionSchema,
    crystalName: z.string().trim().min(1).max(120).optional(),
    crystalId: IdentifierSchema.optional(),
    crystalDraftId: IdentifierSchema.optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    sku: IdentifierSchema.optional(),
    materialKey: IdentifierSchema.optional(),
    shape: BeadShapeSchema.optional(),
    diameterMm: MillimeterSchema.positive().optional(),
    lengthAlongStringMm: MillimeterSchema.positive().optional(),
    currency: CurrencySchema.optional(),
    unitPriceMinor: MinorAmountSchema.optional(),
    costMinor: MinorAmountSchema.optional(),
    availableQuantity: NonNegativeSafeIntegerSchema.optional(),
    qualityStatement: NonEmptyTextSchema.optional(),
    qualitySource: NonEmptyTextSchema.optional(),
    textureAssetKey: ApprovedAssetKeySchema.optional(),
    modelAssetKey: ApprovedAssetKeySchema.optional(),
    rightsHolder: NonEmptyTextSchema.optional(),
    usagePermission: AssetUsagePermissionSchema.optional(),
    isAuthenticPhotograph: z.boolean().optional(),
    allowAiTraining: z.boolean().optional(),
    allowCommercialUse: z.boolean().optional(),
    allowPublicDisplay: z.boolean().optional(),
    allowAiRecommendation: z.boolean().optional()
  })
  .refine(
    (request) => BEAD_PRODUCT_DRAFT_FIELDS.some((field) => request[field] !== undefined),
    { message: "Draft save must carry at least one product field", path: ["expectedGroupRevision"] }
  )
  .refine(
    (request) => !(request.crystalId !== undefined && request.crystalDraftId !== undefined),
    { message: "A draft may reference an existing crystal or a crystal draft, not both", path: ["crystalDraftId"] }
  );
export type SaveBeadProductDraftRequest = z.infer<typeof SaveBeadProductDraftRequestSchema>;

export const SaveBeadProductDraftResponseSchema = z.strictObject({
  groupId: IdentifierSchema,
  state: BeadImageGroupStateSchema,
  revision: PositiveSafeIntegerSchema,
  draftSavedAt: IsoDateTimeSchema
});
export type SaveBeadProductDraftResponse = z.infer<typeof SaveBeadProductDraftResponseSchema>;

export const DRAFT_COMPLETENESS_FIELDS = [
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
] as const;

/**
 * One-to-one mapping from every publish-required business field onto its
 * completeness field. crystalReference covers the crystalId/crystalDraftId
 * pair: exactly one of them satisfies CRYSTAL_REFERENCE.
 */
export const PUBLISH_REQUIRED_FIELDS_TO_COMPLETENESS = {
  crystalReference: "CRYSTAL_REFERENCE",
  crystalName: "CRYSTAL_NAME",
  displayName: "PRODUCT_NAME",
  sku: "SKU",
  shape: "SHAPE",
  diameterMm: "DIMENSIONS",
  qualityStatement: "QUALITY_STATEMENT",
  qualitySource: "QUALITY_SOURCE",
  materialKey: "MATERIAL_KEY",
  textureAssetKey: "TEXTURE_ASSET_KEY",
  currency: "CURRENCY",
  unitPriceMinor: "UNIT_PRICE",
  costMinor: "COST",
  availableQuantity: "AVAILABLE_QUANTITY",
  rightsHolder: "RIGHTS_HOLDER",
  usagePermission: "USAGE_PERMISSION",
  isAuthenticPhotograph: "AUTHENTIC_PHOTO_DECLARATION",
  allowAiTraining: "AI_TRAINING_DECISION",
  allowCommercialUse: "COMMERCIAL_USE_DECISION",
  allowPublicDisplay: "PUBLIC_DISPLAY_DECISION",
  allowAiRecommendation: "AI_RECOMMENDATION_DECISION"
} as const satisfies Record<string, DraftCompletenessField>;

export const DraftCompletenessFieldSchema = z.enum(DRAFT_COMPLETENESS_FIELDS);
export type DraftCompletenessField = z.infer<typeof DraftCompletenessFieldSchema>;

export const CheckBeadProductDraftCompletenessParamsSchema = z.strictObject({
  groupId: IdentifierSchema
});
export type CheckBeadProductDraftCompletenessParams = z.infer<
  typeof CheckBeadProductDraftCompletenessParamsSchema
>;

export const CheckBeadProductDraftCompletenessResponseSchema = z
  .strictObject({
    groupId: IdentifierSchema,
    state: BeadImageGroupStateSchema,
    complete: z.boolean(),
    missingFields: z.array(DraftCompletenessFieldSchema),
    checkedAt: IsoDateTimeSchema
  })
  .refine(
    (response) => response.complete === (response.missingFields.length === 0),
    { message: "complete must be true exactly when missingFields is empty", path: ["complete"] }
  );
export type CheckBeadProductDraftCompletenessResponse = z.infer<
  typeof CheckBeadProductDraftCompletenessResponseSchema
>;

function hasExactlyOneCrystalReference(value: {
  crystalId?: string | undefined;
  crystalDraftId?: string | undefined;
}): boolean {
  const hasCrystal = value.crystalId !== undefined;
  const hasDraft = value.crystalDraftId !== undefined;
  return hasCrystal !== hasDraft;
}

export const PublishBeadImageGroupParamsSchema = z.strictObject({
  groupId: IdentifierSchema
});
export type PublishBeadImageGroupParams = z.infer<typeof PublishBeadImageGroupParamsSchema>;

/**
 * Publication requires the full spec §6.6 field set. allowAiRecommendation is
 * the AI-recommendation availability decision and is deliberately separate
 * from allowAiTraining consent. Crystal identity resolves through either an
 * existing crystalId or an explicitly confirmed CrystalDraft promotion.
 * allowPublicDisplay and allowCommercialUse are affirmative-only grants:
 * publishing while either is false would ship a product whose approved image
 * is contractually forbidden from public or commercial delivery.
 */
export const PublishBeadImageGroupRequestSchema = z
  .strictObject({
    idempotencyKey: IdempotencyKeySchema,
    expectedGroupRevision: ExpectedRevisionSchema,
    crystalId: IdentifierSchema.optional(),
    crystalDraftId: IdentifierSchema.optional(),
    crystalDraftPromotionConfirmed: z.literal(true).optional(),
    crystalName: z.string().trim().min(1).max(120),
    crystalNameConfirmedByOperator: z.literal(true),
    displayName: z.string().trim().min(1).max(200),
    sku: IdentifierSchema,
    materialKey: IdentifierSchema,
    shape: BeadShapeSchema,
    diameterMm: MillimeterSchema.positive(),
    lengthAlongStringMm: MillimeterSchema.positive().optional(),
    qualityStatement: NonEmptyTextSchema,
    qualitySource: NonEmptyTextSchema,
    textureAssetKey: ApprovedAssetKeySchema,
    modelAssetKey: ApprovedAssetKeySchema.optional(),
    currency: CurrencySchema,
    unitPriceMinor: MinorAmountSchema,
    costMinor: MinorAmountSchema,
    availableQuantity: NonNegativeSafeIntegerSchema,
    allowPublicDisplay: z.literal(true),
    allowAiRecommendation: z.boolean(),
    allowAiTraining: z.boolean(),
    allowCommercialUse: z.literal(true),
    rightsHolder: NonEmptyTextSchema,
    usagePermission: PublishAssetUsagePermissionSchema,
    isAuthenticPhotograph: z.boolean()
  })
  .superRefine((request, context) => {
    if (!hasExactlyOneCrystalReference(request)) {
      context.addIssue({
        code: "custom",
        message:
          "Publish must resolve exactly one crystal reference: an existing crystalId or a crystalDraftId promotion",
        path: ["crystalId"]
      });
    }
    if (request.crystalDraftId !== undefined && request.crystalDraftPromotionConfirmed !== true) {
      context.addIssue({
        code: "custom",
        message: "Crystal draft publication requires explicit operator promotion confirmation",
        path: ["crystalDraftPromotionConfirmed"]
      });
    }
    if (request.crystalDraftId === undefined && request.crystalDraftPromotionConfirmed !== undefined) {
      context.addIssue({
        code: "custom",
        message: "crystalDraftPromotionConfirmed is only valid together with a crystalDraftId",
        path: ["crystalDraftPromotionConfirmed"]
      });
    }
  });
export type PublishBeadImageGroupRequest = z.infer<typeof PublishBeadImageGroupRequestSchema>;

export const PublishBeadImageGroupResponseSchema = z.strictObject({
  groupId: IdentifierSchema,
  state: z.literal("PUBLISHED"),
  materialProductId: IdentifierSchema,
  crystalId: IdentifierSchema,
  inventorySnapshotId: IdentifierSchema,
  publishedAt: IsoDateTimeSchema,
  publishedAssetKeys: z.array(ApprovedAssetKeySchema).min(1)
});
export type PublishBeadImageGroupResponse = z.infer<typeof PublishBeadImageGroupResponseSchema>;

export const GetBeadImageGroupPublishResultParamsSchema = z.strictObject({
  groupId: IdentifierSchema
});
export type GetBeadImageGroupPublishResultParams = z.infer<typeof GetBeadImageGroupPublishResultParamsSchema>;

export const GetBeadImageGroupPublishResultResponseSchema = PublishBeadImageGroupResponseSchema;
export type GetBeadImageGroupPublishResultResponse = PublishBeadImageGroupResponse;

export const ResolveApprovedAssetParamsSchema = z.strictObject({
  assetKey: ApprovedAssetKeySchema
});
export type ResolveApprovedAssetParams = z.infer<typeof ResolveApprovedAssetParamsSchema>;

export const APPROVED_ASSET_CONTENT_TYPES = ["image/webp", "image/png", "image/jpeg"] as const;
export const ApprovedAssetContentTypeSchema = z.enum(APPROVED_ASSET_CONTENT_TYPES);
export type ApprovedAssetContentType = z.infer<typeof ApprovedAssetContentTypeSchema>;

export const APPROVED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

const StrongEtagSchema = z
  .string()
  .regex(/^"[0-9a-f]{64}"$/, "Expected a strong ETag quoting the SHA-256 digest");

/**
 * Internal resolver/service result describing one approved asset delivery.
 * This is NOT the HTTP response body of GET /api/assets/:assetKey — that
 * success response is binary image bytes whose headers are validated by
 * ApprovedAssetDeliveryHeadersSchema. Frontends must use the route URL as an
 * <img src> and never treat a JSON document as the delivered image.
 *
 * Content-addressed invariants: the key is exactly approved:<sha256>, the
 * ETag is the strong quoted form of the same digest, and the cache directive
 * is the exact immutable value.
 */
export const ApprovedAssetDeliveryMetadataSchema = z
  .strictObject({
    assetKey: ApprovedAssetKeySchema,
    contentType: ApprovedAssetContentTypeSchema,
    byteSize: PositiveSafeIntegerSchema,
    sha256: Sha256Schema,
    etag: StrongEtagSchema,
    cacheControl: z.literal(APPROVED_ASSET_CACHE_CONTROL)
  })
  .superRefine((metadata, context) => {
    if (metadata.assetKey !== `approved:${metadata.sha256}`) {
      context.addIssue({
        code: "custom",
        message: "assetKey must be the content address approved:<sha256> of the delivered bytes",
        path: ["assetKey"]
      });
    }
    if (metadata.etag !== `"${metadata.sha256}"`) {
      context.addIssue({
        code: "custom",
        message: "ETag must be the strong quoted SHA-256 of the delivered bytes",
        path: ["etag"]
      });
    }
  });
export type ApprovedAssetDeliveryMetadata = z.infer<typeof ApprovedAssetDeliveryMetadataSchema>;

/**
 * The four HTTP response headers of a successful approved asset delivery.
 * The body is the binary image itself; header names are exact and no other
 * header may be validated through this contract.
 */
export const ApprovedAssetDeliveryHeadersSchema = z.strictObject({
  "Content-Type": ApprovedAssetContentTypeSchema,
  "Content-Length": z
    .string()
    .regex(/^[1-9][0-9]{0,14}$/, "Content-Length must be a positive decimal byte count"),
  ETag: StrongEtagSchema,
  "Cache-Control": z.literal(APPROVED_ASSET_CACHE_CONTROL)
});
export type ApprovedAssetDeliveryHeaders = z.infer<typeof ApprovedAssetDeliveryHeadersSchema>;

export function approvedAssetDeliveryHeaders(metadata: ApprovedAssetDeliveryMetadata): ApprovedAssetDeliveryHeaders {
  return {
    "Content-Type": metadata.contentType,
    "Content-Length": String(metadata.byteSize),
    ETag: metadata.etag,
    "Cache-Control": metadata.cacheControl
  };
}

/**
 * Stable typed asset-import errors for the spec §11 failure categories.
 *
 * The HTTP envelope separates two code layers:
 *  - `error.code` uses only the shared HTTP transport vocabulary
 *    (ASSET_IMPORT_TRANSPORT_ERROR_CODES). It mirrors the canonical backend
 *    ApiErrorCodeSchema plus the three transport classes this surface needs
 *    that the backend vocabulary does not currently define
 *    (PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, UNPROCESSABLE_ENTITY).
 *  - `error.assetCode` carries the bead-import business code; retryability
 *    and the recovery action bind to the assetCode catalog, never to the
 *    transport code.
 *
 * The current backend `ApiErrorEnvelopeSchema` is a strict object that only
 * accepts its own code enum, so it does NOT accept this extended shape today;
 * TASK-ASSET-BE-001 must extend or adapt that serializer for the asset-import
 * routes. Business asset codes must never masquerade as transport codes.
 */
export const ASSET_IMPORT_TRANSPORT_ERROR_CODES = [
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_ENTITY",
  "INTERNAL_ERROR"
] as const;

export const AssetImportTransportErrorCodeSchema = z.enum(ASSET_IMPORT_TRANSPORT_ERROR_CODES);
export type AssetImportTransportErrorCode = z.infer<typeof AssetImportTransportErrorCodeSchema>;

export const ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE: Record<AssetImportTransportErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_ERROR: 500
};

export const ASSET_IMPORT_ERROR_CODES = [
  "UNSUPPORTED_FILE_KIND",
  "CORRUPT_FILE_CONTENT",
  "STORAGE_FULL",
  "ARCHIVE_VERIFICATION_FAILED",
  "ARCHIVE_CONFLICT",
  "JOB_LEASE_CONFLICT",
  "SEGMENTATION_FAILED",
  "QUALITY_INSUFFICIENT",
  "ADMIN_PERMISSION_EXPIRED",
  "DRAFT_INCOMPLETE",
  "MISSING_REFERENCE",
  "SKU_CONFLICT",
  "INVENTORY_VERSION_CONFLICT",
  "PUBLISH_TRANSACTION_FAILED"
] as const;

export const AssetImportErrorCodeSchema = z.enum(ASSET_IMPORT_ERROR_CODES);
export type AssetImportErrorCode = z.infer<typeof AssetImportErrorCodeSchema>;

/** Fixed transport pairing for every asset code; the envelope enforces it. */
export const ASSET_IMPORT_ERROR_TRANSPORT_CODES: Record<AssetImportErrorCode, AssetImportTransportErrorCode> = {
  UNSUPPORTED_FILE_KIND: "UNSUPPORTED_MEDIA_TYPE",
  CORRUPT_FILE_CONTENT: "UNPROCESSABLE_ENTITY",
  STORAGE_FULL: "INTERNAL_ERROR",
  ARCHIVE_VERIFICATION_FAILED: "CONFLICT",
  ARCHIVE_CONFLICT: "CONFLICT",
  JOB_LEASE_CONFLICT: "CONFLICT",
  SEGMENTATION_FAILED: "INTERNAL_ERROR",
  QUALITY_INSUFFICIENT: "UNPROCESSABLE_ENTITY",
  ADMIN_PERMISSION_EXPIRED: "UNAUTHORIZED",
  DRAFT_INCOMPLETE: "UNPROCESSABLE_ENTITY",
  MISSING_REFERENCE: "UNPROCESSABLE_ENTITY",
  SKU_CONFLICT: "CONFLICT",
  INVENTORY_VERSION_CONFLICT: "CONFLICT",
  PUBLISH_TRANSACTION_FAILED: "INTERNAL_ERROR"
};

export const ASSET_IMPORT_ERROR_RECOVERY_ACTIONS = [
  "RETRY_REQUEST",
  "RESUME_FROM_CHECKPOINT",
  "REUPLOAD_FILE",
  "REPROCESS_GROUP",
  "COMPLETE_DRAFT_FIELDS",
  "RENEW_ADMIN_PERMISSION",
  "RESOLVE_SKU_CONFLICT",
  "RETRY_WITH_FRESH_INVENTORY",
  "CANCEL_SESSION",
  "NO_RECOVERY"
] as const;

export const AssetImportErrorRecoveryActionSchema = z.enum(ASSET_IMPORT_ERROR_RECOVERY_ACTIONS);
export type AssetImportErrorRecoveryAction = z.infer<typeof AssetImportErrorRecoveryActionSchema>;

export const ASSET_IMPORT_ERROR_CATALOG: Record<
  AssetImportErrorCode,
  Readonly<{ retryable: boolean; recoveryAction: AssetImportErrorRecoveryAction }>
> = {
  UNSUPPORTED_FILE_KIND: { retryable: false, recoveryAction: "REUPLOAD_FILE" },
  CORRUPT_FILE_CONTENT: { retryable: false, recoveryAction: "REUPLOAD_FILE" },
  STORAGE_FULL: { retryable: true, recoveryAction: "RESUME_FROM_CHECKPOINT" },
  ARCHIVE_VERIFICATION_FAILED: { retryable: true, recoveryAction: "REUPLOAD_FILE" },
  ARCHIVE_CONFLICT: { retryable: true, recoveryAction: "RESUME_FROM_CHECKPOINT" },
  JOB_LEASE_CONFLICT: { retryable: true, recoveryAction: "RESUME_FROM_CHECKPOINT" },
  SEGMENTATION_FAILED: { retryable: true, recoveryAction: "REPROCESS_GROUP" },
  QUALITY_INSUFFICIENT: { retryable: false, recoveryAction: "REPROCESS_GROUP" },
  ADMIN_PERMISSION_EXPIRED: { retryable: true, recoveryAction: "RENEW_ADMIN_PERMISSION" },
  DRAFT_INCOMPLETE: { retryable: false, recoveryAction: "COMPLETE_DRAFT_FIELDS" },
  MISSING_REFERENCE: { retryable: false, recoveryAction: "COMPLETE_DRAFT_FIELDS" },
  SKU_CONFLICT: { retryable: false, recoveryAction: "RESOLVE_SKU_CONFLICT" },
  INVENTORY_VERSION_CONFLICT: { retryable: true, recoveryAction: "RETRY_WITH_FRESH_INVENTORY" },
  PUBLISH_TRANSACTION_FAILED: { retryable: true, recoveryAction: "RETRY_REQUEST" }
};

export const AssetImportFieldErrorSchema = z.strictObject({
  fieldPath: z.string().min(1),
  message: z.string().min(1)
});
export type AssetImportFieldError = z.infer<typeof AssetImportFieldErrorSchema>;

function assetErrorMatchesCatalog(detail: {
  assetCode: AssetImportErrorCode;
  retryable: boolean;
  recoveryAction: AssetImportErrorRecoveryAction;
}): boolean {
  const guidance = ASSET_IMPORT_ERROR_CATALOG[detail.assetCode];
  return guidance.retryable === detail.retryable && guidance.recoveryAction === detail.recoveryAction;
}

export const AssetImportErrorDetailSchema = z
  .strictObject({
    assetCode: AssetImportErrorCodeSchema,
    message: NonEmptyTextSchema,
    retryable: z.boolean(),
    recoveryAction: AssetImportErrorRecoveryActionSchema,
    fieldErrors: z.array(AssetImportFieldErrorSchema).optional()
  })
  .refine(assetErrorMatchesCatalog, {
    message: "retryable and recoveryAction must match the stable asset-import error catalog"
  });
export type AssetImportErrorDetail = z.infer<typeof AssetImportErrorDetailSchema>;

export const AssetImportErrorEnvelopeSchema = z.strictObject({
  error: z
    .strictObject({
      code: AssetImportTransportErrorCodeSchema,
      message: NonEmptyTextSchema,
      assetCode: AssetImportErrorCodeSchema,
      retryable: z.boolean(),
      recoveryAction: AssetImportErrorRecoveryActionSchema,
      fieldErrors: z.array(AssetImportFieldErrorSchema).optional(),
      requestId: NonEmptyTextSchema
    })
    .refine(assetErrorMatchesCatalog, {
      message: "retryable and recoveryAction must match the stable asset-import error catalog"
    })
    .refine(
      (error) => error.code === ASSET_IMPORT_ERROR_TRANSPORT_CODES[error.assetCode],
      { message: "error.code must be the transport code bound to the assetCode" }
    )
});
export type AssetImportErrorEnvelope = z.infer<typeof AssetImportErrorEnvelopeSchema>;
