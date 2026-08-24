import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import test from "node:test";

import {
  createPrismaClient,
  KnowledgeCollectionRunRepository,
  KnowledgeRepository,
  type DatabaseClient
} from "@mystcrag/database";

import { runCollectBatch } from "../src/cli/collect.js";
import { KnowledgeReviewService } from "../src/review/review-service.js";

const databaseUrl = process.env.DATABASE_URL;

test("collect persists a CollectionRun and survives a dead source", { skip: !databaseUrl }, async () => {
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url === "/amethyst.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        `<!doctype html><html><head><title>Amethyst gemstone information</title></head>` +
          `<body><article><p>Mohs Hardness 7 gemdat citation text</p>` +
          `<p>Crystal System Trigonal gemdat citation text</p></article></body></html>`
      );
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  const database: DatabaseClient = createPrismaClient(databaseUrl!);
  await database.$connect();
  const repository = new KnowledgeRepository(database);
  const service = new KnowledgeReviewService({ database, repository });
  const collectionRuns = new KnowledgeCollectionRunRepository(database);
  const crawlerStorageDir = mkdtempSync(`${tmpdir()}/mystcrag-collect-`);

  await database.$executeRawUnsafe(`DELETE FROM "knowledge_embeddings"`);
  await database.knowledgeCollectionRun.deleteMany();
  await database.knowledgeRule.deleteMany();
  await database.knowledgeDocument.deleteMany();
  await database.knowledgeVersion.deleteMany();
  await database.knowledgeSource.deleteMany();

  try {
    await repository.upsertSource({
      id: "source-collect-fixture",
      name: "Collect fixture source",
      sourceType: "STATIC_HTML",
      baseUrl: `${base}/amethyst.html`,
      authorityScore: 0.75,
      allowedKnowledgeDomains: [
        "knowledge-domain:crystal-gemology",
        "knowledge-domain:crystal-visual-properties"
      ],
      language: "en",
      enabled: true
    });
    await repository.upsertSource({
      id: "source-collect-dead",
      name: "Dead source (unsupported protocol)",
      // ftp:// fails the SSRF protocol check deterministically and instantly,
      // regardless of the environment's DNS or proxy behavior.
      sourceType: "STATIC_HTML",
      baseUrl: "ftp://dead-source.example.com/amethyst.html",
      authorityScore: 0.5,
      allowedKnowledgeDomains: ["knowledge-domain:crystal-gemology"],
      language: "en",
      enabled: true
    });
    await repository.reviewSource("source-collect-fixture", "APPROVED");
    await repository.reviewSource("source-collect-dead", "APPROVED");

    const report = await runCollectBatch(database, repository, service, {
      allowPrivateNetworks: true,
      crawlerStorageDir
    });

    // The dead source must not void the batch: the fixture source still ran.
    assert.equal(report.sourcesCrawled, 1);
    assert.ok(report.documentsAdded >= 1);
    assert.ok(report.candidatesInserted >= 1);
    assert.ok(report.collectionRunId.length > 0);
    const deadEntry = report.sources.find((entry) => entry.sourceId === "source-collect-dead");
    assert.equal(deadEntry, undefined, "the failed source contributes no results");
    assert.ok(
      report.coverageTargets.some(
        (domain) => domain.domain === "CRYSTAL_GEMOLOGY" && domain.current >= 1
      ),
      "gem profile candidates attribute to CRYSTAL_GEMOLOGY coverage"
    );

    const runs = await collectionRuns.listRuns({ limit: 5 });
    assert.equal(runs.length, 1);
    const run = runs[0]!;
    assert.equal(run.id, report.collectionRunId);
    assert.equal(run.status, "COMPLETED");
    assert.equal(run.sourcesCrawled, 1);
    assert.equal(run.documentsAdded, report.documentsAdded);
    assert.ok(run.finishedAt !== null);
    assert.ok(run.startedAt <= run.finishedAt!);
    assert.equal(run.errors.length, 1);
    assert.equal(run.errors[0]!.sourceId, "source-collect-dead");
    assert.ok(run.errors[0]!.message.length > 0);
    assert.equal(run.sourceResults.length, 1);
    assert.equal(run.sourceResults[0]!.sourceId, "source-collect-fixture");
    assert.ok(run.needsReview >= 1);
  } finally {
    await database.$disconnect();
    server.close();
    server.closeAllConnections();
    rmSync(crawlerStorageDir, { recursive: true, force: true });
  }
});
