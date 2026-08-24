import "dotenv/config";

import { createKnowledgeWorkerRuntime } from "./runtime.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const cron = process.env.KNOWLEDGE_DISCOVER_CRON;

const runtime = await createKnowledgeWorkerRuntime({
  databaseUrl,
  crawlerStorageDir: process.env.KNOWLEDGE_CRAWLER_STORAGE_DIR,
  enableScheduling: cron !== undefined && cron.length > 0
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[knowledge-worker] received ${signal}, shutting down`);
  await runtime.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await runtime.start();
console.log("[knowledge-worker] started; queues: discover-source, fetch-document, generate-embedding, publish-knowledge");

if (cron !== undefined && cron.length > 0) {
  await runtime.boss.schedule("discover-source", cron, {});
  console.log(`[knowledge-worker] discover-source scheduled with cron "${cron}"`);
}
