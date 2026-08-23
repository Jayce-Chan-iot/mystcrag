import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { KnowledgeRule } from "@mystcrag/design-contract";
import {
  createPrismaClient,
  KnowledgeRepository,
  PersistenceError,
  type DatabaseClient
} from "@mystcrag/database";

import { KnowledgeCore } from "../src/knowledge-core.js";
import { ruleFingerprint } from "../src/review/rules.js";
import { KnowledgeReviewService } from "../src/review/review-service.js";
import { KNOWLEDGE_CORPUS_FIXTURES } from "../src/fixtures/corpus-bootstrap.js";

const databaseUrl = process.env.DATABASE_URL;

function candidateRule(input: {
  id: string;
  subject?: string;
  relation?: string;
  payload?: KnowledgeRule["payload"];
  confidence?: number;
  status?: "NEW" | "EXTRACTED";
  sourceId?: string;
  knowledgeType?: KnowledgeRule["knowledgeType"];
  knowledgeDomain?: string;
  claimType?: KnowledgeRule["claimType"];
}) {
  const knowledgeType = input.knowledgeType ?? "COLOR_THEORY";
  const subject = input.subject ?? "color:blue";
  const relation = input.relation ?? "harmonizes-with";
  const payload = input.payload ?? { companionColors: ["color:teal"] };
  return {
    id: input.id,
    knowledgeType,
    knowledgeDomain:
      input.knowledgeDomain ??
      (knowledgeType === "COLOR_THEORY"
        ? "knowledge-domain:color-theory"
        : knowledgeType === "MATERIAL_COMPATIBILITY"
          ? "knowledge-domain:material-compatibility"
          : "knowledge-domain:style-rule"),
    subject,
    relation,
    payload,
    conditions: {},
    confidence: input.confidence ?? 0.9,
    // External-source candidates must declare a claim grade before review
    // (task book §12); a design claim needs no second source to validate.
    claimType: input.claimType ?? "DESIGN_PRINCIPLE",
    status: input.status ?? "EXTRACTED",
    sourceRefs: [{ sourceId: input.sourceId ?? "source-review-test", documentId: "doc-review-test" }],
    version: 1,
    fingerprint: ruleFingerprint(knowledgeType, subject, relation, payload),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceId: input.sourceId ?? "source-review-test"
  };
}

test("knowledge review service runs the review chain end to end", { skip: !databaseUrl }, async (t) => {
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

  await repository.upsertSource({
    id: "source-review-test",
    name: "审核链路测试源",
    sourceType: "OFFICIAL_API",
    authorityScore: 0.9,
    allowedKnowledgeDomains: [
      "knowledge-domain:color-theory",
      "knowledge-domain:material-compatibility",
      "knowledge-domain:style-rule"
    ],
    language: "zh-CN",
    enabled: true
  });
  await repository.upsertDocument({
    id: "doc-review-test",
    sourceId: "source-review-test",
    url: "https://fixtures.mystcrag.internal/review-test",
    contentHash: createHash("sha256").update("doc-review-test").digest("hex"),
    title: "审核链路测试文档",
    contentText: "Review chain evidence document for candidate rules.",
    fetchedAt: new Date().toISOString(),
    parser: "fixture",
    language: "zh-CN",
    status: "PARSED"
  });

  await t.test("importFixtureCorpus seeds the reviewed corpus as APPROVED rules", async () => {
    const summary = await review.importFixtureCorpus();
    assert.equal(summary.sources, 3);
    assert.equal(summary.documents, 3);
    assert.equal(summary.rules, KNOWLEDGE_CORPUS_FIXTURES.length);
    assert.ok(summary.rules >= 500, `expected >= 500 corpus rules, got ${summary.rules}`);
    const rules = await repository.listRules({ status: "APPROVED", limit: 2000 });
    assert.equal(rules.length, KNOWLEDGE_CORPUS_FIXTURES.length);
  });

  await t.test("importFixtureCorpus is idempotent on re-import", async () => {
    const summary = await review.importFixtureCorpus();
    assert.equal(summary.rules, KNOWLEDGE_CORPUS_FIXTURES.length);
    const rules = await repository.listRules({ status: "APPROVED", limit: 2000 });
    assert.equal(rules.length, KNOWLEDGE_CORPUS_FIXTURES.length);
  });

  await t.test("publishVersion snapshots APPROVED rules into a production knowledge version", async () => {
    const version = await review.publishVersion("fixture-corpus-v1");
    assert.equal(version.status, "PUBLISHED");
    assert.equal(version.version, "fixture-corpus-v1");
    assert.ok(
      version.ruleCount >= KNOWLEDGE_CORPUS_FIXTURES.length - 5,
      `ruleCount=${version.ruleCount}`
    );
    const latest = await repository.getLatestPublishedVersion();
    assert.equal(latest?.version, "fixture-corpus-v1");
  });

  await t.test("E2E-2 retrieval answers the amethyst cool low-saturation query with evidenced APPROVED rules", async () => {
    const result = await core.searchKnowledge({
      subjects: ["material:quartz", "color:purple", "temperature:cool"],
      limit: 50
    });
    assert.equal(result.knowledgeVersion, "fixture-corpus-v1");
    assert.ok(result.hits.length >= 5, `expected >= 5 hits, got ${result.hits.length}`);
    for (const hit of result.hits) {
      assert.equal(hit.rule.status, "APPROVED");
      assert.ok(hit.rule.sourceRefs.length >= 1);
      assert.ok(hit.score > 0);
    }
    const types = new Set(result.hits.map((hit) => hit.rule.knowledgeType));
    assert.ok(types.has("COLOR_THEORY"));
    assert.ok(types.has("MATERIAL_COMPATIBILITY"));
  });

  await t.test("runReviewPipeline classifies extracted candidates by confidence, authority and validity", async () => {
    // These candidate keys are deliberately absent from the fixture corpus
    // (core + bootstrap layers) so they cannot collide with APPROVED rules
    // and get conflict-flagged.
    await repository.insertRule(
      candidateRule({
        id: "cand-auto-validated",
        subject: "color:white",
        relation: "harmonizes-with",
        payload: { companionColors: ["color:teal"] },
        confidence: 0.9,
        status: "EXTRACTED"
      })
    );
    await repository.insertRule(
      candidateRule({
        id: "cand-low-confidence",
        subject: "color:white",
        relation: "contrasts-in-value",
        payload: { contrastColors: ["color:black"] },
        confidence: 0.5,
        status: "EXTRACTED"
      })
    );
    await repository.insertRule(
      candidateRule({
        id: "cand-new-status",
        subject: "color:white",
        relation: "suits-style",
        payload: { styles: ["style:minimal"] },
        status: "NEW"
      })
    );
    await repository.insertRule(
      candidateRule({
        id: "cand-invalid-subject",
        subject: "color:bogus",
        payload: { companionColors: ["color:white"] },
        status: "EXTRACTED"
      })
    );

    const summary = await review.runReviewPipeline();
    assert.ok(summary.validated >= 1);
    assert.ok(summary.needsReview >= 1);
    assert.ok(summary.extracted >= 1);

    assert.equal((await repository.getRule("cand-auto-validated")).status, "VALIDATED");
    assert.equal((await repository.getRule("cand-low-confidence")).status, "NEEDS_REVIEW");
    // NEW rules are first promoted to EXTRACTED, then classified in the same
    // run; high confidence from an authoritative source auto-validates.
    assert.equal((await repository.getRule("cand-new-status")).status, "VALIDATED");
    assert.equal((await repository.getRule("cand-invalid-subject")).status, "NEEDS_REVIEW");
  });

  await t.test("runReviewPipeline merges canonically equal facts into one corroborated rule", async () => {
    await repository.upsertSource({
      id: "source-gemdat-test",
      name: "GemDat test source",
      sourceType: "STATIC_HTML",
      authorityScore: 0.85,
      allowedKnowledgeDomains: ["knowledge-domain:crystal-gemology"],
      language: "en",
      enabled: true
    });
    await repository.upsertSource({
      id: "source-wiki-test",
      name: "Wikipedia test source",
      sourceType: "STATIC_HTML",
      authorityScore: 0.9,
      allowedKnowledgeDomains: ["knowledge-domain:crystal-gemology"],
      language: "en",
      enabled: true
    });
    const gemFact = (id: string, value: string, sourceId: string) =>
      candidateRule({
        id,
        knowledgeType: "CRYSTAL_GEMOLOGY",
        knowledgeDomain: "knowledge-domain:crystal-gemology",
        subject: "material:agate",
        relation: "has-property",
        payload: { property: "mohsHardness", value },
        confidence: 0.85,
        claimType: "GEMOLOGICAL_FACT",
        sourceId
      });
    // Same hardness fact, two sources, two surface formats (§19).
    await repository.insertRule(gemFact("cand-gemdat-hardness", "6.5–7", "source-gemdat-test"));
    await repository.insertRule(gemFact("cand-wiki-hardness", "6.5 to 7", "source-wiki-test"));

    const summary = await review.runReviewPipeline();
    assert.equal(summary.merged, 1);

    const primary = await repository.getRule("cand-gemdat-hardness");
    assert.equal(primary.status, "VALIDATED");
    assert.equal(
      primary.sourceRefs.length,
      2,
      "the corroborated primary accumulates both independent sources"
    );
    assert.equal((await repository.getRule("cand-wiki-hardness")).status, "SUPERSEDED");
  });

  await t.test("runReviewPipeline marks divergent same-key candidates CONFLICTED and leaves APPROVED rules stable", async () => {
    await repository.insertRule(
      candidateRule({
        id: "cand-conflict-a",
        subject: "color:white",
        relation: "pairs-with",
        payload: { companionColors: ["color:silver"] },
        status: "EXTRACTED"
      })
    );
    await repository.insertRule(
      candidateRule({
        id: "cand-conflict-b",
        subject: "color:white",
        relation: "pairs-with",
        payload: { companionColors: ["color:gold"] },
        status: "EXTRACTED"
      })
    );
    // Conflicts with an APPROVED fixture rule on the same key.
    const approvedBefore = await repository.listRules({
      status: "APPROVED",
      subject: "color:blue",
      limit: 5
    });
    assert.ok(approvedBefore.length >= 1);
    await repository.insertRule(
      candidateRule({
        id: "cand-conflict-approved",
        subject: "color:blue",
        relation: "harmonizes-with",
        payload: { companionColors: ["color:brown"] },
        status: "EXTRACTED"
      })
    );

    const summary = await review.runReviewPipeline();
    assert.ok(summary.conflicted >= 3, `expected >= 3 conflicted, got ${summary.conflicted}`);

    assert.equal((await repository.getRule("cand-conflict-a")).status, "CONFLICTED");
    assert.equal((await repository.getRule("cand-conflict-b")).status, "CONFLICTED");
    assert.equal((await repository.getRule("cand-conflict-approved")).status, "CONFLICTED");
    for (const rule of approvedBefore) {
      assert.equal((await repository.getRule(rule.id)).status, "APPROVED");
    }
  });

  await t.test("listConflictGroups returns only groups that involve a non-APPROVED rule", async () => {
    const groups = await review.listConflictGroups();
    assert.ok(groups.length >= 1);
    for (const group of groups) {
      const statuses = group.rules.map((rule) => rule.status);
      assert.ok(
        statuses.some((status) => status !== "APPROVED"),
        `group ${group.key.subject} should involve a candidate rule`
      );
    }
    const conflictGroup = groups.find((group) =>
      group.rules.some((rule) => rule.id === "cand-conflict-approved")
    );
    assert.ok(conflictGroup !== undefined);
    assert.ok(
      conflictGroup.rules.some((rule) => rule.status === "APPROVED"),
      "the conflicting approved rule must stay visible in the group"
    );
  });

  await t.test("listReviewQueue returns rules with source and document evidence plus validation issues", async () => {
    const queue = await review.listReviewQueue({ status: "NEEDS_REVIEW" });
    const invalid = queue.find((item) => item.rule.id === "cand-invalid-subject");
    assert.ok(invalid !== undefined);
    assert.ok(invalid.validation.issues.length >= 1);
    assert.ok(invalid.validation.valid === false);
    assert.ok(
      invalid.evidence.some(
        (entry) => entry.source.id === "source-review-test" && entry.document?.id === "doc-review-test"
      ),
      "evidence must join the source and the document"
    );

    const conflicted = await review.listReviewQueue({ status: "CONFLICTED" });
    assert.ok(conflicted.length >= 3);
  });

  await t.test("approve, reject and supersede drive the state machine", async () => {
    const approved = await review.approveRule("cand-low-confidence");
    assert.equal(approved.status, "APPROVED");

    await repository.insertRule(
      candidateRule({
        id: "cand-rejected",
        subject: "color:brown",
        payload: { companionColors: ["color:yellow"] },
        status: "EXTRACTED"
      })
    );
    await review.runReviewPipeline();
    const rejected = await review.rejectRule("cand-rejected");
    assert.equal(rejected.status, "REJECTED");

    // Approving a CONFLICTED rule chains through NEEDS_REVIEW.
    const resolved = await review.approveRule("cand-conflict-a");
    assert.equal(resolved.status, "APPROVED");

    const superseded = await review.supersedeRule("cand-conflict-b");
    assert.equal(superseded.status, "SUPERSEDED");
  });

  await t.test("review actions reject illegal transitions with persistence conflicts", async () => {
    await assert.rejects(
      () => review.approveRule("cand-rejected"),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
    // cand-conflict-b was already superseded in the previous step; a retired
    // rule has no outgoing transitions left.
    await assert.rejects(
      () => review.supersedeRule("cand-conflict-b"),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
    // Superseding a live candidate is a legal retirement path (§19 merge retires
    // secondaries the same way).
    const retired = await review.supersedeRule("cand-auto-validated");
    assert.equal(retired.status, "SUPERSEDED");
  });

  await database.$disconnect();
});
