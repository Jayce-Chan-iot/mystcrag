import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { AssetImportErrorEnvelopeSchema } from "@mystcrag/design-contract";

import { createApp } from "../../app.js";
import { AssetImportApiError } from "./bead-asset-import.errors.js";
import { parseUploadHeaders } from "./bead-asset-import.routes.js";

const ADMIN_KEY = "asset-admin-test-key-0123456789";
const SHA = "a".repeat(64);
const NOW = "2026-09-06T00:00:00.000Z";

function service() {
  return {
    createSession: async () => ({ sessionId: "session-1", state: "CREATED", createdAt: NOW }),
    listSessions: async () => ({ sessions: [], nextCursor: null }),
    cancelSession: async () => ({ sessionId: "session-1", state: "CANCELLED", cancelledAt: NOW }),
    registerManifest: async () => ({
      sessionId: "session-1", registeredFileCount: 1,
      files: [{ fileId: "file-1", clientFileId: "client-1", uploadStatus: "PENDING", createdAt: NOW }]
    }),
    uploadFile: async () => ({ fileId: "file-1", uploadStatus: "UPLOADING", byteSize: 6, sha256: SHA }),
    getSession: async () => ({
      sessionId: "session-1", state: "UPLOADING", createdAt: NOW, updatedAt: NOW,
      lastVerifiedCheckpoint: null, declaredFileCount: 1, uploadedFileCount: 0,
      archivedFileCount: 0, failedFileCount: 0, declaredBytes: 6, uploadedBytes: 0,
      files: [{ fileId: "file-1", clientFileId: "client-1", relativePath: "photo.jpg", kind: "JPEG", state: "UPLOADING", byteSize: 6 }],
      groups: []
    }),
    startGrouping: async () => ({ sessionId: "session-1", state: "PROCESSING", queuedJobCount: 1, startedAt: NOW }),
    startProcessing: async () => ({ sessionId: "session-1", state: "PROCESSING", queuedJobCount: 1, startedAt: NOW }),
    updateGroup: async () => ({ groupId: "group-1", state: "NAMED", revision: 2, memberFileIds: ["file-1"], crystalName: "紫水晶" }),
    reprocessGroup: async () => ({ groupId: "group-1", jobId: "job-1", jobState: "QUEUED", processingVersion: 2 }),
    selectProcessedVersion: async () => ({ groupId: "group-1", state: "PROCESSED", selectedProcessingVersion: 1, updatedAt: NOW }),
    reviewProcessedAsset: async () => ({ groupId: "group-1", processedAssetId: "asset-1", reviewAction: "REJECT", state: "RETIRED", revision: 2, approvedAssetKey: null, reviewedAt: NOW }),
    updateCrystalDraft: async () => ({ crystalDraftId: "draft-1", revision: 2, curationComplete: false, missingFields: ["NAME_EN"], promotionEligible: false, updatedAt: NOW }),
    saveGroupDraft: async () => ({ groupId: "group-1", state: "NAMED", revision: 2, crystalDraftId: "draft-1", crystalDraftRevision: 1, draftSavedAt: NOW }),
    checkGroupDraftCompleteness: async () => ({ groupId: "group-1", state: "NAMED", complete: false, missingFields: ["SKU"], checkedAt: NOW }),
    publishGroup: async () => ({ groupId: "group-1", state: "PUBLISHED", materialProductId: "product-1", crystalId: "crystal-1", inventorySnapshotId: "inventory-1", publishedAt: NOW, publishedAssetKeys: [`approved:${SHA}`] }),
    getPublishResult: async () => ({ groupId: "group-1", state: "PUBLISHED", materialProductId: "product-1", crystalId: "crystal-1", inventorySnapshotId: "inventory-1", publishedAt: NOW, publishedAssetKeys: [`approved:${SHA}`] }),
    searchCrystals: async () => ({ crystals: [{ crystalId: "crystal-1", nameCn: "紫水晶", nameEn: "Amethyst", mineralName: "Quartz" }], nextCursor: null }),
    readSourceFile: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), contentType: "image/jpeg", etag: `"${SHA}"` }),
    readProcessedAsset: async () => ({ bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), contentType: "image/webp", etag: `"${SHA}"` })
  };
}

const routes = [
  { method: "POST", url: "/api/admin/bead-import/sessions", payload: { idempotencyKey: "create-1" } },
  { method: "GET", url: "/api/admin/bead-import/sessions?limit=20" },
  { method: "POST", url: "/api/admin/bead-import/sessions/session-1/cancel", payload: { idempotencyKey: "cancel-1" } },
  { method: "POST", url: "/api/admin/bead-import/sessions/session-1/manifest", payload: { idempotencyKey: "manifest-1", files: [{ clientFileId: "client-1", relativePath: "photo.jpg", byteSize: 6, lastModifiedMs: 1, kind: "JPEG" }] } },
  { method: "PUT", url: "/api/admin/bead-import/sessions/session-1/files/file-1/content", payload: Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0]), headers: { "content-type": "application/octet-stream", "content-length": "6" } },
  { method: "GET", url: "/api/admin/bead-import/sessions/session-1" },
  { method: "POST", url: "/api/admin/bead-import/sessions/session-1/grouping/start", payload: { idempotencyKey: "group-1" } },
  { method: "POST", url: "/api/admin/bead-import/sessions/session-1/processing/start", payload: { idempotencyKey: "process-1" } },
  { method: "PATCH", url: "/api/admin/bead-import/groups/group-1", payload: { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "紫水晶" } },
  { method: "POST", url: "/api/admin/bead-import/groups/group-1/reprocess", payload: { idempotencyKey: "reprocess-1", expectedGroupRevision: 1, settings: { maskThreshold: 0.5 } } },
  { method: "POST", url: "/api/admin/bead-import/groups/group-1/processed-version", payload: { expectedGroupRevision: 1, processingVersion: 1 } },
  { method: "POST", url: "/api/admin/bead-import/groups/group-1/processed-assets/asset-1/review", payload: { idempotencyKey: "review-1", expectedGroupRevision: 1, processedAssetId: "asset-1", action: "REJECT", reviewNote: "边缘异常" } },
  { method: "PATCH", url: "/api/admin/bead-import/crystal-drafts/draft-1", payload: { idempotencyKey: "curate-1", expectedRevision: 1, nameCn: "紫水晶" } },
  { method: "POST", url: "/api/admin/bead-import/groups/group-1/draft", payload: { expectedGroupRevision: 1, crystalName: "紫水晶" } },
  { method: "GET", url: "/api/admin/bead-import/groups/group-1/draft-completeness" },
  { method: "POST", url: "/api/admin/bead-import/groups/group-1/publish", payload: { idempotencyKey: "publish-1", expectedGroupRevision: 1, crystalId: "crystal-1", crystalName: "紫水晶", crystalNameConfirmedByOperator: true, displayName: "紫水晶 8mm", sku: "SKU-1", materialKey: "amethyst-8", shape: "ROUND", diameterMm: 8, qualityStatement: "人工目检", qualitySource: "批次检查", textureAssetKey: `approved:${SHA}`, currency: "CNY", unitPriceMinor: 100, costMinor: 50, availableQuantity: 1, allowPublicDisplay: true, allowAiRecommendation: false, allowAiTraining: false, allowCommercialUse: true, rightsHolder: "玄矶", usagePermission: "OWNED", isAuthenticPhotograph: true } },
  { method: "GET", url: "/api/admin/bead-import/groups/group-1/publish-result" },
  { method: "GET", url: "/api/admin/bead-import/files/file-1/content" },
  { method: "GET", url: "/api/admin/bead-import/processed-assets/asset-1/content?rendition=main" },
  { method: "GET", url: "/api/admin/bead-import/crystals?q=%E7%B4%AB%E6%B0%B4%E6%99%B6" }
] as const;

test("all twenty admin routes are registered, authenticated, and schema-valid", async () => {
  const app = createApp({
    assetImportEnabled: true,
    assetImportService: service() as never,
    productAssetService: { resolve: async () => { throw new Error("not used"); } } as never,
    assetAdminApiKey: ADMIN_KEY,
    logger: false
  });

  for (const route of routes) {
    const unauthorized = await app.inject(route as never);
    assert.equal(unauthorized.statusCode, 401, `${route.method} ${route.url}`);
    assert.ok(AssetImportErrorEnvelopeSchema.safeParse(unauthorized.json()).success);
    assert.equal(unauthorized.json().error.assetCode, undefined);

    const authorized = await app.inject({
      ...route,
      headers: { ...(route as { headers?: object }).headers, "x-admin-key": ADMIN_KEY }
    } as never);
    assert.equal(authorized.statusCode, 200, `${route.method} ${route.url}: ${authorized.body}`);
  }
  await app.close();
});

test("upload headers reject missing, duplicate, malformed, and oversized values before service work", () => {
  for (const headers of [
    {},
    { "content-length": ["6", "6"] },
    { "content-length": ["06"] },
    { "content-length": [String(256 * 1024 * 1024 + 1)] },
    { "content-length": ["6"], "x-content-sha256": [SHA, SHA] },
    { "content-length": ["6"], "x-content-sha256": ["bad"] }
  ]) {
    assert.throws(() => parseUploadHeaders(headers as never), AssetImportApiError);
  }
  assert.deepEqual(parseUploadHeaders({ "content-length": ["6"], "x-content-sha256": [SHA] }), {
    contentLengthBytes: 6,
    declaredSha256: SHA
  });
});

test("admin errors use strict envelopes without database messages or credentials", async () => {
  const secret = "asset-admin-secret-0123456789";
  const app = createApp({
    assetImportEnabled: true,
    assetImportService: {
      ...service(),
      createSession: async () => { throw new Error(`database at /private/root failed ${secret}`); }
    } as never,
    productAssetService: {} as never,
    assetAdminApiKey: secret,
    logger: false
  });
  const response = await app.inject({
    method: "POST", url: "/api/admin/bead-import/sessions",
    headers: { "x-admin-key": secret }, payload: { idempotencyKey: "create-1" }
  });
  assert.equal(response.statusCode, 500);
  assert.ok(AssetImportErrorEnvelopeSchema.safeParse(response.json()).success);
  assert.equal(response.body.includes(secret), false);
  assert.equal(response.body.includes("/private/root"), false);
  await app.close();
});

test("malformed JSON is a strict validation response rather than an internal failure", async () => {
  const app = createApp({
    assetImportEnabled: true,
    assetImportService: service() as never,
    productAssetService: {} as never,
    assetAdminApiKey: ADMIN_KEY,
    logger: false
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/bead-import/sessions",
    headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/json" },
    payload: "{"
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.ok(AssetImportErrorEnvelopeSchema.safeParse(response.json()).success);
  await app.close();
});

test("every upload content type reaches the application service as an unchanged readable stream", async () => {
  const received: Array<{ isStream: boolean; bytes: Buffer }> = [];
  const app = createApp({
    assetImportEnabled: true,
    assetImportService: {
      ...service(),
      uploadFile: async (_params: unknown, source: unknown) => {
        let bytes = Buffer.alloc(0);
        for await (const chunk of source as Readable) bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
        received.push({ isStream: source instanceof Readable, bytes });
        return { fileId: "file-1", uploadStatus: "UPLOADING", byteSize: 6, sha256: SHA };
      }
    } as never,
    productAssetService: {} as never,
    assetAdminApiKey: ADMIN_KEY,
    logger: false
  });
  const payload = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0]);
  for (const contentType of ["application/octet-stream", "application/json", "text/plain"]) {
    const response = await app.inject({
      method: "PUT",
      url: "/api/admin/bead-import/sessions/session-1/files/file-1/content",
      headers: { "x-admin-key": ADMIN_KEY, "content-type": contentType, "content-length": "6" },
      payload
    });
    assert.equal(response.statusCode, 200, `${contentType}: ${response.body}`);
  }
  assert.deepEqual(received, [
    { isStream: true, bytes: payload },
    { isStream: true, bytes: payload },
    { isStream: true, bytes: payload }
  ]);
  await app.close();
});

test("malformed upload headers are rejected before any request body byte is read", async () => {
  let reads = 0;
  let serviceCalled = false;
  const source = new Readable({
    read() {
      reads += 1;
      this.push(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0]));
      this.push(null);
    }
  });
  const app = createApp({
    assetImportEnabled: true,
    assetImportService: {
      ...service(),
      uploadFile: async () => {
        serviceCalled = true;
        return { fileId: "file-1", uploadStatus: "UPLOADING", byteSize: 6, sha256: SHA };
      }
    } as never,
    productAssetService: {} as never,
    assetAdminApiKey: ADMIN_KEY,
    logger: false
  });

  const response = await app.inject({
    method: "PUT",
    url: "/api/admin/bead-import/sessions/session-1/files/file-1/content",
    headers: { "x-admin-key": ADMIN_KEY, "content-type": "application/octet-stream" },
    payload: source
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(serviceCalled, false);
  assert.equal(reads, 0);
  await app.close();
});
