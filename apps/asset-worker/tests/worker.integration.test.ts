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

      await t.test("GROUP_SESSION: suggestions are recorded as job evidence without writing bead_image_groups", async () => {
        const { sessionId, fileIds } = await seedSessionWithFiles("grouping", 3);
        const identical = await pngBytes("#20b2aa");
        const identicalSha = sha256OfBytes(identical);
        const other = await pngBytes("#8a2be2");
        const otherSha = sha256OfBytes(other);

        const archiveEntries: Array<{ fileId: string; archiveKey: string; sha256: string; byteSize: number }> = [];
        for (const [index, entry] of [
          { fileId: fileIds[0]!, bytes: identical, sha256: identicalSha },
          { fileId: fileIds[1]!, bytes: identical, sha256: identicalSha },
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
          void index;
        }

        const job = await prisma.assetProcessingJob.create({
          data: {
            sessionId,
            jobType: "GROUP_SESSION",
            state: "QUEUED",
            payload: {
              files: archiveEntries.map((entry, index) => ({
                fileId: entry.fileId,
                clientFileId: `grouping-cf-${index + 1}`,
                relativePath: `imports/grouping/bead-${index + 1}.png`,
                sha256: entry.sha256,
                archiveKey: entry.archiveKey,
                byteSize: entry.byteSize,
                lastModifiedMs: 1_750_000_000_000 + index,
                kind: "PNG"
              }))
            },
            maxRetries: 3
          }
        });
        const groupsBefore = await prisma.beadImageGroup.count({ where: { sessionId } });

        assert.equal(await makeWorker().runOnce(), "completed");

        const row = await prisma.assetProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        assert.equal(row.state, "COMPLETED");
        const result = row.result as {
          kind: string;
          groups: Array<{ memberFileIds: string[]; similarityEvidence: unknown }>;
        };
        assert.equal(result.kind, "GROUP_SESSION");
        assert.ok(result.groups.length >= 2);
        const merged = result.groups.find((group) => group.memberFileIds.length === 2);
        assert.ok(merged, "identical frames merge into one suggestion");
        assert.deepEqual(
          merged!.memberFileIds.slice().sort(),
          [fileIds[0]!, fileIds[1]!].sort()
        );
        assert.ok(merged!.similarityEvidence);
        // The worker never writes grouping business rows (gap G2): suggestions
        // stay as job evidence for the human review flow.
        assert.equal(await prisma.beadImageGroup.count({ where: { sessionId } }), groupsBefore);
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
          data: { groupId: group.id }
        });
        await prisma.assetProcessingJob.create({
          data: {
            sessionId,
            groupId: group.id,
            jobType: "PROCESS_GROUP",
            state: "QUEUED",
            payload: {
              groupId: group.id,
              processingVersion: 1,
              primaryFileId: fileIds[0]!,
              files: [{ fileId: fileIds[0]!, archiveKey, sha256 }]
            },
            maxRetries: 3
          }
        });

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

        const holder = await repository.completeJob(
          job.id,
          {
            kind: "ARCHIVE_FILE",
            sha256,
            archiveKey: `imports/${sessionId}/raw/${sha256}.png`,
            storageProvider: "local-fs"
          } satisfies CompleteAssetJobResult,
          freshLease!.lease
        );
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
