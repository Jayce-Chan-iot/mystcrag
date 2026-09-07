import assert from "node:assert/strict";
import test from "node:test";

import { BeadImportApiError } from "./api-client";
import {
  createPreviewLoader,
  type PreviewLoaderClient,
  type PreviewOutcome
} from "./preview-loader";

type BinaryContent = {
  blob: Blob;
  contentType: string | null;
  etag: string | null;
  byteSize: number;
};

type DeferredContent = {
  promise: Promise<BinaryContent>;
  resolve: (content?: BinaryContent) => void;
};

function makeDeferred(kind: string): DeferredContent {
  let inner!: (value: BinaryContent) => void;
  const promise = new Promise<BinaryContent>((res) => {
    inner = res;
  });
  return {
    promise,
    resolve: (content) =>
      inner(content ?? { blob: new Blob([kind]), contentType: `image/${kind}`, etag: null, byteSize: 1 })
  };
}

function makeLoader() {
  const created: string[] = [];
  const revoked: string[] = [];
  const abortReasons: unknown[] = [];
  let nextUrl = 0;
  const gates = new Map<string, DeferredContent>();

  const client: PreviewLoaderClient = {
    readSourceFileContent: async (fileId) => {
      const gate = gates.get(fileId);
      return gate === undefined
        ? { blob: new Blob([fileId]), contentType: "image/jpeg", etag: null, byteSize: 1 }
        : await gate.promise;
    },
    readProcessedAssetContent: async (processedAssetId, rendition) => {
      const gate = gates.get(`${processedAssetId}:${rendition}`);
      return gate === undefined
        ? { blob: new Blob([processedAssetId]), contentType: "image/webp", etag: null, byteSize: 1 }
        : await gate.promise;
    }
  };

  const loader = createPreviewLoader({
    client,
    objectUrls: {
      createObjectUrl: (blob) => {
        nextUrl += 1;
        const url = `blob:${blob.size}-${nextUrl}`;
        created.push(url);
        return url;
      },
      revokeObjectUrl: (url) => {
        revoked.push(url);
      }
    },
    createAbortController: () => {
      const controller = {
        signal: { aborted: false },
        abort: (reason?: unknown) => {
          controller.signal.aborted = true;
          abortReasons.push(reason);
        }
      };
      return controller;
    }
  });

  return {
    loader,
    created,
    revoked,
    abortReasons,
    gate(key: string): DeferredContent {
      const existing = gates.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const gate = makeDeferred(key);
      gates.set(key, gate);
      return gate;
    }
  };
}

function makeFailingLoader(error: unknown): { loader: ReturnType<typeof createPreviewLoader> } {
  const loader = createPreviewLoader({
    client: {
      readSourceFileContent: async () => {
        throw error;
      },
      readProcessedAssetContent: async () => {
        throw error;
      }
    },
    objectUrls: {
      createObjectUrl: () => "blob:x",
      revokeObjectUrl: () => {}
    },
    createAbortController: () => ({
      signal: { aborted: false },
      abort: () => {}
    })
  });
  return { loader };
}

function unsupportedError(): BeadImportApiError {
  return new BeadImportApiError({
    code: "UNSUPPORTED_MEDIA_TYPE",
    status: 415,
    message: "无法预览。",
    retryable: false,
    assetCode: "SOURCE_PREVIEW_UNAVAILABLE"
  });
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

test("a ready preview resolves to a tracked url that release revokes", async () => {
  const { loader, created, revoked } = makeLoader();
  const outcome: PreviewOutcome = await loader.loadSource("file-1");
  assert.equal(outcome.status, "READY");
  if (outcome.status === "READY") {
    assert.equal(outcome.contentType, "image/jpeg");
    assert.deepEqual(created, [outcome.url]);
  }
  assert.deepEqual(revoked, []);

  loader.release();
  assert.equal(revoked.length, 1, "an unmounted preview must revoke its object url");
});

test("a response that arrives after release never creates or leaks an object url", async () => {
  const harness = makeLoader();
  const { loader, created, revoked } = harness;
  const gated = gateSource(harness, "file-slow");
  const pending = loader.loadSource("file-slow");

  loader.release();
  gated.resolve(undefined);
  const outcome = await pending;
  await settle();

  assert.deepEqual(created, [], "a late response must never be tracked");
  assert.deepEqual(revoked, [], "there is nothing to revoke when nothing was tracked");
  assert.notEqual(outcome.status, "READY", "a released read cannot hand back a live url");
});

test("switching previews aborts the in-flight read and never tracks its late response", async () => {
  const harness = makeLoader();
  const { loader, created, revoked, abortReasons } = harness;
  const first = gateSource(harness, "file-a");
  const pendingFirst = loader.loadSource("file-a");

  const second = loader.loadSource("file-b");
  await settle();
  assert.ok(abortReasons.length >= 1, "the superseded read is aborted");

  const urlsBeforeLateResponse = [...created];
  first.resolve(undefined);
  await pendingFirst;
  await settle();
  assert.deepEqual(
    created,
    urlsBeforeLateResponse,
    "the aborted read must never surface its bytes, even when they arrive"
  );

  const outcome = await second;
  assert.equal(outcome.status, "READY");
  assert.equal(created.length, 1, "exactly one url exists after the switch");
  assert.deepEqual(revoked, []);

  loader.release();
  assert.deepEqual(revoked, created, "release revokes exactly the tracked url");
});

test("a cancelled read is not terminal: the loader keeps serving later loads", async () => {
  const { loader, created, revoked } = makeLoader();
  const outcome = await loader.loadSource("file-1");
  assert.equal(outcome.status, "READY");

  loader.cancel();
  assert.equal(revoked.length, 1, "cancel revokes the current url");

  const next = await loader.loadProcessed("processed-1", "thumbnail");
  assert.equal(next.status, "READY");
  assert.equal(created.length, 2, "cancel differs from release");

  loader.release();
  assert.deepEqual(revoked, created);
});

test("an ARW refusal becomes an explicit unsupported outcome, never a broken image", async () => {
  const { loader } = makeFailingLoader(unsupportedError());
  const outcome = await loader.loadSource("file-arw");
  assert.equal(outcome.status, "UNSUPPORTED");
  loader.release();
});

test("an unexpected failure becomes an error outcome instead of throwing into the view", async () => {
  const { loader } = makeFailingLoader(new Error("boom"));
  const outcome = await loader.loadProcessed("processed-1", "main");
  assert.equal(outcome.status, "ERROR");
  loader.release();
});

/** Registers a manual gate for a source file and returns its deferred handle. */
function gateSource(harness: ReturnType<typeof makeLoader>, fileId: string): DeferredContent {
  return harness.gate(fileId);
}
