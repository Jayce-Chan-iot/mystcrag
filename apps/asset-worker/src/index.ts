import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ArchiveStore } from "@mystcrag/asset-pipeline";
import { AssetImportRepository, createPrismaClient } from "@mystcrag/database";

import { createJobHandlers } from "./jobs.js";
import { AssetWorker } from "./runtime.js";

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`[asset-worker] ${name} must be a positive integer, got: ${raw}`);
    process.exit(1);
  }
  return Math.round(parsed);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[asset-worker] DATABASE_URL is required");
    process.exit(1);
  }

  const workerId = process.env.MYSTCRAG_ASSET_WORKER_ID?.trim() || `asset-worker-${process.pid}`;
  const shutdownGraceMs = readEnvInt("MYSTCRAG_ASSET_WORKER_SHUTDOWN_GRACE_MS", 30_000);

  // The archive root must live outside every Git worktree: the package
  // directory (pnpm's script cwd) and the worktree root this module lives in.
  const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const store = ArchiveStore.fromEnvironment({
    repositoryRoots: [process.cwd(), moduleRoot]
  });

  const prisma = createPrismaClient(databaseUrl);
  const repository = new AssetImportRepository(prisma);
  const worker = new AssetWorker({
    repository,
    handlers: createJobHandlers({ store, repository }),
    workerId,
    leaseMs: readEnvInt("MYSTCRAG_ASSET_WORKER_LEASE_MS", 60_000),
    heartbeatMs: readEnvInt("MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS", 20_000),
    pollMs: readEnvInt("MYSTCRAG_ASSET_WORKER_POLL_MS", 5_000),
    shutdownGraceMs,
    transientRetryDelayMs: readEnvInt("MYSTCRAG_ASSET_WORKER_TRANSIENT_RETRY_DELAY_MS", 60_000)
  });

  let signaled = false;
  const onSignal = (signal: string): void => {
    if (signaled) return;
    signaled = true;
    console.log(`[asset-worker] ${signal} received; finishing the in-flight job (grace ${shutdownGraceMs}ms)`);
    worker.requestShutdown();
    const forceExit = setTimeout(() => {
      console.error("[asset-worker] shutdown grace exceeded; exiting with the lease left to expire");
      process.exit(1);
    }, shutdownGraceMs);
    forceExit.unref();
  };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));

  try {
    await worker.run();
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("[asset-worker] fatal:", error);
  process.exit(1);
});
