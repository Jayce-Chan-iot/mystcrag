import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import test from "node:test";

import {
  createPrismaClient,
  KnowledgeRepository,
  type DatabaseClient
} from "@mystcrag/database";

import { runIngestionPipeline } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;

const STRUCTURED_FEED = {
  documents: [
    {
      url: "https://fixtures.internal/gemstones/amethyst",
      title: "Amethyst pairing notes",
      contentText: "Amethyst pairs calmly with cool hues.",
      rules: [
        {
          knowledgeType: "COLOR_THEORY",
          subject: "color:purple",
          relation: "harmonizes-with",
          payload: { companionColors: ["color:blue"] },
          confidence: 0.85
        },
        {
          knowledgeType: "MATERIAL_COMPATIBILITY",
          subject: "material:quartz",
          relation: "pairs-with",
          payload: { companion: "material:sterling-silver" },
          confidence: 0.8
        }
      ]
    },
    {
      url: "https://fixtures.internal/gemstones/moonstone",
      title: "Moonstone pairing notes",
      contentText: "Moonstone suits ethereal, light palettes.",
      rules: [
        {
          knowledgeType: "COLOR_THEORY",
          subject: "color:white",
          relation: "harmonizes-with",
          payload: { companionColors: ["color:blue"] },
          confidence: 0.8
        }
      ]
    }
  ]
};

function htmlPage(title: string, body: string, links: string[] = []): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${body}</p>${
    links.map((link) => `<a href="${link}">${link}</a>`).join("")
  }</article></body></html>`;
}

test("E2E-1 automatic knowledge ingestion across three source types", { skip: !databaseUrl }, async (t) => {
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\nDisallow: /articles/private-part.html\n");
      return;
    }
    if (url === "/api/gemstones.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(STRUCTURED_FEED));
      return;
    }
    if (url === "/articles/color-theory.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        htmlPage(
          "Color theory basics",
          "Amethyst purple pairs well with blue on the wheel. Silver spacers keep minimal designs calm."
        )
      );
      return;
    }
    if (url === "/articles/index.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        htmlPage("Article index", "Series of design articles.", [
          "/articles/part-1.html",
          "/articles/part-2.html",
          "/articles/private-part.html"
        ])
      );
      return;
    }
    if (url === "/articles/part-1.html" || url === "/articles/part-2.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        htmlPage(`Series ${url}`, "Rose quartz pink and rhodonite pair gently; garnet adds depth.")
      );
      return;
    }
    if (url === "/articles/private-part.html") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(htmlPage("Private", "This must be skipped by robots.txt rules."));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  const database: DatabaseClient = createPrismaClient(databaseUrl);
  await database.$connect();
  const repository = new KnowledgeRepository(database);
  const crawlerStorageDir = mkdtempSync(`${tmpdir()}/mystcrag-crawlee-`);

  await database.$executeRawUnsafe(`DELETE FROM "knowledge_embeddings"`);
  await database.knowledgeRule.deleteMany();
  await database.knowledgeDocument.deleteMany();
  await database.knowledgeVersion.deleteMany();
  await database.knowledgeSource.deleteMany();

  const options = {
    database,
    repository,
    allowPrivateNetworks: true,
    crawlerStorageDir
  };

  try {
    const structuredSource = await repository.upsertSource({
      id: "source-e2e-structured",
      name: "结构化宝石数据源",
      sourceType: "OFFICIAL_API",
      baseUrl: `${base}/api/gemstones.json`,
      authorityScore: 0.9,
      allowedKnowledgeDomains: [
        "knowledge-domain:color-theory",
        "knowledge-domain:material-compatibility"
      ],
      language: "en",
      enabled: true
    });
    const staticSource = await repository.upsertSource({
      id: "source-e2e-static",
      name: "静态色彩理论页",
      sourceType: "STATIC_HTML",
      baseUrl: `${base}/articles/color-theory.html`,
      authorityScore: 0.75,
      allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
      language: "en",
      enabled: true
    });
    const multiPageSource = await repository.upsertSource({
      id: "source-e2e-multipage",
      name: "多页文章数据源",
      sourceType: "STATIC_HTML",
      baseUrl: `${base}/articles/index.html`,
      authorityScore: 0.7,
      allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
      language: "en",
      enabled: true
    });

    await t.test("first run discovers, fetches, parses, deduplicates, and extracts candidates", async () => {
      const structuredRun = await runIngestionPipeline(structuredSource, options);
      assert.equal(structuredRun.documents.length, 2);
      assert.equal(structuredRun.createdDocuments, 2);
      assert.equal(structuredRun.insertedCandidates, 3);
      for (const record of structuredRun.documents) {
        assert.match(record.url, /^https:\/\/fixtures.internal\//);
        assert.match(record.contentHash, /^[a-f0-9]{64}$/);
        assert.equal(record.parser, "structured-json-v1");
        assert.equal(record.status, "PARSED");
        assert.ok(record.documentId.length > 0);
      }
      const structuredRules = await repository.listRules({ status: "NEW" });
      assert.equal(structuredRules.filter((rule) => rule.sourceId === "source-e2e-structured").length, 3);
      for (const rule of structuredRules) {
        assert.ok(rule.sourceRefs.length >= 1);
      }

      const staticRun = await runIngestionPipeline(staticSource, options);
      assert.equal(staticRun.createdDocuments, 1);
      assert.equal(staticRun.duplicateDocuments, 0);
      assert.ok(
        staticRun.insertedCandidates >= 1,
        "free-text page with taxonomy vocabulary must yield NEEDS_REVIEW candidates"
      );
      const reviewRules = await repository.listRules({ status: "NEEDS_REVIEW" });
      assert.ok(reviewRules.length >= 1);
      assert.ok(reviewRules.every((rule) => rule.confidence <= 0.85));
      assert.ok(reviewRules.every((rule) => rule.relation !== "mentioned-with"));
      for (const rule of reviewRules) {
        const payload = rule.payload as { extraction?: { evidence?: unknown[] } };
        assert.ok(
          (payload.extraction?.evidence?.length ?? 0) >= 1,
          "free-text candidates carry sentence evidence (Q2)"
        );
      }

      const multiPageRun = await runIngestionPipeline(multiPageSource, options);
      const urls = multiPageRun.documents.map((record) => record.url).sort();
      assert.deepEqual(urls, [
        `${base}/articles/index.html`,
        `${base}/articles/part-1.html`,
        `${base}/articles/part-2.html`
      ]);
      assert.equal(
        urls.some((url) => url.includes("private-part")),
        false,
        "robots.txt Disallow must be respected"
      );
      assert.equal(multiPageRun.createdDocuments, 3);
    });

    await t.test("re-running creates no duplicate documents or rules", async () => {
      const structuredSecond = await runIngestionPipeline(structuredSource, options);
      assert.equal(structuredSecond.createdDocuments, 0);
      assert.equal(structuredSecond.duplicateDocuments, 2);
      assert.equal(structuredSecond.insertedCandidates, 0);
      assert.equal(structuredSecond.duplicateCandidates, 3);

      const staticSecond = await runIngestionPipeline(staticSource, options);
      assert.equal(staticSecond.createdDocuments, 0);
      assert.equal(staticSecond.duplicateDocuments, 1);
      assert.equal(staticSecond.insertedCandidates, 0);

      const multiPageSecond = await runIngestionPipeline(multiPageSource, options);
      assert.equal(multiPageSecond.createdDocuments, 0);
      assert.equal(multiPageSecond.duplicateDocuments, 3);

      const documentCount = await database.knowledgeDocument.count();
      const ruleCount = await database.knowledgeRule.count();
      assert.equal(documentCount, 6);
      assert.ok(ruleCount >= 4, `expected at least 4 rules, got ${ruleCount}`);
    });

    await t.test("SSRF guard blocks private networks unless explicitly allowed", async () => {
      const privateSource = await repository.upsertSource({
        id: "source-e2e-private",
        name: "内网源（应被拒绝）",
        sourceType: "OFFICIAL_API",
        baseUrl: `${base}/api/gemstones.json`,
        authorityScore: 0.5,
        allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
        language: "en",
        enabled: true
      });
      await assert.rejects(
        runIngestionPipeline(privateSource, { ...options, allowPrivateNetworks: false }),
        /PRIVATE_NETWORK_BLOCKED/
      );
    });
  } finally {
    await database.$disconnect();
    server.close();
    rmSync(crawlerStorageDir, { recursive: true, force: true });
  }
});
