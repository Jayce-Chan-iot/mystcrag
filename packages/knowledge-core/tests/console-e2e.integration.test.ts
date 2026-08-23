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

import { runIngestionPipeline } from "@mystcrag/knowledge-ingestion";

import { KnowledgeConsoleService } from "../src/console/console-service.js";
import { KnowledgeReviewService } from "../src/review/review-service.js";

const databaseUrl = process.env.DATABASE_URL;

/**
 * Task book Track B E2E closed loop: Crawl → Candidate → Console shows
 * NEEDS_REVIEW → Approve → Console updates. Drives the exact services the
 * Admin API delegates to (KnowledgeReviewService + KnowledgeConsoleService),
 * against a live database and a local fixture crawl source.
 */
test("console E2E closed loop: crawl, review surface, approve, dashboard updates", { skip: !databaseUrl }, async (t) => {
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (url === "/api/gemstones.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          documents: [
            {
              url: "https://fixtures.console-e2e/amethyst",
              title: "Amethyst facts",
              contentText: "Amethyst is a purple quartz with Mohs hardness 7.",
              rules: [
                {
                  knowledgeType: "CRYSTAL_GEMOLOGY",
                  subject: "material:amethyst",
                  relation: "has-property",
                  payload: { property: "mohsHardness", value: "7" },
                  confidence: 0.9
                }
              ]
            }
          ]
        })
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
  const review = new KnowledgeReviewService({ database, repository });
  const consoleService = new KnowledgeConsoleService({ database, repository });
  const collectionRuns = new KnowledgeCollectionRunRepository(database);
  const crawlerStorageDir = mkdtempSync(`${tmpdir()}/mystcrag-crawlee-e2e-`);

  await database.$executeRawUnsafe(`DELETE FROM "knowledge_embeddings"`);
  await database.knowledgeRule.deleteMany();
  await database.knowledgeDocument.deleteMany();
  await database.knowledgeVersion.deleteMany();
  await database.knowledgeSource.deleteMany();
  await database.knowledgeCollectionRun.deleteMany();

  const source = await repository.upsertSource({
    id: "source-console-e2e",
    name: "Console E2E gem feed",
    sourceType: "OFFICIAL_API",
    baseUrl: `${base}/api/gemstones.json`,
    authorityScore: 0.9,
    allowedKnowledgeDomains: ["knowledge-domain:crystal-gemology"],
    language: "en",
    enabled: true
  });

  const run = await collectionRuns.startRun({ startedAt: new Date() });

  try {
    await t.test("crawl inserts a candidate rule and completes the collection run", async () => {
      const result = await runIngestionPipeline(source, {
        database,
        repository,
        allowPrivateNetworks: true,
        crawlerStorageDir
      });
      assert.equal(result.createdDocuments, 1);
      assert.equal(result.insertedCandidates, 1);

      await collectionRuns.completeRun(run.id, {
        finishedAt: new Date(),
        status: "COMPLETED",
        sourcesCrawled: 1,
        documentsAdded: result.createdDocuments,
        documentDuplicates: result.duplicateDocuments,
        candidatesInserted: result.insertedCandidates,
        corroboratedCandidates: 0,
        candidateDuplicates: 0,
        needsReview: 1,
        conflicts: 0,
        errors: [],
        sourceResults: [
          {
            sourceId: source.id,
            documentsAdded: result.createdDocuments,
            duplicateDocuments: result.duplicateDocuments,
            candidatesInserted: result.insertedCandidates,
            corroboratedCandidates: 0,
            duplicateCandidates: 0
          }
        ]
      });
      const runs = await consoleService.listCollectionRuns(10);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]!.status, "COMPLETED");
      assert.equal(runs[0]!.candidatesInserted, 1);
    });

    await t.test("dashboard shows the candidate as NEEDS_REVIEW with full evidence", async () => {
      const pipelineSummary = await review.runReviewPipeline();
      assert.ok(pipelineSummary.needsReview >= 1, "single-source fact candidates park for review");

      const overview = await review.getAdminOverview();
      assert.equal(overview.documents, 1);
      assert.ok(overview.externalCandidates >= 1);
      assert.equal(overview.externalApprovedRules, 0);

      const queue = await review.listReviewQueue({ status: "NEEDS_REVIEW", limit: 50 });
      const candidate = queue.find((item) => item.rule.subject === "material:amethyst");
      assert.ok(candidate !== undefined, "amethyst candidate is visible in the review queue");
      assert.equal(
        candidate.rule.claimType ?? null,
        null,
        "structured-feed candidates lack a claim grade"
      );
      assert.ok(candidate.evidence.length >= 1, "queue item carries source evidence");
      assert.equal(candidate.evidence[0]!.source.id, "source-console-e2e");
      assert.ok(candidate.evidence[0]!.document !== null);
    });

    await t.test("approve flips the dashboard to an evidence-backed approved rule", async () => {
      const queue = await review.listReviewQueue({ status: "NEEDS_REVIEW", limit: 50 });
      const candidate = queue.find((item) => item.rule.subject === "material:amethyst");
      assert.ok(candidate !== undefined);

      const approved = await review.approveRule(candidate.rule.id);
      assert.equal(approved.status, "APPROVED");

      const overview = await review.getAdminOverview();
      assert.equal(overview.externalApprovedRules, 1);
      assert.equal(
        overview.externalCandidates,
        0,
        "the fixture's only candidate was reviewed, so nothing stays pending"
      );
    });

    await t.test("coverage, source stats, and atlas reflect the live database", async () => {
      const coverage = await consoleService.getCoverage();
      const gemology = coverage.find((domain) => domain.domain === "CRYSTAL_GEMOLOGY");
      assert.ok(gemology !== undefined);
      assert.ok(gemology.current >= 1);
      assert.ok(
        gemology.coveredTaxonomyTerms.some((term) => term.id === "material:amethyst")
      );

      const stats = await consoleService.getSourceStats();
      const stat = stats.find((item) => item.sourceId === "source-console-e2e");
      assert.ok(stat !== undefined);
      assert.equal(stat.documents, 1);
      assert.ok(stat.yield >= 1, "one document produced one candidate");

      const atlas = await consoleService.getCrystalAtlas();
      const amethyst = atlas.find((row) => row.crystalId === "material:amethyst");
      assert.ok(amethyst !== undefined);
      assert.ok(amethyst.gemologyCompleteness > 0);

      const detail = await consoleService.getCrystalAtlasDetail("material:amethyst");
      assert.ok(detail !== null);
      assert.ok(
        detail.properties.some(
          (property) => property.property === "mohsHardness" && property.status === "APPROVED"
        )
      );
    });
  } finally {
    rmSync(crawlerStorageDir, { recursive: true, force: true });
    server.close();
    await database.$disconnect();
  }
});
