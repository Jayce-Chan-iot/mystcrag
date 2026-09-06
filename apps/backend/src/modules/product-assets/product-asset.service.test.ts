import assert from "node:assert/strict";
import test from "node:test";

import { sha256OfBytes } from "@mystcrag/asset-pipeline";

import { AssetImportApiError } from "../bead-asset-import/bead-asset-import.errors.js";
import { ProductAssetService } from "./product-asset.service.js";

const BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const SHA = sha256OfBytes(BYTES);

test("approved delivery verifies repository metadata against stored bytes", async () => {
  const service = new ProductAssetService({
    repository: {
      findApprovedPublicAsset: async () => ({
        assetKey: `approved:${SHA}`,
        outputSha256: SHA,
        storageProvider: "local",
        storageKey: "imports/session-1/processed/group-1/v1/bead-512.webp",
        outputContentType: "image/webp",
        outputBytes: BigInt(BYTES.byteLength),
        widthPx: 1,
        heightPx: 1
      })
    } as never,
    archiveStore: { read: async () => BYTES } as never
  });

  const delivery = await service.resolve(`approved:${SHA}`);

  assert.deepEqual(delivery.bytes, BYTES);
  assert.deepEqual(delivery.headers, {
    "Content-Type": "image/webp",
    "Content-Length": String(BYTES.byteLength),
    ETag: `"${SHA}"`,
    "Cache-Control": "public, max-age=31536000, immutable"
  });
  assert.equal("storageKey" in delivery, false);
});

test("unknown and metadata-mismatched public assets fail without storage details", async () => {
  const unknown = new ProductAssetService({
    repository: { findApprovedPublicAsset: async () => null } as never,
    archiveStore: { read: async () => BYTES } as never
  });
  await assert.rejects(() => unknown.resolve(`approved:${SHA}`), (error: unknown) => {
    assert.ok(error instanceof AssetImportApiError);
    assert.equal(error.transportCode, "NOT_FOUND");
    return true;
  });

  const corrupt = new ProductAssetService({
    repository: {
      findApprovedPublicAsset: async () => ({
        assetKey: `approved:${SHA}`,
        outputSha256: SHA,
        storageProvider: "local",
        storageKey: "imports/private/key.webp",
        outputContentType: "image/webp",
        outputBytes: 999n,
        widthPx: null,
        heightPx: null
      })
    } as never,
    archiveStore: { read: async () => BYTES } as never
  });
  await assert.rejects(() => corrupt.resolve(`approved:${SHA}`), (error: unknown) => {
    assert.ok(error instanceof AssetImportApiError);
    assert.equal(error.transportCode, "INTERNAL_ERROR");
    assert.equal(error.message.includes("imports/private"), false);
    return true;
  });
});

test("invalid persisted public content type is an internal integrity failure, not client validation", async () => {
  const service = new ProductAssetService({
    repository: {
      findApprovedPublicAsset: async () => ({
        assetKey: `approved:${SHA}`,
        outputSha256: SHA,
        storageProvider: "local",
        storageKey: "imports/session-1/processed/group-1/v1/bead-512.webp",
        outputContentType: "text/plain",
        outputBytes: BigInt(BYTES.byteLength),
        widthPx: null,
        heightPx: null
      })
    } as never,
    archiveStore: { read: async () => BYTES } as never
  });
  await assert.rejects(() => service.resolve(`approved:${SHA}`), (error: unknown) => {
    assert.ok(error instanceof AssetImportApiError);
    assert.equal(error.transportCode, "INTERNAL_ERROR");
    return true;
  });
});
