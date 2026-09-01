import assert from "node:assert/strict";
import test from "node:test";
import type { ZodType } from "zod";

import * as asset from "../src/schemas/bead-asset-import-api.schema";

const sessionStates = [
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

const checkpoints = [
  "ARCHIVED",
  "GROUPED",
  "LABELED",
  "PROCESSED",
  "REVIEWED",
  "PUBLISHED"
] as const;

const rejects = (schema: ZodType, value: unknown, probe: string) => {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, `${probe} must be rejected`);
};

const accepts = <T>(schema: ZodType, value: unknown, probe: string): T => {
  const result = schema.safeParse(value);
  assert.equal(result.success, true, `${probe} must be accepted: ${JSON.stringify(result.success ? null : result.error.issues)}`);
  return result.data as T;
};

const now = "2026-09-01T09:00:00+08:00";
const later = "2026-09-01T09:30:00+08:00";
const approvedKey = `approved:${"a".repeat(64)}`;
const otherApprovedKey = `approved:${"b".repeat(64)}`;

const manifestEntry = (overrides: Record<string, unknown> = {}) => ({
  clientFileId: "file-001",
  relativePath: "01/DSC0001.JPG",
  byteSize: 1_048_576,
  lastModifiedMs: 1_756_600_000_000,
  kind: "JPEG",
  ...overrides
});

const manifestRequest = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "manifest-batch-1",
  files: [
    manifestEntry(),
    manifestEntry({ clientFileId: "file-002", relativePath: "01/DSC0001.ARW", kind: "ARW" })
  ],
  ...overrides
});

const registeredFile = {
  fileId: "file-1",
  clientFileId: "file-001",
  uploadStatus: "PENDING",
  createdAt: now
};

const sessionResponse = (overrides: Record<string, unknown> = {}) => ({
  sessionId: "session-1",
  state: "NEEDS_REVIEW",
  createdAt: now,
  updatedAt: later,
  lastVerifiedCheckpoint: "GROUPED",
  declaredFileCount: 2,
  uploadedFileCount: 2,
  archivedFileCount: 2,
  failedFileCount: 0,
  declaredBytes: 2_097_152,
  uploadedBytes: 2_097_152,
  files: [
    {
      fileId: "file-1",
      clientFileId: "file-001",
      relativePath: "01/DSC0001.JPG",
      kind: "JPEG",
      state: "ARCHIVED",
      byteSize: 1_048_576,
      sha256: "a".repeat(64),
      archiveKey: "imports/session-1/raw/a.jpg"
    }
  ],
  groups: [
    {
      groupId: "group-1",
      state: "NAMED",
      memberFileIds: ["file-1"],
      primaryFileId: "file-1",
      crystalName: "紫水晶",
      revision: 2
    }
  ],
  ...overrides
});

const sessionSummary = (overrides: Record<string, unknown> = {}) => ({
  sessionId: "session-1",
  state: "ARCHIVING",
  lastVerifiedCheckpoint: "ARCHIVED",
  declaredFileCount: 2,
  archivedFileCount: 2,
  failedFileCount: 0,
  groupCount: 0,
  createdAt: now,
  updatedAt: later,
  ...overrides
});

const publishRequest = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "publish-group-1",
  expectedGroupRevision: 3,
  crystalId: "crystal-amethyst",
  crystalName: "紫水晶",
  crystalNameConfirmedByOperator: true,
  displayName: "紫水晶 8mm 圆珠",
  sku: "BEAD-AMETHYST-8",
  materialKey: "amethyst-round-8",
  shape: "ROUND",
  diameterMm: 8,
  qualityStatement: "天然紫水晶，肉眼可见少量棉絮，无注胶",
  qualitySource: "到货批次人工目检（2026-08-30）",
  textureAssetKey: approvedKey,
  currency: "CNY",
  unitPriceMinor: 12_800,
  costMinor: 4_000,
  availableQuantity: 12,
  allowPublicDisplay: true,
  allowAiRecommendation: false,
  allowAiTraining: false,
  allowCommercialUse: true,
  rightsHolder: "玄矶工作室",
  usagePermission: "GRANTED",
  isAuthenticPhotograph: true,
  ...overrides
});

const publishResponse = (overrides: Record<string, unknown> = {}) => ({
  groupId: "group-1",
  state: "PUBLISHED",
  materialProductId: "product-1",
  crystalId: "crystal-amethyst",
  inventorySnapshotId: "inventory-1",
  publishedAt: later,
  publishedAssetKeys: [approvedKey],
  ...overrides
});

const deliveryMetadata = (overrides: Record<string, unknown> = {}) => ({
  assetKey: approvedKey,
  contentType: "image/webp",
  byteSize: 65_536,
  sha256: "a".repeat(64),
  etag: `"${"a".repeat(64)}"`,
  cacheControl: "public, max-age=31536000, immutable",
  ...overrides
});

const deliveryHeaders = (overrides: Record<string, unknown> = {}) => ({
  "Content-Type": "image/webp",
  "Content-Length": "65536",
  ETag: `"${"a".repeat(64)}"`,
  "Cache-Control": "public, max-age=31536000, immutable",
  ...overrides
});

const errorDetail = (overrides: Record<string, unknown> = {}) => ({
  assetCode: "STORAGE_FULL",
  message: "档案根目录剩余空间不足，归档已暂停",
  retryable: true,
  recoveryAction: "RESUME_FROM_CHECKPOINT",
  ...overrides
});

const errorEnvelope = (overrides: Record<string, unknown> = {}) => ({
  error: { code: "INTERNAL_ERROR", ...errorDetail(), requestId: "req-1", ...overrides }
});

test("session state enum exposes exactly the canonical states including CANCELLED", () => {
  for (const state of sessionStates) {
    accepts(asset.AssetImportSessionStateSchema, state, `session state ${state}`);
  }
  rejects(asset.AssetImportSessionStateSchema, "GROUPING", "legacy session state GROUPING");
  rejects(asset.AssetImportSessionStateSchema, "published", "lowercase session state");
});

test("session transition table covers every state and only legal moves", () => {
  assert.deepEqual(Object.keys(asset.ASSET_IMPORT_SESSION_TRANSITIONS).sort(), [...sessionStates].sort());

  const legalMoves: ReadonlyArray<readonly [string, string]> = [
    ["CREATED", "UPLOADING"],
    ["UPLOADING", "ARCHIVING"],
    ["UPLOADING", "FAILED"],
    ["ARCHIVING", "PROCESSING"],
    ["ARCHIVING", "PARTIALLY_FAILED"],
    ["PROCESSING", "NEEDS_REVIEW"],
    ["PROCESSING", "PARTIALLY_FAILED"],
    ["NEEDS_REVIEW", "READY_TO_PUBLISH"],
    ["NEEDS_REVIEW", "PROCESSING"],
    ["NEEDS_REVIEW", "FAILED"],
    ["READY_TO_PUBLISH", "PUBLISHING"],
    ["READY_TO_PUBLISH", "NEEDS_REVIEW"],
    ["PUBLISHING", "PUBLISHED"],
    ["PUBLISHING", "PARTIALLY_FAILED"],
    ["PARTIALLY_FAILED", "PROCESSING"],
    ["PARTIALLY_FAILED", "NEEDS_REVIEW"],
    ["PARTIALLY_FAILED", "FAILED"]
  ];
  for (const [from, to] of legalMoves) {
    assert.equal(
      asset.canTransitionAssetImportSession(from as never, to as never),
      true,
      `${from} -> ${to} must be legal`
    );
  }

  const illegalMoves: ReadonlyArray<readonly [string, string]> = [
    ["CREATED", "PUBLISHED"],
    ["CREATED", "PROCESSING"],
    ["UPLOADING", "PUBLISHING"],
    ["ARCHIVING", "READY_TO_PUBLISH"],
    ["PROCESSING", "PUBLISHED"],
    ["NEEDS_REVIEW", "PUBLISHING"],
    ["READY_TO_PUBLISH", "UPLOADING"],
    ["PUBLISHED", "NEEDS_REVIEW"],
    ["PUBLISHED", "PROCESSING"],
    ["FAILED", "PUBLISHED"],
    ["PARTIALLY_FAILED", "PUBLISHED"],
    ["CREATED", "CREATED"]
  ];
  for (const [from, to] of illegalMoves) {
    assert.equal(
      asset.canTransitionAssetImportSession(from as never, to as never),
      false,
      `${from} -> ${to} must be illegal`
    );
  }
  assert.equal(asset.canTransitionAssetImportSession("UNKNOWN" as never, "PUBLISHED" as never), false);
});

test("every non-terminal session state can be cancelled and terminals have no exits", () => {
  const nonTerminal = [
    "CREATED",
    "UPLOADING",
    "ARCHIVING",
    "PROCESSING",
    "NEEDS_REVIEW",
    "READY_TO_PUBLISH",
    "PUBLISHING",
    "PARTIALLY_FAILED"
  ];
  for (const from of nonTerminal) {
    assert.equal(
      asset.canTransitionAssetImportSession(from as never, "CANCELLED" as never),
      true,
      `${from} -> CANCELLED must be legal`
    );
  }
  for (const terminal of ["PUBLISHED", "FAILED", "CANCELLED"]) {
    assert.equal(
      asset.ASSET_IMPORT_SESSION_TRANSITIONS[terminal as keyof typeof asset.ASSET_IMPORT_SESSION_TRANSITIONS].length,
      0,
      `${terminal} must be terminal`
    );
    for (const to of sessionStates) {
      assert.equal(
        asset.canTransitionAssetImportSession(terminal as never, to as never),
        false,
        `${terminal} -> ${to} must be illegal`
      );
    }
  }
});

test("recovery checkpoints are a separate ordered enum", () => {
  assert.deepEqual([...asset.ASSET_IMPORT_CHECKPOINTS], [...checkpoints]);
  for (const checkpoint of checkpoints) {
    accepts(asset.AssetImportCheckpointSchema, checkpoint, `checkpoint ${checkpoint}`);
  }
  rejects(asset.AssetImportCheckpointSchema, "UPLOADED", "non-canonical checkpoint UPLOADED");
  rejects(asset.AssetImportCheckpointSchema, "REVIEW", "non-canonical checkpoint REVIEW");
  rejects(asset.AssetImportCheckpointSchema, "archived", "lowercase checkpoint");
  for (let index = 1; index < checkpoints.length; index += 1) {
    assert.ok(
      asset.assetImportCheckpointRank(checkpoints[index] as never) >
        asset.assetImportCheckpointRank(checkpoints[index - 1] as never),
      `${checkpoints[index]} must rank after ${checkpoints[index - 1]}`
    );
  }
});

test("source file lifecycle transitions guard archive verification", () => {
  const legal: ReadonlyArray<readonly [string, string]> = [
    ["PENDING", "UPLOADING"],
    ["UPLOADING", "ARCHIVED"],
    ["UPLOADING", "FAILED"],
    ["FAILED", "UPLOADING"]
  ];
  for (const [from, to] of legal) {
    assert.ok(
      asset.ASSET_SOURCE_FILE_TRANSITIONS[from as keyof typeof asset.ASSET_SOURCE_FILE_TRANSITIONS]?.includes(to as never),
      `file ${from} -> ${to} must be legal`
    );
  }
  assert.ok(!asset.ASSET_SOURCE_FILE_TRANSITIONS.PENDING.includes("ARCHIVED" as never), "files cannot be archived without upload verification");
  assert.equal(asset.ASSET_SOURCE_FILE_TRANSITIONS.ARCHIVED.length, 0, "archived source files are immutable");
  for (const state of ["PENDING", "UPLOADING", "ARCHIVED", "FAILED", "SKIPPED_DUPLICATE"]) {
    accepts(asset.AssetSourceFileStateSchema, state, `file state ${state}`);
  }
});

test("group, processed asset and job states parse strictly", () => {
  for (const state of ["SUGGESTED", "CONFIRMED", "NAMED", "PROCESSED", "QC_FAILED", "READY", "PUBLISHED"]) {
    accepts(asset.BeadImageGroupStateSchema, state, `group state ${state}`);
  }
  rejects(asset.BeadImageGroupStateSchema, "APPROVED", "non-canonical group state");
  for (const state of ["DRAFT", "QC_PENDING", "QC_FAILED", "APPROVED", "RETIRED"]) {
    accepts(asset.ProcessedAssetStateSchema, state, `processed asset state ${state}`);
  }
  rejects(asset.ProcessedAssetStateSchema, "PUBLIC", "processed asset state PUBLIC");
  for (const state of ["QUEUED", "RUNNING", "COMPLETED", "FAILED"]) {
    accepts(asset.AssetProcessingJobStateSchema, state, `job state ${state}`);
  }
  rejects(asset.AssetProcessingJobStateSchema, "DONE", "non-canonical job state");
});

test("usage permission enums separate drafts from publication", () => {
  for (const permission of ["UNKNOWN", "OWNED", "GRANTED", "PROHIBITED"]) {
    accepts(asset.AssetUsagePermissionSchema, permission, `general permission ${permission}`);
  }
  rejects(asset.AssetUsagePermissionSchema, "LICENSED", "non-canonical general permission");
  for (const permission of ["OWNED", "GRANTED"]) {
    accepts(asset.PublishAssetUsagePermissionSchema, permission, `publish permission ${permission}`);
  }
  rejects(asset.PublishAssetUsagePermissionSchema, "UNKNOWN", "UNKNOWN permission can never publish");
  rejects(asset.PublishAssetUsagePermissionSchema, "PROHIBITED", "PROHIBITED permission can never publish");
});

test("every object schema rejects unknown keys", () => {
  const cases: ReadonlyArray<readonly [string, ZodType, unknown]> = [
    ["CreateAssetImportSessionRequest", asset.CreateAssetImportSessionRequestSchema, { idempotencyKey: "k-1", bogus: 1 }],
    ["CreateAssetImportSessionResponse", asset.CreateAssetImportSessionResponseSchema, { sessionId: "session-1", state: "CREATED", createdAt: now, bogus: 1 }],
    ["RegisterAssetManifestParams", asset.RegisterAssetManifestParamsSchema, { sessionId: "session-1", bogus: 1 }],
    ["RegisterAssetManifestRequest", asset.RegisterAssetManifestRequestSchema, { ...manifestRequest(), bogus: 1 }],
    ["RegisterAssetManifestResponse", asset.RegisterAssetManifestResponseSchema, { sessionId: "session-1", registeredFileCount: 1, files: [registeredFile], bogus: 1 }],
    ["UploadAssetFileParams", asset.UploadAssetFileParamsSchema, { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 10, bogus: 1 }],
    ["UploadAssetFileResponse", asset.UploadAssetFileResponseSchema, { fileId: "file-1", uploadStatus: "ARCHIVED", byteSize: 10, sha256: "a".repeat(64), archiveKey: "imports/session-1/raw/a.jpg", archivedAt: now, storagePath: "/tmp/x", bogus: 1 }],
    ["AssetImportSessionResponse", asset.AssetImportSessionResponseSchema, { ...sessionResponse(), bogus: 1 }],
    ["ListAssetImportSessionsQuery", asset.ListAssetImportSessionsQuerySchema, { limit: 20, bogus: 1 }],
    ["AssetImportSessionSummary", asset.AssetImportSessionSummarySchema, { ...sessionSummary(), bogus: 1 }],
    ["ListAssetImportSessionsResponse", asset.ListAssetImportSessionsResponseSchema, { sessions: [], nextCursor: null, bogus: 1 }],
    ["CancelAssetImportSessionParams", asset.CancelAssetImportSessionParamsSchema, { sessionId: "session-1", bogus: 1 }],
    ["CancelAssetImportSessionRequest", asset.CancelAssetImportSessionRequestSchema, { idempotencyKey: "cancel-1", bogus: 1 }],
    ["CancelAssetImportSessionResponse", asset.CancelAssetImportSessionResponseSchema, { sessionId: "session-1", state: "CANCELLED", cancelledAt: now, bogus: 1 }],
    ["StartAssetImportGroupingParams", asset.StartAssetImportGroupingParamsSchema, { sessionId: "session-1", bogus: 1 }],
    ["StartAssetImportGroupingRequest", asset.StartAssetImportGroupingRequestSchema, { idempotencyKey: "group-1", bogus: 1 }],
    ["StartAssetImportGroupingResponse", asset.StartAssetImportGroupingResponseSchema, { sessionId: "session-1", state: "PROCESSING", queuedJobCount: 0, startedAt: now, bogus: 1 }],
    ["StartAssetImportProcessingParams", asset.StartAssetImportProcessingParamsSchema, { sessionId: "session-1", bogus: 1 }],
    ["StartAssetImportProcessingRequest", asset.StartAssetImportProcessingRequestSchema, { idempotencyKey: "process-1", bogus: 1 }],
    ["StartAssetImportProcessingResponse", asset.StartAssetImportProcessingResponseSchema, { sessionId: "session-1", state: "PROCESSING", queuedJobCount: 3, startedAt: now, bogus: 1 }],
    ["UpdateBeadImageGroupParams", asset.UpdateBeadImageGroupParamsSchema, { groupId: "group-1", bogus: 1 }],
    ["UpdateBeadImageGroupRequest", asset.UpdateBeadImageGroupRequestSchema, { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "紫水晶", bogus: 1 }],
    ["UpdateBeadImageGroupResponse", asset.UpdateBeadImageGroupResponseSchema, { groupId: "group-1", state: "NAMED", revision: 2, memberFileIds: [], bogus: 1 }],
    ["ReprocessBeadImageGroupParams", asset.ReprocessBeadImageGroupParamsSchema, { groupId: "group-1", bogus: 1 }],
    ["ReprocessBeadImageGroupRequest", asset.ReprocessBeadImageGroupRequestSchema, { idempotencyKey: "rp-1", expectedGroupRevision: 2, settings: {}, bogus: 1 }],
    ["ReprocessBeadImageGroupResponse", asset.ReprocessBeadImageGroupResponseSchema, { groupId: "group-1", jobId: "job-1", jobState: "QUEUED", processingVersion: 2, bogus: 1 }],
    ["SelectProcessedVersionParams", asset.SelectProcessedVersionParamsSchema, { groupId: "group-1", bogus: 1 }],
    ["SelectProcessedVersionRequest", asset.SelectProcessedVersionRequestSchema, { expectedGroupRevision: 2, processingVersion: 1, bogus: 1 }],
    ["SelectProcessedVersionResponse", asset.SelectProcessedVersionResponseSchema, { groupId: "group-1", state: "PROCESSED", selectedProcessingVersion: 1, updatedAt: now, bogus: 1 }],
    ["SaveBeadProductDraftParams", asset.SaveBeadProductDraftParamsSchema, { groupId: "group-1", bogus: 1 }],
    ["SaveBeadProductDraftRequest", asset.SaveBeadProductDraftRequestSchema, { expectedGroupRevision: 1, crystalName: "紫水晶", bogus: 1 }],
    ["SaveBeadProductDraftResponse", asset.SaveBeadProductDraftResponseSchema, { groupId: "group-1", state: "NAMED", revision: 2, draftSavedAt: now, bogus: 1 }],
    ["CheckBeadProductDraftCompletenessParams", asset.CheckBeadProductDraftCompletenessParamsSchema, { groupId: "group-1", bogus: 1 }],
    ["CheckBeadProductDraftCompletenessResponse", asset.CheckBeadProductDraftCompletenessResponseSchema, { groupId: "group-1", state: "NAMED", complete: false, missingFields: ["CRYSTAL_NAME"], checkedAt: now, bogus: 1 }],
    ["PublishBeadImageGroupParams", asset.PublishBeadImageGroupParamsSchema, { groupId: "group-1", bogus: 1 }],
    ["PublishBeadImageGroupRequest", asset.PublishBeadImageGroupRequestSchema, { ...publishRequest(), bogus: 1 }],
    ["PublishBeadImageGroupResponse", asset.PublishBeadImageGroupResponseSchema, { ...publishResponse(), bogus: 1 }],
    ["GetBeadImageGroupPublishResultParams", asset.GetBeadImageGroupPublishResultParamsSchema, { groupId: "group-1", bogus: 1 }],
    ["GetBeadImageGroupPublishResultResponse", asset.GetBeadImageGroupPublishResultResponseSchema, { ...publishResponse(), bogus: 1 }],
    ["ResolveApprovedAssetParams", asset.ResolveApprovedAssetParamsSchema, { assetKey: approvedKey, bogus: 1 }],
    ["ApprovedAssetDeliveryMetadata", asset.ApprovedAssetDeliveryMetadataSchema, { ...deliveryMetadata(), bogus: 1 }],
    ["ApprovedAssetDeliveryHeaders", asset.ApprovedAssetDeliveryHeadersSchema, { ...deliveryHeaders(), bogus: 1 }],
    ["AssetImportErrorDetail", asset.AssetImportErrorDetailSchema, { ...errorDetail(), bogus: 1 }],
    ["AssetImportErrorEnvelope", asset.AssetImportErrorEnvelopeSchema, { error: { code: "INTERNAL_ERROR", ...errorDetail(), requestId: "req-1", bogus: 1 } }]
  ];
  for (const [name, schema, value] of cases) {
    rejects(schema, value, `${name} with unknown key`);
  }
});

test("manifest entries refuse absolute paths and traversal", () => {
  const hostilePaths = [
    "/Users/chenyanyan/Desktop/珠子图/01/DSC0001.JPG",
    "C:\\photos\\01\\DSC0001.JPG",
    "..\\01\\DSC0001.JPG",
    "../secrets/env.jpg",
    "01/../../secrets/env.jpg",
    "~/photos/01/DSC0001.JPG",
    "01//DSC0001.JPG",
    "",
    "01/"
  ];
  for (const relativePath of hostilePaths) {
    rejects(asset.RegisterAssetManifestRequestSchema, manifestRequest({ files: [manifestEntry({ relativePath })] }), `manifest path ${relativePath}`);
    assert.throws(() => asset.normalizeAssetRelativePath(relativePath), `normalizeAssetRelativePath(${relativePath})`);
  }
  assert.equal(asset.normalizeAssetRelativePath("01/DSC0001.JPG"), "01/DSC0001.JPG");
  assert.equal(asset.normalizeAssetRelativePath("01/./DSC0001.JPG"), "01/DSC0001.JPG");
  assert.equal(asset.normalizeAssetRelativePath("./01/DSC0001.JPG"), "01/DSC0001.JPG");
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ relativePath: "./01/DSC0001.JPG" })] }),
    "manifest must carry the normalized form, not ./ prefixes"
  );
});

test("manifest entries only allow ARW/JPEG/PNG/WEBP with matching extensions", () => {
  for (const [relativePath, kind] of [
    ["01/DSC0001.ARW", "ARW"],
    ["01/DSC0001.arw", "ARW"],
    ["01/DSC0001.JPG", "JPEG"],
    ["01/DSC0001.jpeg", "JPEG"],
    ["01/DSC0001.PNG", "PNG"],
    ["01/DSC0001.webp", "WEBP"]
  ] as const) {
    accepts(
      asset.RegisterAssetManifestRequestSchema,
      manifestRequest({ files: [manifestEntry({ relativePath, kind })] }),
      `manifest ${relativePath} as ${kind}`
    );
    assert.equal(asset.isAllowedAssetSourceExtension(relativePath), true, relativePath);
  }

  rejects(asset.AssetSourceFileKindSchema, "GIF", "GIF kind");
  rejects(asset.AssetSourceFileKindSchema, "HEIC", "HEIC kind");
  rejects(asset.AssetSourceFileKindSchema, "TIFF", "TIFF kind");
  for (const relativePath of ["01/photo.gif", "01/photo.heic", "01/photo.tif", "01/photo.txt", "01/no-extension"]) {
    assert.equal(asset.isAllowedAssetSourceExtension(relativePath), false, relativePath);
    rejects(asset.RegisterAssetManifestRequestSchema, manifestRequest({ files: [manifestEntry({ relativePath, kind: "JPEG" })] }), `manifest ${relativePath}`);
  }
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ relativePath: "01/DSC0001.JPG", kind: "PNG" })] }),
    "extension/kind mismatch"
  );
});

test("manifest registration enforces count, size and uniqueness limits", () => {
  const manyFiles = Array.from({ length: asset.ASSET_MANIFEST_LIMITS.maxFiles + 1 }, (_, index) =>
    manifestEntry({ clientFileId: `file-${index}`, relativePath: `01/DSC${String(index).padStart(4, "0")}.JPG` })
  );
  rejects(asset.RegisterAssetManifestRequestSchema, manifestRequest({ files: manyFiles }), "over max file count");

  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ byteSize: asset.ASSET_MANIFEST_LIMITS.maxFileBytes + 1 })] }),
    "single file over the byte cap"
  );
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ byteSize: 0 })] }),
    "zero-byte file"
  );
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({
      files: Array.from({ length: 33 }, (_, index) =>
        manifestEntry({
          clientFileId: `bulk-${index}`,
          relativePath: `bulk/DSC${String(index).padStart(4, "0")}.JPG`,
          byteSize: asset.ASSET_MANIFEST_LIMITS.maxFileBytes
        })
      )
    }),
    "session total over the byte cap"
  );
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry(), manifestEntry({ relativePath: "02/DSC0002.JPG" })] }),
    "duplicate clientFileId"
  );
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry(), manifestEntry({ clientFileId: "file-002" })] }),
    "duplicate relativePath"
  );
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [] }),
    "empty manifest"
  );
  rejects(
    asset.RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ lastModifiedMs: -1 })] }),
    "negative lastModifiedMs"
  );
});

test("manifest response keeps registeredFileCount consistent with files", () => {
  accepts(
    asset.RegisterAssetManifestResponseSchema,
    { sessionId: "session-1", registeredFileCount: 1, files: [registeredFile] },
    "consistent manifest response"
  );
  rejects(
    asset.RegisterAssetManifestResponseSchema,
    { sessionId: "session-1", registeredFileCount: 2, files: [registeredFile] },
    "registeredFileCount above files length"
  );
  rejects(
    asset.RegisterAssetManifestResponseSchema,
    { sessionId: "session-1", registeredFileCount: 0, files: [registeredFile] },
    "registeredFileCount below files length"
  );
});

test("session creation accepts only an idempotency key and answers CREATED", () => {
  accepts(asset.CreateAssetImportSessionRequestSchema, { idempotencyKey: "import-2026-09-01" }, "minimal session creation");
  rejects(asset.CreateAssetImportSessionRequestSchema, {}, "missing idempotency key");
  rejects(
    asset.CreateAssetImportSessionRequestSchema,
    { idempotencyKey: "import-1", sessionId: "session-client-1" },
    "client-supplied session id"
  );
  rejects(
    asset.CreateAssetImportSessionRequestSchema,
    { idempotencyKey: "import-1", sourceRoot: "/Users/chenyanyan/Desktop/珠子图" },
    "client-supplied filesystem root"
  );
  accepts(
    asset.CreateAssetImportSessionResponseSchema,
    { sessionId: "session-1", state: "CREATED", createdAt: now },
    "session creation response"
  );
  rejects(
    asset.CreateAssetImportSessionResponseSchema,
    { sessionId: "session-1", state: "UPLOADING", createdAt: now },
    "creation response claiming a later state"
  );
});

test("upload params and response never carry client or server filesystem paths", () => {
  accepts(
    asset.UploadAssetFileParamsSchema,
    { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 1_048_576 },
    "upload params"
  );
  rejects(asset.UploadAssetFileParamsSchema, { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 10, localPath: "/Users/x/a.jpg" }, "upload params with localPath");
  rejects(asset.UploadAssetFileParamsSchema, { sessionId: "session-1", fileId: "file-1", contentLengthBytes: -1 }, "negative content length");
  rejects(asset.UploadAssetFileParamsSchema, { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 0 }, "zero content length");
  rejects(
    asset.UploadAssetFileParamsSchema,
    { sessionId: "session-1", fileId: "file-1", contentLengthBytes: asset.ASSET_MANIFEST_LIMITS.maxFileBytes + 1 },
    "content length above the file byte cap"
  );
  rejects(asset.UploadAssetFileParamsSchema, { fileId: "file-1", contentLengthBytes: 10 }, "missing session id");

  const response = accepts<{ archiveKey: string }>(
    asset.UploadAssetFileResponseSchema,
    {
      fileId: "file-1",
      uploadStatus: "ARCHIVED",
      byteSize: 1_048_576,
      sha256: "a".repeat(64),
      archiveKey: "imports/session-1/raw/aaaaaaaa.webp",
      archivedAt: now
    },
    "archived upload response"
  );
  assert.match(response.archiveKey, /^imports\//);
  rejects(
    asset.UploadAssetFileResponseSchema,
    { fileId: "file-1", uploadStatus: "ARCHIVED", byteSize: 10, sha256: "zz", archiveKey: "imports/s/raw/a.webp", archivedAt: now },
    "non-hex sha256"
  );
  rejects(
    asset.UploadAssetFileResponseSchema,
    { fileId: "file-1", uploadStatus: "ARCHIVED", byteSize: 10, sha256: "a".repeat(64), archiveKey: "/Users/x/a.jpg", archivedAt: now },
    "absolute archive key"
  );
});

test("session status response projects checkpoint, file and group review state", () => {
  const response = accepts<{ files: unknown[]; groups: unknown[] }>(
    asset.AssetImportSessionResponseSchema,
    sessionResponse(),
    "session status response"
  );
  assert.equal(response.files.length, 1);
  accepts(
    asset.AssetImportSessionResponseSchema,
    sessionResponse({ lastVerifiedCheckpoint: null }),
    "session without a verified checkpoint yet"
  );
  rejects(
    asset.AssetImportSessionResponseSchema,
    sessionResponse({ lastVerifiedCheckpoint: "UPLOADED" }),
    "non-canonical checkpoint in response"
  );
  const { lastVerifiedCheckpoint: _dropped, ...withoutCheckpoint } = sessionResponse();
  rejects(asset.AssetImportSessionResponseSchema, withoutCheckpoint, "missing checkpoint field");
  rejects(
    asset.AssetImportSessionResponseSchema,
    sessionResponse({ state: "REVIEW" }),
    "legacy session state in response"
  );
});

test("import sessions can be listed with strict query and summary shapes", () => {
  accepts(asset.ListAssetImportSessionsQuerySchema, {}, "empty query");
  accepts(
    asset.ListAssetImportSessionsQuerySchema,
    { state: "NEEDS_REVIEW", limit: 50, cursor: "cursor-1" },
    "filtered query"
  );
  rejects(asset.ListAssetImportSessionsQuerySchema, { limit: 0 }, "zero page size");
  rejects(asset.ListAssetImportSessionsQuerySchema, { limit: 101 }, "page size above the cap");
  rejects(asset.ListAssetImportSessionsQuerySchema, { state: "REVIEW" }, "legacy state filter");

  accepts(
    asset.ListAssetImportSessionsResponseSchema,
    { sessions: [sessionSummary()], nextCursor: null },
    "session list response"
  );
  accepts(
    asset.ListAssetImportSessionsResponseSchema,
    { sessions: [], nextCursor: "cursor-2" },
    "empty page with cursor"
  );
  rejects(
    asset.ListAssetImportSessionsResponseSchema,
    { sessions: [sessionSummary({ groupCount: undefined })], nextCursor: null },
    "summary missing groupCount"
  );
  accepts(
    asset.ListAssetImportSessionsResponseSchema,
    { sessions: [sessionSummary({ state: "CANCELLED", lastVerifiedCheckpoint: "GROUPED" })], nextCursor: null },
    "cancelled session summary is still listable"
  );
});

test("session cancellation is idempotent and answers CANCELLED", () => {
  accepts(asset.CancelAssetImportSessionParamsSchema, { sessionId: "session-1" }, "cancel params");
  accepts(asset.CancelAssetImportSessionRequestSchema, { idempotencyKey: "cancel-1" }, "cancel request");
  rejects(asset.CancelAssetImportSessionRequestSchema, {}, "cancel without idempotency key");
  accepts(
    asset.CancelAssetImportSessionResponseSchema,
    { sessionId: "session-1", state: "CANCELLED", cancelledAt: now },
    "cancel response"
  );
  rejects(
    asset.CancelAssetImportSessionResponseSchema,
    { sessionId: "session-1", state: "FAILED", cancelledAt: now },
    "cancel response claiming FAILED"
  );
  rejects(
    asset.CancelAssetImportSessionResponseSchema,
    { sessionId: "session-1", state: "CANCELLED" },
    "cancel response without cancelledAt"
  );
});

test("grouping and processing starts are explicit boundaries", () => {
  accepts(asset.StartAssetImportGroupingParamsSchema, { sessionId: "session-1" }, "grouping params");
  accepts(asset.StartAssetImportGroupingRequestSchema, { idempotencyKey: "grouping-1" }, "grouping request");
  rejects(asset.StartAssetImportGroupingRequestSchema, {}, "grouping without idempotency key");
  accepts(
    asset.StartAssetImportGroupingResponseSchema,
    { sessionId: "session-1", state: "PROCESSING", queuedJobCount: 4, startedAt: now },
    "grouping response"
  );
  rejects(
    asset.StartAssetImportGroupingResponseSchema,
    { sessionId: "session-1", state: "ARCHIVING", queuedJobCount: 4, startedAt: now },
    "grouping response claiming a non-processing state"
  );
  rejects(
    asset.StartAssetImportGroupingResponseSchema,
    { sessionId: "session-1", state: "PROCESSING", queuedJobCount: -1, startedAt: now },
    "negative queued job count"
  );

  accepts(asset.StartAssetImportProcessingParamsSchema, { sessionId: "session-1" }, "processing params");
  accepts(asset.StartAssetImportProcessingRequestSchema, { idempotencyKey: "processing-1" }, "processing request");
  accepts(
    asset.StartAssetImportProcessingResponseSchema,
    { sessionId: "session-1", state: "PROCESSING", queuedJobCount: 0, startedAt: now },
    "processing response"
  );
  rejects(
    asset.StartAssetImportProcessingResponseSchema,
    { sessionId: "session-1", state: "NEEDS_REVIEW", queuedJobCount: 0, startedAt: now },
    "processing response claiming a review state"
  );
});

test("group review actions validate membership, partitions and names", () => {
  accepts(asset.UpdateBeadImageGroupParamsSchema, { groupId: "group-1" }, "group params");
  accepts(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "紫水晶" },
    "SET_NAME action"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "" },
    "empty crystal name"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SET_NAME", crystalName: "紫水晶" },
    "SET_NAME without expectedGroupRevision"
  );
  accepts(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "MERGE_GROUPS", expectedGroupRevision: 1, sourceGroupIds: ["group-1", "group-2"] },
    "MERGE_GROUPS action"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "MERGE_GROUPS", expectedGroupRevision: 1, sourceGroupIds: ["group-1"] },
    "merge with a single source"
  );
  accepts(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1"], ["file-2", "file-3"]] },
    "SPLIT_GROUP action"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1", "file-2"]] },
    "split into a single partition"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1"], ["file-1"]] },
    "file duplicated across partitions"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1"], []] },
    "empty partition"
  );
  accepts(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "MOVE_FILES", expectedGroupRevision: 1, fileIds: ["file-1"], targetGroupId: "group-2" },
    "MOVE_FILES action"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "MOVE_FILES", expectedGroupRevision: 1, fileIds: ["file-1", "file-1"], targetGroupId: "group-2" },
    "duplicate moved file ids"
  );
  accepts(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SET_PRIMARY", expectedGroupRevision: 1, primaryFileId: "file-1" },
    "SET_PRIMARY action without client membership"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SET_PRIMARY", expectedGroupRevision: 1, primaryFileId: "file-1", memberFileIds: ["file-1", "file-2"] },
    "SET_PRIMARY must not accept client-supplied membership"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "SET_PRIMARY", expectedGroupRevision: 1 },
    "SET_PRIMARY without primaryFileId"
  );
  accepts(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "IGNORE_FILES", expectedGroupRevision: 1, fileIds: ["file-1"], reason: "模糊连拍" },
    "IGNORE_FILES action"
  );
  rejects(
    asset.UpdateBeadImageGroupRequestSchema,
    { action: "AUTO_IDENTIFY", expectedGroupRevision: 1 },
    "unknown group action"
  );

  accepts(
    asset.UpdateBeadImageGroupResponseSchema,
    { groupId: "group-1", state: "NAMED", revision: 2, memberFileIds: ["file-1"], primaryFileId: "file-1", crystalName: "紫水晶" },
    "group update response"
  );
  rejects(
    asset.UpdateBeadImageGroupResponseSchema,
    { groupId: "group-1", state: "NAMED", revision: 0, memberFileIds: [] },
    "non-positive group revision"
  );
});

test("reprocess requests accept only bounded adjustment settings", () => {
  accepts(asset.ReprocessBeadImageGroupParamsSchema, { groupId: "group-1" }, "reprocess params");
  accepts(
    asset.ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-1", expectedGroupRevision: 2, settings: { maskThreshold: 0.42, edgeFeatherPx: 1.5 } },
    "bounded reprocess settings"
  );
  accepts(
    asset.ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-2", expectedGroupRevision: 2 },
    "reprocess without settings"
  );
  rejects(
    asset.ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-3", expectedGroupRevision: 2, settings: { maskThreshold: 1.4 } },
    "maskThreshold above 1"
  );
  rejects(
    asset.ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-4", expectedGroupRevision: 2, settings: { model: "inpaint-xl" } },
    "unknown reprocess setting"
  );
  rejects(
    asset.ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-5", expectedGroupRevision: 2, outputPath: "/tmp/processed.png" },
    "client-supplied output path"
  );

  accepts(
    asset.ReprocessBeadImageGroupResponseSchema,
    { groupId: "group-1", jobId: "job-1", jobState: "QUEUED", processingVersion: 2 },
    "reprocess response"
  );
});

test("processed versions are selected explicitly per group", () => {
  accepts(asset.SelectProcessedVersionParamsSchema, { groupId: "group-1" }, "select version params");
  accepts(
    asset.SelectProcessedVersionRequestSchema,
    { expectedGroupRevision: 3, processingVersion: 2 },
    "select version request"
  );
  rejects(
    asset.SelectProcessedVersionRequestSchema,
    { expectedGroupRevision: 3 },
    "selection without processingVersion"
  );
  rejects(
    asset.SelectProcessedVersionRequestSchema,
    { expectedGroupRevision: 3, processingVersion: 0 },
    "non-positive processingVersion"
  );
  rejects(
    asset.SelectProcessedVersionRequestSchema,
    { expectedGroupRevision: 3, processingVersion: 2, assetId: "asset-1" },
    "selection by client asset id"
  );
  accepts(
    asset.SelectProcessedVersionResponseSchema,
    { groupId: "group-1", state: "PROCESSED", selectedProcessingVersion: 2, updatedAt: now },
    "select version response"
  );
  rejects(
    asset.SelectProcessedVersionResponseSchema,
    { groupId: "group-1", state: "PROCESSED", selectedProcessingVersion: 0, updatedAt: now },
    "non-positive selected version"
  );
});

test("product drafts save partially and keep unresolved permissions local", () => {
  accepts(asset.SaveBeadProductDraftParamsSchema, { groupId: "group-1" }, "draft params");
  accepts(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 1, crystalName: "紫水晶" },
    "draft save with a single field"
  );
  accepts(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, usagePermission: "UNKNOWN" },
    "draft with UNKNOWN usage permission"
  );
  accepts(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, usagePermission: "PROHIBITED" },
    "draft with PROHIBITED usage permission stays local"
  );
  accepts(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, allowPublicDisplay: false, allowCommercialUse: false },
    "draft may record negative display and commercial decisions locally"
  );
  accepts(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, crystalId: "crystal-amethyst", displayName: "紫水晶 8mm 圆珠" },
    "draft linked to an existing crystal"
  );
  accepts(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, crystalDraftId: "draft-amethyst" },
    "draft linked to a crystal draft"
  );
  rejects(asset.SaveBeadProductDraftRequestSchema, { expectedGroupRevision: 1 }, "draft save without any field");
  rejects(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, crystalId: "crystal-amethyst", crystalDraftId: "draft-amethyst" },
    "draft linked to both a crystal and a draft"
  );
  rejects(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, usagePermission: "LICENSED" },
    "non-canonical usage permission"
  );
  rejects(
    asset.SaveBeadProductDraftRequestSchema,
    { expectedGroupRevision: 2, availableQuantity: -1 },
    "negative draft inventory"
  );

  accepts(
    asset.SaveBeadProductDraftResponseSchema,
    { groupId: "group-1", state: "NAMED", revision: 2, draftSavedAt: now },
    "draft save response"
  );
});

test("draft completeness reports every publish-required field", () => {
  assert.ok(Array.isArray(asset.DRAFT_COMPLETENESS_FIELDS), "completeness field list is exported");
  for (const field of asset.DRAFT_COMPLETENESS_FIELDS) {
    accepts(asset.DraftCompletenessFieldSchema, field, `completeness field ${field}`);
  }
  accepts(asset.DraftCompletenessFieldSchema, "SKU", "SKU is a publish-required completeness field");
  rejects(asset.DraftCompletenessFieldSchema, "PRICE", "non-canonical completeness field");

  accepts(asset.CheckBeadProductDraftCompletenessParamsSchema, { groupId: "group-1" }, "completeness params");
  accepts(
    asset.CheckBeadProductDraftCompletenessResponseSchema,
    { groupId: "group-1", state: "READY", complete: true, missingFields: [], checkedAt: now },
    "complete draft"
  );
  accepts(
    asset.CheckBeadProductDraftCompletenessResponseSchema,
    {
      groupId: "group-1",
      state: "NAMED",
      complete: false,
      missingFields: ["SKU", "CRYSTAL_NAME", "QUALITY_STATEMENT", "AI_TRAINING_DECISION"],
      checkedAt: now
    },
    "incomplete draft"
  );
  rejects(
    asset.CheckBeadProductDraftCompletenessResponseSchema,
    { groupId: "group-1", state: "READY", complete: true, missingFields: ["QUALITY_SOURCE"], checkedAt: now },
    "complete flag with missing fields"
  );
  rejects(
    asset.CheckBeadProductDraftCompletenessResponseSchema,
    { groupId: "group-1", state: "NAMED", complete: false, missingFields: [], checkedAt: now },
    "incomplete flag without missing fields"
  );
  rejects(
    asset.CheckBeadProductDraftCompletenessResponseSchema,
    { groupId: "group-1", state: "NAMED", complete: false, missingFields: ["PRICE"], checkedAt: now },
    "unknown completeness field"
  );
});

test("publish-required business fields map one-to-one onto completeness fields", () => {
  const targets = Object.values(asset.PUBLISH_REQUIRED_FIELDS_TO_COMPLETENESS);
  assert.ok(targets.length > 0, "publish-to-completeness mapping is exported");
  assert.equal(new Set(targets).size, targets.length, "each publish field maps to a distinct completeness field");
  assert.deepEqual(
    [...targets].sort(),
    [...asset.DRAFT_COMPLETENESS_FIELDS].sort(),
    "every completeness field is covered by exactly one publish-required business field"
  );
  for (const field of targets) {
    accepts(asset.DraftCompletenessFieldSchema, field, `mapped completeness field ${field}`);
  }
  assert.equal(asset.PUBLISH_REQUIRED_FIELDS_TO_COMPLETENESS.sku, "SKU", "sku maps to the SKU completeness field");
  assert.equal(
    asset.PUBLISH_REQUIRED_FIELDS_TO_COMPLETENESS.crystalReference,
    "CRYSTAL_REFERENCE",
    "the crystalId/crystalDraftId pair maps to CRYSTAL_REFERENCE"
  );
});

test("approved asset keys are stable, content-addressed and distinct from archive keys", () => {
  accepts(asset.ApprovedAssetKeySchema, approvedKey, "approved key");
  accepts(asset.ApprovedAssetKeySchema, `approved:${"0".repeat(63)}f`, "approved key with mixed digest");
  const notApprovedKeys = [
    `approved:${"A".repeat(64)}`,
    `approved:${"a".repeat(63)}`,
    `approved:${"a".repeat(65)}`,
    "approved/imports/session-1/raw/a.jpg",
    "a".repeat(64),
    "imports/session-1/raw/a.jpg",
    "imports/session-1/processed/group-1/v1/bead-512.webp",
    "01/DSC0001.JPG",
    "/Users/chenyanyan/Desktop/珠子图/01/DSC0001.JPG",
    "../approved/a.jpg",
    "APPROVED:" + "a".repeat(64),
    ""
  ];
  for (const key of notApprovedKeys) {
    rejects(asset.ApprovedAssetKeySchema, key, `non-approved key ${key}`);
  }
});

test("approved asset delivery metadata is content-addressed and immutable", () => {
  accepts(asset.ResolveApprovedAssetParamsSchema, { assetKey: approvedKey }, "resolver params");
  rejects(asset.ResolveApprovedAssetParamsSchema, { assetKey: "imports/session-1/raw/a.jpg" }, "resolver params with archive key");
  rejects(asset.ResolveApprovedAssetParamsSchema, { assetKey: approvedKey, path: "/tmp/x" }, "resolver params with a filesystem path");

  accepts(asset.ApprovedAssetDeliveryMetadataSchema, deliveryMetadata(), "content-addressed delivery metadata");
  for (const contentType of ["image/webp", "image/png", "image/jpeg"]) {
    accepts(asset.ApprovedAssetDeliveryMetadataSchema, deliveryMetadata({ contentType }), `delivery content type ${contentType}`);
  }
  rejects(asset.ApprovedAssetDeliveryMetadataSchema, deliveryMetadata({ contentType: "image/gif" }), "unsupported delivery content type");
  rejects(asset.ApprovedAssetDeliveryMetadataSchema, deliveryMetadata({ byteSize: 0 }), "zero-byte delivery");
  rejects(asset.ApprovedAssetDeliveryMetadataSchema, deliveryMetadata({ sha256: "zz" }), "invalid delivery sha256");
  rejects(asset.ApprovedAssetDeliveryMetadataSchema, deliveryMetadata({ etag: undefined }), "missing etag");
  rejects(asset.ApprovedAssetDeliveryMetadataSchema, deliveryMetadata({ cacheControl: undefined }), "missing cache control");

  rejects(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata({ assetKey: otherApprovedKey }),
    "assetKey digest differing from the delivered sha256"
  );
  rejects(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata({ sha256: "b".repeat(64) }),
    "sha256 differing from the assetKey digest"
  );
  rejects(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata({ etag: `"${"b".repeat(64)}"` }),
    "etag quoting a different digest"
  );
  rejects(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata({ etag: `W/"${"a".repeat(64)}"` }),
    "weak etag"
  );
  rejects(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata({ etag: "a".repeat(64) }),
    "unquoted etag"
  );
  rejects(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata({ cacheControl: "private, no-store" }),
    "non-immutable cache directive"
  );
  rejects(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata({ cacheControl: "public, max-age=3600" }),
    "mutable cache directive"
  );
});

test("approved asset delivery answers binary image bytes with validated transport headers", () => {
  accepts(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders(), "delivery transport headers");
  for (const contentType of ["image/webp", "image/png", "image/jpeg"]) {
    accepts(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ "Content-Type": contentType }), `header content type ${contentType}`);
  }
  rejects(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ "Content-Type": "application/json" }), "JSON is never the delivery body type");
  rejects(
    asset.ApprovedAssetDeliveryHeadersSchema,
    deliveryHeaders({ "Content-Length": undefined }),
    "missing Content-Length header"
  );
  rejects(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ "Content-Length": "0" }), "zero Content-Length");
  rejects(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ "Content-Length": "-1" }), "negative Content-Length");
  rejects(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ "Content-Length": 65_536 }), "numeric Content-Length instead of a header string");
  rejects(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ ETag: undefined }), "missing ETag header");
  rejects(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ ETag: `W/"${"a".repeat(64)}"` }), "weak ETag header");
  rejects(asset.ApprovedAssetDeliveryHeadersSchema, deliveryHeaders({ "Cache-Control": undefined }), "missing Cache-Control header");
  rejects(
    asset.ApprovedAssetDeliveryHeadersSchema,
    deliveryHeaders({ "Cache-Control": "private, no-store" }),
    "non-immutable Cache-Control header"
  );
  rejects(
    asset.ApprovedAssetDeliveryHeadersSchema,
    { ...deliveryHeaders(), "X-Local-Path": "/Users/x/a.webp" },
    "delivery headers leaking a filesystem path"
  );

  const metadata = accepts<{ byteSize: number }>(
    asset.ApprovedAssetDeliveryMetadataSchema,
    deliveryMetadata(),
    "metadata for header derivation"
  );
  const headers = asset.approvedAssetDeliveryHeaders(metadata as never);
  assert.deepEqual(headers, deliveryHeaders(), "derived headers are exactly the four validated transport headers");
  assert.equal(headers["Content-Length"], String(metadata.byteSize), "Content-Length equals the metadata byte size");
  accepts(asset.ApprovedAssetDeliveryHeadersSchema, headers, "derived headers validate");
});

test("publish requests require full product, consent and public-key fields", () => {
  const accepted = accepts<{
    crystalName: string;
    allowPublicDisplay: boolean;
    allowAiTraining: boolean;
    allowAiRecommendation: boolean;
  }>(asset.PublishBeadImageGroupRequestSchema, publishRequest(), "complete publish request");
  assert.equal(accepted.crystalName, "紫水晶");
  assert.equal(accepted.allowPublicDisplay, true);
  assert.equal(accepted.allowAiTraining, false);
  assert.equal(accepted.allowAiRecommendation, false);

  accepts(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ allowAiTraining: false, allowAiRecommendation: true }),
    "AI recommendation decision is independent of AI training consent"
  );
  accepts(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({
      crystalId: undefined,
      crystalDraftId: "draft-amethyst",
      crystalDraftPromotionConfirmed: true
    }),
    "publish through an explicitly approved crystal draft promotion"
  );
  accepts(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ modelAssetKey: otherApprovedKey }),
    "optional model asset key with an approved key"
  );

  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ crystalId: undefined }), "publish without any crystal reference");
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ crystalDraftId: "draft-amethyst", crystalDraftPromotionConfirmed: true }),
    "publish referencing both a crystal and a draft"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ crystalId: undefined, crystalDraftId: "draft-amethyst" }),
    "draft promotion without explicit confirmation"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ crystalId: undefined, crystalDraftId: "draft-amethyst", crystalDraftPromotionConfirmed: false }),
    "draft promotion confirmed with false"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ crystalDraftPromotionConfirmed: true }),
    "promotion confirmation without a crystal draft"
  );

  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ crystalName: "" }), "empty crystal name");
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ crystalNameConfirmedByOperator: false }),
    "publish without operator confirmation"
  );
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ qualityStatement: "" }), "empty quality statement");
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ qualitySource: "" }), "empty quality source");
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ qualityStatement: undefined }),
    "publish without a quality statement"
  );

  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ textureAssetKey: undefined }),
    "publish without a public texture asset key"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ textureAssetKey: "imports/session-1/processed/group-1/v1/bead-512.webp" }),
    "texture key using a private archive key"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ textureAssetKey: "01/DSC0001.JPG" }),
    "texture key using a client relative path"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ modelAssetKey: "imports/session-1/processed/group-1/v1/model.glb" }),
    "model key using a private archive key"
  );

  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ allowAiTraining: undefined }), "publish without an AI training decision");
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ allowCommercialUse: undefined }), "publish without a commercial-use decision");
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ allowPublicDisplay: undefined }), "publish without a public-display decision");
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ isAuthenticPhotograph: undefined }), "publish without the authentic-photo declaration");
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ allowAiRecommendation: undefined }), "publish without an AI recommendation decision");

  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ allowPublicDisplay: false }),
    "publish without an affirmative public-display grant"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ allowCommercialUse: false }),
    "publish without an affirmative commercial-use grant"
  );
  accepts(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ allowAiTraining: false, allowAiRecommendation: false }),
    "AI training and recommendation decisions may deny consent at publication"
  );

  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ sourcePath: "/Users/chenyanyan/Desktop/珠子图/01/DSC0001.JPG" }),
    "publish with an absolute source path"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ processedPath: "imports/session-1/processed/asset-1/v1/bead-512.webp" }),
    "publish with a fabricated processing result path"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ assetArchiveKey: "imports/session-1/raw/a.jpg" }),
    "publish with a client-supplied storage key"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ approvedAssetIds: ["asset-512-main"] }),
    "publish carrying the removed approvedAssetIds field"
  );
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ shape: "HEART" }), "unknown bead shape");
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ currency: "USD" }), "unsupported currency");
  rejects(asset.PublishBeadImageGroupRequestSchema, publishRequest({ availableQuantity: -1 }), "negative inventory");
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ usagePermission: "UNKNOWN" }),
    "publish while usage permission is UNKNOWN"
  );
  rejects(
    asset.PublishBeadImageGroupRequestSchema,
    publishRequest({ usagePermission: "PROHIBITED", allowPublicDisplay: true }),
    "publish while usage permission is PROHIBITED"
  );
});

test("publish responses and publish results only carry approved public keys", () => {
  accepts(asset.PublishBeadImageGroupParamsSchema, { groupId: "group-1" }, "publish params");
  accepts(asset.PublishBeadImageGroupResponseSchema, publishResponse(), "publish response");
  accepts(
    asset.PublishBeadImageGroupResponseSchema,
    publishResponse({ publishedAssetKeys: [approvedKey, otherApprovedKey] }),
    "publish response with several approved keys"
  );
  rejects(
    asset.PublishBeadImageGroupResponseSchema,
    publishResponse({ state: "READY" }),
    "publish response without the PUBLISHED literal"
  );
  rejects(
    asset.PublishBeadImageGroupResponseSchema,
    publishResponse({ publishedAssetKeys: [] }),
    "publish response without public asset keys"
  );
  rejects(
    asset.PublishBeadImageGroupResponseSchema,
    publishResponse({ publishedAssetKeys: ["imports/session-1/raw/a.jpg"] }),
    "publish response leaking an archive key"
  );

  accepts(asset.GetBeadImageGroupPublishResultParamsSchema, { groupId: "group-1" }, "publish result params");
  accepts(asset.GetBeadImageGroupPublishResultResponseSchema, publishResponse(), "publish result response");
  rejects(
    asset.GetBeadImageGroupPublishResultResponseSchema,
    publishResponse({ state: "PUBLISHING" }),
    "publish result before publication completed"
  );
});

test("asset import errors keep transport codes separate from asset codes", () => {
  const expectedAssetCodes = [
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
  assert.deepEqual([...asset.ASSET_IMPORT_ERROR_CODES].sort(), [...expectedAssetCodes].sort());
  for (const code of expectedAssetCodes) {
    accepts(asset.AssetImportErrorCodeSchema, code, `asset code ${code}`);
  }
  rejects(asset.AssetImportErrorCodeSchema, "LEGACY_ERROR", "non-canonical asset code");
  rejects(asset.AssetImportErrorCodeSchema, "VALIDATION_ERROR", "shared transport code used as an asset code");

  const expectedRecoveryActions = [
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
  assert.deepEqual([...asset.ASSET_IMPORT_ERROR_RECOVERY_ACTIONS].sort(), [...expectedRecoveryActions].sort());
  for (const action of expectedRecoveryActions) {
    accepts(asset.AssetImportErrorRecoveryActionSchema, action, `recovery action ${action}`);
  }
  rejects(asset.AssetImportErrorRecoveryActionSchema, "IGNORE", "non-canonical recovery action");

  assert.deepEqual(Object.keys(asset.ASSET_IMPORT_ERROR_CATALOG).sort(), [...expectedAssetCodes].sort());
  for (const [assetCode, guidance] of Object.entries(asset.ASSET_IMPORT_ERROR_CATALOG)) {
    assert.equal(typeof guidance.retryable, "boolean", `${assetCode} retryability must be a boolean`);
    accepts(asset.AssetImportErrorRecoveryActionSchema, guidance.recoveryAction, `${assetCode} recovery action`);
    accepts(
      asset.AssetImportErrorDetailSchema,
      errorDetail({ assetCode, retryable: guidance.retryable, recoveryAction: guidance.recoveryAction }),
      `error detail for ${assetCode}`
    );
  }

  // Every spec §11 failure category maps to at least one stable asset code.
  const categories: ReadonlyArray<readonly string[]> = [
    ["UNSUPPORTED_FILE_KIND", "CORRUPT_FILE_CONTENT"],
    ["STORAGE_FULL", "ARCHIVE_VERIFICATION_FAILED"],
    ["ARCHIVE_CONFLICT", "JOB_LEASE_CONFLICT"],
    ["SEGMENTATION_FAILED", "QUALITY_INSUFFICIENT"],
    ["ADMIN_PERMISSION_EXPIRED"],
    ["DRAFT_INCOMPLETE", "MISSING_REFERENCE"],
    ["SKU_CONFLICT", "INVENTORY_VERSION_CONFLICT", "PUBLISH_TRANSACTION_FAILED"]
  ];
  for (const codes of categories) {
    for (const code of codes) {
      assert.ok(expectedAssetCodes.includes(code as never), `category code ${code} must exist`);
    }
  }

  // error.code uses only the shared HTTP transport vocabulary.
  const expectedTransportCodes = [
    "UNAUTHORIZED",
    "VALIDATION_ERROR",
    "NOT_FOUND",
    "CONFLICT",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "UNPROCESSABLE_ENTITY",
    "INTERNAL_ERROR"
  ] as const;
  assert.deepEqual([...asset.ASSET_IMPORT_TRANSPORT_ERROR_CODES].sort(), [...expectedTransportCodes].sort());
  for (const code of expectedTransportCodes) {
    accepts(asset.AssetImportTransportErrorCodeSchema, code, `transport code ${code}`);
  }
  rejects(asset.AssetImportTransportErrorCodeSchema, "STORAGE_FULL", "asset code masquerading as a transport code");
  rejects(asset.AssetImportTransportErrorCodeSchema, "PAYLOAD_LIMIT", "non-canonical transport code");
  assert.deepEqual(asset.ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE, {
    UNAUTHORIZED: 401,
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    CONFLICT: 409,
    PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_ERROR: 500
  });

  // Every asset code binds to exactly one transport code and the envelope enforces the pairing.
  assert.deepEqual(Object.keys(asset.ASSET_IMPORT_ERROR_TRANSPORT_CODES).sort(), [...expectedAssetCodes].sort());
  for (const assetCode of expectedAssetCodes) {
    const transportCode = asset.ASSET_IMPORT_ERROR_TRANSPORT_CODES[assetCode];
    accepts(asset.AssetImportTransportErrorCodeSchema, transportCode, `transport binding for ${assetCode}`);
    const guidance = asset.ASSET_IMPORT_ERROR_CATALOG[assetCode];
    accepts(
      asset.AssetImportErrorEnvelopeSchema,
      errorEnvelope({ code: transportCode, assetCode, retryable: guidance.retryable, recoveryAction: guidance.recoveryAction }),
      `envelope binding ${assetCode} -> ${transportCode}`
    );
  }

  accepts(asset.AssetImportErrorEnvelopeSchema, errorEnvelope(), "asset import error envelope");
  rejects(
    asset.AssetImportErrorEnvelopeSchema,
    errorEnvelope({ code: "STORAGE_FULL" }),
    "business asset code placed in the shared transport code slot"
  );
  rejects(
    asset.AssetImportErrorEnvelopeSchema,
    errorEnvelope({ code: "VALIDATION_ERROR" }),
    "transport code disagreeing with the asset code binding"
  );
  rejects(asset.AssetImportErrorEnvelopeSchema, { error: { ...errorDetail() } }, "envelope without transport code and requestId");
  rejects(
    asset.AssetImportErrorEnvelopeSchema,
    { error: { code: "INTERNAL_ERROR", message: "x", requestId: "req-1" } },
    "envelope without asset detail"
  );
  rejects(
    asset.AssetImportErrorEnvelopeSchema,
    { error: { code: "INTERNAL_ERROR", ...errorDetail({ assetCode: undefined }), requestId: "req-1" } },
    "envelope without assetCode"
  );
  rejects(asset.AssetImportErrorEnvelopeSchema, { ...errorEnvelope(), requestId: "outer" }, "requestId outside the shared error object");
  rejects(asset.AssetImportErrorEnvelopeSchema, { error: { code: "INTERNAL_ERROR", ...errorDetail(), requestId: "req-1" }, extra: 1 }, "unknown envelope outer key");

  rejects(
    asset.AssetImportErrorDetailSchema,
    errorDetail({ retryable: false }),
    "retryability disagreeing with the stable catalog"
  );
  rejects(
    asset.AssetImportErrorDetailSchema,
    errorDetail({ recoveryAction: "IGNORE" }),
    "recovery action disagreeing with the stable catalog"
  );
  rejects(asset.AssetImportErrorDetailSchema, errorDetail({ message: "" }), "empty error message");
  rejects(
    asset.AssetImportErrorDetailSchema,
    errorDetail({ code: "STORAGE_FULL" }),
    "legacy code field instead of assetCode"
  );
  rejects(
    asset.AssetImportErrorEnvelopeSchema,
    errorEnvelope({ retryable: false }),
    "envelope retryability disagreeing with the catalog"
  );
  rejects(
    asset.AssetImportErrorEnvelopeSchema,
    errorEnvelope({ recoveryAction: "IGNORE" }),
    "envelope recovery action disagreeing with the catalog"
  );
});
