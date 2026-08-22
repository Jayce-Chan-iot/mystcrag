import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrismaClient,
  KnowledgeRepository,
  type DatabaseClient
} from "@mystcrag/database";

import { KnowledgeCore } from "../src/knowledge-core.js";
import { KnowledgeReviewService } from "../src/review/review-service.js";
import { KNOWLEDGE_CORPUS_FIXTURES } from "../src/fixtures/corpus-bootstrap.js";

const databaseUrl = process.env.DATABASE_URL;

function extractSubjectRefs(): string[] {
  const refs = new Set<string>();
  for (const rule of KNOWLEDGE_CORPUS_FIXTURES) {
    // Compound subjects (a+b) must be feasible as a whole, and every part
    // must be feasible for single-subject rules.
    refs.add(rule.subject);
    for (const part of rule.subject.split("+")) {
      refs.add(part);
    }
  }
  return [...refs].sort();
}

test("rule compiler integration against the published fixture corpus", { skip: !databaseUrl }, async (t) => {
  const database: DatabaseClient = createPrismaClient(databaseUrl!);
  await database.$connect();
  const repository = new KnowledgeRepository(database);
  const review = new KnowledgeReviewService({ database, repository });
  const core = new KnowledgeCore({ database, repository });

  await database.$executeRawUnsafe(`DELETE FROM "knowledge_embeddings"`);
  await database.knowledgeRule.deleteMany();
  await database.knowledgeDocument.deleteMany();
  await database.knowledgeVersion.deleteMany();
  await database.knowledgeSource.deleteMany();

  await review.importFixtureCorpus();
  await review.publishVersion("compiler-test-v1");

  const catalog = {
    productCatalogVersion: "catalog-fixture-v1",
    availableTaxonomyRefs: extractSubjectRefs()
  };

  await t.test("compiles the published corpus into prioritized active rules", async () => {
    const compiled = await core.compileActiveRules(catalog);

    assert.equal(compiled.knowledgeVersion, "compiler-test-v1");
    assert.equal(compiled.productCatalogVersion, "catalog-fixture-v1");
    assert.ok(
      compiled.rules.length >= 450,
      `expected >= 450 rules from the 500+ corpus, got ${compiled.rules.length}`
    );

    const priorities = compiled.rules.map((rule) => rule.priority);
    const rankOf = (priority: string) => Number(priority.slice(1));
    const ranks = priorities.map(rankOf);
    for (let index = 1; index < ranks.length; index += 1) {
      assert.ok(ranks[index - 1]! <= ranks[index]!, "rules must be sorted by priority");
    }

    assert.ok(compiled.rules.some((rule) => rule.hardness === "HARD"));
    assert.ok(
      compiled.rules.every((rule) => rule.knowledgeRefs.length === 1),
      "every active rule cites its knowledge source rule"
    );
    assert.ok(
      compiled.rules.every((rule) => rule.conditions !== undefined && rule.action.kind.length > 0)
    );
  });

  await t.test("compilation is deterministic across 100 runs and cached results are identical", async () => {
    const first = await core.compileActiveRules(catalog);
    const baseline = JSON.stringify(first);
    for (let run = 0; run < 100; run += 1) {
      assert.equal(JSON.stringify(await core.compileActiveRules(catalog)), baseline);
    }
  });

  await t.test("scope compilation restricts to requested knowledge types", async () => {
    const compiled = await core.compileActiveRules(catalog, {
      scope: { knowledgeTypes: ["TAROT"] }
    });
    assert.ok(compiled.rules.length > 0);
    assert.ok(
      compiled.rules.every((rule) => rule.type === "TAROT")
    );
    assert.ok(
      compiled.rules.every((rule) => rule.priority === "P6"),
      "tarot knowledge compiles at P6 per the task-book ladder"
    );
  });

  await t.test("an empty catalog feasibility snapshot drops material and color rules", async () => {
    const compiled = await core.compileActiveRules({
      productCatalogVersion: "catalog-empty-v1",
      availableTaxonomyRefs: []
    });
    const conditionSubjects = compiled.rules
      .map((rule) =>
        "value" in rule.conditions && typeof rule.conditions.value === "string"
          ? rule.conditions.value
          : null
      )
      .filter((value): value is string => value !== null);
    assert.ok(
      conditionSubjects.every(
        (subject) => !subject.startsWith("material:") && !subject.startsWith("color:")
      ),
      "no rule may depend on a catalog-absent material or color subject"
    );
    assert.ok(compiled.stats.infeasible > 0);
  });

  await database.$disconnect();
});
