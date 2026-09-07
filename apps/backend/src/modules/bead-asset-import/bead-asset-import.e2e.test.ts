import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ArchiveStore, sha256OfBytes } from "@mystcrag/asset-pipeline";
import { AssetImportRepository, createPrismaClient } from "@mystcrag/database";

import { createApp } from "../../app.js";
import { AssetImportApplicationService } from "./bead-asset-import.service.js";
import { ProductAssetService } from "../product-assets/product-asset.service.js";

const databaseUrl = process.env.ASSET_BACKEND_E2E_DATABASE_URL;
const ADMIN_KEY = "asset-backend-e2e-key-0123456789";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

test("real backend composes upload, review, curation, publication, and approved delivery", {
  skip: databaseUrl === undefined
}, async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const database = createPrismaClient();
  const archiveRoot = mkdtempSync(join(tmpdir(), "mystcrag-asset-backend-e2e-"));
  await database.$connect();
  try {
    const repository = new AssetImportRepository(database);
    const archiveStore = new ArchiveStore({ root: archiveRoot, repositoryRoots: [] });
    const app = createApp({
      assetImportEnabled: true,
      assetAdminApiKey: ADMIN_KEY,
      assetImportService: new AssetImportApplicationService({ repository, archiveStore }),
      productAssetService: new ProductAssetService({ repository, archiveStore }),
      logger: false
    });
    const adminHeaders = { "x-admin-key": ADMIN_KEY };

    const created = await app.inject({
      method: "POST", url: "/api/admin/bead-import/sessions", headers: adminHeaders,
      payload: { idempotencyKey: "e2e-session-create" }
    });
    assert.equal(created.statusCode, 200, created.body);
    const sessionId = created.json().sessionId as string;

    const manifest = await app.inject({
      method: "POST", url: `/api/admin/bead-import/sessions/${sessionId}/manifest`, headers: adminHeaders,
      payload: {
        idempotencyKey: "e2e-manifest",
        files: [{ clientFileId: "e2e-file", relativePath: "batch/e2e.jpg", byteSize: JPEG.byteLength, lastModifiedMs: 1, kind: "JPEG" }]
      }
    });
    assert.equal(manifest.statusCode, 200, manifest.body);
    const fileId = manifest.json().files[0].fileId as string;

    const uploaded = await app.inject({
      method: "PUT", url: `/api/admin/bead-import/sessions/${sessionId}/files/${fileId}/content`,
      headers: { ...adminHeaders, "content-type": "application/octet-stream", "content-length": String(JPEG.byteLength) },
      payload: JPEG
    });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    assert.equal(uploaded.json().uploadStatus, "UPLOADING");
    assert.equal(uploaded.json().archiveKey, undefined);

    const archiveJob = await repository.claimNextJob("e2e-worker", new Date(Date.now() + 60_000));
    assert.equal(archiveJob?.jobType, "ARCHIVE_FILE");
    const archivePayload = archiveJob!.payload as { stagingKey: string; sha256: string };
    const original = await archiveStore.putOriginal({
      sessionId, bytes: await archiveStore.read(archivePayload.stagingKey), sha256: archivePayload.sha256, extension: "jpg"
    });
    await repository.recordUploadedFile(fileId, original.sha256, original.archiveKey, {
      storageProvider: "local-fs",
      jobId: archiveJob!.jobId,
      lease: archiveJob!.lease
    });
    await repository.completeJob(archiveJob!.jobId, {
      kind: "ARCHIVE_FILE", sha256: original.sha256, archiveKey: original.archiveKey, storageProvider: "local-fs"
    }, archiveJob!.lease);
    await archiveStore.removeStaging(archivePayload.stagingKey);

    const archivedReplay = await app.inject({
      method: "PUT", url: `/api/admin/bead-import/sessions/${sessionId}/files/${fileId}/content`,
      headers: {
        ...adminHeaders,
        "content-type": "application/octet-stream",
        "content-length": String(JPEG.byteLength),
        "x-content-sha256": original.sha256
      },
      payload: JPEG
    });
    assert.equal(archivedReplay.statusCode, 200, archivedReplay.body);
    assert.equal(archivedReplay.json().uploadStatus, "ARCHIVED");
    assert.equal(archivedReplay.json().sha256, original.sha256);
    assert.equal(archivedReplay.json().archiveKey, original.archiveKey);
    assert.equal(await database.assetProcessingJob.count({
      where: { sessionId, jobType: "ARCHIVE_FILE" }
    }), 1);

    const groupingStart = await app.inject({
      method: "POST", url: `/api/admin/bead-import/sessions/${sessionId}/grouping/start`, headers: adminHeaders,
      payload: { idempotencyKey: "e2e-grouping" }
    });
    assert.equal(groupingStart.statusCode, 200, groupingStart.body);
    const groupingJob = await repository.claimNextJob("e2e-worker", new Date(Date.now() + 60_000));
    assert.equal(groupingJob?.jobType, "GROUP_SESSION");
    await repository.completeJob(groupingJob!.jobId, {
      kind: "GROUP_SESSION",
      groups: [{ groupId: "e2e-group", memberFileIds: [fileId], primaryFileId: fileId }]
    }, groupingJob!.lease);
    const groupedSession = await repository.getSession(sessionId);
    const groupId = groupedSession.groups[0]!.groupId;

    const named = await app.inject({
      method: "PATCH", url: `/api/admin/bead-import/groups/${groupId}`, headers: adminHeaders,
      payload: { action: "SET_NAME", expectedGroupRevision: 1, crystalName: "紫水晶" }
    });
    assert.equal(named.statusCode, 200, named.body);

    const processingStart = await app.inject({
      method: "POST", url: `/api/admin/bead-import/sessions/${sessionId}/processing/start`, headers: adminHeaders,
      payload: { idempotencyKey: "e2e-processing" }
    });
    assert.equal(processingStart.statusCode, 200, processingStart.body);
    const processJob = await repository.claimNextJob("e2e-worker", new Date(Date.now() + 60_000));
    assert.equal(processJob?.jobType, "PROCESS_GROUP");
    const output = await archiveStore.putProcessed({
      sessionId, groupId, processingVersion: 1, fileName: "bead-512.webp", bytes: WEBP
    });
    await repository.completeJob(processJob!.jobId, {
      kind: "PROCESS_GROUP",
      processingVersion: 1,
      output: {
        sourceFileId: fileId, purpose: "TEXTURE", storageProvider: "local", storageKey: output.archiveKey,
        outputSha256: output.sha256, outputContentType: "image/webp", byteSize: output.byteSize,
        widthPx: 1, heightPx: 1, processorVersion: "e2e-v1"
      },
      qc: { passed: true, checks: [{ id: "decode", passed: true }] }
    }, processJob!.lease);

    const draft = await app.inject({
      method: "POST", url: `/api/admin/bead-import/groups/${groupId}/draft`, headers: adminHeaders,
      payload: { expectedGroupRevision: 2, crystalName: "紫水晶" }
    });
    assert.equal(draft.statusCode, 200, draft.body);
    const crystalDraftId = draft.json().crystalDraftId as string;

    const curated = await app.inject({
      method: "PATCH", url: `/api/admin/bead-import/crystal-drafts/${crystalDraftId}`, headers: adminHeaders,
      payload: {
        idempotencyKey: "e2e-curation", expectedRevision: 1, nameCn: "紫水晶", nameEn: "Amethyst",
        mineralName: "Quartz", colorTags: ["purple"], visualTags: ["clear"], styleTags: ["classic"],
        priceLevel: 3, complianceNote: "仅作装饰用途，不构成医疗或科学结论"
      }
    });
    assert.equal(curated.statusCode, 200, curated.body);
    assert.equal(curated.json().curationComplete, true);

    const session = await repository.getSession(sessionId);
    const processedAssetId = session.groups[0]!.processedAssets[0]!.processedAssetId;
    const reviewed = await app.inject({
      method: "POST", url: `/api/admin/bead-import/groups/${groupId}/processed-assets/${processedAssetId}/review`, headers: adminHeaders,
      payload: {
        idempotencyKey: "e2e-review", expectedGroupRevision: 3, processedAssetId, action: "APPROVE",
        reviewNote: "人工确认边缘、颜色与授权", rightsHolder: "玄矶工作室", usagePermission: "OWNED",
        isAuthenticPhotograph: true, allowAiTraining: false, allowCommercialUse: true,
        allowPublicDisplay: true, allowAiRecommendation: false
      }
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    const approvedKey = `approved:${sha256OfBytes(WEBP)}`;
    assert.equal(reviewed.json().approvedAssetKey, approvedKey, "approval returns the authoritative approved key, never a client-computed one");

    // Gap 1: admin binary read of unpublished source and processed images.
    const sourceRead = await app.inject({ method: "GET", url: `/api/admin/bead-import/files/${fileId}/content`, headers: adminHeaders });
    assert.equal(sourceRead.statusCode, 200, sourceRead.body);
    assert.deepEqual(sourceRead.rawPayload, JPEG);
    assert.equal(sourceRead.headers["cache-control"], "private, no-store");

    const processedRead = await app.inject({ method: "GET", url: `/api/admin/bead-import/processed-assets/${processedAssetId}/content?rendition=main`, headers: adminHeaders });
    assert.equal(processedRead.statusCode, 200, processedRead.body);
    assert.deepEqual(processedRead.rawPayload, WEBP);

    // Gap 4: a session refresh restores the approved key, product draft and crystal curation.
    const hydratedSession = await app.inject({ method: "GET", url: `/api/admin/bead-import/sessions/${sessionId}`, headers: adminHeaders });
    assert.equal(hydratedSession.statusCode, 200, hydratedSession.body);
    const hydratedGroup = hydratedSession.json().groups.find((candidate: { groupId: string }) => candidate.groupId === groupId);
    assert.ok(hydratedGroup.productDraft, "the saved product draft hydrates");
    assert.equal(hydratedGroup.productDraft.crystalName, "紫水晶");
    assert.ok(hydratedGroup.crystalDraft, "the crystal draft hydrates");
    assert.equal(hydratedGroup.crystalDraft.nameCn, "紫水晶");
    assert.equal(hydratedGroup.crystalDraft.nameEn, "Amethyst");
    assert.equal(hydratedGroup.crystalDraft.mineralName, "Quartz");
    assert.deepEqual(hydratedGroup.crystalDraft.colorTags, ["purple"]);
    assert.equal(hydratedGroup.crystalDraft.priceLevel, 3);
    assert.equal(hydratedGroup.processedAssets[0].approvedAssetKey, approvedKey);

    const published = await app.inject({
      method: "POST", url: `/api/admin/bead-import/groups/${groupId}/publish`, headers: adminHeaders,
      payload: {
        idempotencyKey: "e2e-publish", expectedGroupRevision: 4, crystalDraftId,
        crystalDraftPromotionConfirmed: true, crystalName: "紫水晶", crystalNameConfirmedByOperator: true,
        displayName: "紫水晶 8mm", sku: "E2E-AMETHYST-8", materialKey: "e2e-amethyst-8",
        shape: "ROUND", diameterMm: 8, qualityStatement: "人工目检通过", qualitySource: "E2E 人工检查",
        textureAssetKey: approvedKey, currency: "CNY", unitPriceMinor: 100, costMinor: 50,
        availableQuantity: 1, allowPublicDisplay: true, allowAiRecommendation: false,
        allowAiTraining: false, allowCommercialUse: true, rightsHolder: "玄矶工作室",
        usagePermission: "OWNED", isAuthenticPhotograph: true
      }
    });
    assert.equal(published.statusCode, 200, published.body);
    assert.deepEqual(published.json().publishedAssetKeys, [approvedKey]);

    // Gap 2: dedicated admin Crystal search finds the promoted crystal by name.
    const crystalSearch = await app.inject({ method: "GET", url: `/api/admin/bead-import/crystals?q=${encodeURIComponent("紫水晶")}`, headers: adminHeaders });
    assert.equal(crystalSearch.statusCode, 200, crystalSearch.body);
    assert.ok(crystalSearch.json().crystals.some((candidate: { nameCn: string }) => candidate.nameCn === "紫水晶"));

    const reread = await app.inject({ method: "GET", url: `/api/admin/bead-import/groups/${groupId}/publish-result`, headers: adminHeaders });
    assert.equal(reread.statusCode, 200, reread.body);
    const publicAsset = await app.inject({ method: "GET", url: `/api/assets/${approvedKey}` });
    assert.equal(publicAsset.statusCode, 200, publicAsset.body);
    assert.deepEqual(publicAsset.rawPayload, WEBP);
    await app.close();
  } finally {
    await database.$disconnect();
    rmSync(archiveRoot, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
