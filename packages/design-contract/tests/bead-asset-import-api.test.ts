import assert from "node:assert/strict";
import test from "node:test";
import type { ZodType } from "zod";

import {
  ASSET_MANIFEST_LIMITS,
  AssetImportSessionResponseSchema,
  ASSET_IMPORT_SESSION_TRANSITIONS,
  AssetImportSessionStateSchema,
  AssetProcessingJobStateSchema,
  ASSET_SOURCE_FILE_TRANSITIONS,
  AssetSourceFileKindSchema,
  AssetSourceFileStateSchema,
  BeadImageGroupStateSchema,
  canTransitionAssetImportSession,
  CreateAssetImportSessionRequestSchema,
  CreateAssetImportSessionResponseSchema,
  isAllowedAssetSourceExtension,
  normalizeAssetRelativePath,
  ProcessedAssetStateSchema,
  PublishBeadImageGroupRequestSchema,
  PublishBeadImageGroupResponseSchema,
  RegisterAssetManifestRequestSchema,
  RegisterAssetManifestResponseSchema,
  ReprocessBeadImageGroupRequestSchema,
  ReprocessBeadImageGroupResponseSchema,
  UpdateBeadImageGroupRequestSchema,
  UpdateBeadImageGroupResponseSchema,
  UploadAssetFileParamsSchema,
  UploadAssetFileResponseSchema
} from "../src/schemas/bead-asset-import-api.schema";

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
  "FAILED"
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

const publishRequest = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "publish-group-1",
  expectedGroupRevision: 3,
  crystalName: "紫水晶",
  crystalNameConfirmedByOperator: true,
  displayName: "紫水晶 8mm 圆珠",
  sku: "BEAD-AMETHYST-8",
  materialKey: "amethyst-round-8",
  shape: "ROUND",
  diameterMm: 8,
  currency: "CNY",
  unitPriceMinor: 12_800,
  costMinor: 4_000,
  availableQuantity: 12,
  allowPublicDisplay: true,
  allowAiRecommendation: false,
  rightsHolder: "玄矶工作室",
  usagePermission: "GRANTED",
  isAuthenticPhotograph: true,
  approvedAssetIds: ["asset-512-main"],
  ...overrides
});

test("session state enum exposes exactly the canonical states", () => {
  for (const state of sessionStates) {
    accepts(AssetImportSessionStateSchema, state, `session state ${state}`);
  }
  rejects(AssetImportSessionStateSchema, "GROUPING", "legacy session state GROUPING");
  rejects(AssetImportSessionStateSchema, "published", "lowercase session state");
});

test("session transition table covers every state and only legal moves", () => {
  assert.deepEqual(Object.keys(ASSET_IMPORT_SESSION_TRANSITIONS).sort(), [...sessionStates].sort());

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
      canTransitionAssetImportSession(from as never, to as never),
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
      canTransitionAssetImportSession(from as never, to as never),
      false,
      `${from} -> ${to} must be illegal`
    );
  }
  assert.equal(canTransitionAssetImportSession("UNKNOWN" as never, "PUBLISHED" as never), false);
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
      ASSET_SOURCE_FILE_TRANSITIONS[from as keyof typeof ASSET_SOURCE_FILE_TRANSITIONS]?.includes(to as never),
      `file ${from} -> ${to} must be legal`
    );
  }
  assert.ok(!ASSET_SOURCE_FILE_TRANSITIONS.PENDING.includes("ARCHIVED" as never), "files cannot be archived without upload verification");
  assert.equal(ASSET_SOURCE_FILE_TRANSITIONS.ARCHIVED.length, 0, "archived source files are immutable");
  for (const state of ["PENDING", "UPLOADING", "ARCHIVED", "FAILED", "SKIPPED_DUPLICATE"]) {
    accepts(AssetSourceFileStateSchema, state, `file state ${state}`);
  }
});

test("group, processed asset and job states parse strictly", () => {
  for (const state of ["SUGGESTED", "CONFIRMED", "NAMED", "PROCESSED", "QC_FAILED", "READY", "PUBLISHED"]) {
    accepts(BeadImageGroupStateSchema, state, `group state ${state}`);
  }
  rejects(BeadImageGroupStateSchema, "APPROVED", "non-canonical group state");
  for (const state of ["DRAFT", "QC_PENDING", "QC_FAILED", "APPROVED", "RETIRED"]) {
    accepts(ProcessedAssetStateSchema, state, `processed asset state ${state}`);
  }
  rejects(ProcessedAssetStateSchema, "PUBLIC", "processed asset state PUBLIC");
  for (const state of ["QUEUED", "RUNNING", "COMPLETED", "FAILED"]) {
    accepts(AssetProcessingJobStateSchema, state, `job state ${state}`);
  }
  rejects(AssetProcessingJobStateSchema, "DONE", "non-canonical job state");
});

test("every object schema rejects unknown keys", () => {
  const cases: ReadonlyArray<readonly [string, ZodType, unknown]> = [
    ["CreateAssetImportSessionRequest", CreateAssetImportSessionRequestSchema, { idempotencyKey: "k-1", bogus: 1 }],
    ["CreateAssetImportSessionResponse", CreateAssetImportSessionResponseSchema, { sessionId: "session-1", state: "CREATED", createdAt: "2026-09-01T09:00:00+08:00", bogus: 1 }],
    ["RegisterAssetManifestRequest", RegisterAssetManifestRequestSchema, { ...manifestRequest(), bogus: 1 }],
    ["RegisterAssetManifestResponse", RegisterAssetManifestResponseSchema, { sessionId: "session-1", registeredFileCount: 1, files: [{ fileId: "file-1", clientFileId: "file-001", uploadStatus: "PENDING", createdAt: "2026-09-01T09:00:00+08:00" }], bogus: 1 }],
    ["UploadAssetFileParams", UploadAssetFileParamsSchema, { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 10, bogus: 1 }],
    ["UploadAssetFileResponse", UploadAssetFileResponseSchema, { fileId: "file-1", uploadStatus: "ARCHIVED", byteSize: 10, sha256: "a".repeat(64), archiveKey: "imports/session-1/raw/a.jpg", archivedAt: "2026-09-01T09:00:00+08:00", storagePath: "/tmp/x", bogus: 1 }],
    ["AssetImportSessionResponse", AssetImportSessionResponseSchema, { sessionId: "session-1", state: "CREATED", createdAt: "2026-09-01T09:00:00+08:00", updatedAt: "2026-09-01T09:00:00+08:00", declaredFileCount: 0, uploadedFileCount: 0, archivedFileCount: 0, failedFileCount: 0, declaredBytes: 0, uploadedBytes: 0, files: [], groups: [], bogus: 1 }],
    ["UpdateBeadImageGroupRequest", UpdateBeadImageGroupRequestSchema, { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "紫水晶", bogus: 1 }],
    ["UpdateBeadImageGroupResponse", UpdateBeadImageGroupResponseSchema, { groupId: "group-1", state: "NAMED", revision: 2, memberFileIds: [], bogus: 1 }],
    ["ReprocessBeadImageGroupRequest", ReprocessBeadImageGroupRequestSchema, { idempotencyKey: "rp-1", expectedGroupRevision: 2, settings: {}, bogus: 1 }],
    ["ReprocessBeadImageGroupResponse", ReprocessBeadImageGroupResponseSchema, { groupId: "group-1", jobId: "job-1", jobState: "QUEUED", processingVersion: 2, bogus: 1 }],
    ["PublishBeadImageGroupRequest", PublishBeadImageGroupRequestSchema, { ...publishRequest(), bogus: 1 }],
    ["PublishBeadImageGroupResponse", PublishBeadImageGroupResponseSchema, { groupId: "group-1", state: "PUBLISHED", materialProductId: "product-1", crystalId: "crystal-1", inventorySnapshotId: "inv-1", publishedAt: "2026-09-01T09:00:00+08:00", publishedAssetKeys: ["asset-512-main"], bogus: 1 }]
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
    rejects(RegisterAssetManifestRequestSchema, manifestRequest({ files: [manifestEntry({ relativePath })] }), `manifest path ${relativePath}`);
    assert.throws(() => normalizeAssetRelativePath(relativePath), `normalizeAssetRelativePath(${relativePath})`);
  }
  assert.equal(normalizeAssetRelativePath("01/DSC0001.JPG"), "01/DSC0001.JPG");
  assert.equal(normalizeAssetRelativePath("01/./DSC0001.JPG"), "01/DSC0001.JPG");
  assert.equal(normalizeAssetRelativePath("./01/DSC0001.JPG"), "01/DSC0001.JPG");
  rejects(
    RegisterAssetManifestRequestSchema,
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
      RegisterAssetManifestRequestSchema,
      manifestRequest({ files: [manifestEntry({ relativePath, kind })] }),
      `manifest ${relativePath} as ${kind}`
    );
    assert.equal(isAllowedAssetSourceExtension(relativePath), true, relativePath);
  }

  rejects(AssetSourceFileKindSchema, "GIF", "GIF kind");
  rejects(AssetSourceFileKindSchema, "HEIC", "HEIC kind");
  rejects(AssetSourceFileKindSchema, "TIFF", "TIFF kind");
  for (const relativePath of ["01/photo.gif", "01/photo.heic", "01/photo.tif", "01/photo.txt", "01/no-extension"]) {
    assert.equal(isAllowedAssetSourceExtension(relativePath), false, relativePath);
    rejects(RegisterAssetManifestRequestSchema, manifestRequest({ files: [manifestEntry({ relativePath, kind: "JPEG" })] }), `manifest ${relativePath}`);
  }
  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ relativePath: "01/DSC0001.JPG", kind: "PNG" })] }),
    "extension/kind mismatch"
  );
});

test("manifest registration enforces count, size and uniqueness limits", () => {
  const manyFiles = Array.from({ length: ASSET_MANIFEST_LIMITS.maxFiles + 1 }, (_, index) =>
    manifestEntry({ clientFileId: `file-${index}`, relativePath: `01/DSC${String(index).padStart(4, "0")}.JPG` })
  );
  rejects(RegisterAssetManifestRequestSchema, manifestRequest({ files: manyFiles }), "over max file count");

  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ byteSize: ASSET_MANIFEST_LIMITS.maxFileBytes + 1 })] }),
    "single file over the byte cap"
  );
  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ byteSize: 0 })] }),
    "zero-byte file"
  );
  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({
      files: Array.from({ length: 33 }, (_, index) =>
        manifestEntry({
          clientFileId: `bulk-${index}`,
          relativePath: `bulk/DSC${String(index).padStart(4, "0")}.JPG`,
          byteSize: ASSET_MANIFEST_LIMITS.maxFileBytes
        })
      )
    }),
    "session total over the byte cap"
  );
  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry(), manifestEntry({ relativePath: "02/DSC0002.JPG" })] }),
    "duplicate clientFileId"
  );
  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry(), manifestEntry({ clientFileId: "file-002" })] }),
    "duplicate relativePath"
  );
  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [] }),
    "empty manifest"
  );
  rejects(
    RegisterAssetManifestRequestSchema,
    manifestRequest({ files: [manifestEntry({ lastModifiedMs: -1 })] }),
    "negative lastModifiedMs"
  );
});

test("session creation accepts an idempotency key and rejects foreign fields", () => {
  const parsed = accepts<{ sessionId: string; state: string }>(
    CreateAssetImportSessionRequestSchema,
    { idempotencyKey: "import-2026-09-01" },
    "minimal session creation"
  );
  assert.equal(parsed.sessionId, undefined);
  rejects(CreateAssetImportSessionRequestSchema, {}, "missing idempotency key");
  rejects(
    CreateAssetImportSessionRequestSchema,
    { idempotencyKey: "import-1", sourceRoot: "/Users/chenyanyan/Desktop/珠子图" },
    "client-supplied filesystem root"
  );
  accepts(
    CreateAssetImportSessionResponseSchema,
    { sessionId: "session-1", state: "CREATED", createdAt: "2026-09-01T09:00:00+08:00" },
    "session creation response"
  );
});

test("upload params and response never carry client or server filesystem paths", () => {
  accepts(
    UploadAssetFileParamsSchema,
    { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 1_048_576 },
    "upload params"
  );
  rejects(UploadAssetFileParamsSchema, { sessionId: "session-1", fileId: "file-1", contentLengthBytes: 10, localPath: "/Users/x/a.jpg" }, "upload params with localPath");
  rejects(UploadAssetFileParamsSchema, { sessionId: "session-1", fileId: "file-1", contentLengthBytes: -1 }, "negative content length");
  rejects(UploadAssetFileParamsSchema, { fileId: "file-1", contentLengthBytes: 10 }, "missing session id");

  const response = accepts<{ archiveKey: string }>(
    UploadAssetFileResponseSchema,
    {
      fileId: "file-1",
      uploadStatus: "ARCHIVED",
      byteSize: 1_048_576,
      sha256: "a".repeat(64),
      archiveKey: "imports/session-1/raw/aaaaaaaa.webp",
      archivedAt: "2026-09-01T09:00:00+08:00"
    },
    "archived upload response"
  );
  assert.match(response.archiveKey, /^imports\//);
  rejects(
    UploadAssetFileResponseSchema,
    { fileId: "file-1", uploadStatus: "ARCHIVED", byteSize: 10, sha256: "zz", archiveKey: "imports/s/raw/a.webp", archivedAt: "2026-09-01T09:00:00+08:00" },
    "non-hex sha256"
  );
  rejects(
    UploadAssetFileResponseSchema,
    { fileId: "file-1", uploadStatus: "ARCHIVED", byteSize: 10, sha256: "a".repeat(64), archiveKey: "/Users/x/a.jpg", archivedAt: "2026-09-01T09:00:00+08:00" },
    "absolute archive key"
  );
});

test("session status response projects file and group review state", () => {
  const response = accepts<{ files: unknown[]; groups: unknown[] }>(
    AssetImportSessionResponseSchema,
    {
      sessionId: "session-1",
      state: "NEEDS_REVIEW",
      createdAt: "2026-09-01T09:00:00+08:00",
      updatedAt: "2026-09-01T09:05:00+08:00",
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
      ]
    },
    "session status response"
  );
  assert.equal(response.files.length, 1);
  rejects(
    AssetImportSessionResponseSchema,
    { sessionId: "session-1", state: "REVIEW", createdAt: "2026-09-01T09:00:00+08:00", updatedAt: "2026-09-01T09:00:00+08:00", declaredFileCount: 0, uploadedFileCount: 0, archivedFileCount: 0, failedFileCount: 0, declaredBytes: 0, uploadedBytes: 0, files: [], groups: [] },
    "legacy session state in response"
  );
});

test("group review actions validate membership, partitions and names", () => {
  accepts(
    UpdateBeadImageGroupRequestSchema,
    { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "紫水晶" },
    "SET_NAME action"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "" },
    "empty crystal name"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "SET_NAME", crystalName: "紫水晶" },
    "SET_NAME without expectedGroupRevision"
  );
  accepts(
    UpdateBeadImageGroupRequestSchema,
    { action: "MERGE_GROUPS", expectedGroupRevision: 1, sourceGroupIds: ["group-1", "group-2"] },
    "MERGE_GROUPS action"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "MERGE_GROUPS", expectedGroupRevision: 1, sourceGroupIds: ["group-1"] },
    "merge with a single source"
  );
  accepts(
    UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1"], ["file-2", "file-3"]] },
    "SPLIT_GROUP action"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1", "file-2"]] },
    "split into a single partition"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1"], ["file-1"]] },
    "file duplicated across partitions"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "SPLIT_GROUP", expectedGroupRevision: 1, partitions: [["file-1"], []] },
    "empty partition"
  );
  accepts(
    UpdateBeadImageGroupRequestSchema,
    { action: "MOVE_FILES", expectedGroupRevision: 1, fileIds: ["file-1"], targetGroupId: "group-2" },
    "MOVE_FILES action"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "MOVE_FILES", expectedGroupRevision: 1, fileIds: ["file-1", "file-1"], targetGroupId: "group-2" },
    "duplicate moved file ids"
  );
  accepts(
    UpdateBeadImageGroupRequestSchema,
    { action: "SET_PRIMARY", expectedGroupRevision: 1, primaryFileId: "file-1", memberFileIds: ["file-1", "file-2"] },
    "SET_PRIMARY action"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "SET_PRIMARY", expectedGroupRevision: 1, primaryFileId: "file-9", memberFileIds: ["file-1", "file-2"] },
    "primary file outside membership"
  );
  accepts(
    UpdateBeadImageGroupRequestSchema,
    { action: "IGNORE_FILES", expectedGroupRevision: 1, fileIds: ["file-1"], reason: "模糊连拍" },
    "IGNORE_FILES action"
  );
  rejects(
    UpdateBeadImageGroupRequestSchema,
    { action: "AUTO_IDENTIFY", expectedGroupRevision: 1 },
    "unknown group action"
  );

  accepts(
    UpdateBeadImageGroupResponseSchema,
    { groupId: "group-1", state: "NAMED", revision: 2, memberFileIds: ["file-1"], primaryFileId: "file-1", crystalName: "紫水晶" },
    "group update response"
  );
  rejects(
    UpdateBeadImageGroupResponseSchema,
    { groupId: "group-1", state: "NAMED", revision: 0, memberFileIds: [] },
    "non-positive group revision"
  );
});

test("reprocess requests accept only bounded adjustment settings", () => {
  accepts(
    ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-1", expectedGroupRevision: 2, settings: { maskThreshold: 0.42, edgeFeatherPx: 1.5 } },
    "bounded reprocess settings"
  );
  accepts(
    ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-2", expectedGroupRevision: 2 },
    "reprocess without settings"
  );
  rejects(
    ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-3", expectedGroupRevision: 2, settings: { maskThreshold: 1.4 } },
    "maskThreshold above 1"
  );
  rejects(
    ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-4", expectedGroupRevision: 2, settings: { model: "inpaint-xl" } },
    "unknown reprocess setting"
  );
  rejects(
    ReprocessBeadImageGroupRequestSchema,
    { idempotencyKey: "rp-5", expectedGroupRevision: 2, outputPath: "/tmp/processed.png" },
    "client-supplied output path"
  );

  accepts(
    ReprocessBeadImageGroupResponseSchema,
    { groupId: "group-1", jobId: "job-1", jobState: "QUEUED", processingVersion: 2 },
    "reprocess response"
  );
});

test("publish requests require a human-confirmed name and explicit rights", () => {
  const accepted = accepts<{ crystalName: string; allowPublicDisplay: boolean }>(
    PublishBeadImageGroupRequestSchema,
    publishRequest(),
    "complete publish request"
  );
  assert.equal(accepted.crystalName, "紫水晶");
  assert.equal(accepted.allowPublicDisplay, true);

  rejects(PublishBeadImageGroupRequestSchema, publishRequest({ crystalName: "" }), "empty crystal name");
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ crystalNameConfirmedByOperator: false }),
    "publish without operator confirmation"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ approvedAssetIds: [] }),
    "publish without approved assets"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ sourcePath: "/Users/chenyanyan/Desktop/珠子图/01/DSC0001.JPG" }),
    "publish with an absolute source path"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ processedPath: "imports/session-1/processed/asset-1/v1/bead-512.webp" }),
    "publish with a fabricated processing result path"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ assetArchiveKey: "imports/session-1/raw/a.jpg" }),
    "publish with a client-supplied storage key"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ shape: "HEART" }),
    "unknown bead shape"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ currency: "USD" }),
    "unsupported currency"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ availableQuantity: -1 }),
    "negative inventory"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ usagePermission: "UNKNOWN" }),
    "publish while usage permission is UNKNOWN"
  );
  rejects(
    PublishBeadImageGroupRequestSchema,
    publishRequest({ usagePermission: "PROHIBITED", allowPublicDisplay: true }),
    "publish while usage permission is PROHIBITED"
  );

  accepts(
    PublishBeadImageGroupResponseSchema,
    {
      groupId: "group-1",
      state: "PUBLISHED",
      materialProductId: "product-1",
      crystalId: "crystal-1",
      inventorySnapshotId: "inventory-1",
      publishedAt: "2026-09-01T09:30:00+08:00",
      publishedAssetKeys: ["asset-512-main"]
    },
    "publish response"
  );
  rejects(
    PublishBeadImageGroupResponseSchema,
    { groupId: "group-1", state: "DRAFT", materialProductId: "product-1", crystalId: "crystal-1", inventorySnapshotId: "inventory-1", publishedAt: "2026-09-01T09:30:00+08:00", publishedAssetKeys: [] },
    "publish response claiming a draft went live"
  );
});
