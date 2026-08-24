import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrismaClient,
  KnowledgeRepository,
  type DatabaseClient
} from "@mystcrag/database";

import { HashEmbeddingProvider, KnowledgeCore } from "../src/index";

const databaseUrl = process.env.DATABASE_URL;

const CORPUS_SIZE = 60;
const GOLDEN_QUERY_COUNT = 50;

function sha256Hex(input: string): string {
  // Small deterministic digest for unique content hashes in tests.
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (Math.imul(hash, 31) + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(64, "0");
}

test("knowledge-core hybrid retrieval verification", { skip: !databaseUrl }, async (t) => {
  const database: DatabaseClient = createPrismaClient(databaseUrl);
  await database.$connect();
  const repository = new KnowledgeRepository(database);
  const core = new KnowledgeCore({
    database,
    repository,
    embeddings: new HashEmbeddingProvider()
  });

  // Isolate the run.
  await database.$executeRawUnsafe(`DELETE FROM "knowledge_embeddings"`);
  await database.knowledgeRule.deleteMany();
  await database.knowledgeDocument.deleteMany();
  await database.knowledgeVersion.deleteMany();
  await database.knowledgeSource.deleteMany();

  await repository.upsertSource({
    id: "source-retrieval-corpus",
    name: "检索回归语料",
    sourceType: "MANUAL",
    authorityScore: 0.9,
    allowedKnowledgeDomains: ["knowledge-domain:color-theory", "knowledge-domain:material-compatibility"],
    language: "en",
    enabled: true
  });

  // Corpus: one document + one APPROVED rule per topic index, plus a Chinese
  // document that English FTS cannot tokenize (vector-channel demonstration).
  for (let index = 0; index < CORPUS_SIZE; index++) {
    const paddedIndex = String(index).padStart(2, "0");
    await repository.upsertDocument({
      id: `doc-topic-${paddedIndex}`,
      sourceId: "source-retrieval-corpus",
      url: `https://corpus.example.com/topic-${paddedIndex}`,
      contentHash: sha256Hex(`doc-topic-${paddedIndex}`),
      title: `Design note topic${paddedIndex}`,
      contentText: `Topic${paddedIndex} covers crystal aesthetics keywords unique${paddedIndex} harmony balance.`,
      fetchedAt: "2026-08-20T10:00:00+08:00",
      parser: "manual-corpus",
      language: "en",
      status: "FETCHED"
    });
    await repository.insertRule({
      id: `rule-topic-${paddedIndex}`,
      sourceId: "source-retrieval-corpus",
      knowledgeType: index % 2 === 0 ? "COLOR_THEORY" : "MATERIAL_COMPATIBILITY",
      knowledgeDomain: index % 2 === 0 ? "knowledge-domain:color-theory" : "knowledge-domain:material-compatibility",
      subject: index % 2 === 0 ? `color:${paddedIndex}` : `material:${paddedIndex}`,
      relation: "harmonizes-with",
      payload: { topic: paddedIndex },
      conditions: {},
      confidence: 0.9,
      status: "APPROVED",
      sourceRefs: [{ sourceId: "source-retrieval-corpus", documentId: `doc-topic-${paddedIndex}` }],
      version: 1,
      fingerprint: sha256Hex(`rule-topic-${paddedIndex}`),
      createdAt: "2026-08-20T10:00:00+08:00",
      updatedAt: "2026-08-20T10:00:00+08:00"
    });
  }

  await repository.upsertDocument({
    id: "doc-zh-moonstone",
    sourceId: "source-retrieval-corpus",
    url: "https://corpus.example.com/zh-moonstone",
    contentHash: sha256Hex("doc-zh-moonstone"),
    title: "月光石温润",
    contentText: "月光石 温润 白色 微光",
    fetchedAt: "2026-08-20T10:00:00+08:00",
    parser: "manual-corpus",
    language: "zh-CN",
    status: "FETCHED"
  });
  await repository.insertRule({
    id: "rule-zh-moonstone",
    sourceId: "source-retrieval-corpus",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:white",
    relation: "harmonizes-with",
    payload: { zh: true },
    conditions: {},
    confidence: 0.9,
    status: "APPROVED",
    sourceRefs: [{ sourceId: "source-retrieval-corpus", documentId: "doc-zh-moonstone" }],
    version: 1,
    fingerprint: sha256Hex("rule-zh-moonstone"),
    createdAt: "2026-08-20T10:00:00+08:00",
    updatedAt: "2026-08-20T10:00:00+08:00"
  });

  await repository.createKnowledgeVersion("kv-retrieval-test", "knowledge-retrieval-test-v1");
  await repository.publishKnowledgeVersion("kv-retrieval-test");

  const embeddingIndex = await core.indexEmbeddings(1000);
  assert.equal(embeddingIndex.indexed, CORPUS_SIZE + 1);

  await t.test("structured search filters production rules deterministically", async () => {
    const result = await core.searchKnowledge({
      knowledgeTypes: ["COLOR_THEORY"],
      subjects: Array.from({ length: CORPUS_SIZE / 2 }, (_, index) => `color:${String(index * 2).padStart(2, "0")}`),
      limit: 10
    });
    assert.equal(result.knowledgeVersion, "knowledge-retrieval-test-v1");
    assert.equal(result.strategy, "structured");
    assert.equal(result.hits.length, 10);
    assert.ok(result.hits.every((hit) => hit.channels.structured));
  });

  await t.test("keyword and vector channels fuse into a hybrid result", async () => {
    const result = await core.searchKnowledge({ text: "topic07 unique07", limit: 10 });
    assert.equal(result.strategy, "hybrid");
    assert.equal(result.hits[0]?.rule.id, "rule-topic-07");
    const top = result.hits[0];
    assert.ok(top);
    assert.equal(top.channels.keyword, true);
    assert.equal(top.channels.vector, true);
  });

  await t.test("Chinese queries reach zh documents through the vector channel", async () => {
    const result = await core.searchKnowledge({ text: "月光石", limit: 10 });
    const zhHit = result.hits.find((hit) => hit.rule.id === "rule-zh-moonstone");
    assert.ok(zhHit, "zh rule should be retrieved via CJK-bigram hash embeddings");
    assert.equal(zhHit.channels.vector, true);
  });

  await t.test("retrieval degrades to structured + keyword without an embedding provider", async () => {
    const degraded = new KnowledgeCore({ database, repository });
    const result = await degraded.searchKnowledge({ text: "topic07 unique07", limit: 10 });
    assert.equal(result.strategy, "keyword");
    assert.equal(result.hits[0]?.rule.id, "rule-topic-07");
  });

  await t.test("golden query set: 50 queries each rank their topic rule first", async () => {
    for (let index = 0; index < GOLDEN_QUERY_COUNT; index++) {
      const paddedIndex = String(index).padStart(2, "0");
      const result = await core.searchKnowledge({ text: `topic${paddedIndex} unique${paddedIndex}`, limit: 3 });
      const top = result.hits[0]?.rule.id;
      assert.equal(
        top,
        `rule-topic-${paddedIndex}`,
        `golden query ${paddedIndex} expected rule-topic-${paddedIndex}, got ${top}`
      );
    }
  });

  await t.test("query facades return typed production rule sets", async () => {
    const colorRules = await core.getColorRules("color:white");
    assert.ok(colorRules.some((rule) => rule.id === "rule-zh-moonstone"));

    const compatibility = await core.getMaterialCompatibility("material:01");
    assert.deepEqual(
      compatibility.map((rule) => rule.id),
      ["rule-topic-01"]
    );

    const formula = await core.getDesignFormula();
    assert.equal(formula.length, 0);
  });

  await database.$disconnect();
});
