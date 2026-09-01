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
 * session state machine, manifest/upload DTOs, group review actions and the
 * publication request. Storage layout, image processing, persistence and
 * routing are owned by the worker/backend/database tasks; the client never
 * submits filesystem paths, server storage keys or processing results.
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
  "FAILED"
] as const;

export const AssetImportSessionStateSchema = z.enum(ASSET_IMPORT_SESSION_STATES);
export type AssetImportSessionState = z.infer<typeof AssetImportSessionStateSchema>;

export const ASSET_IMPORT_SESSION_TRANSITIONS: Record<AssetImportSessionState, readonly AssetImportSessionState[]> = {
  CREATED: ["UPLOADING", "FAILED"],
  UPLOADING: ["ARCHIVING", "FAILED"],
  ARCHIVING: ["PROCESSING", "PARTIALLY_FAILED", "FAILED"],
  PROCESSING: ["NEEDS_REVIEW", "PARTIALLY_FAILED", "FAILED"],
  NEEDS_REVIEW: ["READY_TO_PUBLISH", "PROCESSING", "FAILED"],
  READY_TO_PUBLISH: ["PUBLISHING", "NEEDS_REVIEW"],
  PUBLISHING: ["PUBLISHED", "PARTIALLY_FAILED"],
  PUBLISHED: [],
  PARTIALLY_FAILED: ["PROCESSING", "NEEDS_REVIEW", "FAILED"],
  FAILED: []
};

export function canTransitionAssetImportSession(
  from: AssetImportSessionState,
  to: AssetImportSessionState
): boolean {
  return ASSET_IMPORT_SESSION_TRANSITIONS[from]?.includes(to) ?? false;
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

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 hex digest");

const AssetArchiveKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_RELATIVE_PATH_LENGTH)
  .refine(isNormalizedAssetRelativePath, {
    message: "Archive key must be a server-generated relative storage key"
  });

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
  idempotencyKey: IdempotencyKeySchema,
  sessionId: IdentifierSchema.optional()
});
export type CreateAssetImportSessionRequest = z.infer<typeof CreateAssetImportSessionRequestSchema>;

export const CreateAssetImportSessionResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  state: AssetImportSessionStateSchema,
  createdAt: IsoDateTimeSchema
});
export type CreateAssetImportSessionResponse = z.infer<typeof CreateAssetImportSessionResponseSchema>;

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

export const RegisterAssetManifestResponseSchema = z.strictObject({
  sessionId: IdentifierSchema,
  registeredFileCount: NonNegativeSafeIntegerSchema,
  files: z.array(RegisteredAssetFileSchema)
});
export type RegisterAssetManifestResponse = z.infer<typeof RegisterAssetManifestResponseSchema>;

export const UploadAssetFileParamsSchema = z.strictObject({
  sessionId: IdentifierSchema,
  fileId: IdentifierSchema,
  contentLengthBytes: NonNegativeSafeIntegerSchema,
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

const SetPrimaryFileActionSchema = z
  .strictObject({
    action: z.literal("SET_PRIMARY"),
    expectedGroupRevision: ExpectedRevisionSchema,
    primaryFileId: IdentifierSchema,
    memberFileIds: z.array(IdentifierSchema).min(1)
  })
  .refine((action) => action.memberFileIds.includes(action.primaryFileId), {
    message: "primaryFileId must be a current group member",
    path: ["primaryFileId"]
  });

const IgnoreFilesActionSchema = z.strictObject({
  action: z.literal("IGNORE_FILES"),
  expectedGroupRevision: ExpectedRevisionSchema,
  fileIds: z.array(IdentifierSchema).min(1),
  reason: NonEmptyTextSchema
});

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

export const AssetUsagePermissionSchema = z.enum(["OWNED", "GRANTED", "PROHIBITED"]);
export type AssetUsagePermission = z.infer<typeof AssetUsagePermissionSchema>;

export const PublishBeadImageGroupRequestSchema = z
  .strictObject({
    idempotencyKey: IdempotencyKeySchema,
    expectedGroupRevision: ExpectedRevisionSchema,
    crystalName: z.string().trim().min(1).max(120),
    crystalNameConfirmedByOperator: z.literal(true),
    displayName: z.string().trim().min(1).max(200),
    sku: IdentifierSchema,
    materialKey: IdentifierSchema,
    shape: BeadShapeSchema,
    diameterMm: MillimeterSchema.positive(),
    lengthAlongStringMm: MillimeterSchema.positive().optional(),
    currency: CurrencySchema,
    unitPriceMinor: MinorAmountSchema,
    costMinor: MinorAmountSchema,
    availableQuantity: NonNegativeSafeIntegerSchema,
    allowPublicDisplay: z.boolean(),
    allowAiRecommendation: z.boolean(),
    rightsHolder: NonEmptyTextSchema,
    usagePermission: AssetUsagePermissionSchema,
    isAuthenticPhotograph: z.boolean(),
    approvedAssetIds: z.array(IdentifierSchema).min(1)
  })
  .superRefine((request, context) => {
    if (request.usagePermission === "PROHIBITED") {
      context.addIssue({
        code: "custom",
        message: "Assets with PROHIBITED usage permission can never be published",
        path: ["usagePermission"]
      });
    }
  });
export type PublishBeadImageGroupRequest = z.infer<typeof PublishBeadImageGroupRequestSchema>;

export const PublishBeadImageGroupResponseSchema = z.strictObject({
  groupId: IdentifierSchema,
  state: BeadImageGroupStateSchema,
  materialProductId: IdentifierSchema,
  crystalId: IdentifierSchema,
  inventorySnapshotId: IdentifierSchema,
  publishedAt: IsoDateTimeSchema,
  publishedAssetKeys: z.array(AssetArchiveKeySchema)
});
export type PublishBeadImageGroupResponse = z.infer<typeof PublishBeadImageGroupResponseSchema>;
