import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { ArchiveStore } from "@mystcrag/asset-pipeline";
import { AssetImportRepository, createPrismaClient } from "@mystcrag/database";

import { loadWorkerConfigFromEnv } from "./config.js";
import { createJobHandlers } from "./jobs.js";
import { discoverRepositoryRoots } from "./repository-roots.js";
import { AssetWorker, formatErrorForLog } from "./runtime.js";

async function main(): Promise<void> {
  const config = loadWorkerConfigFromEnv(process.env);

  // The archive root must live outside every Git worktree of this repository:
  // the current linked worktree, the main checkout, and any sibling worktree
  // registered in `git worktree list`. Discovery fails closed when neither the
  // git CLI nor a filesystem walk can identify those trees.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repositoryRoots = await discoverRepositoryRoots({ startDir: moduleDir });
  const store = new ArchiveStore({ root: config.archiveRoot, repositoryRoots });

  const prisma = createPrismaClient(config.databaseUrl);
  const repository = new AssetImportRepository(prisma);
  const worker = new AssetWorker({
    repository,
    handlers: createJobHandlers({ store, repository }),
    workerId: config.workerId,
    leaseMs: config.leaseMs,
    heartbeatMs: config.heartbeatMs,
    pollMs: config.pollMs,
    shutdownGraceMs: config.shutdownGraceMs,
    transientRetryDelayMs: config.transientRetryDelayMs
  });

  let signaled = false;
  const onSignal = (signal: string): void => {
    if (signaled) return;
    signaled = true;
    console.log(
      `[asset-worker] ${signal} received; finishing the in-flight job (grace ${config.shutdownGraceMs}ms)`
    );
    worker.requestShutdown();
    const forceExit = setTimeout(() => {
      console.error("[asset-worker] shutdown grace exceeded; exiting with the lease left to expire");
      process.exit(1);
    }, config.shutdownGraceMs);
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
  console.error("[asset-worker] fatal:", formatErrorForLog(error));
  process.exit(1);
});
