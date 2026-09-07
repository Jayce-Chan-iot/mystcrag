import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import { detectAssetSourceKind, type ArchiveStore } from "@mystcrag/asset-pipeline";
import type { AssetImportRepository, ResolvedAssetUploadTarget } from "@mystcrag/database";
import type {
  CancelAssetImportSessionRequest,
  CreateAssetImportSessionRequest,
  ListAssetImportSessionsQuery,
  ListCrystalsQuery,
  ProcessedAssetRendition,
  PublishBeadImageGroupRequest,
  RegisterAssetManifestRequest,
  ReprocessBeadImageGroupRequest,
  ReviewProcessedAssetRequest,
  SaveBeadProductDraftRequest,
  SelectProcessedVersionRequest,
  StartAssetImportGroupingRequest,
  StartAssetImportProcessingRequest,
  UpdateBeadImageGroupRequest,
  UpdateCrystalDraftCurationRequest,
  UploadAssetFileParams
} from "@mystcrag/design-contract";

import { ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID } from "./bead-asset-import.auth.js";
import { AssetImportApiError, normalizeAssetImportError } from "./bead-asset-import.errors.js";

export const ASSET_UPLOAD_PROBE_MAX_BYTES = 8 * 1024 * 1024;

type Repository = Pick<AssetImportRepository,
  | "createSession" | "listSessions" | "cancelSession" | "registerManifest"
  | "getSession" | "resolveUploadTarget" | "enqueueArchiveFile" | "failUploadReservation"
  | "startGrouping" | "startProcessing" | "updateGroup" | "reprocessGroup"
  | "selectProcessedVersion" | "reviewProcessedAsset" | "updateCrystalDraft"
  | "saveGroupDraft" | "checkGroupDraftCompleteness" | "publishGroup" | "getPublishResult"
  | "searchCrystals" | "resolveSourceFileRead" | "resolveProcessedAssetRead"
>;

type Store = Pick<ArchiveStore, "putStagingStream" | "removeStaging" | "openVerifiedRead">;

function iso(date: Date): string {
  return date.toISOString();
}

export type AdminBinaryContent = {
  stream: Readable;
  byteSize: number;
  contentType: string;
  etag: string;
};

const SOURCE_CONTENT_TYPES: Readonly<Record<"JPEG" | "PNG" | "WEBP", string>> = {
  JPEG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp"
};

const PROCESSED_MAIN_FILENAME = "bead-512.webp";
const PROCESSED_THUMBNAIL_FILENAME = "thumb-256.webp";

function uploadIdempotencyKey(sessionId: string, fileId: string, sha256: string, uploadAttemptId: string): string {
  const digest = createHash("sha256")
    .update(sessionId)
    .update("\0")
    .update(fileId)
    .update("\0")
    .update(sha256)
    .update("\0")
    .update(uploadAttemptId)
    .digest("hex");
  return `asset-upload-${digest}`;
}

async function verifyArchivedReplay(
  target: Extract<ResolvedAssetUploadTarget, { state: "ARCHIVED" }>,
  source: Readable
) {
  const hash = createHash("sha256");
  const probe: Uint8Array[] = [];
  let probeBytes = 0;
  let byteSize = 0;
  for await (const value of source) {
    const chunk = value instanceof Uint8Array ? value : Buffer.from(value as never);
    byteSize += chunk.byteLength;
    if (byteSize > target.byteSize) {
      throw new AssetImportApiError("CONFLICT", "The archived file has different content.", "ARCHIVE_CONFLICT");
    }
    hash.update(chunk);
    if (probeBytes < ASSET_UPLOAD_PROBE_MAX_BYTES) {
      const captured = Buffer.from(chunk.subarray(0, ASSET_UPLOAD_PROBE_MAX_BYTES - probeBytes));
      probe.push(captured);
      probeBytes += captured.byteLength;
    }
  }
  const sha256 = hash.digest("hex");
  if (
    byteSize !== target.byteSize ||
    sha256 !== target.sha256 ||
    detectAssetSourceKind(Buffer.concat(probe)) !== target.kind
  ) {
    throw new AssetImportApiError("CONFLICT", "The archived file has different content.", "ARCHIVE_CONFLICT");
  }
  return {
    fileId: target.fileId,
    uploadStatus: "ARCHIVED" as const,
    byteSize,
    sha256,
    archiveKey: target.archiveKey,
    archivedAt: iso(target.archivedAt)
  };
}

export class AssetImportApplicationService {
  constructor(private readonly deps: { repository: Repository; archiveStore: Store }) {}

  async createSession(input: CreateAssetImportSessionRequest) {
    const result = await this.deps.repository.createSession(input);
    return { sessionId: result.sessionId, state: "CREATED" as const, createdAt: iso(result.createdAt) };
  }

  async listSessions(input: ListAssetImportSessionsQuery) {
    const result = await this.deps.repository.listSessions(input);
    return {
      sessions: result.sessions.map((session) => ({
        ...session,
        createdAt: iso(session.createdAt),
        updatedAt: iso(session.updatedAt)
      })),
      nextCursor: result.nextCursor
    };
  }

  async cancelSession(sessionId: string, input: CancelAssetImportSessionRequest) {
    const result = await this.deps.repository.cancelSession(sessionId, input, ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID);
    return { ...result, cancelledAt: iso(result.cancelledAt) };
  }

  async registerManifest(sessionId: string, input: RegisterAssetManifestRequest) {
    const result = await this.deps.repository.registerManifest(sessionId, input);
    return {
      ...result,
      files: result.files.map((file) => ({ ...file, createdAt: iso(file.createdAt) }))
    };
  }

  async getSession(sessionId: string) {
    const result = await this.deps.repository.getSession(sessionId);
    return {
      sessionId: result.sessionId,
      state: result.state,
      createdAt: iso(result.createdAt),
      updatedAt: iso(result.updatedAt),
      lastVerifiedCheckpoint: result.lastVerifiedCheckpoint,
      declaredFileCount: result.declaredFileCount,
      uploadedFileCount: result.uploadedFileCount,
      archivedFileCount: result.archivedFileCount,
      failedFileCount: result.failedFileCount,
      declaredBytes: result.declaredBytes,
      uploadedBytes: result.uploadedBytes,
      files: result.files.map((file) => ({
        fileId: file.fileId,
        clientFileId: file.clientFileId,
        relativePath: file.relativePath,
        kind: file.kind,
        state: file.state,
        byteSize: file.byteSize,
        ...(file.sha256 === undefined ? {} : { sha256: file.sha256 })
      })),
      groups: result.groups
    };
  }

  async uploadFile(params: UploadAssetFileParams, source: Readable) {
    const uploadAttemptId = randomUUID();
    const target = await this.deps.repository.resolveUploadTarget(params);
    if (target.state === "ARCHIVED") {
      try {
        return await verifyArchivedReplay(target, source);
      } catch (error) {
        throw normalizeAssetImportError(error);
      }
    }
    let stagingKey: string | undefined;
    const probe: Uint8Array[] = [];
    let probeBytes = 0;
    const tee = async function* () {
      for await (const value of source) {
        const chunk = value instanceof Uint8Array ? value : Buffer.from(value as never);
        if (probeBytes < ASSET_UPLOAD_PROBE_MAX_BYTES) {
          const remaining = ASSET_UPLOAD_PROBE_MAX_BYTES - probeBytes;
          const captured = Buffer.from(chunk.subarray(0, remaining));
          probe.push(captured);
          probeBytes += captured.byteLength;
        }
        yield chunk;
      }
    };

    try {
      const staged = await this.deps.archiveStore.putStagingStream({
        sessionId: target.sessionId,
        source: tee(),
        expectedByteSize: target.byteSize,
        maxByteSize: target.byteSize
      });
      stagingKey = staged.stagingKey;
      if (staged.byteSize !== target.byteSize || staged.byteSize !== params.contentLengthBytes) {
        throw new AssetImportApiError("CONFLICT", "The staged upload could not be verified.", "ARCHIVE_VERIFICATION_FAILED");
      }
      if (target.declaredSha256 !== null && target.declaredSha256 !== staged.sha256) {
        throw new AssetImportApiError("CONFLICT", "The staged upload could not be verified.", "ARCHIVE_VERIFICATION_FAILED");
      }
      const detected = detectAssetSourceKind(Buffer.concat(probe));
      if (detected === null) {
        throw new AssetImportApiError("UNSUPPORTED_MEDIA_TYPE", "The uploaded file kind is unsupported.", "UNSUPPORTED_FILE_KIND");
      }
      if (detected !== target.kind) {
        throw new AssetImportApiError("UNPROCESSABLE_ENTITY", "The uploaded content does not match its declared kind.", "CORRUPT_FILE_CONTENT");
      }
      await this.deps.repository.enqueueArchiveFile({
        sessionId: target.sessionId,
        fileId: target.fileId,
        idempotencyKey: uploadIdempotencyKey(target.sessionId, target.fileId, staged.sha256, uploadAttemptId),
        stagingKey: staged.stagingKey,
        sha256: staged.sha256
      });
      return {
        fileId: target.fileId,
        uploadStatus: "UPLOADING" as const,
        byteSize: staged.byteSize,
        sha256: staged.sha256
      };
    } catch (error) {
      if (stagingKey !== undefined) {
        await this.deps.archiveStore.removeStaging(stagingKey).catch(() => undefined);
      }
      await this.deps.repository.failUploadReservation(target.sessionId, target.fileId).catch(() => undefined);
      throw normalizeAssetImportError(error);
    }
  }

  async startGrouping(sessionId: string, input: StartAssetImportGroupingRequest) {
    const result = await this.deps.repository.startGrouping(sessionId, input);
    return { ...result, startedAt: iso(result.startedAt) };
  }
  async startProcessing(sessionId: string, input: StartAssetImportProcessingRequest) {
    const result = await this.deps.repository.startProcessing(sessionId, input);
    return { ...result, startedAt: iso(result.startedAt) };
  }
  updateGroup(groupId: string, input: UpdateBeadImageGroupRequest) {
    return this.deps.repository.updateGroup(groupId, input, ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID);
  }
  reprocessGroup(groupId: string, input: ReprocessBeadImageGroupRequest) {
    return this.deps.repository.reprocessGroup(groupId, input);
  }
  async selectProcessedVersion(groupId: string, input: SelectProcessedVersionRequest) {
    const result = await this.deps.repository.selectProcessedVersion(groupId, input, ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID);
    return { ...result, updatedAt: iso(result.updatedAt) };
  }
  async reviewProcessedAsset(groupId: string, processedAssetId: string, input: ReviewProcessedAssetRequest) {
    const result = await this.deps.repository.reviewProcessedAsset(groupId, processedAssetId, input, ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID);
    return { ...result, reviewedAt: iso(result.reviewedAt) };
  }
  async updateCrystalDraft(crystalDraftId: string, input: UpdateCrystalDraftCurationRequest) {
    const result = await this.deps.repository.updateCrystalDraft(crystalDraftId, input, ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID);
    return { ...result, updatedAt: iso(result.updatedAt) };
  }
  async saveGroupDraft(groupId: string, input: SaveBeadProductDraftRequest) {
    const result = await this.deps.repository.saveGroupDraft(groupId, input);
    return { ...result, draftSavedAt: iso(result.draftSavedAt) };
  }
  async checkGroupDraftCompleteness(groupId: string) {
    const result = await this.deps.repository.checkGroupDraftCompleteness(groupId);
    return { ...result, checkedAt: iso(result.checkedAt) };
  }
  async publishGroup(groupId: string, input: PublishBeadImageGroupRequest) {
    const result = await this.deps.repository.publishGroup(groupId, input, ASSET_IMPORT_LOCAL_ADMIN_ACTOR_ID);
    return { ...result, publishedAt: iso(result.publishedAt) };
  }
  async getPublishResult(groupId: string) {
    const result = await this.deps.repository.getPublishResult(groupId);
    return { ...result, publishedAt: iso(result.publishedAt) };
  }

  async searchCrystals(query: ListCrystalsQuery) {
    return this.deps.repository.searchCrystals(query);
  }

  async readSourceFile(fileId: string): Promise<AdminBinaryContent> {
    const file = await this.deps.repository.resolveSourceFileRead(fileId);
    if (file.state !== "ARCHIVED" || file.archiveKey === null || file.sha256 === null) {
      throw new AssetImportApiError("NOT_FOUND", "The source image is not available for preview.");
    }
    if (file.kind === "ARW") {
      throw new AssetImportApiError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Raw camera files cannot be previewed in the browser.",
        "SOURCE_PREVIEW_UNAVAILABLE"
      );
    }
    const { stream, byteSize } = await this.deps.archiveStore.openVerifiedRead(file.archiveKey, file.sha256);
    return { stream, byteSize, contentType: SOURCE_CONTENT_TYPES[file.kind], etag: `"${file.sha256}"` };
  }

  async readProcessedAsset(processedAssetId: string, rendition: ProcessedAssetRendition): Promise<AdminBinaryContent> {
    const asset = await this.deps.repository.resolveProcessedAssetRead(processedAssetId);
    if (rendition === "main") {
      const { stream, byteSize } = await this.deps.archiveStore.openVerifiedRead(asset.storageKey, asset.outputSha256);
      return { stream, byteSize, contentType: asset.outputContentType, etag: `"${asset.outputSha256}"` };
    }
    const thumbnailKey = asset.storageKey.endsWith(PROCESSED_MAIN_FILENAME)
      ? `${asset.storageKey.slice(0, -PROCESSED_MAIN_FILENAME.length)}${PROCESSED_THUMBNAIL_FILENAME}`
      : asset.storageKey;
    const { stream, byteSize, sha256 } = await this.deps.archiveStore.openVerifiedRead(thumbnailKey);
    return { stream, byteSize, contentType: asset.outputContentType, etag: `"${sha256}"` };
  }
}
