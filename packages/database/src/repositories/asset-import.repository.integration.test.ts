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
    storageKey: string,
    processingVersion = 1
  ): CompleteAssetJobResult {
    return {
      kind: "PROCESS_GROUP",
      processingVersion,
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

  let reviewSequence = 0;
  function reviewDecision(processedAssetId: string, expectedGroupRevision = 1) {
    return {
      idempotencyKey: keyOf(`review-${processedAssetId}-${++reviewSequence}`),
      expectedGroupRevision,
      processedAssetId,
      action: "APPROVE" as const,
      reviewNote: "Operator reviewed image quality and rights evidence",
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
      expectedGroupRevision: 2,
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

  let archiveLeaseSequence = 0;
  async function recordUploadedFileWithLease(
    fileId: string,
    sha256: string,
    archiveKey: string,
    storageProvider = "local-fs"
  ) {
    const file = await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } });
    const sequence = ++archiveLeaseSequence;
    const lease = {
      workerId: `integration-archive-worker-${sequence}`,
      leaseToken: `integration-archive-lease-${sequence}`
    };
    const job = await prisma.assetProcessingJob.create({
      data: {
        sessionId: file.sessionId,
        groupId: null,
        jobType: "ARCHIVE_FILE",
        state: "RUNNING",
        payload: {
          fileId,
          stagingKey: `imports/${file.sessionId}/staging/00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          sha256
        },
        maxRetries: 3,
        workerId: lease.workerId,
        leaseToken: lease.leaseToken,
        leaseUntil: new Date(Date.now() + 60_000)
      }
    });
    const result = await repository.recordUploadedFile(fileId, sha256, archiveKey, {
      storageProvider,
      jobId: job.id,
      lease
    });
    await repository.completeJob(job.id, {
      kind: "ARCHIVE_FILE",
      sha256,
      archiveKey: result.archiveKey ?? archiveKey,
      storageProvider
    }, lease);
    return result;
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
    const archiveKey = `imports/${session.sessionId}/raw/${scenario}-1.jpg`;
    await recordUploadedFileWithLease(fileIds[0]!, outputSha256, archiveKey);
    const group = await prisma.beadImageGroup.create({
      data: { sessionId: session.sessionId, state: "NAMED", revision: 1 }
    });
    const reservedOutputStorageKey = `imports/${session.sessionId}/processed/${group.id}/v1/bead-512.webp`;
    await prisma.assetSourceFile.update({
      where: { id: fileIds[0]! },
      data: { groupId: group.id }
    });
    const job = await prisma.assetProcessingJob.create({
      data: {
        sessionId: session.sessionId,
        groupId: group.id,
        jobType: "PROCESS_GROUP",
        state: "RUNNING",
        payload: {
          groupId: group.id,
          processingVersion: 1,
          primaryFileId: fileIds[0]!,
          files: [{ fileId: fileIds[0]!, archiveKey, sha256: outputSha256 }],
          outputStorageKey: reservedOutputStorageKey
        },
        maxRetries: 3,
        workerId: `worker-${scenario}`,
        leaseToken: `lease-${scenario}`,
        leaseUntil: new Date(Date.now() + 60_000)
      }
    });
    const lease = { workerId: `worker-${scenario}`, leaseToken: `lease-${scenario}` };
    const completed = await repository.completeJob(
      job.id,
      processResult(fileIds[0]!, outputSha256, reservedOutputStorageKey),
      lease
    );
    assert.equal(completed.state, "COMPLETED");
    // QC pass parks the asset in QC_PENDING; the operator approval is what
    // makes it publishable.
    const pendingAsset = await prisma.processedAsset.findFirstOrThrow({
      where: { groupId: group.id, isCurrentVersion: true }
    });
    assert.equal(pendingAsset.state, "QC_PENDING");
    const review = await repository.reviewProcessedAsset(
      group.id,
      pendingAsset.id,
      reviewDecision(pendingAsset.id),
      "integration-admin"
    );
    assert.equal(review.state, "APPROVED");
    assert.equal(review.reviewAction, "APPROVE");
    const groupRow = await prisma.beadImageGroup.findUniqueOrThrow({ where: { id: group.id } });
    assert.equal(groupRow.state, "READY");
    const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
      where: { id: session.sessionId }
    });
    assert.equal(sessionRow.state, "READY_TO_PUBLISH");
    return {
      sessionId: session.sessionId,
      groupId: group.id,
      fileIds,
      sourceFileId: fileIds[0]!,
      outputSha256,
      assetKey: `approved:${outputSha256}`,
      jobId: job.id,
      lease
    };
  }

  function expectCode(code: PersistenceError["code"]) {
    return (error: unknown) => {
      assert.ok(error instanceof PersistenceError, `expected PersistenceError, got ${String(error)}`);
      assert.equal(error.code, code);
      return true;
    };
  }

  function publishAsAdmin(
    groupId: string,
    input: PublishAssetGroupInput,
    actorId = "integration-admin-publisher"
  ) {
    return repository.publishGroup(groupId, input, actorId);
  }

  async function pauseMatchingUpdates(
    tableName: "asset_processing_jobs" | "bead_image_groups",
    triggerName: string,
    functionName: string,
    whenClause: string
  ): Promise<() => Promise<void>> {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${tableName}"`);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION "${functionName}"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM pg_sleep(0.2);
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE ON "${tableName}"
      FOR EACH ROW
      WHEN (${whenClause})
      EXECUTE FUNCTION "${functionName}"()
    `);
    return async () => {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${tableName}"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    };
  }

  const waitForLockInterleave = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

  function assertConflictLoser(outcomes: PromiseSettledResult<unknown>[]): void {
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const loser = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
    );
    assert.ok(loser);
    assert.ok(
      loser.reason instanceof PersistenceError,
      `expected PersistenceError, got ${String(loser.reason)}`
    );
    assert.equal(loser.reason.code, "CONFLICT");
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
      assert.ok(names.includes("20260905_add_asset_backend_orchestration"));
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
        "asset_import_operations",
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
           'asset_processing_jobs', 'asset_import_operations', 'product_asset_bindings', 'bead_group_publications'
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
        "bead_group_publications_idempotency_key_key",
        "asset_import_operations_operation_type_idempotency_key_key",
        "asset_import_ops_aggregate_type_created_idx"
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
           OR (table_name = 'crystal_drafts' AND column_name IN ('color_tags', 'visual_tags', 'style_tags', 'price_level', 'revision'))
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
        "crystal_drafts.revision",
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
      const archived = await recordUploadedFileWithLease(
        firstFile!.fileId,
        archiveSha,
        `imports/${session.sessionId}/raw/upload.jpg`
      );
      assert.equal(archived.uploadStatus, "ARCHIVED");
      assert.equal(archived.archiveKey, `imports/${session.sessionId}/raw/upload.jpg`);

      const duplicate = await recordUploadedFileWithLease(
        secondFile!.fileId,
        archiveSha,
        `imports/${session.sessionId}/raw/upload.jpg`
      );
      assert.equal(duplicate.uploadStatus, "SKIPPED_DUPLICATE");
      assert.equal(duplicate.archiveKey, `imports/${session.sessionId}/raw/upload.jpg`);
      const duplicateRow = await prisma.assetSourceFile.findUniqueOrThrow({
        where: { id: secondFile!.fileId }
      });
      assert.equal(duplicateRow.duplicateOfId, firstFile!.fileId);

      await assert.rejects(
        () =>
          recordUploadedFileWithLease(
            firstFile!.fileId,
            shaOf("different-payload"),
            `imports/${session.sessionId}/raw/upload.jpg`
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
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf("manifest-expired"),
        files: [{
          clientFileId: `${prefix}-expired-file`,
          relativePath: `imports/expired/${prefix}.jpg`,
          byteSize: 1024,
          lastModifiedMs: 1_750_000_000_000,
          kind: "JPEG"
        }]
      });
      const fileId = registered.files[0]!.fileId;
      const recoverySha = shaOf("expired-recovery");
      const archiveKey = `imports/${session.sessionId}/raw/expired.jpg`;
      const job = await prisma.assetProcessingJob.create({
        data: {
          sessionId: session.sessionId,
          jobType: "ARCHIVE_FILE",
          state: "QUEUED",
          payload: {
            fileId,
            stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000006`,
            sha256: recoverySha
          },
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
            { kind: "ARCHIVE_FILE", sha256: recoverySha, archiveKey, storageProvider: "local-fs" },
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

      await repository.recordUploadedFile(fileId, recoverySha, archiveKey, {
        storageProvider: "local-fs",
        jobId: job.id,
        lease: reclaimed.lease
      });
      const completed = await repository.completeJob(
        job.id,
        {
          kind: "ARCHIVE_FILE",
          sha256: recoverySha,
          archiveKey,
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
        expectedGroupRevision: 2,
        displayName: "海蓝宝圆珠 8mm",
        sku: publishSku,
        unitPriceMinor: 1200,
        allowPublicDisplay: true
      });
      assert.equal(draft.state, "READY");
      assert.equal(draft.revision, 3);

      const published = await publishAsAdmin(
        fixture.groupId,
        publishInput(scenario, crystalId, fixture.assetKey, { expectedGroupRevision: 3 })
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
      assert.equal(publication.publishedByActorId, "integration-admin-publisher");

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
      const first = await publishAsAdmin(fixture.groupId, input);
      const retry = await publishAsAdmin(fixture.groupId, input);
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
          publishAsAdmin(fixture.groupId, publishInput(scenario, crystalId, fixture.assetKey, {
            unitPriceMinor: 999
          })),
        expectCode("CONFLICT")
      );
      await assert.rejects(
        () =>
          publishAsAdmin(
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
          rightsHolder: "Mystcrag Studio",
          isAuthenticPhotograph: true,
          allowCommercialUse: true,
          allowPublicDisplay: true,
          allowAiTraining: false,
          allowAiRecommendation: true,
          isCurrentVersion: true
        }
      });
      const crystalId = await createCrystal(scenario);
      const published = await publishAsAdmin(
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
          () => publishAsAdmin(fixture.groupId, publishInput(scenario, crystalId, fixture.assetKey)),
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
        const registered = await repository.registerManifest(session.sessionId, {
          idempotencyKey: keyOf(`manifest-${scenario}`),
          files: [{
            clientFileId: `${scenario}-file`,
            relativePath: `imports/${scenario}/file.jpg`,
            byteSize: 1024,
            lastModifiedMs: 1_750_000_000_000,
            kind: "JPEG"
          }]
        });
        const fileId = registered.files[0]!.fileId;
        const resultSha = shaOf(`${scenario}-stale`);
        const resultArchiveKey = `imports/${session.sessionId}/raw/${scenario}.jpg`;
        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId: session.sessionId,
            jobType: "ARCHIVE_FILE",
            state: "QUEUED",
            payload: {
              fileId,
              stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000015`,
              sha256: resultSha
            },
            maxRetries: 3
          }
        });
        const staleLease = await repository.claimNextJob("worker-stale-write", new Date(Date.now() + 60_000));
        assert.ok(staleLease);
        const staleResult: CompleteAssetJobResult = {
          kind: "ARCHIVE_FILE",
          sha256: resultSha,
          archiveKey: resultArchiveKey,
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

        await repository.recordUploadedFile(fileId, resultSha, resultArchiveKey, {
          storageProvider: "local-fs",
          jobId: job.id,
          lease: reclaimerLease!.lease
        });
        const completed = await repository.completeJob(
          job.id,
          {
            kind: "ARCHIVE_FILE",
            sha256: resultSha,
            archiveKey: resultArchiveKey,
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
            assert.equal(read[0]!.revision, 2);

            const winner = await repository.saveGroupDraft(fixture.groupId, {
              expectedGroupRevision: 2,
              displayName: `CAS winner ${scenario}`
            });
            assert.equal(winner.revision, 3);

            oldPatternOverwrote = await tx.$executeRawUnsafe(
              'UPDATE "bead_image_groups" SET "revision" = 3 WHERE "id" = $1',
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
      assert.equal(groupRow.revision, 3, "the rollback restores the winner's revision");

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
          publishAsAdmin(
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
      const published = await publishAsAdmin(
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
        const published = await publishAsAdmin(
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
        const archiveKey = `imports/${session.sessionId}/raw/${scenario}-1.jpg`;
        await recordUploadedFileWithLease(fileIds[0]!, outputSha256, archiveKey);
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
            payload: {
              groupId: group.id,
              processingVersion: 1,
              primaryFileId: fileIds[0]!,
              files: [{ fileId: fileIds[0]!, archiveKey, sha256: outputSha256 }],
              outputStorageKey: `imports/${session.sessionId}/processed/${group.id}/v1/bead-512.webp`
            },
            maxRetries: 3
          }
        });
        const claimed = await repository.claimNextJob(`worker-${scenario}`, new Date(Date.now() + 60_000));
        assert.ok(claimed);
        assert.equal(claimed.jobId, job.id);
        const output = processResult(
          fileIds[0]!,
          outputSha256,
          `imports/${session.sessionId}/processed/${group.id}/v1/bead-512.webp`
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
          () => publishAsAdmin(
            group.id,
            publishInput(scenario, crystalId, `approved:${outputSha256}`, { expectedGroupRevision: 1 })
          ),
          expectCode("COMPLIANCE_BLOCKED"),
          "publishing a group whose current asset is only QC-passed must fail closed"
        );
        assert.equal(await prisma.materialProduct.count({ where: { sku: keyOf(`sku-${scenario}`) } }), 0);
        assert.equal(await prisma.beadGroupPublication.count({ where: { groupId: group.id } }), 0);

        const review = await repository.reviewProcessedAsset(
          group.id,
          pending.id,
          reviewDecision(pending.id),
          "integration-admin"
        );
        assert.equal(review.state, "APPROVED");
        assert.equal(review.approvedAssetKey, `approved:${outputSha256}`, "approval must return the authoritative approved key");
        await assert.rejects(
          () => repository.reviewProcessedAsset(
            group.id,
            pending.id,
            reviewDecision(pending.id, 2),
            "integration-admin"
          ),
          expectCode("CONFLICT"),
          "a second review of the same asset must conflict"
        );

        const published = await publishAsAdmin(
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

    let uploadSessionForCancellation = "";
    let orchestrationSessionId = "";
    let orchestrationGroupId = "";

    await t.test("21. upload targets and archive enqueue prove ownership and replay durably", async () => {
      const scenario = "uploadtarget";
      const session = await repository.createSession({ idempotencyKey: keyOf(`session-${scenario}`) });
      const other = await repository.createSession({ idempotencyKey: keyOf(`session-${scenario}-other`) });
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`manifest-${scenario}`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/bead.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_000_001,
          kind: "JPEG"
        }]
      });
      const fileId = registered.files[0]!.fileId;
      await assert.rejects(
        () => repository.resolveUploadTarget({
          sessionId: other.sessionId,
          fileId,
          contentLengthBytes: 2048
        }),
        expectCode("NOT_FOUND")
      );
      await assert.rejects(
        () => repository.resolveUploadTarget({
          sessionId: session.sessionId,
          fileId,
          contentLengthBytes: 1024
        }),
        expectCode("CONFLICT")
      );
      const target = await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048,
        declaredSha256: shaOf(`${scenario}-source`)
      });
      assert.equal(target.kind, "JPEG");
      assert.equal(target.state, "UPLOADING");

      const enqueueInput = {
        sessionId: session.sessionId,
        fileId,
        idempotencyKey: keyOf(`archive-enqueue-${scenario}`),
        stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000021`,
        sha256: shaOf(`${scenario}-source`)
      };
      const first = await repository.enqueueArchiveFile(enqueueInput);
      const replay = await repository.enqueueArchiveFile(enqueueInput);
      assert.deepEqual(replay, first);
      assert.equal(
        await prisma.assetProcessingJob.count({ where: { sessionId: session.sessionId, jobType: "ARCHIVE_FILE" } }),
        1
      );
      await assert.rejects(
        () => repository.enqueueArchiveFile({ ...enqueueInput, sha256: shaOf(`${scenario}-different`) }),
        expectCode("CONFLICT")
      );
      const detail = await repository.getSession(session.sessionId);
      assert.equal(detail.files[0]!.fileId, fileId);
      assert.equal(detail.jobs[0]!.jobId, first.jobId);
      assert.equal(detail.jobs[0]!.jobType, "ARCHIVE_FILE");
      const listed = await repository.listSessions({ state: "ARCHIVING", limit: 100 });
      assert.ok(listed.sessions.some((entry) => entry.sessionId === session.sessionId));
      uploadSessionForCancellation = session.sessionId;
    });

    await t.test("22. grouping completion and human membership edits are authoritative", async () => {
      const scenario = "orchestration";
      const session = await repository.createSession({ idempotencyKey: keyOf(`session-${scenario}`) });
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`manifest-${scenario}`),
        files: [1, 2, 3].map((index) => ({
          clientFileId: `${scenario}-file-${index}`,
          relativePath: `imports/${scenario}/bead-${index}.jpg`,
          byteSize: 2048 + index,
          lastModifiedMs: 1_750_000_000_000 + index,
          kind: "JPEG" as const
        }))
      });
      const fileIds = registered.files.map((file) => file.fileId);
      for (const [index, fileId] of fileIds.entries()) {
        await recordUploadedFileWithLease(
          fileId,
          shaOf(`${scenario}-file-${index}`),
          `imports/${session.sessionId}/raw/file-${index}.jpg`
        );
      }
      const startInput = { idempotencyKey: keyOf(`grouping-${scenario}`) };
      const started = await repository.startGrouping(session.sessionId, startInput);
      assert.deepEqual(await repository.startGrouping(session.sessionId, startInput), started);
      assert.equal(started.queuedJobCount, 1);
      const job = await prisma.assetProcessingJob.findFirstOrThrow({
        where: { sessionId: session.sessionId, jobType: "GROUP_SESSION" }
      });
      const suggestedGroupA = keyOf(`${scenario}-group-a`);
      const suggestedGroupB = keyOf(`${scenario}-group-b`);
      const leaseUntil = new Date(Date.now() + 60_000);
      await prisma.assetProcessingJob.update({
        where: { id: job.id },
        data: {
          state: "RUNNING",
          workerId: `worker-${scenario}`,
          leaseToken: `lease-${scenario}`,
          leaseUntil
        }
      });
      await repository.completeJob(
        job.id,
        {
          kind: "GROUP_SESSION",
          groups: [
            { groupId: suggestedGroupA, memberFileIds: [fileIds[0]!, fileIds[1]!], primaryFileId: fileIds[0] },
            { groupId: suggestedGroupB, memberFileIds: [fileIds[2]!], primaryFileId: fileIds[2] }
          ]
        },
        { workerId: `worker-${scenario}`, leaseToken: `lease-${scenario}` }
      );
      assert.equal((await repository.getSession(session.sessionId)).groups.length, 2);
      const materializedFiles = await prisma.assetSourceFile.findMany({
        where: { id: { in: fileIds } },
        orderBy: { clientFileId: "asc" }
      });
      const groupA = materializedFiles[0]!.groupId!;
      const groupB = materializedFiles[2]!.groupId!;
      assert.notEqual(groupA, suggestedGroupA);
      assert.notEqual(groupB, suggestedGroupB);

      const named = await repository.updateGroup(groupA, {
        action: "SET_NAME",
        expectedGroupRevision: 1,
        crystalName: "人工确认紫水晶"
      }, "integration-admin");
      assert.equal(named.revision, 2);
      const primary = await repository.updateGroup(groupA, {
        action: "SET_PRIMARY",
        expectedGroupRevision: 2,
        primaryFileId: fileIds[0]!
      }, "integration-admin");
      assert.equal(primary.revision, 3);
      await assert.rejects(
        () => repository.updateGroup(groupA, {
          action: "SET_NAME",
          expectedGroupRevision: 1,
          crystalName: "过期写入"
        }, "integration-admin"),
        expectCode("CONFLICT")
      );
      const moved = await repository.updateGroup(groupA, {
        action: "MOVE_FILES",
        expectedGroupRevision: 3,
        fileIds: [fileIds[1]!],
        targetGroupId: groupB
      }, "integration-admin");
      assert.deepEqual(moved.memberFileIds, [fileIds[0]!]);
      const merged = await repository.updateGroup(groupA, {
        action: "MERGE_GROUPS",
        expectedGroupRevision: 4,
        sourceGroupIds: [groupA, groupB]
      }, "integration-admin");
      assert.equal(merged.revision, 5);
      assert.deepEqual([...merged.memberFileIds].sort(), [...fileIds].sort());
      assert.equal(await prisma.beadImageGroup.count({ where: { sessionId: session.sessionId } }), 1);

      const processingInput = { idempotencyKey: keyOf(`processing-${scenario}`) };
      const processing = await repository.startProcessing(session.sessionId, processingInput);
      assert.deepEqual(await repository.startProcessing(session.sessionId, processingInput), processing);
      assert.equal(processing.queuedJobCount, 1);
      orchestrationSessionId = session.sessionId;
      orchestrationGroupId = groupA;
    });

    await t.test("23. process, review, reprocess and version selection preserve CAS and idempotency", async () => {
      const scenario = "orchestration";
      const job = await prisma.assetProcessingJob.findFirstOrThrow({
        where: {
          sessionId: orchestrationSessionId,
          groupId: orchestrationGroupId,
          jobType: "PROCESS_GROUP",
          state: "QUEUED"
        }
      });
      const payload = job.payload as {
        processingVersion: number;
        primaryFileId: string;
      };
      assert.equal(payload.processingVersion, 1);
      const leaseUntil = new Date(Date.now() + 60_000);
      await prisma.assetProcessingJob.update({
        where: { id: job.id },
        data: {
          state: "RUNNING",
          workerId: `worker-${scenario}-process`,
          leaseToken: `lease-${scenario}-process`,
          leaseUntil
        }
      });
      const outputSha = shaOf(`${scenario}-processed-v1`);
      await repository.completeJob(
        job.id,
        processResult(
          payload.primaryFileId,
          outputSha,
          `imports/${orchestrationSessionId}/processed/${orchestrationGroupId}/v1/bead-512.webp`
        ),
        { workerId: `worker-${scenario}-process`, leaseToken: `lease-${scenario}-process` }
      );
      const pending = await prisma.processedAsset.findFirstOrThrow({
        where: { groupId: orchestrationGroupId, processingVersion: 1 }
      });
      const left = {
        ...reviewDecision(pending.id, 5),
        idempotencyKey: keyOf(`${scenario}-review-left`)
      };
      const right = {
        ...reviewDecision(pending.id, 5),
        idempotencyKey: keyOf(`${scenario}-review-right`),
        reviewNote: "并发复核的第二个写入"
      };
      const outcomes = await Promise.allSettled([
        repository.reviewProcessedAsset(orchestrationGroupId, pending.id, left, "integration-admin-left"),
        repository.reviewProcessedAsset(orchestrationGroupId, pending.id, right, "integration-admin-right")
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      const winnerIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
      const winnerInput = winnerIndex === 0 ? left : right;
      const winnerActor = winnerIndex === 0 ? "integration-admin-left" : "integration-admin-right";
      const replay = await repository.reviewProcessedAsset(
        orchestrationGroupId,
        pending.id,
        winnerInput,
        winnerActor
      );
      assert.equal(replay.state, "APPROVED");
      const audit = await prisma.assetImportOperation.findUniqueOrThrow({
        where: {
          operationType_idempotencyKey: {
            operationType: "REVIEW_PROCESSED_ASSET",
            idempotencyKey: winnerInput.idempotencyKey
          }
        }
      });
      assert.equal(audit.actorId, winnerActor);
      assert.equal(audit.reviewNote, winnerInput.reviewNote);

      const reprocessInput = {
        idempotencyKey: keyOf(`${scenario}-reprocess`),
        expectedGroupRevision: 6,
        settings: { maskThreshold: 0.55, edgeFeatherPx: 2 }
      };
      const reprocessed = await repository.reprocessGroup(orchestrationGroupId, reprocessInput);
      assert.deepEqual(await repository.reprocessGroup(orchestrationGroupId, reprocessInput), reprocessed);
      assert.equal(reprocessed.processingVersion, 2);
      const queuedReprocessJobs = await prisma.assetProcessingJob.findMany({
          where: { groupId: orchestrationGroupId, jobType: "PROCESS_GROUP", state: "QUEUED" }
      });
      assert.equal(queuedReprocessJobs.length, 1);
      assert.deepEqual(
        (queuedReprocessJobs[0]!.payload as { settings?: unknown }).settings,
        reprocessInput.settings
      );
      const reprocessJob = queuedReprocessJobs[0]!;
      const reprocessPayload = reprocessJob.payload as {
        primaryFileId?: string;
        files: Array<{ fileId: string }>;
        outputStorageKey: string;
      };
      const reprocessLease = {
        workerId: `worker-${scenario}-reprocess`,
        leaseToken: `lease-${scenario}-reprocess`
      };
      await prisma.assetProcessingJob.update({
        where: { id: reprocessJob.id },
        data: {
          state: "RUNNING",
          workerId: reprocessLease.workerId,
          leaseToken: reprocessLease.leaseToken,
          leaseUntil: new Date(Date.now() + 60_000)
        }
      });
      await repository.completeJob(
        reprocessJob.id,
        processResult(
          reprocessPayload.primaryFileId ?? reprocessPayload.files[0]!.fileId,
          shaOf(`${scenario}-reprocess-output`),
          reprocessPayload.outputStorageKey,
          2
        ),
        reprocessLease
      );
      const selected = await repository.selectProcessedVersion(
        orchestrationGroupId,
        { expectedGroupRevision: 7, processingVersion: 1 },
        "integration-version-selector"
      );
      assert.equal(selected.selectedProcessingVersion, 1);
      const current = await prisma.processedAsset.findMany({
        where: { groupId: orchestrationGroupId, isCurrentVersion: true }
      });
      assert.equal(current.length, 1);
      assert.equal(current[0]!.processingVersion, 1);
    });

    await t.test("24. CrystalDraft curation admits one concurrent writer and blocks duplicates", async () => {
      const scenario = "curationcas";
      const draft = await prisma.crystalDraft.create({
        data: {
          nameCn: "待补充水晶",
          mineralName: "UNSPECIFIED",
          complianceNote: "Pending manual curation."
        }
      });
      const base = {
        expectedRevision: 1,
        nameCn: "并发紫水晶",
        nameEn: "Concurrent Amethyst",
        mineralName: "Quartz",
        colorTags: ["purple"],
        visualTags: ["translucent"],
        styleTags: ["minimal"],
        priceLevel: 3,
        complianceNote: "仅作矿物材质和装饰用途说明，不构成功效结论"
      };
      const left = { ...base, idempotencyKey: keyOf(`${scenario}-left`) };
      const right = {
        ...base,
        idempotencyKey: keyOf(`${scenario}-right`),
        nameCn: "并发获胜候选二"
      };
      const outcomes = await Promise.allSettled([
        repository.updateCrystalDraft(draft.id, left, "integration-admin-left"),
        repository.updateCrystalDraft(draft.id, right, "integration-admin-right")
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      const winnerIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
      const winner = outcomes[winnerIndex]!;
      assert.equal(winner.status, "fulfilled");
      const winnerInput = winnerIndex === 0 ? left : right;
      const winnerActor = winnerIndex === 0 ? "integration-admin-left" : "integration-admin-right";
      const replay = await repository.updateCrystalDraft(draft.id, winnerInput, winnerActor);
      assert.deepEqual(replay, winner.value);
      assert.equal(replay.revision, 2);
      assert.equal(replay.curationComplete, true);
      assert.equal(replay.promotionEligible, true);

      await prisma.crystal.create({
        data: {
          nameCn: winnerInput.nameCn,
          nameEn: winnerInput.nameEn,
          mineralName: winnerInput.mineralName,
          gemologicalInfo: {},
          colorTags: winnerInput.colorTags,
          visualTags: winnerInput.visualTags,
          styleTags: winnerInput.styleTags,
          emotionTags: [],
          cultureTags: [],
          priceLevel: winnerInput.priceLevel,
          complianceNote: winnerInput.complianceNote
        }
      });
      const duplicateBlocked = await repository.updateCrystalDraft(
        draft.id,
        {
          idempotencyKey: keyOf(`${scenario}-duplicate-check`),
          expectedRevision: 2,
          complianceNote: "更新说明后仍必须由人工解决重复水晶，不自动晋升"
        },
        "integration-admin-reviewer"
      );
      assert.equal(duplicateBlocked.curationComplete, true);
      assert.equal(duplicateBlocked.promotionEligible, false);
    });

    await t.test("25. cancellation replays, publish results re-read, and draft completeness stays queryable", async () => {
      const cancelInput = { idempotencyKey: keyOf("cancel-uploadtarget") };
      const first = await repository.cancelSession(
        uploadSessionForCancellation,
        cancelInput,
        "integration-admin"
      );
      assert.deepEqual(
        await repository.cancelSession(uploadSessionForCancellation, cancelInput, "integration-admin"),
        first
      );
      const cancelledJob = await prisma.assetProcessingJob.findFirstOrThrow({
        where: { sessionId: uploadSessionForCancellation, jobType: "ARCHIVE_FILE" }
      });
      assert.equal(cancelledJob.state, "FAILED");
      assert.equal(cancelledJob.errorCode, "SESSION_CANCELLED");
      const cancelledSessions = await repository.listSessions({ state: "CANCELLED", limit: 100 });
      assert.ok(cancelledSessions.sessions.some((entry) => entry.sessionId === uploadSessionForCancellation));

      const publishResult = await repository.getPublishResult(fullFlowGroupId);
      assert.equal(publishResult.groupId, fullFlowGroupId);
      assert.deepEqual(publishResult.publishedAssetKeys, [fullFlowAssetKey]);
      const completeness = await repository.checkGroupDraftCompleteness(fullFlowGroupId);
      assert.equal(completeness.groupId, fullFlowGroupId);
      assert.equal(completeness.complete, false);
      assert.ok(completeness.missingFields.includes("CRYSTAL_REFERENCE"));
    });

    await t.test("26. aggregate work starts admit one distinct-key winner without duplicate jobs", async () => {
      const scenario = "aggregate-work-cas";
      const groupingSession = await repository.createSession({
        idempotencyKey: keyOf(`${scenario}-grouping-session`)
      });
      const groupingManifest = await repository.registerManifest(groupingSession.sessionId, {
        idempotencyKey: keyOf(`${scenario}-grouping-manifest`),
        files: [{
          clientFileId: `${scenario}-grouping-file`,
          relativePath: `imports/${scenario}/grouping.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_000_010,
          kind: "JPEG"
        }]
      });
      const groupingFileId = groupingManifest.files[0]!.fileId;
      await recordUploadedFileWithLease(
        groupingFileId,
        shaOf(`${scenario}-grouping-file`),
        `imports/${groupingSession.sessionId}/raw/grouping.jpg`
      );
      const groupingOutcomes = await Promise.allSettled([
        repository.startGrouping(groupingSession.sessionId, {
          idempotencyKey: keyOf(`${scenario}-grouping-left`)
        }),
        repository.startGrouping(groupingSession.sessionId, {
          idempotencyKey: keyOf(`${scenario}-grouping-right`)
        })
      ]);
      assert.equal(groupingOutcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(groupingOutcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      assert.equal(await prisma.assetProcessingJob.count({
        where: { sessionId: groupingSession.sessionId, jobType: "GROUP_SESSION" }
      }), 1);

      const processingSession = await repository.createSession({
        idempotencyKey: keyOf(`${scenario}-processing-session`)
      });
      const processingManifest = await repository.registerManifest(processingSession.sessionId, {
        idempotencyKey: keyOf(`${scenario}-processing-manifest`),
        files: [{
          clientFileId: `${scenario}-processing-file`,
          relativePath: `imports/${scenario}/processing.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_000_011,
          kind: "JPEG"
        }]
      });
      const processingFileId = processingManifest.files[0]!.fileId;
      await recordUploadedFileWithLease(
        processingFileId,
        shaOf(`${scenario}-processing-file`),
        `imports/${processingSession.sessionId}/raw/processing.jpg`
      );
      const group = await prisma.beadImageGroup.create({
        data: {
          sessionId: processingSession.sessionId,
          state: "NAMED",
          revision: 1,
          primaryFileId: processingFileId,
          crystalName: "并发测试水晶"
        }
      });
      await prisma.assetSourceFile.update({
        where: { id: processingFileId },
        data: { groupId: group.id }
      });
      await prisma.assetImportSession.update({
        where: { id: processingSession.sessionId },
        data: { state: "NEEDS_REVIEW" }
      });
      const processingOutcomes = await Promise.allSettled([
        repository.startProcessing(processingSession.sessionId, {
          idempotencyKey: keyOf(`${scenario}-processing-left`)
        }),
        repository.startProcessing(processingSession.sessionId, {
          idempotencyKey: keyOf(`${scenario}-processing-right`)
        })
      ]);
      assert.equal(processingOutcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(processingOutcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      assert.equal(await prisma.assetProcessingJob.count({
        where: { sessionId: processingSession.sessionId, jobType: "PROCESS_GROUP" }
      }), 1);
    });

    await t.test("27. archive enqueue and concurrent file completion remain aggregate-safe", async () => {
      const scenario = "archive-aggregate-cas";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: Array.from({ length: 8 }, (_, index) => ({
          clientFileId: `${scenario}-${index}`,
          relativePath: `imports/${scenario}/${index}.jpg`,
          byteSize: 2048 + index,
          lastModifiedMs: 1_750_000_000_100 + index,
          kind: "JPEG" as const
        }))
      });
      const [enqueuedFile, ...completionFiles] = registered.files;
      assert.ok(enqueuedFile);
      await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId: enqueuedFile.fileId,
        contentLengthBytes: 2048
      });
      const enqueueBase = {
        sessionId: session.sessionId,
        fileId: enqueuedFile.fileId,
        stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000027`,
        sha256: shaOf(`${scenario}-enqueue`)
      };
      const enqueueOutcomes = await Promise.allSettled([
        repository.enqueueArchiveFile({
          ...enqueueBase,
          idempotencyKey: keyOf(`${scenario}-enqueue-left`)
        }),
        repository.enqueueArchiveFile({
          ...enqueueBase,
          idempotencyKey: keyOf(`${scenario}-enqueue-right`)
        })
      ]);
      assert.equal(enqueueOutcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(enqueueOutcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      assert.equal(await prisma.assetProcessingJob.count({
        where: { sessionId: session.sessionId, jobType: "ARCHIVE_FILE" }
      }), 1);

      await Promise.all(completionFiles.map((file, index) => recordUploadedFileWithLease(
        file.fileId,
        shaOf(`${scenario}-completion-${index}`),
        `imports/${session.sessionId}/raw/completion-${index}.jpg`
      )));
      const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } });
      assert.equal(sessionRow.archivedFileCount, completionFiles.length);
      assert.equal(
        Number(sessionRow.uploadedBytes),
        completionFiles.reduce((total, _file, index) => total + 2049 + index, 0)
      );
    });

    await t.test("28. concurrent draft publication cannot create duplicate Crystal names", async () => {
      const scenario = "crystal-promotion-race";
      const left = await driveGroupToReady(`${scenario}-left`);
      const right = await driveGroupToReady(`${scenario}-right`);
      const sharedNameCn = `并发唯一水晶 ${prefix}`;
      const sharedNameEn = `Concurrent Unique Crystal ${prefix}`;
      const createDraft = () => prisma.crystalDraft.create({
        data: {
          nameCn: sharedNameCn,
          nameEn: sharedNameEn,
          mineralName: "Quartz",
          colorTags: ["purple"],
          visualTags: ["translucent"],
          styleTags: ["minimal"],
          gemologicalInfo: { source: "operator-curated" },
          priceLevel: 3,
          complianceNote: "仅作矿物材质与装饰用途说明，不构成功效结论"
        }
      });
      const [leftDraft, rightDraft] = await Promise.all([createDraft(), createDraft()]);
      await Promise.all([
        prisma.beadImageGroup.update({ where: { id: left.groupId }, data: { crystalDraftId: leftDraft.id } }),
        prisma.beadImageGroup.update({ where: { id: right.groupId }, data: { crystalDraftId: rightDraft.id } })
      ]);
      const draftPublishInput = (
        side: "left" | "right",
        draftId: string,
        assetKey: string
      ): PublishAssetGroupInput => publishInput(
        `${scenario}-${side}`,
        "unused-crystal-id",
        assetKey,
        {
          crystalId: undefined,
          crystalDraftId: draftId,
          crystalDraftPromotionConfirmed: true,
          crystalName: sharedNameCn,
          idempotencyKey: keyOf(`${scenario}-publish-${side}`)
        }
      );
      const outcomes = await Promise.allSettled([
        publishAsAdmin(
          left.groupId,
          draftPublishInput("left", leftDraft.id, left.assetKey)
        ),
        publishAsAdmin(
          right.groupId,
          draftPublishInput("right", rightDraft.id, right.assetKey)
        )
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      assert.equal(await prisma.crystal.count({ where: { nameCn: sharedNameCn } }), 1);
      assert.equal(await prisma.beadGroupPublication.count({
        where: { groupId: { in: [left.groupId, right.groupId] } }
      }), 1);
    });

    await t.test("29. concurrent publication claims one group revision exactly once", async () => {
      const scenario = "publish-cas";
      const fixture = await driveGroupToReady(scenario);
      const crystalId = await createCrystal(scenario);
      const left = publishInput(scenario, crystalId, fixture.assetKey, {
        idempotencyKey: keyOf(`${scenario}-left`)
      });
      const right = publishInput(scenario, crystalId, fixture.assetKey, {
        idempotencyKey: keyOf(`${scenario}-right`)
      });
      const outcomes = await Promise.allSettled([
        publishAsAdmin(fixture.groupId, left),
        publishAsAdmin(fixture.groupId, right)
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      assert.equal(await prisma.beadGroupPublication.count({ where: { groupId: fixture.groupId } }), 1);
      assert.equal(await prisma.materialProduct.count({ where: { sku: left.sku } }), 1);
      const group = await prisma.beadImageGroup.findUniqueOrThrow({ where: { id: fixture.groupId } });
      assert.equal(group.state, "PUBLISHED");
      assert.equal(group.revision, 3);
    });

    await t.test("30. the asset operation audit ledger rejects UPDATE and DELETE", async () => {
      const operation = await prisma.assetImportOperation.findFirstOrThrow({
        orderBy: { createdAt: "asc" }
      });
      await assert.rejects(() => prisma.$executeRawUnsafe(
        'UPDATE "asset_import_operations" SET "review_note" = $1 WHERE "id" = $2',
        "tampered",
        operation.id
      ));
      await assert.rejects(() => prisma.$executeRawUnsafe(
        'DELETE FROM "asset_import_operations" WHERE "id" = $1',
        operation.id
      ));
      assert.ok(await prisma.assetImportOperation.findUnique({ where: { id: operation.id } }));
    });

    await t.test("31. one merge source cannot be consumed by two concurrent target groups", async () => {
      const scenario = "merge-source-cas";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [0, 1, 2].map((index) => ({
          clientFileId: `${scenario}-${index}`,
          relativePath: `imports/${scenario}/${index}.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_001_000 + index,
          kind: "JPEG" as const
        }))
      });
      const groups = await Promise.all([0, 1, 2].map((index) => prisma.beadImageGroup.create({
        data: {
          sessionId: session.sessionId,
          state: "CONFIRMED",
          revision: 1,
          crystalName: `并发合并组 ${index}`
        }
      })));
      await Promise.all(registered.files.map((file, index) => prisma.assetSourceFile.update({
        where: { id: file.fileId },
        data: { groupId: groups[index]!.id, state: "ARCHIVED" }
      })));
      const [left, right, source] = groups;
      assert.ok(left && right && source);
      const outcomes = await Promise.allSettled([
        repository.updateGroup(left.id, {
          action: "MERGE_GROUPS",
          expectedGroupRevision: 1,
          sourceGroupIds: [left.id, source.id]
        }, "integration-merge-left"),
        repository.updateGroup(right.id, {
          action: "MERGE_GROUPS",
          expectedGroupRevision: 1,
          sourceGroupIds: [right.id, source.id]
        }, "integration-merge-right")
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      assert.equal(await prisma.beadImageGroup.count({ where: { id: source.id } }), 0);
      const sourceFile = await prisma.assetSourceFile.findUniqueOrThrow({
        where: { id: registered.files[2]!.fileId }
      });
      assert.ok(sourceFile.groupId === left.id || sourceFile.groupId === right.id);
      const audit = await prisma.assetImportOperation.findFirstOrThrow({
        where: { operationType: "UPDATE_GROUP", aggregateId: sourceFile.groupId! }
      });
      assert.ok(audit.actorId === "integration-merge-left" || audit.actorId === "integration-merge-right");
    });

    await t.test("32. cancellation serializes with upload reservation and leaves no mutable file", async () => {
      const scenario = "cancel-upload-race";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const manifest = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/file.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_009_000,
          kind: "JPEG"
        }]
      });
      const fileId = manifest.files[0]!.fileId;
      const outcomes = await Promise.allSettled([
        repository.resolveUploadTarget({
          sessionId: session.sessionId,
          fileId,
          contentLengthBytes: 2048
        }),
        repository.cancelSession(
          session.sessionId,
          { idempotencyKey: keyOf(`${scenario}-cancel`) },
          "integration-canceller"
        )
      ]);
      assert.equal(outcomes[1]!.status, "fulfilled");
      const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
        where: { id: session.sessionId }
      });
      const fileRow = await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } });
      assert.equal(sessionRow.state, "CANCELLED");
      assert.equal(fileRow.state, "FAILED");
      assert.equal(sessionRow.failedFileCount, 1);
    });

    await t.test("33. terminal archive failure propagates and can be queued for recovery", async () => {
      const scenario = "archive-terminal-recovery";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const manifest = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/file.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_010_000,
          kind: "JPEG"
        }]
      });
      const fileId = manifest.files[0]!.fileId;
      await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048
      });
      await prisma.assetImportSession.update({
        where: { id: session.sessionId },
        data: { state: "ARCHIVING" }
      });
      const lease = {
        workerId: `worker-${scenario}`,
        leaseToken: `lease-${scenario}`
      };
      const digest = shaOf(scenario);
      const failedJob = await prisma.assetProcessingJob.create({
        data: {
          sessionId: session.sessionId,
          jobType: "ARCHIVE_FILE",
          state: "RUNNING",
          payload: {
            fileId,
            stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000033`,
            sha256: digest
          },
          retryCount: 0,
          maxRetries: 0,
          workerId: lease.workerId,
          leaseToken: lease.leaseToken,
          leaseUntil: new Date(Date.now() + 60_000)
        }
      });
      const failure = await repository.failJob(
        failedJob.id,
        { code: "WRITE_FAILED", message: "archive retries exhausted" },
        null,
        lease
      );
      assert.equal(failure.state, "FAILED");
      assert.equal((await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } })).state, "FAILED");
      assert.equal(
        (await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } })).state,
        "PARTIALLY_FAILED"
      );

      await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048
      });
      const retry = await repository.enqueueArchiveFile({
        sessionId: session.sessionId,
        fileId,
        idempotencyKey: keyOf(`${scenario}-retry`),
        stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000034`,
        sha256: digest
      });
      assert.equal(retry.jobState, "QUEUED");
    });

    await t.test("34. one approved asset may serve texture and model without duplicate bindings", async () => {
      const scenario = "shared-texture-model";
      const fixture = await driveGroupToReady(scenario);
      const crystalId = await createCrystal(scenario);
      const published = await publishAsAdmin(
        fixture.groupId,
        publishInput(scenario, crystalId, fixture.assetKey, { modelAssetKey: fixture.assetKey }),
        "integration-shared-asset-publisher"
      );
      assert.deepEqual(published.publishedAssetKeys, [fixture.assetKey]);
      assert.equal(
        await prisma.productAssetBinding.count({ where: { materialProductId: published.materialProductId } }),
        1
      );
      const publication = await prisma.beadGroupPublication.findUniqueOrThrow({
        where: { groupId: fixture.groupId }
      });
      assert.equal(publication.publishedByActorId, "integration-shared-asset-publisher");
    });

    await t.test("35. cancellation and upload recording use session-before-job lock order", async () => {
      const scenario = "cancel-record-lock-order";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const manifest = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/file.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_011_000,
          kind: "JPEG"
        }]
      });
      const fileId = manifest.files[0]!.fileId;
      await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048
      });
      const digest = shaOf(scenario);
      const lease = { workerId: `worker-${scenario}`, leaseToken: `lease-${scenario}` };
      const job = await prisma.assetProcessingJob.create({
        data: {
          sessionId: session.sessionId,
          jobType: "ARCHIVE_FILE",
          state: "RUNNING",
          payload: {
            fileId,
            stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000035`,
            sha256: digest
          },
          maxRetries: 3,
          workerId: lease.workerId,
          leaseToken: lease.leaseToken,
          leaseUntil: new Date(Date.now() + 60_000)
        }
      });
      const removePause = await pauseMatchingUpdates(
        "asset_processing_jobs",
        "assetdb002_pause_running_job_update",
        "assetdb002_sleep_running_job_update",
        "OLD.state = 'RUNNING' AND NEW.state = 'RUNNING'"
      );
      try {
        const recording = repository.recordUploadedFile(
          fileId,
          digest,
          `imports/${session.sessionId}/raw/${scenario}.jpg`,
          { jobId: job.id, lease }
        );
        await waitForLockInterleave();
        const cancelling = repository.cancelSession(
          session.sessionId,
          { idempotencyKey: keyOf(`${scenario}-cancel`) },
          "integration-lock-order-canceller"
        );
        const outcomes = await Promise.allSettled([recording, cancelling]);
        assert.equal(outcomes.every((outcome) => outcome.status === "fulfilled"), true);
        assert.equal(
          (await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } })).state,
          "CANCELLED"
        );
      } finally {
        await removePause();
      }
    });

    await t.test("36. group edits and draft saves use session-before-group lock order", async () => {
      const scenario = "edit-save-lock-order";
      const fixture = await driveGroupToReady(scenario);
      const removePause = await pauseMatchingUpdates(
        "bead_image_groups",
        "assetdb002_pause_group_edit_update",
        "assetdb002_sleep_group_edit_update",
        "OLD.id = NEW.id"
      );
      try {
        const editing = repository.updateGroup(fixture.groupId, {
          action: "SET_NAME",
          expectedGroupRevision: 2,
          crystalName: "锁序编辑水晶"
        }, "integration-lock-order-editor");
        await waitForLockInterleave();
        const saving = repository.saveGroupDraft(fixture.groupId, {
          expectedGroupRevision: 2,
          displayName: "锁序草稿"
        });
        assertConflictLoser(await Promise.allSettled([editing, saving]));
      } finally {
        await removePause();
      }
    });

    await t.test("37. publication and version selection use session-before-group lock order", async () => {
      const scenario = "publish-select-lock-order";
      const fixture = await driveGroupToReady(scenario);
      const crystalId = await createCrystal(scenario);
      const removePause = await pauseMatchingUpdates(
        "bead_image_groups",
        "assetdb002_pause_group_publish_update",
        "assetdb002_sleep_group_publish_update",
        "OLD.id = NEW.id"
      );
      try {
        const publishing = publishAsAdmin(
          fixture.groupId,
          publishInput(scenario, crystalId, fixture.assetKey),
          "integration-lock-order-publisher"
        );
        await waitForLockInterleave();
        const selecting = repository.selectProcessedVersion(
          fixture.groupId,
          { expectedGroupRevision: 2, processingVersion: 1 },
          "integration-lock-order-selector"
        );
        assertConflictLoser(await Promise.allSettled([publishing, selecting]));
      } finally {
        await removePause();
      }
    });

    await t.test("38. failed upload reservations recover idempotently and can be reserved again", async () => {
      for (const sessionState of ["UPLOADING", "ARCHIVING", "PARTIALLY_FAILED"] as const) {
        const scenario = `upload-recovery-${sessionState.toLowerCase()}`;
        const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
        const manifest = await repository.registerManifest(session.sessionId, {
          idempotencyKey: keyOf(`${scenario}-manifest`),
          files: [{
            clientFileId: `${scenario}-file`,
            relativePath: `imports/${scenario}/file.jpg`,
            byteSize: 2048,
            lastModifiedMs: 1_750_000_012_000,
            kind: "JPEG"
          }]
        });
        const fileId = manifest.files[0]!.fileId;
        await repository.resolveUploadTarget({
          sessionId: session.sessionId,
          fileId,
          contentLengthBytes: 2048
        });
        await prisma.assetImportSession.update({
          where: { id: session.sessionId },
          data: { state: sessionState }
        });

        assert.deepEqual(
          await repository.failUploadReservation(session.sessionId, fileId),
          { sessionId: session.sessionId, fileId, state: "FAILED", changed: true }
        );
        const sentinelUpdatedAt = new Date("2026-01-04T00:00:00.000Z");
        await prisma.assetImportSession.update({
          where: { id: session.sessionId },
          data: { updatedAt: sentinelUpdatedAt }
        });
        assert.deepEqual(
          await repository.failUploadReservation(session.sessionId, fileId),
          { sessionId: session.sessionId, fileId, state: "FAILED", changed: false }
        );
        const failedSession = await prisma.assetImportSession.findUniqueOrThrow({
          where: { id: session.sessionId }
        });
        assert.equal(failedSession.state, sessionState);
        assert.equal(failedSession.failedFileCount, 1);
        assert.equal(failedSession.updatedAt.toISOString(), sentinelUpdatedAt.toISOString());

        await repository.resolveUploadTarget({
          sessionId: session.sessionId,
          fileId,
          contentLengthBytes: 2048
        });
        assert.equal(
          (await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } })).state,
          "UPLOADING"
        );
        assert.equal(
          (await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } }))
            .failedFileCount,
          0
        );
      }
    });

    await t.test("39. upload recovery hides ownership and rejects files without a reservation", async () => {
      const scenario = "upload-recovery-conflicts";
      const first = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-first`) });
      const second = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-second`) });
      const manifest = await repository.registerManifest(first.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: ["pending", "archived", "duplicate"].map((label, index) => ({
          clientFileId: `${scenario}-${label}`,
          relativePath: `imports/${scenario}/${label}.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_013_000 + index,
          kind: "JPEG" as const
        }))
      });
      const [pending, archived, duplicate] = manifest.files;
      assert.ok(pending && archived && duplicate);
      await assert.rejects(
        () => repository.failUploadReservation(second.sessionId, pending.fileId),
        expectCode("NOT_FOUND")
      );
      await assert.rejects(
        () => repository.failUploadReservation(first.sessionId, "missing-file"),
        expectCode("NOT_FOUND")
      );
      await prisma.assetSourceFile.update({ where: { id: archived.fileId }, data: { state: "ARCHIVED" } });
      await prisma.assetSourceFile.update({
        where: { id: duplicate.fileId },
        data: { state: "SKIPPED_DUPLICATE" }
      });
      for (const fileId of [pending.fileId, archived.fileId, duplicate.fileId]) {
        await assert.rejects(
          () => repository.failUploadReservation(first.sessionId, fileId),
          expectCode("CONFLICT")
        );
      }
    });

    await t.test("40. upload recovery preserves a reservation with active archive work", async () => {
      const scenario = "upload-recovery-active-job";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const manifest = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/file.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_014_000,
          kind: "JPEG"
        }]
      });
      const fileId = manifest.files[0]!.fileId;
      await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048
      });
      await prisma.assetProcessingJob.create({
        data: {
          sessionId: session.sessionId,
          jobType: "ARCHIVE_FILE",
          state: "RUNNING",
          payload: {
            fileId,
            stagingKey: `imports/${session.sessionId}/staging/00000000-0000-4000-8000-000000000040`,
            sha256: shaOf(scenario)
          },
          maxRetries: 3,
          workerId: `worker-${scenario}`,
          leaseToken: `lease-${scenario}`,
          leaseUntil: new Date(Date.now() + 60_000)
        }
      });

      await assert.rejects(
        () => repository.failUploadReservation(session.sessionId, fileId),
        expectCode("CONFLICT")
      );
      assert.equal(
        (await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } })).state,
        "UPLOADING"
      );
      assert.equal(
        (await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } }))
          .failedFileCount,
        0
      );
    });

    await t.test("41. cancellation and upload recovery serialize without reviving the session", async () => {
      const scenario = "cancel-upload-recovery-race";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const manifest = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/file.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_015_000,
          kind: "JPEG"
        }]
      });
      const fileId = manifest.files[0]!.fileId;
      await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048
      });

      const outcomes = await Promise.allSettled([
        repository.failUploadReservation(session.sessionId, fileId),
        repository.cancelSession(
          session.sessionId,
          { idempotencyKey: keyOf(`${scenario}-cancel`) },
          "integration-recovery-canceller"
        )
      ]);
      assert.equal(outcomes.every((outcome) => outcome.status === "fulfilled"), true);
      assert.equal(
        (await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } })).state,
        "CANCELLED"
      );
      assert.equal(
        (await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } }))
          .failedFileCount,
        1
      );
      assert.equal(
        (await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } })).state,
        "FAILED"
      );
    });

    await t.test("42. concurrent upload recovery changes the file once and keeps an exact count", async () => {
      const scenario = "double-upload-recovery";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const manifest = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/file.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_016_000,
          kind: "JPEG"
        }]
      });
      const fileId = manifest.files[0]!.fileId;
      await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048
      });

      const outcomes = await Promise.all([
        repository.failUploadReservation(session.sessionId, fileId),
        repository.failUploadReservation(session.sessionId, fileId)
      ]);
      assert.deepEqual(outcomes.map((outcome) => outcome.changed).sort(), [false, true]);
      assert.equal(
        (await prisma.assetImportSession.findUniqueOrThrow({ where: { id: session.sessionId } }))
          .failedFileCount,
        1
      );
      assert.equal(
        (await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } })).state,
        "FAILED"
      );
    });

    await t.test("43. repeated recovery never updates terminal session timestamps", async () => {
      for (const terminalState of ["CANCELLED", "FAILED", "PUBLISHED"] as const) {
        const scenario = `terminal-recovery-noop-${terminalState.toLowerCase()}`;
        const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
        const manifest = await repository.registerManifest(session.sessionId, {
          idempotencyKey: keyOf(`${scenario}-manifest`),
          files: [{
            clientFileId: `${scenario}-file`,
            relativePath: `imports/${scenario}/file.jpg`,
            byteSize: 2048,
            lastModifiedMs: 1_750_000_017_000,
            kind: "JPEG"
          }]
        });
        const fileId = manifest.files[0]!.fileId;
        await repository.resolveUploadTarget({
          sessionId: session.sessionId,
          fileId,
          contentLengthBytes: 2048
        });
        await repository.failUploadReservation(session.sessionId, fileId);
        if (terminalState === "CANCELLED") {
          await repository.cancelSession(
            session.sessionId,
            { idempotencyKey: keyOf(`${scenario}-cancel`) },
            "integration-terminal-noop-canceller"
          );
        }
        const sentinelDay = terminalState === "CANCELLED" ? 1 : terminalState === "FAILED" ? 2 : 3;
        const sentinelUpdatedAt = new Date(`2026-01-0${sentinelDay}T00:00:00.000Z`);
        await prisma.assetImportSession.update({
          where: { id: session.sessionId },
          data: { state: terminalState, failedFileCount: 0, updatedAt: sentinelUpdatedAt }
        });

        assert.deepEqual(
          await repository.failUploadReservation(session.sessionId, fileId),
          { sessionId: session.sessionId, fileId, state: "FAILED", changed: false }
        );
        const terminal = await prisma.assetImportSession.findUniqueOrThrow({
          where: { id: session.sessionId }
        });
        assert.equal(terminal.state, terminalState);
        assert.equal(terminal.failedFileCount, 0);
        assert.equal(terminal.updatedAt.toISOString(), sentinelUpdatedAt.toISOString());
      }
    });

    await t.test("44. archived upload replay returns verified metadata without mutation", async () => {
      const scenario = "archived-upload-replay";
      const session = await repository.createSession({ idempotencyKey: keyOf(`${scenario}-session`) });
      const manifest = await repository.registerManifest(session.sessionId, {
        idempotencyKey: keyOf(`${scenario}-manifest`),
        files: [{
          clientFileId: `${scenario}-file`,
          relativePath: `imports/${scenario}/file.jpg`,
          byteSize: 2048,
          lastModifiedMs: 1_750_000_018_000,
          kind: "JPEG"
        }]
      });
      const fileId = manifest.files[0]!.fileId;
      const sha256 = shaOf(scenario);
      const archiveKey = `imports/${session.sessionId}/raw/${sha256}.jpg`;
      const archivedAt = new Date("2026-09-06T02:03:04.000Z");
      await prisma.assetSourceFile.update({
        where: { id: fileId },
        data: { state: "ARCHIVED", sha256, archiveKey, archivedAt }
      });
      await prisma.assetImportSession.update({
        where: { id: session.sessionId },
        data: { state: "PROCESSING", archivedFileCount: 1, uploadedBytes: 2048n }
      });

      const before = await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } });
      const target = await repository.resolveUploadTarget({
        sessionId: session.sessionId,
        fileId,
        contentLengthBytes: 2048,
        declaredSha256: sha256
      });
      const after = await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileId } });

      assert.equal(target.state, "ARCHIVED");
      assert.deepEqual(target, {
        sessionId: session.sessionId,
        fileId,
        clientFileId: `${scenario}-file`,
        relativePath: `imports/${scenario}/file.jpg`,
        kind: "JPEG",
        byteSize: 2048,
        state: "ARCHIVED",
        sha256,
        archiveKey,
        archivedAt
      });
      assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
      assert.equal(await prisma.assetProcessingJob.count({ where: { sessionId: session.sessionId } }), 0);
    });

    await t.test("36. crystal search is case-insensitive, bounded and stably ordered", async () => {
      const tag = keyOf("crystal");
      const base = {
        gemologicalInfo: {},
        colorTags: [],
        visualTags: [],
        styleTags: [],
        emotionTags: [],
        cultureTags: [],
        priceLevel: 3,
        complianceNote: ""
      };
      await prisma.crystal.createMany({
        data: [
          { id: `${tag}-beta`, nameCn: `${tag} 白水晶`, nameEn: `${tag} Clear Quartz`, mineralName: `${tag} Quartz`, ...base },
          { id: `${tag}-alpha`, nameCn: `${tag} 紫水晶`, nameEn: `${tag} Amethyst`, mineralName: `${tag} Quartz`, ...base },
          { id: `${tag}-gamma`, nameCn: `${tag} 粉晶`, nameEn: "", mineralName: `${tag} Quartz`, ...base }
        ]
      });

      const byCn = await repository.searchCrystals({ q: `${tag} 紫水晶` });
      assert.deepEqual(byCn.crystals.map((c) => c.crystalId), [`${tag}-alpha`]);
      assert.equal(byCn.crystals[0]!.nameEn, `${tag} Amethyst`);
      assert.equal(byCn.crystals[0]!.mineralName, `${tag} Quartz`);

      const byMineral = await repository.searchCrystals({ q: `${tag} QUARTZ` });
      assert.equal(byMineral.crystals.length, 3, "case-insensitive mineral match");
      assert.deepEqual(
        new Set(byMineral.crystals.map((c) => c.crystalId)),
        new Set([`${tag}-beta`, `${tag}-alpha`, `${tag}-gamma`])
      );

      const page1 = await repository.searchCrystals({ q: tag, limit: 2 });
      assert.equal(page1.crystals.length, 2);
      assert.ok(page1.nextCursor !== null, "a bounded page carries a cursor");
      const page2 = await repository.searchCrystals({ q: tag, limit: 2, cursor: page1.nextCursor });
      assert.equal(page2.crystals.length, 1);
      assert.equal(page2.nextCursor, null);

      const gamma = (await repository.searchCrystals({ q: `${tag} 粉晶` })).crystals[0]!;
      assert.equal(gamma.nameEn, null, "an empty english name hydrates as null, never a placeholder");
    });

    await t.test("37. session hydration restores the approved key, product draft and crystal curation", async () => {
      const scenario = "hydration";
      const fixture = await driveGroupToReady(scenario);

      const draft = await repository.saveGroupDraft(fixture.groupId, {
        expectedGroupRevision: 2,
        crystalName: "紫水晶",
        displayName: "紫水晶 8mm 圆珠",
        sku: keyOf("sku-hydration"),
        shape: "ROUND",
        diameterMm: 8,
        currency: "CNY",
        unitPriceMinor: 12800,
        rightsHolder: "玄矶水晶工作室",
        usagePermission: "OWNED",
        qualityStatement: "天然紫水晶，肉眼可见少量棉絮",
        qualitySource: "到货批次人工目检",
        isAuthenticPhotograph: true,
        allowPublicDisplay: true,
        allowCommercialUse: true,
        allowAiTraining: false,
        allowAiRecommendation: true
      });
      assert.ok(draft.crystalDraftId, "a saved draft must create a crystal draft");
      await repository.updateCrystalDraft(
        draft.crystalDraftId!,
        {
          idempotencyKey: keyOf("curation-hydration"),
          expectedRevision: draft.crystalDraftRevision!,
          nameCn: "紫水晶",
          nameEn: "Amethyst",
          mineralName: "Quartz",
          colorTags: ["紫色"],
          visualTags: ["透明"],
          styleTags: ["简约"],
          priceLevel: 3,
          complianceNote: "仅作文化象征说明"
        },
        "integration-admin"
      );

      const detail = await repository.getSession(fixture.sessionId);
      const group = detail.groups.find((candidate) => candidate.groupId === fixture.groupId)!;
      assert.equal(group.processedAssets[0]!.approvedAssetKey, fixture.assetKey, "approved key hydrates on refresh");
      assert.ok(group.productDraft, "the saved product draft hydrates");
      assert.equal(group.productDraft!.displayName, "紫水晶 8mm 圆珠");
      assert.equal(group.productDraft!.unitPriceMinor, 12800);
      assert.equal(group.productDraft!.usagePermission, "OWNED");
      assert.equal(group.productDraft!.isAuthenticPhotograph, true);
      assert.ok(group.crystalDraft, "the crystal draft hydrates");
      assert.equal(group.crystalDraft!.nameCn, "紫水晶");
      assert.equal(group.crystalDraft!.nameEn, "Amethyst");
      assert.equal(group.crystalDraft!.mineralName, "Quartz");
      assert.deepEqual(group.crystalDraft!.colorTags, ["紫色"]);
      assert.equal(group.crystalDraft!.priceLevel, 3);
      assert.equal(group.crystalDraft!.complianceNote, "仅作文化象征说明");
      assert.equal(group.crystalDraft!.curationComplete, true);
    });
  } finally {
    await prisma.$disconnect();
  }
});
