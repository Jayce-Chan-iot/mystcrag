import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import test from "node:test";

import { KNOWLEDGE_JOBS } from "../src/jobs.js";
import {
  createKnowledgeWorkerRuntime,
  type KnowledgeWorkerRuntime
} from "../src/runtime.js";

const databaseUrl = process.env.DATABASE_URL;

function structuredFeed(url: string, title: string, contentText: string) {
  return {
    documents: [
      {
        url,
        title,
        contentText,
        rules: [
          {
            knowledgeType: "COLOR_THEORY",
            subject: "color:purple",
            relation: "harmonizes-with",
            payload: { companionColors: ["color:blue"] },
            confidence: 0.85
          },
          {
            knowledgeType: "COLOR_THEORY",
            subject: "color:blue",
            relation: "harmonizes-with",
            payload: { companionColors: ["color:white"] },
            confidence: 0.8
          }
        ]
      }
    ]
  };
}

const FEED_A = structuredFeed(
  "https://fixtures.internal/worker/amethyst",
  "Amethyst worker notes",
  "Amethyst pairs calmly with cool hues and silver accents."
);
const FEED_B = structuredFeed(
  "https://fixtures.internal/worker/labradorite",
  "Labradorite worker notes",
  "Labradorite flashes blue-green against neutral grey tones."
);

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
}

test("knowledge worker executes the ingestion chain through pg-boss", { skip: !databaseUrl }, async (t) => {
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url === "/api/feed-a.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(FEED_A));
      return;
    }
    if (url === "/api/feed-b.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(FEED_B));
      return;
    }
    if (url === "/article.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(htmlPage("Worker color article", "Amethyst purple and moonstone white suit calm styles."));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  const crawlerStorageDir = mkdtempSync(`${tmpdir()}/mystcrag-worker-`);
  let runtime: KnowledgeWorkerRuntime | undefined;

  try {
    assert.ok(databaseUrl, "DATABASE_URL is required when this test runs");
    runtime = await createKnowledgeWorkerRuntime({
      databaseUrl,
      allowPrivateNetworks: true,
      crawlerStorageDir,
      retryLimit: 0,
      pollingIntervalSeconds: 0.5
    });
    const worker: KnowledgeWorkerRuntime = runtime;
    const { repository, database } = worker;

    await database.$executeRawUnsafe(`DELETE FROM "knowledge_embeddings"`);
    await database.knowledgeRule.deleteMany();
    await database.knowledgeDocument.deleteMany();
    await database.knowledgeVersion.deleteMany();
    await database.knowledgeSource.deleteMany();
    await worker.start();
    // purgeQueue keeps completed jobs, whose singleton slots (job_i4 unique
    // index) would suppress this run's sends, so wipe the job table outright.
    await database.$executeRawUnsafe(`DELETE FROM "pgboss"."job"`);

    const singletonSource = await repository.upsertSource({
      id: "source-worker-singleton",
      name: "Worker 单例验证源",
      sourceType: "OFFICIAL_API",
      baseUrl: `${base}/api/feed-b.json`,
      authorityScore: 0.8,
      allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
      language: "en",
      enabled: true
    });
    const structuredSource = await repository.upsertSource({
      id: "source-worker-structured",
      name: "Worker 结构化源",
      sourceType: "OFFICIAL_API",
      baseUrl: `${base}/api/feed-a.json`,
      authorityScore: 0.9,
      allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
      language: "en",
      enabled: true
    });
    const staticSource = await repository.upsertSource({
      id: "source-worker-static",
      name: "Worker 静态源",
      sourceType: "STATIC_HTML",
      baseUrl: `${base}/article.html`,
      authorityScore: 0.7,
      allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
      language: "en",
      enabled: true
    });

    await t.test("singleton key suppresses duplicate fetch jobs per source", async () => {
      const first = await worker.enqueueFetchDocument(singletonSource.id);
      assert.ok(first !== null, "first fetch-document enqueue must succeed");
      const duplicate = await worker.enqueueFetchDocument(singletonSource.id);
      assert.equal(duplicate, null, "second enqueue within the singleton window must return null");
      const job = await worker.waitForJob(KNOWLEDGE_JOBS.fetchDocument, first);
      assert.equal(job.state, "completed");
      assert.equal((job.output as { createdDocuments: number }).createdDocuments, 1);
    });

    await t.test("discover-source fans out to enabled sources and skips singletoned ones", async () => {
      const discoverId = await worker.enqueueDiscoverSources();
      assert.ok(discoverId !== null);
      const discover = await worker.waitForJob(KNOWLEDGE_JOBS.discoverSource, discoverId);
      assert.equal(discover.state, "completed");
      const output = discover.output as {
        enqueued: Array<{ sourceId: string; jobId: string }>;
        skipped: string[];
      };
      assert.deepEqual(
        output.enqueued.map((entry) => entry.sourceId).sort(),
        [staticSource.id, structuredSource.id]
      );
      assert.deepEqual(output.skipped, [singletonSource.id]);
      for (const entry of output.enqueued) {
        const fetchJob = await worker.waitForJob(KNOWLEDGE_JOBS.fetchDocument, entry.jobId);
        assert.equal(fetchJob.state, "completed");
      }
      const documentCount = await database.knowledgeDocument.count();
      assert.equal(documentCount, 3);
      const ruleCount = await database.knowledgeRule.count();
      assert.ok(ruleCount >= 3, `expected at least 3 rules, got ${ruleCount}`);
    });

    await t.test("generate-embedding indexes fetched documents", async () => {
      const jobId = await worker.enqueueGenerateEmbedding();
      assert.ok(jobId !== null);
      const job = await worker.waitForJob(KNOWLEDGE_JOBS.generateEmbedding, jobId);
      assert.equal(job.state, "completed");
      assert.ok((job.output as { indexed: number }).indexed >= 3);
      assert.equal((job.output as { model: string | null }).model, "hash-256-v1");
    });

    await t.test("publish-knowledge publishes approved rules as a version", async () => {
      const reviewRules = await repository.listRules({ status: "NEEDS_REVIEW" });
      assert.ok(reviewRules.length >= 1);
      await repository.transitionRule(reviewRules[0]!.id, "APPROVED");

      const version = `worker-test-${Date.now()}`;
      const jobId = await worker.enqueuePublishKnowledge(version);
      assert.ok(jobId !== null);
      const job = await worker.waitForJob(KNOWLEDGE_JOBS.publishKnowledge, jobId);
      assert.equal(job.state, "completed");
      assert.equal((job.output as { status: string }).status, "PUBLISHED");

      const latest = await repository.getLatestPublishedVersion();
      assert.ok(latest !== null);
      assert.equal(latest.version, version);
      assert.ok(latest.ruleCount >= 1);
    });

    await t.test("exhausted fetch failures land in the dead-letter queue", async () => {
      const deadSource = await repository.upsertSource({
        id: "source-worker-dead",
        name: "Worker 失败源",
        sourceType: "OFFICIAL_API",
        baseUrl: "https://invalid.invalid/feed.json",
        authorityScore: 0.5,
        allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
        language: "en",
        enabled: true
      });
      const jobId = await worker.enqueueFetchDocument(deadSource.id);
      assert.ok(jobId !== null);
      const job = await worker.waitForJob(KNOWLEDGE_JOBS.fetchDocument, jobId);
      assert.equal(job.state, "failed", "with retryLimit 0 the handler error fails the job");

      const deadline = Date.now() + 10_000;
      let deadLetterJobs: Array<{ data: { sourceId?: string } }> = [];
      for (;;) {
        deadLetterJobs = (await worker.boss.fetch(KNOWLEDGE_JOBS.deadLetter)) as Array<{
          data: { sourceId?: string };
        }>;
        if (deadLetterJobs.length > 0) break;
        if (Date.now() >= deadline) {
          assert.fail("dead-letter job never appeared");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(deadLetterJobs[0]!.data.sourceId, deadSource.id);
    });
  } finally {
    if (runtime !== undefined) {
      await runtime.stop();
    }
    rmSync(crawlerStorageDir, { recursive: true, force: true });
    server.close();
  }
});
