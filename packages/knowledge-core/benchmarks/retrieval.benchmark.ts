/**
 * Hybrid retrieval benchmark (KNOWLEDGE_SYSTEM_SPEC section 14).
 *
 * Provisions a synthetic corpus of RECORD_COUNT knowledge documents + rules +
 * hash embeddings, then measures searchKnowledge latency. Run against a
 * disposable database:
 *
 *   DATABASE_URL=postgres://... pnpm bench:retrieval
 *
 * The corpus is isolated by id prefixes and cleaned at start, so the script
 * can be re-run repeatedly on the same database.
 */
import { performance } from "node:perf_hooks";

import {
  createPrismaClient,
  KnowledgeRepository,
  type DatabaseClient
} from "@mystcrag/database";

import { HashEmbeddingProvider, KnowledgeCore, vectorToPgLiteral } from "../src/index";

const RECORD_COUNT = Number(process.env.BENCH_RECORDS ?? 10_000);
const QUERY_COUNT = Number(process.env.BENCH_QUERIES ?? 100);
const MODEL_ID = "hash-256-v1";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the retrieval benchmark");
}

function digest(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (Math.imul(hash, 31) + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(64, "0");
}

async function main(): Promise<void> {
  const database: DatabaseClient = createPrismaClient(databaseUrl);
  await database.$connect();
  const repository = new KnowledgeRepository(database);
  const provider = new HashEmbeddingProvider();
  const core = new KnowledgeCore({ database, repository, embeddings: provider });

  console.log(`[bench] provisioning ${RECORD_COUNT} records...`);
  const provisionStart = performance.now();

  // Cleanup order respects FK Restrict: embeddings, rules, documents, version, source.
  await database.$executeRawUnsafe(`DELETE FROM "knowledge_embeddings" WHERE "document_id" LIKE 'bench-doc-%'`);
  await database.$executeRawUnsafe(`DELETE FROM "knowledge_rules" WHERE "id" LIKE 'bench-rule-%'`);
  await database.$executeRawUnsafe(`DELETE FROM "knowledge_documents" WHERE "id" LIKE 'bench-doc-%'`);
  // A previous run's publish may have attached unrelated rules to bench-kv.
  await database.$executeRawUnsafe(`UPDATE "knowledge_rules" SET "knowledge_version_id" = NULL WHERE "knowledge_version_id" = 'bench-kv'`);
  await database.knowledgeVersion.deleteMany({ where: { id: "bench-kv" } });
  await database.knowledgeSource.deleteMany({ where: { id: "bench-source" } });

  await repository.upsertSource({
    id: "bench-source",
    name: "benchmark corpus",
    sourceType: "MANUAL",
    authorityScore: 0.9,
    allowedKnowledgeDomains: ["knowledge-domain:color-theory", "knowledge-domain:material-compatibility"],
    language: "en",
    enabled: true
  });

  const documentRows: Array<{
    id: string;
    sourceId: string;
    url: string;
    urlNormalized: string;
    contentHash: string;
    title: string;
    contentText: string;
    fetchedAt: Date;
    parser: string;
    language: string;
    status: string;
  }> = [];
  const rulePayloads: Array<Record<string, unknown>> = [];
  for (let index = 0; index < RECORD_COUNT; index++) {
    const padded = String(index).padStart(6, "0");
    documentRows.push({
      id: `bench-doc-${padded}`,
      sourceId: "bench-source",
      url: `https://bench.example.com/doc-${padded}`,
      urlNormalized: `https://bench.example.com/doc-${padded}`,
      contentHash: digest(`bench-doc-${padded}`),
      title: `Benchmark note ${padded}`,
      contentText: `Benchmark topic${padded} crystal aesthetics harmony palette${padded} balance texture${index % 97}.`,
      fetchedAt: new Date(),
      parser: "benchmark",
      language: "en",
      status: "FETCHED"
    });
    rulePayloads.push({
      id: `bench-rule-${padded}`,
      sourceId: "bench-source",
      knowledgeType: index % 2 === 0 ? "COLOR_THEORY" : "MATERIAL_COMPATIBILITY",
      knowledgeDomain: index % 2 === 0 ? "knowledge-domain:color-theory" : "knowledge-domain:material-compatibility",
      subject: index % 2 === 0 ? `color:bench-${index % 200}` : `material:bench-${index % 200}`,
      relation: "harmonizes-with",
      payload: { topic: padded },
      conditions: {},
      confidence: 0.9,
      status: "APPROVED",
      fingerprint: digest(`bench-rule-${padded}`),
      sourceRefs: [{ sourceId: "bench-source", documentId: `bench-doc-${padded}` }],
      version: 1
    });
  }

  await database.knowledgeVersion.create({ data: { id: "bench-kv", version: "bench-knowledge-v1" } });
  const published = await repository.publishKnowledgeVersion("bench-kv");
  for (const rule of rulePayloads) {
    rule.knowledgeVersionId = published.id;
  }

  const DOCUMENT_BATCH = 500;
  for (let offset = 0; offset < documentRows.length; offset += DOCUMENT_BATCH) {
    await database.knowledgeDocument.createMany({
      data: documentRows.slice(offset, offset + DOCUMENT_BATCH) as never,
      skipDuplicates: true
    });
    await database.knowledgeRule.createMany({
      data: rulePayloads.slice(offset, offset + DOCUMENT_BATCH) as never,
      skipDuplicates: true
    });
  }

  const texts = documentRows.map((row) => `${row.title}\n${row.contentText}`);
  let embedded = 0;
  const EMBED_BATCH = 500;
  for (let offset = 0; offset < texts.length; offset += EMBED_BATCH) {
    const batch = texts.slice(offset, offset + EMBED_BATCH);
    const vectors = await provider.embed(batch);
    const values: string[] = [];
    const params: unknown[] = [];
    vectors.forEach((vector, vectorIndex) => {
      const row = documentRows[offset + vectorIndex];
      if (row === undefined) return;
      const base = params.length;
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector)`);
      params.push(`emb-${row.id}`, row.id, MODEL_ID, vectorToPgLiteral(vector));
    });
    await database.$executeRawUnsafe(
      `INSERT INTO "knowledge_embeddings" ("id", "document_id", "model", "embedding")
       VALUES ${values.join(", ")}
       ON CONFLICT ("document_id", "model") DO UPDATE SET "embedding" = EXCLUDED."embedding"`,
      ...params
    );
    embedded += batch.length;
  }

  const provisionMs = performance.now() - provisionStart;
  console.log(`[bench] provisioned ${embedded} embeddings in ${(provisionMs / 1000).toFixed(1)}s`);

  console.log(`[bench] running ${QUERY_COUNT} hybrid queries...`);
  const durations: number[] = [];
  for (let index = 0; index < QUERY_COUNT; index++) {
    const topic = String((index * 97) % RECORD_COUNT).padStart(6, "0");
    const start = performance.now();
    const result = await core.searchKnowledge({
      text: `topic${topic} palette${topic}`,
      knowledgeDomains: [
        index % 2 === 0 ? "knowledge-domain:color-theory" : "knowledge-domain:material-compatibility"
      ],
      limit: 20
    });
    const elapsed = performance.now() - start;
    if (result.hits.length === 0) {
      throw new Error(`query ${index} returned no hits`);
    }
    durations.push(elapsed);
  }

  durations.sort((left, right) => left - right);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const max = durations[durations.length - 1];
  console.log(
    `[bench] retrieval ${RECORD_COUNT} records: p50=${p50?.toFixed(1)}ms p95=${p95?.toFixed(1)}ms max=${max?.toFixed(1)}ms (n=${durations.length})`
  );

  await database.$disconnect();
}

await main();
