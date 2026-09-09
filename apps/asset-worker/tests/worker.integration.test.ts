import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import sharp from "sharp";

import { ArchiveStore, sha256OfBytes } from "@mystcrag/asset-pipeline";
import {
  AssetImportRepository,
  PersistenceError,
  createPrismaClient,
  type CompleteAssetJobResult
} from "@mystcrag/database";

import { createJobHandlers } from "../src/jobs.js";
import { AssetWorker, type WorkerRepository } from "../src/runtime.js";

const databaseUrl = process.env.DATABASE_URL;
const archiveRoot = process.env.MYSTCRAG_ASSET_ARCHIVE_ROOT;

test(
  "asset worker end-to-end against live PostgreSQL",
  { skip: !databaseUrl || !archiveRoot ? "requires DATABASE_URL and MYSTCRAG_ASSET_ARCHIVE_ROOT" : undefined },
  async (t) => {
    const prisma = createPrismaClient(databaseUrl);
    const repository = new AssetImportRepository(prisma);
    const store = new ArchiveStore({ root: mkdtempSync(join(tmpdir(), "asset-worker-e2e-")), repositoryRoots: [] });
    const prefix = `assetworker-${Date.now()}`;
    const shaOf = (seed: string) => createHash("sha256").update(`${prefix}:${seed}`).digest("hex");

    async function pngBytes(color: string): Promise<Uint8Array> {
      // The proven QC-passing scene geometry from packages/asset-pipeline:
      // a full bead with an interior highlight on a uniform background.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
        <rect width="800" height="800" fill="#f0f0f0"/>
        <circle cx="400" cy="400" r="300" fill="${color}"/>
        <circle cx="330" cy="330" r="40" fill="#ffffff"/>
      </svg>`;
      return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
    }

    async function seedSessionWithFiles(
      label: string,
      count: number
    ): Promise<{ sessionId: string; fileIds: string[] }> {
      const session = await repository.createSession({ idempotencyKey: `${prefix}-session-${label}` });
      if (count === 0) {
        return { sessionId: session.sessionId, fileIds: [] };
      }
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: `${prefix}-manifest-${label}`,
        files: Array.from({ length: count }, (_, index) => ({
          clientFileId: `${label}-cf-${index + 1}`,
          relativePath: `imports/${label}/bead-${index + 1}.png`,
          byteSize: 4096,
          lastModifiedMs: 1_750_000_000_000 + index,
          kind: "PNG" as const
        }))
      });
      return {
        sessionId: session.sessionId,
        fileIds: registered.files.map((file) => file.fileId)
      };
    }

    function makeWorker(workerId = `${prefix}-worker`): AssetWorker {
      return new AssetWorker({
        repository,
        handlers: createJobHandlers({ store, repository }),
        workerId,
        leaseMs: 60_000,
        heartbeatMs: 25,
        pollMs: 5,
        shutdownGraceMs: 5_000,
        transientRetryDelayMs: 60_000
      });
    }

    async function seedArchiveFileJob(
      label: string,
      color: string
    ): Promise<{
      sessionId: string;
      fileId: string;
      sha256: string;
      stagingKey: string;
      bytes: Uint8Array;
      jobId: string;
      rawArchiveKey: string;
    }> {
      const { sessionId, fileIds } = await seedSessionWithFiles(label, 1);
      const bytes = await pngBytes(color);
      const sha256 = sha256OfBytes(bytes);
      const staging = await store.putStaging({ sessionId, bytes });
      const job = await prisma.assetProcessingJob.create({
        data: {
          sessionId,
          jobType: "ARCHIVE_FILE",
          state: "QUEUED",
          payload: { fileId: fileIds[0]!, stagingKey: staging.archiveKey, sha256 },
          maxRetries: 3
        }
      });
      return {
        sessionId,
        fileId: fileIds[0]!,
        sha256,
        stagingKey: staging.archiveKey,
        bytes,
        jobId: job.id,
        rawArchiveKey: `imports/${sessionId}/raw/${sha256}.png`
      };
    }

    class CleanupFailingStore extends ArchiveStore {
      override async removeStaging(): Promise<void> {
        throw new Error("removeStaging failed: disk full");
      }
    }

    function withFailingRemoveStaging(inner: ArchiveStore): ArchiveStore {
      return new CleanupFailingStore({ root: inner.root, repositoryRoots: [] });
    }

    await prisma.$connect();
    try {
      await t.test("ARCHIVE_FILE: staging bytes are archived, the file row advances and the job completes", async () => {
        const { sessionId, fileIds } = await seedSessionWithFiles("archive", 1);
        const bytes = await pngBytes("#4169e1");
        const sha256 = sha256OfBytes(bytes);
        const staging = await store.putStaging({ sessionId, bytes });
        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId,
            jobType: "ARCHIVE_FILE",
            state: "QUEUED",
            payload: { fileId: fileIds[0]!, stagingKey: staging.archiveKey, sha256 },
            maxRetries: 3
          }
        });

        const outcome = await makeWorker().runOnce();

        assert.equal(outcome, "completed");
        const row = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(row.state, "COMPLETED");
        const result = row.result as { kind: string; sha256: string; archiveKey: string };
        assert.equal(result.kind, "ARCHIVE_FILE");
        assert.equal(result.sha256, sha256);
        assert.equal(result.archiveKey, `imports/${sessionId}/raw/${sha256}.png`);

        const fileRow = await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: fileIds[0]! } });
        assert.equal(fileRow.state, "ARCHIVED");
        assert.equal(fileRow.sha256, sha256);
        assert.equal(fileRow.archiveKey, result.archiveKey);
        const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({ where: { id: sessionId } });
        assert.equal(sessionRow.archivedFileCount, 1);
      });

      await t.test("ARCHIVE_FILE: byte-identical duplicate content within one session is skipped, not re-archived", async () => {
        const { sessionId, fileIds } = await seedSessionWithFiles("dup", 2);
        const bytes = await pngBytes("#3cb371");
        const sha256 = sha256OfBytes(bytes);

        for (const fileId of fileIds) {
          const staging = await store.putStaging({ sessionId, bytes });
          await prisma.assetProcessingJob.create({
            data: {
              sessionId,
              jobType: "ARCHIVE_FILE",
              state: "QUEUED",
              payload: { fileId, stagingKey: staging.archiveKey, sha256 },
              maxRetries: 3
            }
          });
          assert.equal(await makeWorker().runOnce(), "completed");
        }

        const archivedRow = await prisma.assetSourceFile.findUniqueOrThrow({
          where: { id: fileIds[0]! }
        });
        assert.equal(archivedRow.state, "ARCHIVED");
        const duplicateRow = await prisma.assetSourceFile.findUniqueOrThrow({
          where: { id: fileIds[1]! }
        });
        assert.equal(duplicateRow.state, "SKIPPED_DUPLICATE");
        assert.equal(duplicateRow.duplicateOfId, fileIds[0]!);
        assert.equal(duplicateRow.archiveKey, archivedRow.archiveKey);
        const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({ where: { id: sessionId } });
        assert.equal(sessionRow.archivedFileCount, 1);
        assert.equal(sessionRow.skippedFileCount, 1);
      });

      await t.test("GROUP_SESSION: suggestions are materialized for human review", async () => {
        const { sessionId, fileIds } = await seedSessionWithFiles("grouping", 3);
        const identicalA = await pngBytes("#20b2aa");
        const identicalB = new Uint8Array(
          await sharp(identicalA).png({ compressionLevel: 0 }).toBuffer()
        );
        const identicalShaA = sha256OfBytes(identicalA);
        const identicalShaB = sha256OfBytes(identicalB);
        assert.notEqual(identicalShaA, identicalShaB, "equivalent frames use distinct source bytes");
        const other = await pngBytes("#8a2be2");
        const otherSha = sha256OfBytes(other);

        const archiveEntries: Array<{ fileId: string; archiveKey: string; sha256: string; byteSize: number }> = [];
        for (const [index, entry] of [
          { fileId: fileIds[0]!, bytes: identicalA, sha256: identicalShaA },
          { fileId: fileIds[1]!, bytes: identicalB, sha256: identicalShaB },
          { fileId: fileIds[2]!, bytes: other, sha256: otherSha }
        ].entries()) {
          const archiveKey = (
            await store.putOriginal({
              sessionId,
              bytes: entry.bytes,
              sha256: entry.sha256,
              extension: "png"
            })
          ).archiveKey;
          archiveEntries.push({
            fileId: entry.fileId,
            archiveKey,
            sha256: entry.sha256,
            byteSize: entry.bytes.byteLength
          });
          await prisma.assetSourceFile.update({
            where: { id: entry.fileId },
            data: {
              state: "ARCHIVED",
              sha256: entry.sha256,
              archiveKey,
              byteSize: entry.bytes.byteLength,
              storageProvider: "local-fs",
              archivedAt: new Date()
            }
          });
          void index;
        }

        await prisma.assetImportSession.update({
          where: { id: sessionId },
          data: {
            state: "ARCHIVING",
            archivedFileCount: archiveEntries.length,
            uploadedBytes: archiveEntries.reduce((total, entry) => total + BigInt(entry.byteSize), 0n),
            lastVerifiedCheckpoint: "ARCHIVED"
          }
        });
        const started = await repository.startGrouping(sessionId, {
          idempotencyKey: `${prefix}-grouping-start`
        });
        assert.equal(started.queuedJobCount, 1);
        assert.equal(await prisma.beadImageGroup.count({ where: { sessionId } }), 0);

        assert.equal(await makeWorker().runOnce(), "completed");

        const row = await prisma.assetProcessingJob.findFirstOrThrow({
          where: { sessionId, jobType: "GROUP_SESSION" }
        });
        assert.equal(row.state, "COMPLETED");
        const result = row.result as {
          kind: string;
          groups: Array<{ memberFileIds: string[]; similarityEvidence: unknown }>;
        };
        assert.equal(result.kind, "GROUP_SESSION");
        assert.ok(result.groups.length >= 2);
        const merged = result.groups.find((group) => group.memberFileIds.length === 2);
        assert.ok(merged, "visually identical frames merge into one suggestion");
        assert.deepEqual(
          merged!.memberFileIds.slice().sort(),
          [fileIds[0]!, fileIds[1]!].sort()
        );
        assert.ok(merged!.similarityEvidence);
        const materializedGroups = await prisma.beadImageGroup.findMany({
          where: { sessionId },
          include: { files: true }
        });
        assert.equal(materializedGroups.length, result.groups.length);
        assert.ok(materializedGroups.every((group) => group.state === "SUGGESTED"));
        assert.ok(materializedGroups.every((group) => group.similarityEvidence !== null));
        assert.deepEqual(
          materializedGroups.flatMap((group) => group.files.map((file) => file.id)).sort(),
          fileIds.slice().sort()
        );
      });

      await t.test("PROCESS_GROUP: QC pass parks the asset in QC_PENDING, never approved, thumb archived", async () => {
        const { sessionId, fileIds } = await seedSessionWithFiles("process", 1);
        const bytes = await pngBytes("#ff7f50");
        const sha256 = sha256OfBytes(bytes);
        const archiveKey = (
          await store.putOriginal({ sessionId, bytes, sha256, extension: "png" })
        ).archiveKey;

        const group = await prisma.beadImageGroup.create({
          data: { sessionId, state: "NAMED", revision: 1 }
        });
        await prisma.assetSourceFile.update({
          where: { id: fileIds[0]! },
          data: {
            group: { connect: { id: group.id } },
            state: "ARCHIVED",
            sha256,
            archiveKey,
            storageProvider: "local-fs",
            archivedAt: new Date()
          }
        });
        await prisma.beadImageGroup.update({
          where: { id: group.id },
          data: { primaryFileId: fileIds[0]! }
        });
        await prisma.assetImportSession.update({
          where: { id: sessionId },
          data: { state: "NEEDS_REVIEW", lastVerifiedCheckpoint: "GROUPED" }
        });
        const processing = await repository.startProcessing(sessionId, {
          idempotencyKey: `${prefix}-processing-start`
        });
        assert.equal(processing.queuedJobCount, 1);

        assert.equal(await makeWorker().runOnce(), "completed");

        const asset = await prisma.processedAsset.findFirstOrThrow({
          where: { groupId: group.id, isCurrentVersion: true }
        });
        assert.equal(asset.state, "QC_PENDING");
        assert.equal(asset.usagePermission, "UNKNOWN");
        assert.equal(asset.approvedAt, null);
        assert.equal(asset.assetKey, null);
        assert.equal(asset.sourceFileId, fileIds[0]!);
        assert.match(asset.storageKey ?? "", /\/bead-512\.webp$/);

        const groupRow = await prisma.beadImageGroup.findUniqueOrThrow({ where: { id: group.id } });
        assert.equal(groupRow.state, "READY");

        const thumbKey = asset.storageKey!.replace("bead-512.webp", "thumb-256.webp");
        const thumbBytes = await store.read(thumbKey);
        const thumbMetadata = await sharp(thumbBytes).metadata();
        assert.equal(thumbMetadata.format, "webp");
        assert.equal(thumbMetadata.width, 256);

        const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({ where: { id: sessionId } });
        assert.equal(sessionRow.lastVerifiedCheckpoint, "PROCESSED");

        const reprocess = await repository.reprocessGroup(group.id, {
          idempotencyKey: `${prefix}-reprocess-settings`,
          expectedGroupRevision: 1,
          settings: { maskThreshold: 0.25, edgeFeatherPx: 0 }
        });
        assert.equal(reprocess.processingVersion, 2);
        const queuedReprocess = await prisma.assetProcessingJob.findUniqueOrThrow({
          where: { id: reprocess.jobId }
        });
        assert.deepEqual(
          queuedReprocess.payload,
          {
            groupId: group.id,
            processingVersion: 2,
            primaryFileId: fileIds[0]!,
            files: [{ fileId: fileIds[0]!, archiveKey, sha256 }],
            outputStorageKey: `imports/${sessionId}/processed/${group.id}/v2/bead-512.webp`,
            settings: { maskThreshold: 0.25, edgeFeatherPx: 0 }
          }
        );

        assert.equal(await makeWorker(`${prefix}-reprocess-worker`).runOnce(), "completed");
        const reprocessedAsset = await prisma.processedAsset.findFirstOrThrow({
          where: { groupId: group.id, processingVersion: 2 }
        });
        assert.equal(
          reprocessedAsset.storageKey,
          `imports/${sessionId}/processed/${group.id}/v2/bead-512.webp`
        );
        const parameters = reprocessedAsset.parameters as {
          options: { backgroundTolerance: number; maskFeatherSigma: number };
        };
        assert.equal(parameters.options.backgroundTolerance, 15);
        assert.equal(parameters.options.maskFeatherSigma, 0);
      });

      await t.test("expired leases are reclaimed with a fresh token; the stale worker cannot submit", async () => {
        const { sessionId, fileIds } = await seedSessionWithFiles("lease", 1);
        const bytes = await pngBytes("#aa336a");
        const sha256 = sha256OfBytes(bytes);
        const staging = await store.putStaging({ sessionId, bytes });
        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId,
            jobType: "ARCHIVE_FILE",
            state: "QUEUED",
            payload: { fileId: fileIds[0]!, stagingKey: staging.archiveKey, sha256 },
            maxRetries: 3
          }
        });

        const staleWorkerId = `${prefix}-stale`;
        const staleLease = await repository.claimNextJob(staleWorkerId, new Date(Date.now() + 60_000));
        assert.ok(staleLease);

        // Simulate lease expiry: the row becomes reclaimable.
        await prisma.assetProcessingJob.update({
          where: { id: job.id },
          data: { leaseUntil: new Date(Date.now() - 1_000) }
        });

        const freshWorkerId = `${prefix}-fresh`;
        const freshLease = await repository.claimNextJob(freshWorkerId, new Date(Date.now() + 60_000));
        assert.ok(freshLease);
        assert.equal(freshLease!.jobId, job.id);
        assert.notEqual(freshLease!.lease.leaseToken, staleLease!.lease.leaseToken);

        // The stale holder loses both the heartbeat and any attempt to complete.
        assert.equal(
          await repository.heartbeatJob(job.id, staleLease!.lease, new Date(Date.now() + 60_000)),
          false
        );
        await assert.rejects(
          repository.completeJob(
            job.id,
            {
              kind: "ARCHIVE_FILE",
              sha256,
              archiveKey: `imports/${sessionId}/raw/${sha256}.png`,
              storageProvider: "local-fs"
            } satisfies CompleteAssetJobResult,
            staleLease!.lease
          ),
          (error: unknown) => {
            assert.ok(error instanceof PersistenceError);
            assert.equal(error.code, "CONFLICT");
            return true;
          }
        );

        // Even the same workerId cannot reuse the stale token after reclaim.
        assert.equal(
          await repository.heartbeatJob(job.id, { workerId: staleWorkerId, leaseToken: staleLease!.lease.leaseToken }, new Date(Date.now() + 60_000)),
          false
        );

        const freshWorker = makeWorker(freshWorkerId);
        assert.equal(
          await freshWorker.processClaimedJobForTest(freshLease!, { submit: true }),
          "completed"
        );
        const holder = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(holder.state, "COMPLETED");
      });

      await t.test("retry chain: deterministic failures requeue and eventually fail terminally", async () => {
        const { sessionId } = await seedSessionWithFiles("retry", 0);
        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId,
            jobType: "GROUP_SESSION",
            state: "QUEUED",
            payload: { files: [] },
            maxRetries: 2
          }
        });

        const worker = makeWorker(`${prefix}-retry`);
        // Round 1: invalid payload fails deterministically and requeues.
        assert.equal(await worker.runOnce(), "failed");
        let row = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(row.state, "QUEUED");
        assert.equal(row.retryCount, 1);
        assert.ok(row.nextAttemptAt);

        // Make the retry immediately claimable.
        await prisma.assetProcessingJob.update({
          where: { id: job.id },
          data: { nextAttemptAt: new Date(Date.now() - 1_000) }
        });
        assert.equal(await worker.runOnce(), "failed");
        row = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(row.retryCount, 2);

        await prisma.assetProcessingJob.update({
          where: { id: job.id },
          data: { nextAttemptAt: new Date(Date.now() - 1_000) }
        });
        // Round 3 exceeds maxRetries=2: the repository marks it FAILED.
        assert.equal(await worker.runOnce(), "failed");
        row = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(row.state, "FAILED");
        assert.equal(row.retryCount, 3);
        assert.equal(row.nextAttemptAt, null);
        assert.equal(row.errorCode, "PAYLOAD_INVALID");
      });

      await t.test("recovery: a reclaimed job reuses its hash-verified output without duplicating content", async () => {
        const { sessionId, fileIds } = await seedSessionWithFiles("recover", 1);
        const bytes = await pngBytes("#9370db");
        const sha256 = sha256OfBytes(bytes);
        const archiveKey = (
          await store.putOriginal({ sessionId, bytes, sha256, extension: "png" })
        ).archiveKey;
        const group = await prisma.beadImageGroup.create({
          data: { sessionId, state: "NAMED", revision: 1 }
        });
        await prisma.assetSourceFile.update({
          where: { id: fileIds[0]! },
          data: { groupId: group.id }
        });
        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId,
            groupId: group.id,
            jobType: "PROCESS_GROUP",
            state: "QUEUED",
            payload: {
              groupId: group.id,
              processingVersion: 1,
              outputStorageKey: `imports/${sessionId}/processed/${group.id}/v1/bead-512.webp`,
              primaryFileId: fileIds[0]!,
              files: [{ fileId: fileIds[0]!, archiveKey, sha256 }]
            },
            maxRetries: 3
          }
        });

        // First attempt processes and archives the outputs, but "crashes"
        // before completing the job: the lease expires and the job requeues.
        const crashedWorkerId = `${prefix}-crashed`;
        const crashedLease = await repository.claimNextJob(crashedWorkerId, new Date(Date.now() + 60_000));
        assert.ok(crashedLease);
        const worker = makeWorker(crashedWorkerId);
        const processed = await worker.processClaimedJobForTest(crashedLease!);
        assert.ok(processed === "completed" || processed === "abandoned" || processed === "failed");
        // Simulate the crash: the completion never lands, the lease expires.
        await prisma.assetProcessingJob.update({
          where: { id: job.id },
          data: { leaseUntil: new Date(Date.now() - 1_000) }
        });

        const before = await prisma.processedAsset.count({ where: { groupId: group.id } });
        const recoveringWorker = makeWorker(`${prefix}-recovering`);
        assert.equal(await recoveringWorker.runOnce(), "completed");

        const assets = await prisma.processedAsset.findMany({ where: { groupId: group.id } });
        assert.equal(assets.length, before + 1);
        const current = assets.filter((asset) => asset.isCurrentVersion);
        assert.equal(current.length, 1, "exactly one current version remains after recovery");
        const row = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(row.state, "COMPLETED");
      });

      await t.test("ARCHIVE_FILE crash window: staging survives the crash and recovery completes without duplicates", async () => {
        const seeded = await seedArchiveFileJob("crashwindow", "#5f9ea0");

        // The worker archives the original and records the file, then dies
        // before the completion is submitted.
        const crashedLease = await repository.claimNextJob(
          `${prefix}-cw-crashed`,
          new Date(Date.now() + 60_000)
        );
        assert.ok(crashedLease);
        assert.equal(crashedLease!.jobId, seeded.jobId);
        const crashedWorker = makeWorker(`${prefix}-cw-crashed`);
        assert.equal(await crashedWorker.processClaimedJobForTest(crashedLease!), "completed");

        // The recovery input must still exist: staging is only removed after
        // the completion commits.
        await store.verifiedRead(seeded.stagingKey, seeded.sha256);
        const fileRow = await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: seeded.fileId } });
        assert.equal(fileRow.state, "ARCHIVED");
        let sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
          where: { id: seeded.sessionId }
        });
        assert.equal(sessionRow.archivedFileCount, 1);

        // The crash strands the job; the expired lease lets another worker
        // reclaim and finish it.
        await prisma.assetProcessingJob.update({
          where: { id: seeded.jobId },
          data: { leaseUntil: new Date(Date.now() - 1_000) }
        });
        assert.equal(await makeWorker(`${prefix}-cw-recovering`).runOnce(), "completed");

        const jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: seeded.jobId } });
        assert.equal(jobRow.state, "COMPLETED");
        sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
          where: { id: seeded.sessionId }
        });
        assert.equal(sessionRow.archivedFileCount, 1);
        assert.equal(sessionRow.skippedFileCount, 0);
        assert.equal(
          await prisma.assetSourceFile.count({ where: { archiveKey: seeded.rawArchiveKey } }),
          1,
          "the raw original is recorded exactly once"
        );
        const rawKeys = (await store.listSessionFiles(seeded.sessionId)).filter((key) =>
          key.includes("/raw/")
        );
        assert.deepEqual(rawKeys, [seeded.rawArchiveKey]);
        await assert.rejects(store.read(seeded.stagingKey));
      });

      await t.test("a rejected completion requeues the job and the retry completes from the surviving staging", async () => {
        const seeded = await seedArchiveFileJob("reject", "#6a5acd");

        let completions = 0;
        const onceFailingCompletion: WorkerRepository = {
          claimNextJob: (workerId, leaseUntil) => repository.claimNextJob(workerId, leaseUntil),
          heartbeatJob: (jobId, lease, leaseUntil) => repository.heartbeatJob(jobId, lease, leaseUntil),
          failJob: (jobId, error, retryAt, lease) => repository.failJob(jobId, error, retryAt, lease),
          completeJob: async (jobId, result, lease) => {
            completions += 1;
            if (completions === 1) {
              throw new Error("connection reset during commit");
            }
            return repository.completeJob(jobId, result, lease);
          }
        };
        const worker = new AssetWorker({
          repository: onceFailingCompletion,
          handlers: createJobHandlers({ store, repository }),
          workerId: `${prefix}-reject`,
          leaseMs: 60_000,
          heartbeatMs: 25,
          pollMs: 5,
          shutdownGraceMs: 5_000,
          transientRetryDelayMs: 60_000
        });

        assert.equal(await worker.runOnce(), "failed");
        let jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: seeded.jobId } });
        assert.equal(jobRow.state, "QUEUED");
        assert.equal(jobRow.retryCount, 1);
        assert.equal(jobRow.errorCode, "COMPLETION_REJECTED");
        // The rejected completion never removed the recovery input.
        await store.verifiedRead(seeded.stagingKey, seeded.sha256);

        await prisma.assetProcessingJob.update({
          where: { id: seeded.jobId },
          data: { nextAttemptAt: new Date(Date.now() - 1_000) }
        });
        assert.equal(await makeWorker(`${prefix}-reject-retry`).runOnce(), "completed");

        jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: seeded.jobId } });
        assert.equal(jobRow.state, "COMPLETED");
        const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
          where: { id: seeded.sessionId }
        });
        assert.equal(sessionRow.archivedFileCount, 1);
        await assert.rejects(store.read(seeded.stagingKey));
      });

      await t.test("lease takeover: the stale worker cannot complete or delete the new holder's staging", async () => {
        const seeded = await seedArchiveFileJob("takeover", "#2e8b57");

        const staleWorkerId = `${prefix}-tk-stale`;
        const staleLease = await repository.claimNextJob(staleWorkerId, new Date(Date.now() + 60_000));
        assert.ok(staleLease);
        const staleWorker = makeWorker(staleWorkerId);
        assert.equal(await staleWorker.processClaimedJobForTest(staleLease!), "completed");

        // The stale worker dies; its expired lease is taken over with a fresh
        // token.
        await prisma.assetProcessingJob.update({
          where: { id: seeded.jobId },
          data: { leaseUntil: new Date(Date.now() - 1_000) }
        });
        const freshWorkerId = `${prefix}-tk-fresh`;
        const freshLease = await repository.claimNextJob(freshWorkerId, new Date(Date.now() + 60_000));
        assert.ok(freshLease);
        assert.equal(freshLease!.jobId, seeded.jobId);
        assert.notEqual(freshLease!.lease.leaseToken, staleLease!.lease.leaseToken);

        // The stale holder wakes up: its completion is rejected, and it must
        // not have removed the staging entry the new holder still needs.
        await assert.rejects(
          repository.completeJob(
            seeded.jobId,
            {
              kind: "ARCHIVE_FILE",
              sha256: seeded.sha256,
              archiveKey: seeded.rawArchiveKey,
              storageProvider: "local-fs"
            } satisfies CompleteAssetJobResult,
            staleLease!.lease
          ),
          (error: unknown) => {
            assert.ok(error instanceof PersistenceError);
            assert.equal(error.code, "CONFLICT");
            return true;
          }
        );
        await store.verifiedRead(seeded.stagingKey, seeded.sha256);

        // The new holder processes and commits with its own lease.
        const freshWorker = makeWorker(freshWorkerId);
        assert.equal(await freshWorker.processClaimedJobForTest(freshLease!, { submit: true }), "completed");

        const jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: seeded.jobId } });
        assert.equal(jobRow.state, "COMPLETED");
        const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
          where: { id: seeded.sessionId }
        });
        assert.equal(sessionRow.archivedFileCount, 1);
        await assert.rejects(store.read(seeded.stagingKey));
      });

      await t.test("a failing staging cleanup leaves the committed job COMPLETED with a reclaimable staging entry", async () => {
        const seeded = await seedArchiveFileJob("cleanupfail", "#b22222");

        const worker = new AssetWorker({
          repository,
          handlers: createJobHandlers({ store: withFailingRemoveStaging(store), repository }),
          workerId: `${prefix}-cf`,
          leaseMs: 60_000,
          heartbeatMs: 25,
          pollMs: 5,
          shutdownGraceMs: 5_000,
          transientRetryDelayMs: 60_000
        });

        assert.equal(await worker.runOnce(), "completed");

        const jobRow = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: seeded.jobId } });
        assert.equal(jobRow.state, "COMPLETED");
        assert.equal(jobRow.errorCode, null);
        const fileRow = await prisma.assetSourceFile.findUniqueOrThrow({ where: { id: seeded.fileId } });
        assert.equal(fileRow.state, "ARCHIVED");
        const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
          where: { id: seeded.sessionId }
        });
        assert.equal(sessionRow.archivedFileCount, 1);
        // The cleanup failure leaks the staging entry instead of corrupting
        // the committed outcome; the entry stays reclaimable.
        await store.verifiedRead(seeded.stagingKey, seeded.sha256);
      });
    } finally {
      await prisma.$disconnect().catch(() => undefined);
      rmSync(store.root, { recursive: true, force: true });
    }
  }
);

/**
 * QA-scale regression for TASK-ASSET-WORKER-003. TASK-ASSET-QA-001 observed the
 * real 127-file source set (`sources/discovery` in the QA evidence: 127 files
 * = 65 JPG + 62 ARW across 26 top-level directories, 66 stems, 1 cross-folder
 * stem ZDX01535, 4 jpg-only stems, 1 arw-only stem) fail `sources/grouping-pairs`:
 * GROUP_SESSION never settled within the bounded 240 s window and the session
 * ended state=PARTIALLY_FAILED groups=0. This fixture reproduces that exact
 * source-set SHAPE with synthetic bytes only — no source photograph is ever
 * copied or committed — and drives the real worker against live PostgreSQL
 * until the GROUP_SESSION job reaches a terminal state, asserting the
 * deterministic convergence the QA gate requires.
 */
test(
  "QA-scale GROUP_SESSION: the real 127-file source-set shape converges within the bounded workflow",
  { skip: !databaseUrl || !archiveRoot ? "requires DATABASE_URL and MYSTCRAG_ASSET_ARCHIVE_ROOT" : undefined },
  async () => {
    const prisma = createPrismaClient(databaseUrl);
    const repository = new AssetImportRepository(prisma);
    const store = new ArchiveStore({
      root: mkdtempSync(join(tmpdir(), "asset-worker-qa-scale-")),
      repositoryRoots: []
    });
    const prefix = `assetworker-qascale-${Date.now()}`;

    async function jpegBead(color: string, cx: number, cy: number): Promise<Uint8Array> {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
        <rect width="800" height="800" fill="#f0f0f0"/>
        <circle cx="${cx}" cy="${cy}" r="300" fill="${color}"/>
        <circle cx="${cx - 70}" cy="${cy - 70}" r="40" fill="#ffffff"/>
      </svg>`;
      return new Uint8Array(await sharp(Buffer.from(svg)).jpeg().toBuffer());
    }

    /**
     * Minimal structurally valid Sony ARW with an extra ImageWidth entry whose
     * value varies per seed, so every fixture ARW has a distinct sha256 while
     * still carrying the CFA photometric + "SONY" Make evidence the detector
     * requires. Sharp cannot decode ARW sensor data, so the ARW path must never
     * require a raster decode.
     */
    function minimalSonyArw(seed: number): Uint8Array {
      const ifdOffset = 8;
      const ifdSize = 2 + 3 * 12 + 4;
      const makeOffset = ifdOffset + ifdSize;
      const entries = [
        { tag: 0x0100, type: 3, count: 1, inline: 4000 + seed },
        { tag: 0x0106, type: 3, count: 1, inline: 32803 },
        { tag: 0x010f, type: 2, count: 5, offset: makeOffset }
      ];
      const buffer = Buffer.alloc(makeOffset + 5);
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      buffer.set([0x49, 0x49, 0x2a, 0x00], 0);
      view.setUint32(4, ifdOffset, true);
      view.setUint16(ifdOffset, entries.length, true);
      let at = ifdOffset + 2;
      for (const entry of entries) {
        view.setUint16(at, entry.tag, true);
        view.setUint16(at + 2, entry.type, true);
        view.setUint32(at + 4, entry.count, true);
        if (entry.inline !== undefined) view.setUint16(at + 8, entry.inline, true);
        else view.setUint32(at + 8, entry.offset!, true);
        at += 12;
      }
      view.setUint32(at, 0, true);
      buffer.set(Buffer.from("SONY\0", "latin1"), makeOffset);
      return new Uint8Array(buffer);
    }

    function hexColor(hue: number): string {
      const saturation = 0.65;
      const lightness = 0.45;
      const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
      const huePrime = hue / 60;
      const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
      let rgb: [number, number, number];
      if (huePrime < 1) rgb = [chroma, x, 0];
      else if (huePrime < 2) rgb = [x, chroma, 0];
      else if (huePrime < 3) rgb = [0, chroma, x];
      else if (huePrime < 4) rgb = [0, x, chroma];
      else if (huePrime < 5) rgb = [x, 0, chroma];
      else rgb = [chroma, 0, x];
      const shift = lightness - chroma / 2;
      const channel = (value: number) =>
        Math.round((value + shift) * 255)
          .toString(16)
          .padStart(2, "0");
      return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
    }

    try {
      await prisma.$connect();

      type FixtureFile = {
        stem: string;
        kind: "ARW" | "JPEG";
        dir: string;
        bytes: Uint8Array;
        lastModifiedMs: number;
      };
      const fixtures: FixtureFile[] = [];
      const baseMs = 1_750_000_000_000;

      // 61 same-stem ARW+JPEG pairs; adjacent pairs are 100 s apart so no
      // cross-pair visual merge can ever satisfy the 60 s confident window.
      const pairStems: string[] = [];
      for (let number = 1500; pairStems.length < 60; number += 1) {
        const stem = `ZDX0${number}`;
        if (stem !== "ZDX01531" && stem !== "ZDX01535" && stem !== "ZDX01541") pairStems.push(stem);
      }
      pairStems.push("ZDX01535");
      for (const [index, stem] of pairStems.entries()) {
        const dir = String((index % 26) + 1).padStart(2, "0");
        const ms = baseMs + index * 100_000;
        const crossFolder = stem === "ZDX01535";
        fixtures.push({
          stem,
          kind: "ARW",
          dir: crossFolder ? "22" : dir,
          bytes: minimalSonyArw(index + 1),
          lastModifiedMs: ms
        });
        fixtures.push({
          stem,
          kind: "JPEG",
          dir: crossFolder ? "21" : dir,
          bytes: await jpegBead(hexColor((index * 360) / 61), 400, 400),
          lastModifiedMs: ms
        });
      }

      // The 4 jpg-only stems: the three visually near shots whose capture gaps
      // (842 s and 2230 s) exceed the 60 s confident window form one
      // low-confidence review group; the distinct fourth stays a singleton.
      const trioMs = baseMs + 61 * 100_000;
      const trioShots = [
        { stem: "ZDX01441", shift: 0, ms: trioMs },
        { stem: "ZDX01449", shift: 2, ms: trioMs + 842_000 },
        { stem: "ZDX01455", shift: 1, ms: trioMs + 842_000 + 2_230_000 }
      ];
      for (const shot of trioShots) {
        fixtures.push({
          stem: shot.stem,
          kind: "JPEG",
          dir: "01",
          bytes: await jpegBead("#3cb371", 400 + shot.shift, 400 + shot.shift),
          lastModifiedMs: shot.ms
        });
      }
      fixtures.push({
        stem: "ZDX01541",
        kind: "JPEG",
        dir: "24",
        bytes: await jpegBead("#8a2be2", 400, 400),
        lastModifiedMs: trioMs + 10_000_000
      });
      fixtures.push({
        stem: "ZDX01531",
        kind: "ARW",
        dir: "20",
        bytes: minimalSonyArw(63),
        lastModifiedMs: trioMs + 10_000_000
      });

      assert.equal(fixtures.length, 127);
      assert.equal(fixtures.filter((f) => f.kind === "JPEG").length, 65);
      assert.equal(fixtures.filter((f) => f.kind === "ARW").length, 62);
      assert.equal(new Set(fixtures.map((f) => f.stem)).size, 66);
      assert.equal(new Set(fixtures.map((f) => sha256OfBytes(f.bytes))).size, 127);

      const session = await repository.createSession({ idempotencyKey: `${prefix}-session` });
      const registered = await repository.registerManifest(session.sessionId, {
        idempotencyKey: `${prefix}-manifest`,
        files: fixtures.map((fixture, index) => ({
          clientFileId: `cf-${index + 1}`,
          relativePath: `sources/${fixture.dir}/${fixture.stem}.${fixture.kind === "ARW" ? "ARW" : "JPG"}`,
          byteSize: fixture.bytes.byteLength,
          lastModifiedMs: fixture.lastModifiedMs,
          kind: fixture.kind
        }))
      });
      const fileIdByIndex = registered.files.map((file) => file.fileId);
      assert.equal(fileIdByIndex.length, 127);
      const fileIdOf = (stem: string, kind: "ARW" | "JPEG"): string => {
        const index = fixtures.findIndex((fixture) => fixture.stem === stem && fixture.kind === kind);
        return fileIdByIndex[index]!;
      };

      for (const [index, fixture] of fixtures.entries()) {
        const sha256 = sha256OfBytes(fixture.bytes);
        const { archiveKey } = await store.putOriginal({
          sessionId: session.sessionId,
          bytes: fixture.bytes,
          sha256,
          extension: fixture.kind === "ARW" ? "arw" : "jpg"
        });
        await prisma.assetSourceFile.update({
          where: { id: fileIdByIndex[index]! },
          data: {
            state: "ARCHIVED",
            sha256,
            archiveKey,
            storageProvider: "local-fs",
            archivedAt: new Date()
          }
        });
      }
      await prisma.assetImportSession.update({
        where: { id: session.sessionId },
        data: {
          state: "ARCHIVING",
          archivedFileCount: fixtures.length,
          uploadedBytes: fixtures.reduce((total, fixture) => total + BigInt(fixture.bytes.byteLength), 0n),
          lastVerifiedCheckpoint: "ARCHIVED"
        }
      });

      // A tiny transient retry delay keeps the bounded retry loop tight; on the
      // fixed path the job completes on the first attempt and never retries.
      const qaWorker = new AssetWorker({
        repository,
        handlers: createJobHandlers({ store, repository }),
        workerId: `${prefix}-worker`,
        leaseMs: 60_000,
        heartbeatMs: 25,
        pollMs: 5,
        shutdownGraceMs: 5_000,
        transientRetryDelayMs: 25
      });

      const startedAt = Date.now();
      const started = await repository.startGrouping(session.sessionId, {
        idempotencyKey: `${prefix}-grouping-start`
      });
      assert.equal(started.queuedJobCount, 1);
      assert.equal(await prisma.beadImageGroup.count({ where: { sessionId: session.sessionId } }), 0);

      let jobRow = await prisma.assetProcessingJob.findFirstOrThrow({
        where: { sessionId: session.sessionId, jobType: "GROUP_SESSION" }
      });
      for (let spin = 0; jobRow.state !== "COMPLETED" && jobRow.state !== "FAILED" && spin < 16; spin += 1) {
        await qaWorker.runOnce();
        await new Promise((resolve) => setTimeout(resolve, 30));
        jobRow = await prisma.assetProcessingJob.findFirstOrThrow({
          where: { sessionId: session.sessionId, jobType: "GROUP_SESSION" }
        });
      }
      const elapsedMs = Date.now() - startedAt;

      const sessionRow = await prisma.assetImportSession.findUniqueOrThrow({
        where: { id: session.sessionId }
      });
      const materializedCount = await prisma.beadImageGroup.count({ where: { sessionId: session.sessionId } });
      assert.ok(
        jobRow.state === "COMPLETED" && sessionRow.state === "NEEDS_REVIEW",
        `GROUP_SESSION must reach the deterministic terminal state within the bounded workflow (observed job=${jobRow.state} session=${sessionRow.state} groups=${materializedCount} after ${elapsedMs}ms)`
      );
      assert.ok(elapsedMs < 240_000, `grouping must settle inside the 240s QA window (observed ${elapsedMs}ms)`);
      assert.equal(jobRow.errorCode, null);
      assert.equal(sessionRow.lastVerifiedCheckpoint, "GROUPED");

      const result = jobRow.result as {
        kind: string;
        groups: Array<{
          groupId: string;
          memberFileIds: string[];
          similarityEvidence: Array<{
            stemPairedWith: string | null;
            confidence: string;
            dHashDistance: number | null;
            histogramDistance: number | null;
            captureGapMs: number | null;
          }>;
        }>;
      };
      assert.equal(result.kind, "GROUP_SESSION");
      assert.equal(result.groups.length, 64);
      assert.equal(result.groups.filter((group) => group.groupId.startsWith("sg-")).length, 63);
      assert.equal(result.groups.filter((group) => group.groupId.startsWith("rv-")).length, 1);

      const memberships = new Map<string, number>();
      for (const group of result.groups) {
        for (const fileId of group.memberFileIds) {
          memberships.set(fileId, (memberships.get(fileId) ?? 0) + 1);
        }
      }
      assert.equal(memberships.size, 127, "every archived file is covered");
      assert.deepEqual(
        [...memberships.values()].filter((count) => count !== 1),
        [],
        "every archived file belongs to exactly one suggested or review group"
      );

      const stemPairedGroups = result.groups.filter((group) =>
        group.similarityEvidence.some((evidence) => evidence.stemPairedWith !== null)
      );
      assert.equal(stemPairedGroups.length, 61, "the 61 same-stem ARW+JPEG pairs each form one group");

      const crossFolderGroup = result.groups.find((group) =>
        group.memberFileIds.includes(fileIdOf("ZDX01535", "JPEG"))
      );
      assert.ok(crossFolderGroup, "the cross-folder stem still pairs");
      assert.ok(crossFolderGroup!.groupId.startsWith("sg-"));
      assert.deepEqual(crossFolderGroup!.memberFileIds.slice().sort(), [
        fileIdOf("ZDX01535", "ARW"),
        fileIdOf("ZDX01535", "JPEG")
      ]);
      assert.ok(
        crossFolderGroup!.similarityEvidence.some((evidence) => evidence.stemPairedWith !== null)
      );

      const reviewGroup = result.groups.find((group) => group.groupId.startsWith("rv-"));
      assert.ok(reviewGroup, "the visually near jpg-only trio surfaces as one review group");
      assert.deepEqual(reviewGroup!.memberFileIds.slice().sort(), [
        fileIdOf("ZDX01441", "JPEG"),
        fileIdOf("ZDX01449", "JPEG"),
        fileIdOf("ZDX01455", "JPEG")
      ]);
      assert.ok(reviewGroup!.similarityEvidence.length >= 2, "the spanning tree carries one edge per merge");
      assert.ok(
        reviewGroup!.similarityEvidence.every((evidence) => evidence.confidence === "low"),
        "the review group keeps human-primary low-confidence evidence"
      );

      for (const [stem, kind] of [
        ["ZDX01541", "JPEG"],
        ["ZDX01531", "ARW"]
      ] as const) {
        const singleton = result.groups.find((group) =>
          group.memberFileIds.includes(fileIdOf(stem, kind))
        );
        assert.ok(singleton, `${stem} keeps its own suggestion`);
        assert.ok(singleton!.groupId.startsWith("sg-"));
        assert.deepEqual(singleton!.memberFileIds, [fileIdOf(stem, kind)]);
      }

      const materialized = await prisma.beadImageGroup.findMany({
        where: { sessionId: session.sessionId },
        include: { files: true }
      });
      assert.equal(materialized.length, 64);
      assert.ok(materialized.every((group) => group.state === "SUGGESTED"));
      assert.ok(materialized.every((group) => group.similarityEvidence !== null));
      assert.deepEqual(
        materialized.flatMap((group) => group.files.map((file) => file.id)).sort(),
        [...fileIdByIndex].sort()
      );
    } finally {
      await prisma.$disconnect().catch(() => undefined);
      rmSync(store.root, { recursive: true, force: true });
    }
  }
);
