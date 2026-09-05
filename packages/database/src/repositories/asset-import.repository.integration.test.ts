import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import {
  AssetImportRepository,
  type ClaimedAssetJob,
  type CompleteAssetJobResult,
  type PublishAssetGroupInput
} from "./asset-import.repository.js";

const databaseUrl = process.env.DATABASE_URL;

test("live PostgreSQL bead asset import persistence matrix", { skip: !databaseUrl }, async (t) => {
  const prisma = createPrismaClient(databaseUrl);
  const repository = new AssetImportRepository(prisma);
  const prefix = `assetdb001-${Date.now()}`;
  const shaOf = (seed: string) => createHash("sha256").update(`${prefix}:${seed}`).digest("hex");
  const keyOf = (label: string) => `${prefix}-${label}`;

  function processResult(
    sourceFileId: string,
    outputSha256: string,
    storageKey: string
  ): CompleteAssetJobResult {
    return {
      kind: "PROCESS_GROUP",
      processingVersion: 1,
      output: {
        sourceFileId,
        purpose: "MAIN",
        storageProvider: "local-fs",
        storageKey,
        outputSha256,
        outputContentType: "image/webp",
        byteSize: 4096,
        widthPx: 512,
        heightPx: 512,
        processorVersion: "sharp-test-1.0.0",
        parameters: { maskThreshold: 0.5 }
      },
      qc: { passed: true, checks: [{ id: "alpha-coverage", passed: true }], summary: null }
    };
  }

  function reviewDecision() {
    return {
      usagePermission: "OWNED" as const,
      rightsHolder: "Mystcrag Studio",
      isAuthenticPhotograph: true,
      allowPublicDisplay: true,
      allowCommercialUse: true,
      allowAiTraining: false,
      allowAiRecommendation: true
    };
  }

  function publishInput(
    scenario: string,
    crystalId: string,
    textureAssetKey: string,
    overrides: Partial<PublishAssetGroupInput> = {}
  ): PublishAssetGroupInput {
    return {
      idempotencyKey: keyOf(`publish-${scenario}`),
      expectedGroupRevision: 1,
      crystalId,
      crystalName: "海蓝宝",
      crystalNameConfirmedByOperator: true,
      displayName: `海蓝宝圆珠 ${scenario}`,
      sku: keyOf(`sku-${scenario}`),
      materialKey: keyOf(`material-${scenario}`),
      shape: "ROUND",
      diameterMm: 8,
      qualityStatement: "品相完整，无裂痕",
      qualitySource: "供应商证书",
      textureAssetKey,
      currency: "CNY",
      unitPriceMinor: 1200,
      costMinor: 500,
      availableQuantity: 50,
      allowPublicDisplay: true,
      allowAiRecommendation: true,
      allowAiTraining: false,
      allowCommercialUse: true,
      rightsHolder: "Mystcrag Studio",
      usagePermission: "OWNED",
      isAuthenticPhotograph: true,
      ...overrides
    };
  }

  async function createCrystal(label: string): Promise<string> {
    const crystal = await prisma.crystal.create({
      data: {
        nameCn: `水晶 ${label}`,
        nameEn: `Crystal ${label}`,
        mineralName: "Quartz",
        gemologicalInfo: { source: "asset-db-001-integration" },
        colorTags: ["neutral"],
        visualTags: ["translucent"],
        styleTags: ["minimal"],
        emotionTags: ["calm-aesthetic"],
        cultureTags: ["design-reference"],
        priceLevel: 2,
        complianceNote: "Integration test reference only."
      }
    });
    return crystal.id;
  }

  async function driveGroupToReady(scenario: string): Promise<{
    sessionId: string;
    groupId: string;
    fileIds: string[];
    sourceFileId: string;
    outputSha256: string;
    assetKey: string;
    jobId: string;
    lease: ClaimedAssetJob["lease"];
  }> {
    const session = await repository.createSession({ idempotencyKey: keyOf(`session-${scenario}`) });
    const clientFileIds = [`${scenario}-cf-1`, `${scenario}-cf-2`];
    const registered = await repository.registerManifest(session.sessionId, {
      idempotencyKey: keyOf(`manifest-${scenario}`),
      files: clientFileIds.map((clientFileId) => ({
        clientFileId,
        relativePath: `imports/${scenario}/${clientFileId}.jpg`,
        byteSize: 2048,
        lastModifiedMs: 1_750_000_000_000,
        kind: "JPEG" as const
      }))
    });
    const fileIds = registered.files.map((file) => file.fileId);
    const outputSha256 = shaOf(`output-${scenario}`);
    await repository.recordUploadedFile(fileIds[0]!, outputSha256, `imports/${prefix}/raw/${scenario}-1.jpg`, {
      storageProvider: "local-fs"
    });
    const group = await prisma.beadImageGroup.create({
      data: { sessionId: session.sessionId, state: "NAMED", revision: 1 }
    });
    await prisma.assetSourceFile.update({
      where: { id: fileIds[0]! },
      data: { groupId: group.id }
    });
    const job = await prisma.assetProcessingJob.create({
      data: {
        sessionId: session.sessionId,
        groupId: group.id,
        jobType: "PROCESS_GROUP",
        state: "QUEUED",
        payload: {},
        maxRetries: 3
      }
    });
    const claimed = await repository.claimNextJob(`worker-${scenario}`, new Date(Date.now() + 60_000));
    assert.ok(claimed, `expected the seeded ${scenario} job to be claimable`);
    assert.equal(claimed.jobId, job.id);
    const completed = await repository.completeJob(
      claimed.jobId,
      processResult(fileIds[0]!, outputSha256, `imports/${prefix}/processed/${scenario}/v1/bead-512.webp`),
      claimed.lease
    );
    assert.equal(completed.state, "COMPLETED");
    // QC pass parks the asset in QC_PENDING; the operator approval is what
    // makes it publishable.
    const pendingAsset = await prisma.processedAsset.findFirstOrThrow({
      where: { groupId: group.id, isCurrentVersion: true }
    });
    assert.equal(pendingAsset.state, "QC_PENDING");
    const review = await repository.reviewProcessedAsset(pendingAsset.id, reviewDecision());
    assert.equal(review.state, "APPROVED");
    assert.equal(review.assetKey, `approved:${outputSha256}`);
    const groupRow = await prisma.beadImageGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(groupRow.state, "READY");
    return {
      sessionId: session.sessionId,
      groupId: group.id,
      fileIds,
      sourceFileId: fileIds[0]!,
      outputSha256,
      assetKey: `approved:${outputSha256}`,
      jobId: claimed.jobId,
      lease: claimed.lease
    };
  }

  function expectCode(code: PersistenceError["code"]) {
    return (error: unknown) => {
      assert.ok(error instanceof PersistenceError, `expected PersistenceError, got ${String(error)}`);
      assert.equal(error.code, code);
      return true;
    };
  }

  await prisma.$connect();
  try {
    await t.test("1. the bead asset import migration is additive and finished", async () => {
      const migrations = await prisma.$queryRawUnsafe<
        Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
      >(
        'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at'
      );
      const names = migrations.map(({ migration_name }) => migration_name);
      assert.ok(names.includes("20260831_add_bead_asset_import"));
      assert.equal(
        names.includes("20260902_harden_asset_import_persistence"),
        false,
        "the hardening round is folded into 20260831; a second asset import migration must not exist"
      );
      assert.ok(names.includes("20260721140000_init_mystcrag_persistence_v1"));
      assert.equal(migrations.every(({ finished_at }) => finished_at !== null), true);
      assert.equal(migrations.every(({ rolled_back_at }) => rolled_back_at === null), true);

      const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
      );
      const tableNames = new Set(tables.map(({ table_name }) => table_name));
      for (const legacy of ["users", "designs", "crystals", "material_products", "inventory_snapshots"]) {
        assert.ok(tableNames.has(legacy), `existing table ${legacy} must survive the migration`);
      }
      for (const added of [
        "asset_import_sessions",
        "asset_source_files",
        "bead_image_groups",
        "crystal_drafts",
        "material_product_drafts",
        "processed_assets",
        "asset_processing_jobs",
        "product_asset_bindings",
        "bead_group_publications"
      ]) {
        assert.ok(tableNames.has(added), `new table ${added} must exist after the migration`);
      }

      const indexes = await prisma.$queryRawUnsafe<
        Array<{ index_name: string; is_partial: boolean }>
      >(
        `SELECT i.relname AS index_name, ix.indpred IS NOT NULL AS is_partial
         FROM pg_class i
         JOIN pg_index ix ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         WHERE t.relname IN (
           'asset_import_sessions', 'asset_source_files', 'bead_image_groups', 'processed_assets',
           'asset_processing_jobs', 'product_asset_bindings', 'bead_group_publications'
         )`
      );
      const indexByName = new Map(indexes.map((row) => [row.index_name, row.is_partial]));
      for (const required of [
        "asset_import_sessions_idempotency_key_key",
        "asset_source_files_session_id_client_file_id_key",
        "asset_source_files_session_sha256_archived_key",
        "processed_assets_asset_key_key",
        "processed_assets_current_version_key",
        "product_asset_bindings_active_product_asset_key",
        "asset_processing_jobs_state_next_attempt_at_created_at_idx",
        "asset_processing_jobs_state_lease_until_idx",
        "bead_image_groups_state_updated_at_idx",
        "bead_group_publications_idempotency_key_key"
      ]) {
        assert.ok(indexByName.has(required), `required index ${required} must exist`);
      }
      for (const partial of [
        "asset_source_files_session_sha256_archived_key",
        "processed_assets_current_version_key",
        "product_asset_bindings_active_product_asset_key"
      ]) {
        assert.equal(indexByName.get(partial), true, `index ${partial} must stay a partial unique index`);
      }

      const columns = await prisma.$queryRawUnsafe<
        Array<{ table_name: string; column_name: string; is_nullable: string }>
      >(
        `SELECT table_name, column_name, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND (
           (table_name = 'asset_source_files' AND column_name = 'last_modified_ms')
           OR (table_name = 'asset_import_sessions' AND column_name = 'skipped_file_count')
           OR (table_name = 'crystal_drafts' AND column_name IN ('color_tags', 'visual_tags', 'style_tags', 'price_level'))
           OR (table_name = 'processed_assets' AND column_name IN (
             'usage_permission', 'rights_holder', 'allow_ai_training', 'allow_ai_recommendation'
           ))
           OR (table_name = 'bead_group_publications' AND column_name IN (
             'quality_statement', 'quality_source', 'rights_holder', 'usage_permission',
             'is_authentic_photograph', 'allow_ai_training', 'allow_ai_recommendation',
             'allow_commercial_use', 'allow_public_display'
           ))
         )`
      );
      const columnKey = (table: string, column: string) => `${table}.${column}`;
      const presentColumns = new Set(columns.map((row) => columnKey(row.table_name, row.column_name)));
      for (const required of [
        "asset_source_files.last_modified_ms",
        "asset_import_sessions.skipped_file_count",
        "crystal_drafts.color_tags",
        "crystal_drafts.visual_tags",
        "crystal_drafts.style_tags",
        "crystal_drafts.price_level",
        "processed_assets.usage_permission",
        "processed_assets.rights_holder",
        "processed_assets.allow_ai_training",
        "processed_assets.allow_ai_recommendation",
        "bead_group_publications.quality_statement",
        "bead_group_publications.quality_source",
        "bead_group_publications.rights_holder",
        "bead_group_publications.usage_permission",
        "bead_group_publications.is_authentic_photograph",
        "bead_group_publications.allow_ai_training",
        "bead_group_publications.allow_ai_recommendation",
        "bead_group_publications.allow_commercial_use",
        "bead_group_publications.allow_public_display"
      ]) {
        assert.ok(presentColumns.has(required), `required column ${required} must exist`);
      }
      for (const decision of columns.filter((row) => row.table_name === "bead_group_publications")) {
        assert.equal(
          decision.is_nullable,
          "NO",
          `publication decision column ${decision.column_name} must be NOT NULL so approval evidence is always recorded`
        );
      }
      console.log(
        `ASSET_IMPORT_VERIFICATION_ENV migrations=${names.length} tables=${tableNames.size} indexes=${indexByName.size}`
      );
    });

    await t.test("2. session creation is idempotent, including a concurrent race", async () => {
      const key = keyOf("session-stable");
      const first = await repository.createSession({ idempotencyKey: key });
      assert.equal(first.created, true);
      const retry = await repository.createSession({ idempotencyKey: key });
      assert.equal(retry.created, false);
      assert.equal(retry.sessionId, first.sessionId);
      assert.equal(await prisma.assetImportSession.count({ where: { idempotencyKey: key } }), 1);

      const raceKey = keyOf("session-race");
      const [left, right] = await Promise.all([
        repository.createSession({ idempotencyKey: raceKey }),
        repository.createSession({ idempotencyKey: raceKey })
      ]);
      assert.equal(left.sessionId, right.sessionId);
      assert.equal(await prisma.assetImportSession.count({ where: { idempotencyKey: raceKey } }), 1);

      await assert.rejects(() =>
        prisma.assetImportSession.create({ data: { idempotencyKey: key } })
      );
    });

    await t.test("3. manifest registration is idempotent and conflicting retries are rejected", async () => {
      const session = await repository.createSession({ idempotencyKey: keyOf("session-manifest") });
      const manifest = {
        idempotencyKey: keyOf("manifest-stable"),
        files: [
          {
            clientFileId: `${prefix}-mcf-1`,
            relativePath: `imports/manifest/${prefix}-mcf-1.jpg`,
            byteSize: 1024,
            lastModifiedMs: 1_750_000_000_000,
            kind: "JPEG" as const
          },
          {
            clientFileId: `${prefix}-mcf-2`,
            relativePath: `imports/manifest/${prefix}-mcf-2.jpg`,
            byteSize: 2048,
            lastModifiedMs: 1_750_000_000_001,
            kind: "JPEG" as const
          }
        ]
      };
      const first = await repository.registerManifest(session.sessionId, manifest);
      assert.equal(first.registeredFileCount, 2);
      const retry = await repository.registerManifest(session.sessionId, manifest);
      assert.deepEqual(
        retry.files.map((file) => file.fileId),
        first.files.map((file) => file.fileId)
      );
      assert.equal(await prisma.assetSourceFile.count({ where: { sessionId: session.sessionId } }), 2);

      await assert.rejects(
        () =>
          repository.registerManifest(session.sessionId, {
            idempotencyKey: keyOf("manifest-stable"),
            files: [manifest.files[0]!]
          }),
        expectCode("CONFLICT")
      );

      await assert.rejects(
        () =>
          repository.registerManifest(session.sessionId, {
            idempotencyKey: keyOf("manifest-changed-metadata"),
            files: [
              {
                clientFileId: `${prefix}-mcf-1`,
                relativePath: `imports/manifest/${prefix}-mcf-1.jpg`,
                byteSize: 4096,
                lastModifiedMs: 1_750_000_000_000,
                kind: "JPEG" as const
              }
            ]
          }),
        expectCode("CONFLICT")
      );

      const existing = await prisma.assetSourceFile.findFirstOrThrow({
        where: { sessionId: session.sessionId, clientFileId: `${prefix}-mcf-1` }
      });
      await assert.rejects(() =>
        prisma.assetSourceFile.create({
          data: {
            sessionId: session.sessionId,
            clientFileId: existing.clientFileId,
            relativePath: `imports/manifest/${prefix}-duplicate.jpg`,
            byteSize: 1n,
            kind: "JPEG"
          }
        })
      );
    });

    await t.test("4. upload archival deduplicates exact SHA-256 repeats inside one session", async () => {
      const session = await repository.createSession({ idempotencyKey: keyOf("session-upload") });
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf("manifest-upload"),
        files: [
          {
            clientFileId: `${prefix}-ucf-1`,
            relativePath: `imports/upload/${prefix}-ucf-1.jpg`,
            byteSize: 1024,
            lastModifiedMs: 1_750_000_000_000,
            kind: "JPEG" as const
          },
          {
            clientFileId: `${prefix}-ucf-2`,
            relativePath: `imports/upload/${prefix}-ucf-2.jpg`,
            byteSize: 1024,
            lastModifiedMs: 1_750_000_000_000,
            kind: "JPEG" as const
          }
        ]
      });
      const [firstFile, secondFile] = registered.files;
      const archiveSha = shaOf("upload-payload");
      const archived = await repository.recordUploadedFile(
        firstFile!.fileId,
        archiveSha,
        `imports/${prefix}/raw/upload-1.jpg`,
        { storageProvider: "local-fs" }
      );
      assert.equal(archived.uploadStatus, "ARCHIVED");
      assert.equal(archived.archiveKey, `imports/${prefix}/raw/upload-1.jpg`);

      const duplicate = await repository.recordUploadedFile(
        secondFile!.fileId,
        archiveSha,
        `imports/${prefix}/raw/upload-2.jpg`
      );
      assert.equal(duplicate.uploadStatus, "SKIPPED_DUPLICATE");
      assert.equal(duplicate.archiveKey, `imports/${prefix}/raw/upload-1.jpg`);
      const duplicateRow = await prisma.assetSourceFile.findUniqueOrThrow({
        where: { id: secondFile!.fileId }
      });
      assert.equal(duplicateRow.duplicateOfId, firstFile!.fileId);

      await assert.rejects(
        () =>
          repository.recordUploadedFile(
            firstFile!.fileId,
            shaOf("different-payload"),
            `imports/${prefix}/raw/upload-1.jpg`
          ),
        expectCode("CONFLICT")
      );

      const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
        where: { id: session.sessionId }
      });
      assert.equal(sessionRow.archivedFileCount, 1);
      assert.equal(sessionRow.failedFileCount, 0, "an exact duplicate is skipped, not failed");
      assert.equal(sessionRow.skippedFileCount, 1);
      assert.equal(sessionRow.uploadedBytes, 1024n);
      assert.equal(sessionRow.lastVerifiedCheckpoint, "ARCHIVED");

      const thirdFile = await prisma.assetSourceFile.create({
        data: {
          sessionId: session.sessionId,
          clientFileId: `${prefix}-ucf-3`,
          relativePath: `imports/upload/${prefix}-ucf-3.jpg`,
          byteSize: 512n,
          kind: "JPEG"
        }
      });
      await assert.rejects(() =>
        prisma.assetSourceFile.update({
          where: { id: thirdFile.id },
          data: { state: "ARCHIVED", sha256: archiveSha, archiveKey: `imports/${prefix}/raw/upload-3.jpg` }
        })
      );
    });

    await t.test("5. two concurrent workers can never claim the same job", async () => {
      const session = await repository.createSession({ idempotencyKey: keyOf("session-lease-race") });
      const job = await prisma.assetProcessingJob.create({
        data: {
          sessionId: session.sessionId,
          jobType: "ARCHIVE_FILE",
          state: "QUEUED",
          payload: {},
          maxRetries: 3
        }
      });
      const leaseUntil = new Date(Date.now() + 60_000);
      const claims = await Promise.all([
        repository.claimNextJob("worker-lease-a", leaseUntil),
        repository.claimNextJob("worker-lease-b", leaseUntil)
      ]);
      const winners = claims.filter((claimed) => claimed !== null);
      assert.equal(winners.length, 1);
      const winner = winners[0]!;
      assert.equal(winner.jobId, job.id);
      assert.equal(winner.state, "RUNNING");
      assert.ok(winner.lease.leaseToken);
      const jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(jobRow.state, "RUNNING");
      assert.ok(jobRow.workerId === "worker-lease-a" || jobRow.workerId === "worker-lease-b");
      assert.equal(jobRow.leaseToken, winner.lease.leaseToken);

      assert.equal(
        await repository.heartbeatJob(
          job.id,
          { workerId: "worker-lease-other", leaseToken: winner.lease.leaseToken },
          new Date(Date.now() + 60_000)
        ),
        false
      );
      assert.equal(
        await repository.heartbeatJob(job.id, winner.lease, new Date(Date.now() - 1_000)),
        false
      );
      assert.equal(
        await repository.heartbeatJob(job.id, winner.lease, new Date(Date.now() + 120_000)),
        true
      );
    });

    await t.test("6. an expired lease is reclaimed and the stale worker is rejected", async () => {
      const session = await repository.createSession({ idempotencyKey: keyOf("session-expired") });
      const job = await prisma.assetProcessingJob.create({
        data: {
          sessionId: session.sessionId,
          jobType: "ARCHIVE_FILE",
          state: "QUEUED",
          payload: {},
          maxRetries: 3
        }
      });
      const staleLease = await repository.claimNextJob("worker-stale", new Date(Date.now() + 60_000));
      assert.ok(staleLease);
      assert.equal(staleLease.jobId, job.id);
      // The repository writes timestamps through the pg adapter (UTC-naive),
      // so the fixture must backdate the lease with a bound Date rather than
      // server-side now(), whose rendering follows the session TimeZone.
      await prisma.$executeRawUnsafe(
        'UPDATE "asset_processing_jobs" SET "lease_until" = $1 WHERE "id" = $2',
        new Date(Date.now() - 5_000),
        job.id
      );

      await assert.rejects(
        () =>
          repository.completeJob(
            staleLease.jobId,
            { kind: "ARCHIVE_FILE", sha256: shaOf("stale-output"), archiveKey: `imports/${prefix}/raw/stale.jpg`, storageProvider: "local-fs" },
            staleLease.lease
          ),
        expectCode("CONFLICT")
      );

      const reclaimed = await repository.claimNextJob("worker-fresh", new Date(Date.now() + 60_000));
      assert.ok(reclaimed, "an expired lease must become reclaimable");
      assert.equal(reclaimed.jobId, job.id);
      assert.equal(reclaimed.lease.workerId, "worker-fresh");
      assert.notEqual(reclaimed.lease.leaseToken, staleLease.lease.leaseToken);

      assert.equal(
        await repository.heartbeatJob(job.id, staleLease.lease, new Date(Date.now() + 60_000)),
        false,
        "a restarted process reusing the same workerId but the stale lease token must be rejected"
      );
      await assert.rejects(
        () =>
          repository.failJob(
            job.id,
            { code: "STALE_WORKER", message: "stale worker must not overwrite the new lease" },
            new Date(Date.now() + 60_000),
            staleLease.lease
          ),
        expectCode("CONFLICT")
      );

      const completed = await repository.completeJob(
        job.id,
        {
          kind: "ARCHIVE_FILE",
          sha256: shaOf("expired-recovery"),
          archiveKey: `imports/${prefix}/raw/expired.jpg`,
          storageProvider: "local-fs"
        },
        reclaimed.lease
      );
      assert.equal(completed.state, "COMPLETED");
    });

    await t.test("7. failJob retries with backoff and fails terminally after max retries", async () => {
      const session = await repository.createSession({ idempotencyKey: keyOf("session-retry") });
      const job = await prisma.assetProcessingJob.create({
        data: {
          sessionId: session.sessionId,
          jobType: "ARCHIVE_FILE",
          state: "QUEUED",
          payload: {},
          maxRetries: 2
        }
      });
      const retryAt = new Date(Date.now() + 30_000);
      let claimed = await repository.claimNextJob("worker-retry", new Date(Date.now() + 60_000));
      assert.ok(claimed);
      assert.equal(claimed.jobId, job.id);
      const firstFailure = await repository.failJob(
        job.id,
        { code: "TRANSIENT", message: "first transient failure" },
        retryAt,
        claimed.lease
      );
      assert.equal(firstFailure.state, "QUEUED");
      assert.equal(firstFailure.retryCount, 1);
      assert.equal(firstFailure.nextAttemptAt?.getTime(), retryAt.getTime());
      assert.equal(
        await repository.claimNextJob("worker-retry-early", new Date(Date.now() + 60_000)),
        null,
        "a job whose next attempt is in the future must not be claimable"
      );

      await prisma.$executeRawUnsafe(
        'UPDATE "asset_processing_jobs" SET "next_attempt_at" = $1 WHERE "id" = $2',
        new Date(Date.now() - 1_000),
        job.id
      );
      claimed = await repository.claimNextJob("worker-retry-2", new Date(Date.now() + 60_000));
      assert.ok(claimed);
      assert.equal(claimed.jobId, job.id);
      assert.equal(claimed.retryCount, 1);
      const secondFailure = await repository.failJob(
        job.id,
        { code: "TRANSIENT", message: "second transient failure" },
        null,
        claimed.lease
      );
      assert.equal(secondFailure.state, "QUEUED");
      assert.equal(secondFailure.retryCount, 2);
      assert.ok(secondFailure.nextAttemptAt);

      await prisma.$executeRawUnsafe(
        'UPDATE "asset_processing_jobs" SET "next_attempt_at" = $1 WHERE "id" = $2',
        new Date(Date.now() - 1_000),
        job.id
      );
      claimed = await repository.claimNextJob("worker-retry-3", new Date(Date.now() + 60_000));
      assert.ok(claimed);
      const terminal = await repository.failJob(
        job.id,
        { code: "PERMANENT", message: "retries exhausted" },
        null,
        claimed.lease
      );
      assert.equal(terminal.state, "FAILED");
      assert.equal(terminal.retryCount, 3);
      assert.equal(terminal.nextAttemptAt, null);
      const jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(jobRow.errorCode, "PERMANENT");
      assert.ok(jobRow.failedAt);
      assert.equal(
        await repository.claimNextJob("worker-after-terminal", new Date(Date.now() + 60_000)),
        null,
        "a terminally failed job must never be claimable again"
      );
    });

    let fullFlowAssetKey = "";
    let fullFlowGroupId = "";
    await t.test("8. the full pipeline publishes one group transactionally", async () => {
      const scenario = "fullflow";
      const fixture = await driveGroupToReady(scenario);
      const crystalId = await createCrystal(scenario);
      const publishSku = keyOf(`sku-${scenario}`);
      const draft = await repository.saveGroupDraft(fixture.groupId, {
        expectedGroupRevision: 1,
        displayName: "海蓝宝圆珠 8mm",
        sku: publishSku,
        unitPriceMinor: 1200,
        allowPublicDisplay: true
      });
      assert.equal(draft.state, "READY");
      assert.equal(draft.revision, 2);

      const published = await repository.publishGroup(
        fixture.groupId,
        publishInput(scenario, crystalId, fixture.assetKey, { expectedGroupRevision: 2 })
      );
      assert.equal(published.state, "PUBLISHED");
      assert.equal(published.crystalId, crystalId);
      assert.deepEqual(published.publishedAssetKeys, [fixture.assetKey]);

      const product = await prisma.materialProduct.findUniqueOrThrow({
        where: { id: published.materialProductId }
      });
      assert.equal(product.sku, publishSku);
      assert.equal(product.textureAssetKey, fixture.assetKey);
      assert.equal(product.unitPriceMinor, 1200n);
      assert.equal(product.unitCostMinor, 500n);
      assert.equal(product.active, true);
      const snapshot = await prisma.inventorySnapshot.findUniqueOrThrow({
        where: { id: published.inventorySnapshotId }
      });
      assert.equal(snapshot.productType, "MATERIAL");
      assert.equal(snapshot.productId, product.id);
      assert.equal(snapshot.availableQuantity, 50);
      assert.equal(snapshot.sourceVersion, `asset-import:${fixture.groupId}`);
      const bindings = await prisma.productAssetBinding.findMany({
        where: { materialProductId: product.id }
      });
      assert.equal(bindings.length, 1);
      assert.equal(bindings[0]!.bindingStatus, "APPROVED");
      assert.equal(bindings[0]!.assetKey, fixture.assetKey);
      assert.equal(bindings[0]!.allowPublicDisplay, true);
      const groupRow = await prisma.beadImageGroup.findUniqueOrThrow({
        where: { id: fixture.groupId }
      });
      assert.equal(groupRow.state, "PUBLISHED");
      const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
        where: { id: fixture.sessionId }
      });
      assert.equal(sessionRow.state, "PUBLISHED");
      assert.equal(sessionRow.lastVerifiedCheckpoint, "PUBLISHED");
      const publication = await prisma.beadGroupPublication.findUniqueOrThrow({
        where: { groupId: fixture.groupId }
      });
      assert.equal(publication.materialProductId, product.id);

      const publicAsset = await repository.findApprovedPublicAsset(fixture.assetKey);
      assert.ok(publicAsset);
      assert.equal(publicAsset.storageProvider, "local-fs");
      assert.equal(publicAsset.outputBytes, 4096n);
      fullFlowAssetKey = fixture.assetKey;
      fullFlowGroupId = fixture.groupId;
    });

    await t.test("9. publication replays idempotently and conflicting replays are rejected", async () => {
      const scenario = "idempotent";
      const fixture = await driveGroupToReady(scenario);
      const crystalId = await createCrystal(scenario);
      const input = publishInput(scenario, crystalId, fixture.assetKey);
      const first = await repository.publishGroup(fixture.groupId, input);
      const retry = await repository.publishGroup(fixture.groupId, input);
      assert.equal(retry.materialProductId, first.materialProductId);
      assert.equal(retry.inventorySnapshotId, first.inventorySnapshotId);
      assert.equal(retry.publishedAt.getTime(), first.publishedAt.getTime());
      assert.equal(
        await prisma.materialProduct.count({ where: { crystalId } }),
        1,
        "a replayed publish must not create a second product"
      );
      assert.equal(
        await prisma.inventorySnapshot.count({ where: { sourceVersion: `asset-import:${fixture.groupId}` } }),
        1
      );
      assert.equal(
        await prisma.productAssetBinding.count({ where: { assetKey: fixture.assetKey } }),
        1
      );
      assert.equal(await prisma.beadGroupPublication.count({ where: { groupId: fixture.groupId } }), 1);

      await assert.rejects(
        () =>
          repository.publishGroup(fixture.groupId, publishInput(scenario, crystalId, fixture.assetKey, {
            unitPriceMinor: 999
          })),
        expectCode("CONFLICT")
      );
      await assert.rejects(
        () =>
          repository.publishGroup(
            fixture.groupId,
            publishInput(scenario, crystalId, fixture.assetKey, {
              idempotencyKey: keyOf("publish-idempotent-second"),
              expectedGroupRevision: 2
            })
          ),
        expectCode("CONFLICT")
      );
    });

    await t.test("10. one product binds both its texture and its model asset", async () => {
      const scenario = "modelasset";
      const fixture = await driveGroupToReady(scenario);
      const modelSha = shaOf(`model-${scenario}`);
      await prisma.processedAsset.create({
        data: {
          sourceFileId: fixture.sourceFileId,
          groupId: fixture.groupId,
          purpose: "MODEL",
          processingVersion: 1,
          processorVersion: "sharp-test-1.0.0",
          state: "APPROVED",
          storageProvider: "local-fs",
          storageKey: `imports/${prefix}/processed/${scenario}/v1/bead-model.webp`,
          assetKey: `approved:${modelSha}`,
          outputSha256: modelSha,
          outputBytes: 2048n,
          outputContentType: "image/webp",
          qcResult: { passed: true, checks: [] },
          qcPassedAt: new Date(),
          approvedAt: new Date(),
          usagePermission: "OWNED",
          isAuthenticPhotograph: true,
          allowCommercialUse: true,
          allowPublicDisplay: true,
          isCurrentVersion: true
        }
      });
      const crystalId = await createCrystal(scenario);
      const published = await repository.publishGroup(
        fixture.groupId,
        publishInput(scenario, crystalId, fixture.assetKey, {
          modelAssetKey: `approved:${modelSha}`
        })
      );
      assert.deepEqual(published.publishedAssetKeys.sort(), [
        `approved:${modelSha}`,
        fixture.assetKey
      ].sort());
      const bindings = await prisma.productAssetBinding.findMany({
        where: { materialProductId: published.materialProductId }
      });
      assert.equal(bindings.length, 2);
      assert.equal(bindings.every((binding) => binding.bindingStatus === "APPROVED"), true);
      const product = await prisma.materialProduct.findUniqueOrThrow({
        where: { id: published.materialProductId }
      });
      assert.equal(product.textureAssetKey, fixture.assetKey);
      assert.equal(product.modelAssetKey, `approved:${modelSha}`);
    });

    await t.test("11. a failing inventory append rolls back the whole publication", async () => {
      const scenario = "rollback";
      const fixture = await driveGroupToReady(scenario);
      const crystalId = await createCrystal(scenario);
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION ${'assetdb001_fail_inventory'}() RETURNS trigger AS $fn$
         BEGIN
           IF NEW.source_version LIKE 'asset-import:%' THEN
             RAISE EXCEPTION 'forced inventory append failure';
           END IF;
           RETURN NEW;
         END;
         $fn$ LANGUAGE plpgsql`
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER assetdb001_inventory_guard BEFORE INSERT ON "inventory_snapshots"
         FOR EACH ROW EXECUTE FUNCTION assetdb001_fail_inventory()`
      );
      try {
        await assert.rejects(
          () => repository.publishGroup(fixture.groupId, publishInput(scenario, crystalId, fixture.assetKey)),
          expectCode("DATA_INTEGRITY_ERROR")
        );
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER assetdb001_inventory_guard ON "inventory_snapshots"');
        await prisma.$executeRawUnsafe("DROP FUNCTION assetdb001_fail_inventory()");
      }
      assert.equal(await prisma.materialProduct.count({ where: { sku: "SKU-ROLLBACK" } }), 0);
      assert.equal(
        await prisma.inventorySnapshot.count({
          where: { sourceVersion: `asset-import:${fixture.groupId}` }
        }),
        0
      );
      assert.equal(
        await prisma.productAssetBinding.count({ where: { assetKey: fixture.assetKey } }),
        0
      );
      assert.equal(await prisma.beadGroupPublication.count({ where: { groupId: fixture.groupId } }), 0);
      const groupRow = await prisma.beadImageGroup.findUniqueOrThrow({
        where: { id: fixture.groupId }
      });
      assert.equal(groupRow.state, "READY");
      const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
        where: { id: fixture.sessionId }
      });
      assert.notEqual(sessionRow.state, "PUBLISHED");
      assert.notEqual(sessionRow.lastVerifiedCheckpoint, "PUBLISHED");
    });

    await t.test("12. approved-only public lookup hides drafts, retired and private assets", async () => {
      const scenario = "lookup";
      const fixture = await driveGroupToReady(scenario);
      // Each variant keeps a distinct (purpose, processingVersion) pair and at
      // most one current version per purpose so the group-level invariants
      // hold while every lookup rule is still exercised.
      const variants: Array<{
        label: string;
        state: "DRAFT" | "QC_PENDING" | "RETIRED" | "APPROVED";
        assetPurpose: "MAIN" | "TEXTURE" | "MODEL" | "PREVIEW";
        processingVersion: number;
        current: boolean;
        publicDisplay: boolean;
        bindingStatus: "DRAFT" | "APPROVED" | "RETIRED";
        bindingPurpose: "MAIN" | "TEXTURE" | "MODEL" | "PREVIEW";
      }> = [
        { label: "draft", state: "DRAFT", assetPurpose: "TEXTURE", processingVersion: 1, current: true, publicDisplay: true, bindingStatus: "DRAFT", bindingPurpose: "TEXTURE" },
        { label: "retired", state: "RETIRED", assetPurpose: "MODEL", processingVersion: 1, current: true, publicDisplay: true, bindingStatus: "RETIRED", bindingPurpose: "MODEL" },
        { label: "private", state: "APPROVED", assetPurpose: "PREVIEW", processingVersion: 1, current: true, publicDisplay: false, bindingStatus: "APPROVED", bindingPurpose: "PREVIEW" },
        { label: "superseded", state: "APPROVED", assetPurpose: "MODEL", processingVersion: 2, current: false, publicDisplay: true, bindingStatus: "APPROVED", bindingPurpose: "TEXTURE" }
      ];
      const crystalId = await createCrystal(`${scenario}-product`);
      const product = await prisma.materialProduct.create({
        data: {
          id: keyOf(`product-${scenario}`),
          sku: keyOf(`sku-${scenario}`),
          crystalId,
          name: "lookup product",
          shape: "ROUND",
          diameterMm: 8,
          materialKey: keyOf(`material-${scenario}`),
          currency: "CNY",
          unitPriceMinor: 100n,
          unitCostMinor: 50n
        }
      });
      for (const variant of variants) {
        const variantSha = shaOf(`lookup-${variant.label}`);
        const assetKey = `approved:${variantSha}`;
        const asset = await prisma.processedAsset.create({
          data: {
            sourceFileId: fixture.sourceFileId,
            groupId: fixture.groupId,
            purpose: variant.assetPurpose,
            processingVersion: variant.processingVersion,
            processorVersion: "sharp-test-1.0.0",
            state: variant.state,
            storageProvider: "local-fs",
            storageKey: `imports/${prefix}/processed/lookup/${variant.label}.webp`,
            assetKey,
            outputSha256: variantSha,
            outputBytes: 128n,
            outputContentType: "image/webp",
            qcResult: { passed: true, checks: [] },
            qcPassedAt: new Date(),
            approvedAt: new Date(),
            usagePermission: "OWNED",
            isAuthenticPhotograph: true,
            allowCommercialUse: true,
            allowPublicDisplay: variant.publicDisplay,
            isCurrentVersion: variant.current
          }
        });
        await prisma.productAssetBinding.create({
          data: {
            materialProductId: product.id,
            processedAssetId: asset.id,
            assetKey,
            purpose: variant.bindingPurpose,
            bindingStatus: variant.bindingStatus,
            allowPublicDisplay: true,
            allowCommercialUse: true
          }
        });
        assert.equal(
          await repository.findApprovedPublicAsset(assetKey),
          null,
          `a ${variant.label} asset must never be publicly readable`
        );
      }

      const unboundSha = shaOf("lookup-unbound");
      const unboundGroup = await prisma.beadImageGroup.create({
        data: { sessionId: fixture.sessionId, state: "NAMED", revision: 1 }
      });
      await prisma.processedAsset.create({
        data: {
          sourceFileId: fixture.sourceFileId,
          groupId: unboundGroup.id,
          purpose: "MAIN",
          processingVersion: 1,
          processorVersion: "sharp-test-1.0.0",
          state: "APPROVED",
          storageProvider: "local-fs",
          storageKey: `imports/${prefix}/processed/lookup/unbound.webp`,
          assetKey: `approved:${unboundSha}`,
          outputSha256: unboundSha,
          outputBytes: 128n,
          outputContentType: "image/webp",
          qcResult: { passed: true, checks: [] },
          qcPassedAt: new Date(),
          approvedAt: new Date(),
          usagePermission: "OWNED",
          isAuthenticPhotograph: true,
          allowCommercialUse: true,
          allowPublicDisplay: true,
          isCurrentVersion: true
        }
      });
      assert.equal(
        await repository.findApprovedPublicAsset(`approved:${unboundSha}`),
        null,
        "an approved asset without a published product binding stays private"
      );

      assert.ok(fullFlowAssetKey);
      const publicAsset = await repository.findApprovedPublicAsset(fullFlowAssetKey);
      assert.ok(publicAsset, "the published full-flow asset stays readable");
      assert.equal(publicAsset.assetKey, fullFlowAssetKey);

      await assert.rejects(
        () => repository.findApprovedPublicAsset("not-an-approved-key"),
        expectCode("VALIDATION_ERROR")
      );
    });

    await t.test("13. PostgreSQL enforces the partial unique invariants directly", async () => {
      const scenario = "constraints";
      const fixture = await driveGroupToReady(scenario);

      const firstArchived = await prisma.assetSourceFile.findFirstOrThrow({
        where: { sessionId: fixture.sessionId, state: "ARCHIVED" }
      });
      const sibling = await prisma.assetSourceFile.findFirstOrThrow({
        where: { sessionId: fixture.sessionId, state: "PENDING" }
      });
      await assert.rejects(() =>
        prisma.assetSourceFile.update({
          where: { id: sibling.id },
          data: { state: "ARCHIVED", sha256: firstArchived.sha256 }
        })
      );

      const secondSha = shaOf(`constraints-second-${scenario}`);
      await assert.rejects(() =>
        prisma.processedAsset.create({
          data: {
            sourceFileId: fixture.sourceFileId,
            groupId: fixture.groupId,
            purpose: "MAIN",
            processingVersion: 2,
            processorVersion: "sharp-test-1.0.0",
            state: "APPROVED",
            storageProvider: "local-fs",
            storageKey: `imports/${prefix}/processed/${scenario}/v2/bead-512.webp`,
            assetKey: fixture.assetKey,
            outputSha256: secondSha,
            outputBytes: 4096n,
            outputContentType: "image/webp",
            qcResult: { passed: true, checks: [] },
            qcPassedAt: new Date(),
            approvedAt: new Date(),
            usagePermission: "OWNED",
            isAuthenticPhotograph: true,
            allowCommercialUse: true,
            allowPublicDisplay: true,
            isCurrentVersion: true
          }
        }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /asset_key|current_version/);
          return true;
        }
      );

      const crystalId = await createCrystal(`${scenario}-product`);
      const product = await prisma.materialProduct.create({
        data: {
          id: keyOf(`product-${scenario}`),
          sku: keyOf(`sku-${scenario}`),
          crystalId,
          name: "constraint product",
          shape: "ROUND",
          diameterMm: 8,
          materialKey: keyOf(`material-${scenario}`),
          currency: "CNY",
          unitPriceMinor: 100n,
          unitCostMinor: 50n
        }
      });
      const boundAsset = await prisma.processedAsset.findFirstOrThrow({
        where: { groupId: fixture.groupId, isCurrentVersion: true }
      });
      await prisma.productAssetBinding.create({
        data: {
          materialProductId: product.id,
          processedAssetId: boundAsset.id,
          assetKey: boundAsset.assetKey!,
          purpose: "MAIN",
          bindingStatus: "APPROVED",
          allowPublicDisplay: true,
          allowCommercialUse: true
        }
      });
      await assert.rejects(() =>
        prisma.productAssetBinding.create({
          data: {
            materialProductId: product.id,
            processedAssetId: boundAsset.id,
            assetKey: boundAsset.assetKey!,
            purpose: "MAIN",
            bindingStatus: "APPROVED",
            allowPublicDisplay: true,
            allowCommercialUse: true
          }
        })
      );
    });

    await t.test("14. foreign keys restrict deletion across the import graph", async () => {
      assert.ok(fullFlowGroupId);
      const groupRow = await prisma.beadImageGroup.findUniqueOrThrow({
        where: { id: fullFlowGroupId }
      });
      await assert.rejects(() =>
        prisma.assetImportSession.delete({ where: { id: groupRow.sessionId } })
      );
      await assert.rejects(() => prisma.beadImageGroup.delete({ where: { id: fullFlowGroupId } }));
      const sourceFile = await prisma.assetSourceFile.findFirstOrThrow({
        where: { groupId: fullFlowGroupId }
      });
      await assert.rejects(() => prisma.assetSourceFile.delete({ where: { id: sourceFile.id } }));
      const boundAsset = await prisma.processedAsset.findFirstOrThrow({
        where: { groupId: fullFlowGroupId }
      });
      await assert.rejects(() => prisma.processedAsset.delete({ where: { id: boundAsset.id } }));
      const publication = await prisma.beadGroupPublication.findUniqueOrThrow({
        where: { groupId: fullFlowGroupId }
      });
      await assert.rejects(() =>
        prisma.materialProduct.delete({ where: { id: publication.materialProductId } })
      );
      await assert.rejects(() =>
        prisma.crystal.delete({ where: { id: publication.crystalId } })
      );
      await assert.rejects(() =>
        prisma.inventorySnapshot.delete({ where: { id: publication.inventorySnapshotId } })
      );
    });

    await t.test(
      "15. a stale worker cannot overwrite the reclaimer after a lease takeover",
      async () => {
        const scenario = "stalewrite";
        const session = await repository.createSession({ idempotencyKey: keyOf(`session-${scenario}`) });
        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId: session.sessionId,
            jobType: "ARCHIVE_FILE",
            state: "QUEUED",
            payload: {},
            maxRetries: 3
          }
        });
        const staleLease = await repository.claimNextJob("worker-stale-write", new Date(Date.now() + 60_000));
        assert.ok(staleLease);
        const staleResult: CompleteAssetJobResult = {
          kind: "ARCHIVE_FILE",
          sha256: shaOf(`${scenario}-stale`),
          archiveKey: `imports/${prefix}/raw/${scenario}-stale.jpg`,
          storageProvider: "local-fs"
        };

        // Emulate the pre-fix read-then-write pattern in one transaction: the
        // stale worker reads a still-valid lease, the lease then expires and
        // another worker reclaims the job, and only afterwards does the stale
        // worker write by bare id. The transaction rolls back at the end so
        // the demonstration leaves no residue behind.
        let oldPatternOverwrote = 0;
        let reclaimerLease: ClaimedAssetJob | null = null;
        await assert.rejects(() =>
          prisma.$transaction(
            async (tx) => {
              const read = await tx.$queryRawUnsafe<
                Array<{ id: string; worker_id: string | null; lease_until: Date }>
              >('SELECT id, worker_id, lease_until FROM "asset_processing_jobs" WHERE id = $1', job.id);
              assert.equal(read[0]!.worker_id, "worker-stale-write");

              await prisma.$executeRawUnsafe(
                'UPDATE "asset_processing_jobs" SET "lease_until" = $1 WHERE "id" = $2',
                new Date(Date.now() - 5_000),
                job.id
              );
              const reclaimed = await repository.claimNextJob(
                "worker-reclaimer",
                new Date(Date.now() + 60_000)
              );
              assert.ok(reclaimed, "the expired lease must be reclaimable mid-race");
              assert.equal(reclaimed.jobId, job.id);
              reclaimerLease = reclaimed;

              oldPatternOverwrote = await tx.$executeRawUnsafe(
                `UPDATE "asset_processing_jobs"
                 SET "state" = 'COMPLETED', "result" = $1::jsonb, "completed_at" = now(),
                     "worker_id" = NULL, "lease_token" = NULL, "lease_until" = NULL
                 WHERE "id" = $2`,
                JSON.stringify(staleResult),
                job.id
              );
              throw new Error("roll back the emulated pre-fix write");
            },
            { timeout: 30_000 }
          )
        );
        assert.equal(
          oldPatternOverwrote,
          1,
          "the pre-fix unconditional write-by-id would have clobbered the reclaimer"
        );

        let jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(jobRow.state, "RUNNING", "the rollback restores the reclaimer's lease");
        assert.equal(jobRow.workerId, "worker-reclaimer");
        assert.equal(jobRow.result, null);
        assert.equal(jobRow.completedAt, null);

        // The fixed repository path: the stale worker's compare-and-set must
        // reject without touching the reclaimer's state.
        await assert.rejects(
          () => repository.completeJob(job.id, staleResult, staleLease.lease),
          expectCode("CONFLICT")
        );
        jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(jobRow.state, "RUNNING");
        assert.equal(jobRow.workerId, "worker-reclaimer");
        assert.equal(jobRow.result, null);
        assert.equal(jobRow.completedAt, null);

        const completed = await repository.completeJob(
          job.id,
          {
            kind: "ARCHIVE_FILE",
            sha256: shaOf(`${scenario}-reclaimer`),
            archiveKey: `imports/${prefix}/raw/${scenario}-reclaimer.jpg`,
            storageProvider: "local-fs"
          },
          reclaimerLease!.lease
        );
        assert.equal(completed.state, "COMPLETED");

        // True concurrent race: the lease is already expired and the stale
        // completion races a parallel reclaim — the stale writer must lose
        // regardless of the interleaving.
        const raceSession = await repository.createSession({ idempotencyKey: keyOf("session-race-stale") });
        const raceJob = await prisma.assetProcessingJob.create({
          data: {
            sessionId: raceSession.sessionId,
            jobType: "ARCHIVE_FILE",
            state: "QUEUED",
            payload: {},
            maxRetries: 3
          }
        });
        const raceStale = await repository.claimNextJob("worker-race-stale", new Date(Date.now() + 60_000));
        assert.ok(raceStale);
        await prisma.$executeRawUnsafe(
          'UPDATE "asset_processing_jobs" SET "lease_until" = $1 WHERE "id" = $2',
          new Date(Date.now() - 5_000),
          raceJob.id
        );
        const [, staleOutcome] = await Promise.allSettled([
          repository.claimNextJob("worker-race-fresh", new Date(Date.now() + 60_000)),
          repository.completeJob(
            raceJob.id,
            {
              kind: "ARCHIVE_FILE",
              sha256: shaOf(`${scenario}-race-stale`),
              archiveKey: `imports/${prefix}/raw/${scenario}-race-stale.jpg`,
              storageProvider: "local-fs"
            },
            raceStale.lease
          )
        ]);
        assert.equal(staleOutcome.status, "rejected", "the stale completion must never win the race");
        const raceRow = await prisma.assetProcessingJob.findUniqueOrThrow({
          where: { id: raceJob.id }
        });
        assert.equal(raceRow.state, "RUNNING");
        assert.equal(raceRow.workerId, "worker-race-fresh");
        assert.equal(raceRow.result, null);
      }
    );

    await t.test("16. concurrent draft saves on one revision admit exactly one writer", async () => {
      const scenario = "draftcas";
      const fixture = await driveGroupToReady(scenario);

      // The pre-fix pattern read the revision, then wrote it back
      // unconditionally; a concurrent winner between read and write was
      // silently clobbered. Emulate that pattern, then roll back.
      let oldPatternOverwrote = 0;
      await assert.rejects(() =>
        prisma.$transaction(
          async (tx) => {
            const read = await tx.$queryRawUnsafe<Array<{ revision: number }>>(
              'SELECT revision FROM "bead_image_groups" WHERE id = $1',
              fixture.groupId
            );
            assert.equal(read[0]!.revision, 1);

            const winner = await repository.saveGroupDraft(fixture.groupId, {
              expectedGroupRevision: 1,
              displayName: `CAS winner ${scenario}`
            });
            assert.equal(winner.revision, 2);

            oldPatternOverwrote = await tx.$executeRawUnsafe(
              'UPDATE "bead_image_groups" SET "revision" = 2 WHERE "id" = $1',
              fixture.groupId
            );
            throw new Error("roll back the emulated pre-fix write");
          },
          { timeout: 30_000 }
        )
      );
      assert.equal(
        oldPatternOverwrote,
        1,
        "the pre-fix unconditional revision write would have clobbered the winner"
      );
      const groupRow = await prisma.beadImageGroup.findUniqueOrThrow({
        where: { id: fixture.groupId }
      });
      assert.equal(groupRow.revision, 2, "the rollback restores the winner's revision");

      // Two genuinely concurrent saves against the same revision: the
      // compare-and-set serialises them on the row lock, so exactly one
      // transaction commits and the other conflicts and rolls back.
      const raceGroup = await prisma.beadImageGroup.create({
        data: { sessionId: fixture.sessionId, state: "NAMED", revision: 1 }
      });
      const attempts = await Promise.allSettled([
        repository.saveGroupDraft(raceGroup.id, {
          expectedGroupRevision: 1,
          displayName: `race writer A ${scenario}`
        }),
        repository.saveGroupDraft(raceGroup.id, {
          expectedGroupRevision: 1,
          displayName: `race writer B ${scenario}`
        })
      ]);
      const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
      const rejected = attempts.filter((attempt) => attempt.status === "rejected");
      assert.equal(fulfilled.length, 1, "exactly one concurrent draft save may win the revision");
      assert.equal(rejected.length, 1);
      const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(
        rejectedError instanceof PersistenceError && rejectedError.code === "CONFLICT",
        `the loser must conflict, got ${String(rejectedError)}`
      );
      const raceRow = await prisma.beadImageGroup.findUniqueOrThrow({ where: { id: raceGroup.id } });
      assert.equal(raceRow.revision, 2);
      assert.equal(await prisma.materialProductDraft.count({ where: { groupId: raceGroup.id } }), 1);

      await assert.rejects(
        () =>
          repository.saveGroupDraft(raceGroup.id, {
            expectedGroupRevision: 1,
            displayName: `stale writer ${scenario}`
          }),
        expectCode("CONFLICT")
      );
    });

    await t.test("17. crystal draft promotion fails closed until a human curates every field", async () => {
      const scenario = "promotion";
      const fixture = await driveGroupToReady(scenario);
      const draft = await prisma.crystalDraft.create({
        data: {
          nameCn: "晋升水晶",
          nameEn: null,
          mineralName: "UNSPECIFIED",
          complianceNote: "Pending manual curation."
        }
      });
      await prisma.beadImageGroup.update({
        where: { id: fixture.groupId },
        data: { state: "READY", crystalDraftId: draft.id }
      });
      await prisma.assetImportSession.update({
        where: { id: fixture.sessionId },
        data: { state: "READY_TO_PUBLISH" }
      });

      await assert.rejects(
        () =>
          repository.publishGroup(
            fixture.groupId,
            publishInput(scenario, "unused-crystal-id", fixture.assetKey, {
              crystalId: undefined,
              crystalDraftId: draft.id,
              crystalDraftPromotionConfirmed: true,
              crystalName: "晋升水晶"
            })
          ),
        expectCode("COMPLIANCE_BLOCKED")
      );
      assert.equal(await prisma.crystal.count({ where: { nameCn: "晋升水晶" } }), 0);
      const draftRow = await prisma.crystalDraft.findUniqueOrThrow({ where: { id: draft.id } });
      assert.equal(draftRow.promotedCrystalId, null);
      assert.equal(await prisma.beadGroupPublication.count({ where: { groupId: fixture.groupId } }), 0);
      const groupAfterBlock = await prisma.beadImageGroup.findUniqueOrThrow({
        where: { id: fixture.groupId }
      });
      assert.equal(groupAfterBlock.state, "READY", "the failed promotion must roll the group back to READY");

      // A human curates every required field; only then may the draft promote,
      // carrying the manual fields onto the formal Crystal.
      await prisma.crystalDraft.update({
        where: { id: draft.id },
        data: {
          nameEn: "Promotion Crystal",
          mineralName: "Beryl",
          colorTags: ["blue"],
          visualTags: ["translucent"],
          styleTags: ["minimal"],
          priceLevel: 3,
          complianceNote: "合规说明：天然矿物，无处理。"
        }
      });
      const published = await repository.publishGroup(
        fixture.groupId,
        publishInput(scenario, "unused-crystal-id", fixture.assetKey, {
          crystalId: undefined,
          crystalDraftId: draft.id,
          crystalDraftPromotionConfirmed: true,
          crystalName: "晋升水晶"
        })
      );
      const crystal = await prisma.crystal.findUniqueOrThrow({ where: { id: published.crystalId } });
      assert.equal(crystal.nameCn, "晋升水晶");
      assert.equal(crystal.nameEn, "Promotion Crystal");
      assert.equal(crystal.mineralName, "Beryl");
      assert.deepEqual(crystal.colorTags, ["blue"]);
      assert.deepEqual(crystal.visualTags, ["translucent"]);
      assert.deepEqual(crystal.styleTags, ["minimal"]);
      assert.equal(crystal.priceLevel, 3);
      assert.equal(crystal.complianceNote, "合规说明：天然矿物，无处理。");
      const promotedDraft = await prisma.crystalDraft.findUniqueOrThrow({ where: { id: draft.id } });
      assert.equal(promotedDraft.promotedCrystalId, published.crystalId);
    });

    await t.test(
      "18. approved-only lookup joins through processedAssetId onto live public products",
      async () => {
        const scenario = "bindinglookup";
        const crystalId = await createCrystal(`${scenario}-product`);
        const lookupSession = await repository.createSession({ idempotencyKey: keyOf(`session-${scenario}`) });
        const lookupRegistered = await repository.registerManifest(lookupSession.sessionId, {
          idempotencyKey: keyOf(`manifest-${scenario}`),
          files: [
            {
              clientFileId: `${prefix}-lcf-1`,
              relativePath: `imports/${scenario}/lcf-1.jpg`,
              byteSize: 256,
              lastModifiedMs: 1_750_000_000_000,
              kind: "JPEG" as const
            }
          ]
        });
        const lookupFileId = lookupRegistered.files[0]!.fileId;

        async function seedLookupAsset(label: string): Promise<string> {
          const sha = shaOf(`${scenario}-${label}`);
          const group = await prisma.beadImageGroup.create({
            data: { sessionId: lookupSession.sessionId, state: "NAMED", revision: 1 }
          });
          const asset = await prisma.processedAsset.create({
            data: {
              sourceFileId: lookupFileId,
              groupId: group.id,
              purpose: "MAIN",
              processingVersion: 1,
              processorVersion: "sharp-test-1.0.0",
              state: "APPROVED",
              storageProvider: "local-fs",
              storageKey: `imports/${prefix}/processed/${scenario}/${label}.webp`,
              assetKey: `approved:${sha}`,
              outputSha256: sha,
              outputBytes: 256n,
              outputContentType: "image/webp",
              qcResult: { passed: true, checks: [] },
              qcPassedAt: new Date(),
              approvedAt: new Date(),
              usagePermission: "OWNED",
              isAuthenticPhotograph: true,
              allowCommercialUse: true,
              allowPublicDisplay: true,
              isCurrentVersion: true
            }
          });
          return asset.id;
        }

        async function seedLookupProduct(label: string, active: boolean): Promise<string> {
          const product = await prisma.materialProduct.create({
            data: {
              id: keyOf(`product-${scenario}-${label}`),
              sku: keyOf(`sku-${scenario}-${label}`),
              crystalId,
              name: `${scenario} ${label}`,
              shape: "ROUND",
              diameterMm: 8,
              materialKey: keyOf(`material-${scenario}-${label}`),
              currency: "CNY",
              unitPriceMinor: 100n,
              unitCostMinor: 50n,
              active
            }
          });
          return product.id;
        }

        // A binding that reuses another asset's key but points at a different
        // processed asset must not make that key resolvable.
        const targetAssetId = await seedLookupAsset("decoy-target");
        const targetSha = shaOf(`${scenario}-decoy-target`);
        const pointerAssetId = await seedLookupAsset("decoy-pointer");
        const pointerSha = shaOf(`${scenario}-decoy-pointer`);
        const decoyProductId = await seedLookupProduct("decoy", true);
        await prisma.productAssetBinding.create({
          data: {
            materialProductId: decoyProductId,
            processedAssetId: pointerAssetId,
            assetKey: `approved:${targetSha}`,
            purpose: "MAIN",
            bindingStatus: "APPROVED",
            allowPublicDisplay: true,
            allowCommercialUse: true,
            approvedAt: new Date()
          }
        });
        assert.notEqual(pointerAssetId, targetAssetId);
        assert.equal(
          await repository.findApprovedPublicAsset(`approved:${targetSha}`),
          null,
          "a key is only resolvable through a binding that points at the matching processed asset"
        );
        assert.equal(await repository.findApprovedPublicAsset(`approved:${pointerSha}`), null);

        // A private binding never exposes the asset.
        const privateAssetId = await seedLookupAsset("private");
        const privateSha = shaOf(`${scenario}-private`);
        const privateProductId = await seedLookupProduct("private", true);
        await prisma.productAssetBinding.create({
          data: {
            materialProductId: privateProductId,
            processedAssetId: privateAssetId,
            assetKey: `approved:${privateSha}`,
            purpose: "MAIN",
            bindingStatus: "APPROVED",
            allowPublicDisplay: false,
            allowCommercialUse: true,
            approvedAt: new Date()
          }
        });
        assert.equal(await repository.findApprovedPublicAsset(`approved:${privateSha}`), null);

        // A non-commercial binding never exposes the asset.
        const nonCommercialAssetId = await seedLookupAsset("noncommercial");
        const nonCommercialSha = shaOf(`${scenario}-noncommercial`);
        const nonCommercialProductId = await seedLookupProduct("noncommercial", true);
        await prisma.productAssetBinding.create({
          data: {
            materialProductId: nonCommercialProductId,
            processedAssetId: nonCommercialAssetId,
            assetKey: `approved:${nonCommercialSha}`,
            purpose: "MAIN",
            bindingStatus: "APPROVED",
            allowPublicDisplay: true,
            allowCommercialUse: false,
            approvedAt: new Date()
          }
        });
        assert.equal(await repository.findApprovedPublicAsset(`approved:${nonCommercialSha}`), null);

        // A binding onto an inactive product never exposes the asset.
        const inactiveAssetId = await seedLookupAsset("inactive");
        const inactiveSha = shaOf(`${scenario}-inactive`);
        const inactiveProductId = await seedLookupProduct("inactive", false);
        await prisma.productAssetBinding.create({
          data: {
            materialProductId: inactiveProductId,
            processedAssetId: inactiveAssetId,
            assetKey: `approved:${inactiveSha}`,
            purpose: "MAIN",
            bindingStatus: "APPROVED",
            allowPublicDisplay: true,
            allowCommercialUse: true,
            approvedAt: new Date()
          }
        });
        assert.equal(await repository.findApprovedPublicAsset(`approved:${inactiveSha}`), null);

        // The healthy path: matching processed asset, approved public
        // commercial binding, active product.
        const healthyAssetId = await seedLookupAsset("healthy");
        const healthySha = shaOf(`${scenario}-healthy`);
        const healthyProductId = await seedLookupProduct("healthy", true);
        await prisma.productAssetBinding.create({
          data: {
            materialProductId: healthyProductId,
            processedAssetId: healthyAssetId,
            assetKey: `approved:${healthySha}`,
            purpose: "MAIN",
            bindingStatus: "APPROVED",
            allowPublicDisplay: true,
            allowCommercialUse: true,
            approvedAt: new Date()
          }
        });
        const resolved = await repository.findApprovedPublicAsset(`approved:${healthySha}`);
        assert.ok(resolved, "the healthy binding must resolve");
        assert.equal(resolved.assetKey, `approved:${healthySha}`);
        assert.equal(resolved.storageProvider, "local-fs");
        assert.equal(resolved.outputBytes, 256n);
      }
    );

    await t.test(
      "19. publishing binds exactly the selected assets and snapshots the approval decisions",
      async () => {
        const scenario = "selective";
        const fixture = await driveGroupToReady(scenario);
        const previewSha = shaOf(`${scenario}-preview`);
        await prisma.processedAsset.create({
          data: {
            sourceFileId: fixture.sourceFileId,
            groupId: fixture.groupId,
            purpose: "PREVIEW",
            processingVersion: 1,
            processorVersion: "sharp-test-1.0.0",
            state: "APPROVED",
            storageProvider: "local-fs",
            storageKey: `imports/${prefix}/processed/${scenario}/v1/bead-preview.webp`,
            assetKey: `approved:${previewSha}`,
            outputSha256: previewSha,
            outputBytes: 1024n,
            outputContentType: "image/webp",
            qcResult: { passed: true, checks: [] },
            qcPassedAt: new Date(),
            approvedAt: new Date(),
            usagePermission: "OWNED",
            isAuthenticPhotograph: true,
            allowCommercialUse: true,
            allowPublicDisplay: false,
            isCurrentVersion: true
          }
        });
        const crystalId = await createCrystal(scenario);
        const published = await repository.publishGroup(
          fixture.groupId,
          publishInput(scenario, crystalId, fixture.assetKey, {
            allowAiTraining: false,
            allowAiRecommendation: true
          })
        );
        assert.equal(
          published.state,
          "PUBLISHED",
          "an unrelated private PREVIEW asset must never block publication"
        );
        assert.deepEqual(published.publishedAssetKeys, [fixture.assetKey]);

        const bindings = await prisma.productAssetBinding.findMany({
          where: { materialProductId: published.materialProductId }
        });
        assert.equal(bindings.length, 1, "only the selected texture asset is bound");
        assert.equal(bindings[0]!.assetKey, fixture.assetKey);
        assert.equal(bindings[0]!.bindingStatus, "APPROVED");
        assert.equal(
          await prisma.productAssetBinding.count({ where: { assetKey: `approved:${previewSha}` } }),
          0,
          "the private preview must never receive a binding"
        );

        const publication = await prisma.beadGroupPublication.findUniqueOrThrow({
          where: { groupId: fixture.groupId }
        });
        assert.deepEqual(publication.publishedAssetKeys, [fixture.assetKey]);
        assert.equal(publication.qualityStatement, "品相完整，无裂痕");
        assert.equal(publication.qualitySource, "供应商证书");
        assert.equal(publication.rightsHolder, "Mystcrag Studio");
        assert.equal(publication.usagePermission, "OWNED");
        assert.equal(publication.isAuthenticPhotograph, true);
        assert.equal(publication.allowAiTraining, false);
        assert.equal(publication.allowAiRecommendation, true);
        assert.equal(publication.allowCommercialUse, true);
        assert.equal(publication.allowPublicDisplay, true);
      }
    );

    await t.test(
      "20. QC pass stays pending human review: unapproved assets can neither publish nor resolve",
      async () => {
        const scenario = "qcpending";
        const session = await repository.createSession({ idempotencyKey: keyOf(`session-${scenario}`) });
        const registered = await repository.registerManifest(session.sessionId, {
          idempotencyKey: keyOf(`manifest-${scenario}`),
          files: [
            {
              clientFileId: `${scenario}-cf-1`,
              relativePath: `imports/${scenario}/${scenario}-cf-1.jpg`,
              byteSize: 2048,
              lastModifiedMs: 1_750_000_000_000,
              kind: "JPEG" as const
            }
          ]
        });
        const fileIds = registered.files.map((file) => file.fileId);
        const outputSha256 = shaOf(`output-${scenario}`);
        await repository.recordUploadedFile(fileIds[0]!, outputSha256, `imports/${prefix}/raw/${scenario}-1.jpg`, {
          storageProvider: "local-fs"
        });
        const group = await prisma.beadImageGroup.create({
          data: { sessionId: session.sessionId, state: "NAMED", revision: 1 }
        });
        await prisma.assetSourceFile.update({
          where: { id: fileIds[0]! },
          data: { groupId: group.id }
        });
        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId: session.sessionId,
            groupId: group.id,
            jobType: "PROCESS_GROUP",
            state: "QUEUED",
            payload: {},
            maxRetries: 3
          }
        });
        const claimed = await repository.claimNextJob(`worker-${scenario}`, new Date(Date.now() + 60_000));
        assert.ok(claimed);
        assert.equal(claimed.jobId, job.id);
        const output = processResult(
          fileIds[0]!,
          outputSha256,
          `imports/${prefix}/processed/${scenario}/v1/bead-512.webp`
        );

        const smuggled = {
          ...output,
          usagePermission: "OWNED",
          isAuthenticPhotograph: true,
          allowCommercialUse: true,
          allowPublicDisplay: true
        } as unknown as typeof output;
        await assert.rejects(
          () => repository.completeJob(claimed.jobId, smuggled, claimed.lease),
          expectCode("VALIDATION_ERROR"),
          "a worker result carrying permission decisions must be rejected before any write"
        );
        assert.equal(
          await prisma.processedAsset.count({ where: { groupId: group.id } }),
          0,
          "the rejected completion must not have written an asset row"
        );

        const completed = await repository.completeJob(claimed.jobId, output, claimed.lease);
        assert.equal(completed.state, "COMPLETED");
        const pending = await prisma.processedAsset.findFirstOrThrow({ where: { groupId: group.id } });
        assert.equal(pending.state, "QC_PENDING", "a QC pass must await human review, never auto-approve");
        assert.equal(pending.assetKey, null);
        assert.equal(pending.approvedAt, null);
        assert.equal(pending.qcPassedAt !== null, true);
        assert.equal(pending.usagePermission, "UNKNOWN");
        assert.equal(pending.rightsHolder, null);
        assert.equal(pending.allowPublicDisplay, false);
        assert.equal(pending.allowCommercialUse, false);

        assert.equal(
          await repository.findApprovedPublicAsset(`approved:${outputSha256}`),
          null,
          "a QC-passed but unapproved asset must be invisible to the public resolver"
        );

        const crystalId = await createCrystal(scenario);
        await assert.rejects(
          () => repository.publishGroup(group.id, publishInput(scenario, crystalId, `approved:${outputSha256}`)),
          expectCode("COMPLIANCE_BLOCKED"),
          "publishing a group whose current asset is only QC-passed must fail closed"
        );
        assert.equal(await prisma.materialProduct.count({ where: { sku: keyOf(`sku-${scenario}`) } }), 0);
        assert.equal(await prisma.beadGroupPublication.count({ where: { groupId: group.id } }), 0);

        const review = await repository.reviewProcessedAsset(pending.id, reviewDecision());
        assert.equal(review.state, "APPROVED");
        assert.equal(review.assetKey, `approved:${outputSha256}`);
        await assert.rejects(
          () => repository.reviewProcessedAsset(pending.id, reviewDecision()),
          expectCode("CONFLICT"),
          "a second review of the same asset must conflict"
        );

        const published = await repository.publishGroup(
          group.id,
          publishInput(scenario, crystalId, `approved:${outputSha256}`)
        );
        assert.equal(published.state, "PUBLISHED");
        assert.deepEqual(published.publishedAssetKeys, [`approved:${outputSha256}`]);
        const resolved = await repository.findApprovedPublicAsset(`approved:${outputSha256}`);
        assert.ok(resolved, "after human approval the published asset must resolve");
        assert.equal(resolved.assetKey, `approved:${outputSha256}`);
      }
    );
  } finally {
    await prisma.$disconnect();
  }
});
