import assert from "node:assert/strict";
import test from "node:test";

import type {
  RegisterAssetManifestRequest,
  RegisterAssetManifestResponse
} from "@mystcrag/design-contract";

import { BeadImportApiError, type BeadImportUpload, type SanitizedUploadResult } from "./api-client";
import type { AbortSignalLike } from "./session-lifecycle";
import { planUploads, type UploadFileLike, type UploadPlan } from "./upload-model";

import {
  UPLOAD_QUEUE_CONCURRENCY,
  createUploadQueue,
  type UploadFileSource,
  type UploadQueueController,
  type UploadQueueState
} from "./upload-queue";

const FORBIDDEN_LEAKS = ["127.0.0.1", "localhost", "x-admin-key", "asset-archive", "/Users/", "ECONNREFUSED"];

type RecordedUpload = {
  sessionId: string;
  fileId: string;
  upload: BeadImportUpload;
  signal: AbortSignalLike | undefined;
};

type Harness = {
  queue: UploadQueueController;
  reports: UploadQueueState[];
  uploads: RecordedUpload[];
  manifestRequests: { sessionId: string; request: RegisterAssetManifestRequest }[];
  idempotencyKeys: string[];
  streamCalls: number;
  peakConcurrency: number;
  aborted: number;
  latest(): UploadQueueState;
  releaseUploads(results: (SanitizedUploadResult | Error)[]): void;
  setManifestResult(result: RegisterAssetManifestResponse | Error): void;
};

function makeSource(
  relativePath: string,
  overrides: Partial<UploadFileLike> & { type?: string } = {}
): { file: UploadFileLike; source: UploadFileSource; stream: ReadableStream<Uint8Array> } {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    }
  });
  const file: UploadFileLike = {
    name,
    size: 2048,
    lastModified: 1_700_000_000_000,
    webkitRelativePath: relativePath,
    ...overrides
  };
  const source: UploadFileSource = {
    ...file,
    type: overrides.type ?? "image/jpeg",
    stream() {
      return stream;
    }
  };
  return { file, source, stream };
}

function makeHarness(options: { gateUploads?: boolean } = {}): Harness {
  const reports: UploadQueueState[] = [];
  const uploads: RecordedUpload[] = [];
  const manifestRequests: { sessionId: string; request: RegisterAssetManifestRequest }[] = [];
  const idempotencyKeys: string[] = [];
  let streamCalls = 0;
  let peakConcurrency = 0;
  let active = 0;
  let aborted = 0;
  let manifestResult: RegisterAssetManifestResponse | Error | null = null;
  let gates: ((result: SanitizedUploadResult | Error) => void)[] = [];

  const queue = createUploadQueue({
    client: {
      async registerManifest(sessionId, request) {
        manifestRequests.push({ sessionId, request });
        idempotencyKeys.push(request.idempotencyKey);
        if (manifestResult instanceof Error) {
          throw manifestResult;
        }
        if (manifestResult !== null) {
          return manifestResult;
        }
        return {
          sessionId,
          registeredFileCount: request.files.length,
          files: request.files.map((entry, index) => ({
            fileId: `file-${index + 1}`,
            clientFileId: entry.clientFileId,
            uploadStatus: "PENDING" as const,
            createdAt: "2026-09-06T10:00:00.000Z"
          }))
        };
      },
      async uploadFileContent(sessionId, fileId, upload, requestOptions) {
        uploads.push({ sessionId, fileId, upload, signal: requestOptions?.signal });
        active += 1;
        peakConcurrency = Math.max(peakConcurrency, active);
        try {
          if (options.gateUploads === true) {
            const result = await new Promise<SanitizedUploadResult | Error>((resolve) => {
              gates.push(resolve);
            });
            if (result instanceof Error) {
              throw result;
            }
            return result;
          }
          return { fileId, uploadStatus: "ARCHIVED", byteSize: upload.byteLength };
        } finally {
          active -= 1;
        }
      }
    },
    newIdempotencyKey: () => `idem-${idempotencyKeys.length + 1}`,
    createAbortController: () => {
      let abortedLocally = false;
      return {
        signal: {
          get aborted() {
            return abortedLocally;
          }
        },
        abort: () => {
          abortedLocally = true;
          aborted += 1;
        }
      };
    },
    openStream: (file) => {
      streamCalls += 1;
      return file.stream();
    },
    report: (state) => reports.push(state)
  });

  return {
    queue,
    reports,
    uploads,
    manifestRequests,
    idempotencyKeys,
    get streamCalls() {
      return streamCalls;
    },
    get peakConcurrency() {
      return peakConcurrency;
    },
    get aborted() {
      return aborted;
    },
    latest() {
      const last = reports.at(-1);
      assert.ok(last !== undefined, "the queue must report its state");
      return last;
    },
    releaseUploads(results) {
      const pending = gates;
      gates = [];
      pending.forEach((release, index) => {
        const result = results[index];
        release(result ?? new Error(`no result released for upload ${index}`));
      });
    },
    setManifestResult(result) {
      manifestResult = result;
    }
  };
}

function planOf(paths: readonly string[]): { plan: UploadPlan; sources: Map<string, UploadFileSource> } {
  const made = paths.map((path) => makeSource(path));
  let issued = 0;
  const plan = planUploads(
    made.map((entry) => entry.file),
    { newClientFileId: () => `cf-${(issued += 1)}` }
  );
  const byPath = new Map(made.map((entry) => [entry.file.webkitRelativePath ?? entry.file.name, entry.source]));
  const sources = new Map<string, UploadFileSource>();
  for (const entry of plan.entries) {
    const source = byPath.get(entry.relativePath);
    assert.ok(source !== undefined, `a planned file must keep its source: ${entry.relativePath}`);
    sources.set(entry.clientFileId, source);
  }
  return { plan, sources };
}

function archived(fileId: string, byteSize = 2048): SanitizedUploadResult {
  return { fileId, uploadStatus: "ARCHIVED", byteSize };
}

/** One microtask hop is not a settled wave: the queue resumes through several awaited hops per file. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function phaseSequence(reports: readonly UploadQueueState[]): UploadQueueState["phase"][] {
  const phases: UploadQueueState["phase"][] = [];
  for (const report of reports) {
    if (phases.at(-1) !== report.phase) {
      phases.push(report.phase);
    }
  }
  return phases;
}

test("the manifest is registered once, before any file content is sent", async () => {
  const harness = makeHarness();
  const { plan, sources } = planOf(["批次/a.jpg", "批次/b.jpg"]);
  await harness.queue.start("session-1", plan, sources);

  assert.equal(harness.manifestRequests.length, 1);
  assert.equal(harness.manifestRequests[0]?.sessionId, "session-1");
  assert.deepEqual(harness.idempotencyKeys, ["idem-1"]);
  assert.deepEqual(
    harness.uploads.map((upload) => upload.fileId),
    ["file-1", "file-2"]
  );
  assert.equal(harness.latest().phase, "COMPLETE");
});

test("no more than three files are in flight at once", async () => {
  const harness = makeHarness({ gateUploads: true });
  const { plan, sources } = planOf(Array.from({ length: 9 }, (_, index) => `批次/bead-${index}.jpg`));
  assert.equal(UPLOAD_QUEUE_CONCURRENCY, 3);

  const running = harness.queue.start("session-1", plan, sources);
  await settled();
  assert.equal(harness.uploads.length, 3, "the first wave must stop at the pinned concurrency");
  assert.equal(harness.latest().totals.archived, 0, "nothing is reported as archived while a wave is still in flight");

  harness.releaseUploads([archived("file-1"), archived("file-2"), archived("file-3")]);
  await settled();
  assert.equal(harness.uploads.length, 6);
  assert.equal(harness.latest().totals.archived, 3, "each settled file must reach the operator before the run ends");

  harness.releaseUploads([archived("file-4"), archived("file-5"), archived("file-6")]);
  await settled();
  assert.equal(harness.uploads.length, 9);
  assert.equal(harness.latest().totals.archived, 6);

  harness.releaseUploads([archived("file-7"), archived("file-8"), archived("file-9")]);
  await running;

  assert.equal(harness.peakConcurrency, 3);
  assert.equal(harness.latest().totals.archived, 9);
});

test("each file is streamed from disk with its declared length and never digested in the browser", async () => {
  const harness = makeHarness();
  const made = makeSource("批次/raw.arw", { type: "", size: 4096 });
  let issued = 0;
  const plan = planUploads([made.file], { newClientFileId: () => `cf-${(issued += 1)}` });
  await harness.queue.start("session-1", plan, new Map([["cf-1", made.source]]));

  assert.equal(harness.streamCalls, 1, "the file must be opened exactly once per attempt");
  const record = harness.uploads[0];
  assert.ok(record !== undefined);
  assert.equal(record.upload.byteLength, 4096);
  assert.equal(record.upload.body, made.stream, "the browser stream must be handed over as it is");
  assert.equal("sha256" in record.upload, false, "a digest must never be computed by copying the file");
  assert.equal(record.upload.contentType, undefined, "an empty browser type must not become a header");
});

test("a browser-declared content type is passed through untouched", async () => {
  const harness = makeHarness();
  const made = makeSource("批次/shot.png", { type: "image/png" });
  let issued = 0;
  const plan = planUploads([made.file], { newClientFileId: () => `cf-${(issued += 1)}` });
  await harness.queue.start("session-1", plan, new Map([["cf-1", made.source]]));
  assert.equal(harness.uploads[0]?.upload.contentType, "image/png");
});

test("a duplicate the Backend skips is reported as skipped, not as a failure", async () => {
  const harness = makeHarness({ gateUploads: true });
  const { plan, sources } = planOf(["批次/a.jpg", "批次/b.jpg"]);
  const running = harness.queue.start("session-1", plan, sources);
  await settled();
  harness.releaseUploads([
    archived("file-1"),
    { fileId: "file-2", uploadStatus: "SKIPPED_DUPLICATE", byteSize: 2048 }
  ]);
  await running;

  const totals = harness.latest().totals;
  assert.equal(totals.archived, 1);
  assert.equal(totals.skipped, 1);
  assert.equal(totals.failed, 0);
});

test("one failing file never stops the others and keeps its own reason", async () => {
  const harness = makeHarness({ gateUploads: true });
  const { plan, sources } = planOf(["批次/a.jpg", "批次/b.jpg", "批次/c.jpg"]);
  const running = harness.queue.start("session-1", plan, sources);
  await settled();
  harness.releaseUploads([
    archived("file-1"),
    new BeadImportApiError({ code: "PAYLOAD_TOO_LARGE", status: 413, message: "文件超过单文件上限。", retryable: false }),
    archived("file-3")
  ]);
  await running;

  const latest = harness.latest();
  assert.equal(latest.totals.archived, 2);
  assert.equal(latest.totals.failed, 1);
  const failed = latest.files.find((entry) => entry.status === "FAILED");
  assert.ok(failed !== undefined);
  assert.equal(failed.relativePath, "批次/b.jpg");
  assert.equal(failed.message, "文件超过单文件上限。");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.fileId, "file-2");
});

test("an unexpected transport throw is reported without echoing its detail", async () => {
  const harness = makeHarness({ gateUploads: true });
  const { plan, sources } = planOf(["批次/a.jpg"]);
  const running = harness.queue.start("session-1", plan, sources);
  await settled();
  harness.releaseUploads([
    new TypeError("fetch failed: connect ECONNREFUSED http://127.0.0.1:4000/api/admin/bead-import/sessions")
  ]);
  await running;

  const failed = harness.latest().files.find((entry) => entry.status === "FAILED");
  assert.ok(failed !== undefined);
  assert.ok(failed.message !== null);
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!failed.message.includes(forbidden), `${failed.message} must not mention ${forbidden}`);
  }
});

test("retrying re-sends only the failed file and counts the attempt", async () => {
  const harness = makeHarness({ gateUploads: true });
  const { plan, sources } = planOf(["批次/a.jpg", "批次/b.jpg"]);
  const first = harness.queue.start("session-1", plan, sources);
  await settled();
  harness.releaseUploads([
    archived("file-1"),
    new BeadImportApiError({ code: "INTERNAL_ERROR", status: 500, message: "服务暂时不可用。", retryable: true })
  ]);
  await first;
  assert.equal(harness.uploads.length, 2);
  assert.equal(harness.manifestRequests.length, 1, "a retry must not register a second manifest");

  const second = harness.queue.retry("session-1", "file-2");
  harness.releaseUploads([archived("file-2")]);
  await second;

  assert.deepEqual(
    harness.uploads.map((upload) => upload.fileId),
    ["file-1", "file-2", "file-2"]
  );
  assert.equal(harness.streamCalls, 3, "each attempt streams the file again from disk");
  const latest = harness.latest();
  assert.equal(latest.totals.failed, 0);
  assert.equal(latest.totals.archived, 2);
  assert.equal(latest.files.find((entry) => entry.fileId === "file-2")?.attempts, 2);
});

test("retrying a file that is not failed changes nothing", async () => {
  const harness = makeHarness();
  const { plan, sources } = planOf(["批次/a.jpg"]);
  await harness.queue.start("session-1", plan, sources);
  await harness.queue.retry("session-1", "file-1");
  await harness.queue.retry("session-1", "file-missing");
  assert.equal(harness.uploads.length, 1);
});

test("a blocked plan registers nothing and says why", async () => {
  const harness = makeHarness();
  const plan: UploadPlan = {
    entries: [],
    rejected: [],
    blockedBy: "FILE_COUNT_LIMIT",
    message: "一次最多登记 500 个文件，请分批导入。"
  };
  await harness.queue.start("session-1", plan, new Map());

  assert.deepEqual(harness.manifestRequests, []);
  assert.deepEqual(harness.uploads, []);
  const latest = harness.latest();
  assert.equal(latest.phase, "BLOCKED");
  assert.equal(latest.message, plan.message);
});

test("a refused file is listed without a path or an identifier", async () => {
  const harness = makeHarness();
  const absolute = makeSource("/Users/operator/批次/secret.jpg");
  const good = makeSource("批次/a.jpg");
  let issued = 0;
  const plan = planUploads([absolute.file, good.file], { newClientFileId: () => `cf-${(issued += 1)}` });
  await harness.queue.start("session-1", plan, new Map([["cf-1", good.source]]));

  const rejected = harness.latest().files.filter((entry) => entry.status === "REJECTED");
  assert.equal(rejected.length, 1);
  const refusal = rejected[0];
  assert.ok(refusal !== undefined);
  assert.equal(refusal.relativePath, null, "a refused path must never be repeated to the operator");
  assert.equal(refusal.fileId, null);
  assert.equal(refusal.clientFileId, null);
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!refusal.label.includes(forbidden));
    assert.ok(!(refusal.message ?? "").includes(forbidden));
  }
  assert.equal(harness.latest().totals.rejected, 1);
});

test("a missing source file is reported instead of uploaded as an empty body", async () => {
  const harness = makeHarness();
  const { plan } = planOf(["批次/a.jpg"]);
  await harness.queue.start("session-1", plan, new Map());

  assert.deepEqual(harness.uploads, []);
  const latest = harness.latest();
  assert.equal(latest.totals.failed, 1);
  assert.equal(latest.files[0]?.status, "FAILED");
  assert.ok((latest.files[0]?.message ?? "") !== "");
});

test("a failed manifest registration issues no upload", async () => {
  const harness = makeHarness();
  harness.setManifestResult(
    new BeadImportApiError({
      code: "UNAUTHORIZED",
      status: 401,
      message: "管理员会话已失效，请重新登录。",
      retryable: false
    })
  );
  const { plan, sources } = planOf(["批次/a.jpg"]);
  await harness.queue.start("session-1", plan, sources);

  assert.deepEqual(harness.uploads, []);
  const latest = harness.latest();
  assert.equal(latest.phase, "FAILED");
  assert.equal(latest.message, "管理员会话已失效，请重新登录。");
});

test("cancelling aborts the in-flight uploads and reports nothing afterwards", async () => {
  const harness = makeHarness({ gateUploads: true });
  const { plan, sources } = planOf(["批次/a.jpg", "批次/b.jpg", "批次/c.jpg", "批次/d.jpg"]);
  const running = harness.queue.start("session-1", plan, sources);
  await settled();
  assert.equal(harness.uploads.length, 3);

  harness.queue.cancel();
  assert.equal(harness.aborted, 3);
  const reportsBefore = harness.reports.length;
  harness.releaseUploads([archived("file-1"), archived("file-2"), archived("file-3")]);
  await running;

  assert.equal(harness.reports.length, reportsBefore, "an unmounted queue must not dispatch");
  assert.equal(harness.latest().files.filter((entry) => entry.status === "ARCHIVED").length, 0);
  assert.equal(harness.uploads.length, 3, "the fourth file must never be started");
});

test("the queue reports the phases and totals an operator reads", async () => {
  const harness = makeHarness();
  const { plan, sources } = planOf(["批次/a.jpg", "批次/b.jpg"]);
  await harness.queue.start("session-1", plan, sources);

  assert.deepEqual(phaseSequence(harness.reports), ["REGISTERING", "UPLOADING", "COMPLETE"]);
  assert.deepEqual(harness.latest().totals, {
    registered: 2,
    archived: 2,
    skipped: 0,
    failed: 0,
    rejected: 0,
    uploadedBytes: 4096,
    declaredBytes: 4096
  });
});

test("an upload result outside the contract states is a failure, not a silent success", async () => {
  const harness = makeHarness({ gateUploads: true });
  const { plan, sources } = planOf(["批次/a.jpg"]);
  const running = harness.queue.start("session-1", plan, sources);
  await settled();
  harness.releaseUploads([{ fileId: "file-1", uploadStatus: "PENDING", byteSize: 0 }]);
  await running;

  const latest = harness.latest();
  assert.equal(latest.totals.archived, 0);
  assert.equal(latest.files[0]?.status, "FAILED");
});
