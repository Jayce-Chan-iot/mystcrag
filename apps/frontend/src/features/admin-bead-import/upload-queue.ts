import type {
  RegisterAssetManifestRequest,
  RegisterAssetManifestResponse
} from "@mystcrag/design-contract";

import { type BeadImportUpload, type SanitizedUploadResult } from "./api-client";
import { classifyFailure } from "./failure-copy";
import type { AbortHandle, AbortSignalLike } from "./session-lifecycle";
import { UPLOAD_CONCURRENCY, buildManifestRequest, type UploadFileLike, type UploadPlan } from "./upload-model";

/**
 * Uploads a planned folder in the order the Backend requires: one manifest
 * registration, then one PUT per registered file, never more than three at
 * once. A file body is handed to the client as the browser stream it already
 * is — nothing here buffers an archive into JS memory, and no digest is
 * computed, because computing one would mean copying the very bytes we are
 * trying not to copy.
 */

export const UPLOAD_QUEUE_CONCURRENCY = UPLOAD_CONCURRENCY;

export type UploadFileSource = UploadFileLike & {
  readonly type: string;
  stream(): ReadableStream<Uint8Array>;
};

export type UploadFileStatus =
  | "REJECTED"
  | "QUEUED"
  | "UPLOADING"
  | "ARCHIVED"
  | "SKIPPED_DUPLICATE"
  | "FAILED";

export type UploadFileProgress = {
  clientFileId: string | null;
  fileId: string | null;
  label: string;
  relativePath: string | null;
  byteSize: number;
  status: UploadFileStatus;
  message: string | null;
  attempts: number;
};

export type UploadQueuePhase =
  | "IDLE"
  | "REGISTERING"
  | "UPLOADING"
  | "COMPLETE"
  | "BLOCKED"
  | "FAILED"
  | "CANCELLED";

export type UploadQueueTotals = {
  registered: number;
  archived: number;
  skipped: number;
  failed: number;
  rejected: number;
  uploadedBytes: number;
  declaredBytes: number;
};

export type UploadQueueState = {
  phase: UploadQueuePhase;
  files: UploadFileProgress[];
  totals: UploadQueueTotals;
  message: string | null;
};

export type UploadQueueClient = {
  registerManifest(
    sessionId: string,
    request: RegisterAssetManifestRequest,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<RegisterAssetManifestResponse>;
  uploadFileContent(
    sessionId: string,
    fileId: string,
    upload: BeadImportUpload,
    requestOptions?: { signal?: AbortSignalLike }
  ): Promise<SanitizedUploadResult>;
};

export type UploadQueueDeps = {
  client: UploadQueueClient;
  newIdempotencyKey: () => string;
  createAbortController: () => AbortHandle;
  openStream: (file: UploadFileSource) => ReadableStream<Uint8Array>;
  report: (state: UploadQueueState) => void;
};

/** A registered file the authoritative session already knows, awaiting its bytes again. */
export type RegisteredRetryTarget = {
  fileId: string;
  clientFileId: string;
  relativePath: string;
  byteSize: number;
};

export type UploadQueueController = {
  start(sessionId: string, plan: UploadPlan, sources: ReadonlyMap<string, UploadFileSource>): Promise<void>;
  retry(sessionId: string, fileId: string): Promise<void>;
  retryRegistered(
    sessionId: string,
    targets: ReadonlyArray<RegisteredRetryTarget>,
    sources: ReadonlyMap<string, UploadFileSource>
  ): Promise<void>;
  cancel(): void;
  snapshot(): UploadQueueState;
};

const NOTHING_TO_REGISTER_MESSAGE = "没有可登记的文件：仅支持 ARW、JPG、PNG、WEBP。";
const CANCELLED_MESSAGE = "已停止上传，已上传的文件仍然有效。";
const NOTHING_TO_RETRY_MESSAGE = "没有匹配到待重试的已登记文件，请核对所选文件夹。";
const START_FAILURE_MESSAGE = "上传未能开始，请稍后重试。";
const UNREGISTERED_MESSAGE = "服务端未登记该文件，请重新导入。";
const MISSING_SOURCE_MESSAGE = "浏览器已释放该文件，请重新选择后再上传。";
const DUPLICATE_MESSAGE = "服务端已存在相同文件，本次未重复归档。";
const UNCONFIRMED_MESSAGE = "服务端未确认该文件已归档，请重试。";

export function createUploadQueue(deps: UploadQueueDeps): UploadQueueController {
  let phase: UploadQueuePhase = "IDLE";
  let message: string | null = null;
  let files: UploadFileProgress[] = [];
  let sources: ReadonlyMap<string, UploadFileSource> = new Map();
  let archivedBytes = 0;
  let active = 0;
  let cancelled = false;
  let live = new Set<AbortHandle>();
  let idle: (() => void) | null = null;

  function computeTotals(): UploadQueueTotals {
    const totals: UploadQueueTotals = {
      registered: 0,
      archived: 0,
      skipped: 0,
      failed: 0,
      rejected: 0,
      uploadedBytes: archivedBytes,
      declaredBytes: 0
    };
    for (const file of files) {
      if (file.status === "REJECTED") {
        totals.rejected += 1;
        continue;
      }
      totals.declaredBytes += file.byteSize;
      if (file.fileId !== null) {
        totals.registered += 1;
      }
      if (file.status === "ARCHIVED") {
        totals.archived += 1;
      } else if (file.status === "SKIPPED_DUPLICATE") {
        totals.skipped += 1;
      } else if (file.status === "FAILED") {
        totals.failed += 1;
      }
    }
    return totals;
  }

  function snapshot(): UploadQueueState {
    return { phase, files: files.map((file) => ({ ...file })), totals: computeTotals(), message };
  }

  function emit(): void {
    if (cancelled) {
      return;
    }
    deps.report(snapshot());
  }

  function fail(row: UploadFileProgress, reason: string): void {
    row.status = "FAILED";
    row.message = reason;
    emit();
  }

  function applyRegistration(response: RegisterAssetManifestResponse): void {
    const registered = new Map(response.files.map((file) => [file.clientFileId, file]));
    for (const row of files) {
      if (row.status !== "QUEUED" || row.clientFileId === null) {
        continue;
      }
      const entry = registered.get(row.clientFileId);
      if (entry === undefined) {
        row.status = "FAILED";
        row.message = UNREGISTERED_MESSAGE;
        continue;
      }
      row.fileId = entry.fileId;
      if (entry.uploadStatus === "SKIPPED_DUPLICATE") {
        row.status = "SKIPPED_DUPLICATE";
        row.message = DUPLICATE_MESSAGE;
      }
    }
  }

  function settle(row: UploadFileProgress, result: SanitizedUploadResult): void {
    if (result.uploadStatus === "ARCHIVED") {
      row.status = "ARCHIVED";
      row.message = null;
      archivedBytes += result.byteSize;
      return;
    }
    if (result.uploadStatus === "SKIPPED_DUPLICATE") {
      row.status = "SKIPPED_DUPLICATE";
      row.message = DUPLICATE_MESSAGE;
      return;
    }
    // Anything else has not finished the transfer; reporting it as uploaded
    // would hide a file the archive never received.
    row.status = "FAILED";
    row.message = UNCONFIRMED_MESSAGE;
  }

  async function send(sessionId: string, row: UploadFileProgress, controller: AbortHandle): Promise<void> {
    const fileId = row.fileId;
    const source = row.clientFileId === null ? undefined : sources.get(row.clientFileId);
    if (fileId === null || source === undefined) {
      fail(row, fileId === null ? UNREGISTERED_MESSAGE : MISSING_SOURCE_MESSAGE);
      return;
    }
    try {
      const upload: BeadImportUpload = { body: deps.openStream(source), byteLength: row.byteSize };
      if (source.type !== "") {
        upload.contentType = source.type;
      }
      const result = await deps.client.uploadFileContent(sessionId, fileId, upload, { signal: controller.signal });
      if (cancelled) {
        return;
      }
      settle(row, result);
    } catch (error) {
      if (cancelled) {
        return;
      }
      fail(row, classifyFailure(error).message);
      return;
    }
    emit();
  }

  function nextQueued(): UploadFileProgress | undefined {
    return files.find((file) => file.status === "QUEUED");
  }

  function launch(sessionId: string, row: UploadFileProgress): void {
    active += 1;
    row.status = "UPLOADING";
    row.attempts += 1;
    row.message = null;
    const controller = deps.createAbortController();
    live.add(controller);
    emit();
    void send(sessionId, row, controller).finally(() => {
      active -= 1;
      live.delete(controller);
      if (!cancelled) {
        pump(sessionId);
      }
    });
  }

  function pump(sessionId: string): void {
    while (!cancelled && active < UPLOAD_QUEUE_CONCURRENCY) {
      const row = nextQueued();
      if (row === undefined) {
        break;
      }
      launch(sessionId, row);
    }
    if (cancelled || (active === 0 && nextQueued() === undefined)) {
      const resolve = idle;
      idle = null;
      resolve?.();
    }
  }

  async function runPump(sessionId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      idle = resolve;
      pump(sessionId);
    });
  }

  function finish(): void {
    phase = "COMPLETE";
    const failed = computeTotals().failed;
    message = failed > 0 ? `有 ${failed} 个文件未归档，请逐个重试。` : null;
    emit();
  }

  async function start(
    sessionId: string,
    plan: UploadPlan,
    planSources: ReadonlyMap<string, UploadFileSource>
  ): Promise<void> {
    try {
      await runStart(sessionId, plan, planSources);
    } catch {
      if (!cancelled) {
        phase = "FAILED";
        message = START_FAILURE_MESSAGE;
        emit();
      }
    }
  }

  async function runStart(
    sessionId: string,
    plan: UploadPlan,
    planSources: ReadonlyMap<string, UploadFileSource>
  ): Promise<void> {
    cancelled = false;
    active = 0;
    archivedBytes = 0;
    live = new Set();
    idle = null;
    sources = planSources;
    message = null;
    files = plan.rejected.map((rejection) => ({
      clientFileId: null,
      fileId: null,
      label: rejection.fileName,
      relativePath: null,
      byteSize: 0,
      status: "REJECTED" as const,
      message: rejection.message,
      attempts: 0
    }));

    const request = buildManifestRequest(plan, deps.newIdempotencyKey());
    if (request === null) {
      phase = "BLOCKED";
      message = plan.message ?? NOTHING_TO_REGISTER_MESSAGE;
      emit();
      return;
    }

    for (const entry of plan.entries) {
      files.push({
        clientFileId: entry.clientFileId,
        fileId: null,
        label: entry.relativePath,
        relativePath: entry.relativePath,
        byteSize: entry.byteSize,
        status: "QUEUED",
        message: null,
        attempts: 0
      });
    }

    phase = "REGISTERING";
    emit();

    try {
      applyRegistration(await deps.client.registerManifest(sessionId, request));
    } catch (error) {
      if (cancelled) {
        return;
      }
      phase = "FAILED";
      message = classifyFailure(error).message;
      emit();
      return;
    }
    if (cancelled) {
      return;
    }

    phase = "UPLOADING";
    emit();
    await runPump(sessionId);
    if (cancelled) {
      return;
    }
    finish();
  }

  async function retry(sessionId: string, fileId: string): Promise<void> {
    if (cancelled) {
      return;
    }
    const row = files.find((file) => file.fileId === fileId && file.status === "FAILED");
    if (row === undefined) {
      return;
    }
    row.status = "QUEUED";
    row.message = null;
    phase = "UPLOADING";
    message = null;
    emit();
    await runPump(sessionId);
    if (cancelled) {
      return;
    }
    finish();
  }

  async function retryRegistered(
    sessionId: string,
    targets: ReadonlyArray<RegisteredRetryTarget>,
    retrySources: ReadonlyMap<string, UploadFileSource>
  ): Promise<void> {
    if (targets.length === 0) {
      cancelled = false;
      active = 0;
      live = new Set();
      idle = null;
      sources = retrySources;
      phase = "BLOCKED";
      message = NOTHING_TO_RETRY_MESSAGE;
      files = [];
      emit();
      return;
    }
    try {
      cancelled = false;
      active = 0;
      archivedBytes = 0;
      live = new Set();
      idle = null;
      sources = retrySources;
      message = null;
      files = targets.map((target) => ({
        clientFileId: target.clientFileId,
        fileId: target.fileId,
        label: target.relativePath,
        relativePath: target.relativePath,
        byteSize: target.byteSize,
        status: "QUEUED" as const,
        message: null,
        attempts: 0
      }));
      // The file ids already exist on the server: a retry re-sends content only,
      // so no manifest is registered and no duplicate registration is created.
      phase = "UPLOADING";
      emit();
      await runPump(sessionId);
      if (cancelled) {
        return;
      }
      finish();
    } catch {
      if (!cancelled) {
        phase = "FAILED";
        message = START_FAILURE_MESSAGE;
        emit();
      }
    }
  }

  function cancel(): void {
    if (cancelled) {
      return;
    }
    cancelled = true;
    for (const controller of live) {
      controller.abort("bead import upload cancelled");
    }
    live.clear();
    if (phase === "REGISTERING" || phase === "UPLOADING") {
      // A cancelled run must never leave the operator in a running phase: the
      // queue settles in its own terminal state instead of waiting forever.
      phase = "CANCELLED";
      message = CANCELLED_MESSAGE;
      deps.report(snapshot());
    }
    const resolve = idle;
    idle = null;
    resolve?.();
  }

  return { start, retry, retryRegistered, cancel, snapshot };
}
