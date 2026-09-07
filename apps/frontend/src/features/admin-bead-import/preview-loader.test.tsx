import assert from "node:assert/strict";
import test from "node:test";

import { BeadImportApiError } from "./api-client";
import { createPreviewLoader, type PreviewOutcome, type PreviewLoaderClient } from "./preview-loader";

function makeLoader(overrides: Partial<PreviewLoaderClient> = {}) {
  const created: string[] = [];
  const revoked: string[] = [];
  const loader = createPreviewLoader({
    client: {
      async readSourceFileContent(fileId) {
        if (overrides.readSourceFileContent) return overrides.readSourceFileContent(fileId);
        return { blob: new Blob(["a"]), contentType: "image/jpeg", etag: null, byteSize: 1 };
      },
      async readProcessedAssetContent(processedAssetId, rendition) {
        if (overrides.readProcessedAssetContent) {
          return overrides.readProcessedAssetContent(processedAssetId, rendition);
        }
        return { blob: new Blob(["b"]), contentType: "image/webp", etag: null, byteSize: 1 };
      }
    },
    objectUrls: {
      createObjectUrl: (blob) => {
        const url = `blob:${blob.size}`;
        created.push(url);
        return url;
      },
      revokeObjectUrl: (url) => {
        revoked.push(url);
      }
    }
  });
  return { loader, created, revoked };
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

test("a source preview resolves to an object url and revokes it on release", async () => {
  const { loader, created, revoked } = makeLoader();
  const outcome: PreviewOutcome = await loader.loadSource("file-1");
  assert.equal(outcome.status, "READY");
  if (outcome.status === "READY") {
    assert.equal(outcome.url, "blob:1");
    assert.equal(outcome.contentType, "image/jpeg");
  }
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, []);

  loader.release();
  assert.deepEqual(revoked, ["blob:1"], "an unmounted preview must not leak its object url");
});

test("an ARW refusal becomes an explicit unsupported outcome, never a broken image", async () => {
  const { loader } = makeLoader({
    readSourceFileContent: async () => {
      throw unsupportedError();
    }
  });
  const outcome = await loader.loadSource("file-arw");
  assert.equal(outcome.status, "UNSUPPORTED");
  loader.release();
});

test("a processed rendition loads through the same loader and honours the rendition enum", async () => {
  let requested: string | null = null;
  const { loader } = makeLoader({
    readProcessedAssetContent: async (processedAssetId, rendition) => {
      requested = rendition;
      return { blob: new Blob(["c"]), contentType: "image/webp", etag: null, byteSize: 1 };
    }
  });
  const outcome = await loader.loadProcessed("processed-1", "thumbnail");
  assert.equal(requested, "thumbnail");
  assert.equal(outcome.status, "READY");
});

test("an unexpected failure becomes an error outcome instead of throwing into the view", async () => {
  const { loader } = makeLoader({
    readProcessedAssetContent: async () => {
      throw new Error("boom");
    }
  });
  const outcome = await loader.loadProcessed("processed-1", "main");
  assert.equal(outcome.status, "ERROR");
  loader.release();
});
