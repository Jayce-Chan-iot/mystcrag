import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgeDocument, KnowledgeRule, KnowledgeSource } from "@mystcrag/design-contract";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import {
  KnowledgeRepository,
  normalizeKnowledgeUrl
} from "./knowledge.repository.js";

const databaseUrl = process.env.DATABASE_URL;

function sourceFixture(id: string, overrides?: Partial<KnowledgeSource>): KnowledgeSource {
  return {
    id,
    name: `色彩设计参考 ${id}`,
    sourceType: "STATIC_HTML",
    baseUrl: "https://books.example.com",
    authorityScore: 0.8,
    allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
    language: "zh-CN",
    enabled: false,
    ...overrides
  } as KnowledgeSource;
}

function documentFixture(
  id: string,
  sourceId: string,
  contentHash: string,
  overrides?: Partial<KnowledgeDocument>
): KnowledgeDocument {
  return {
    id,
    sourceId,
    url: `https://books.example.com/color-theory/${id}`,
    contentHash,
    title: `Color theory chapter ${id}`,
    contentText: "Analogous hues sit adjacent on the color wheel and share a calm undertone.",
    fetchedAt: "2026-08-20T10:00:00+08:00",
    parser: "static-html-basic",
    language: "en",
    status: "FETCHED",
    ...overrides
  } as KnowledgeDocument;
}

function ruleFixture(
  id: string,
  sourceId: string,
  documentId: string,
  fingerprint: string,
  overrides?: Partial<KnowledgeRule>
): KnowledgeRule & { sourceId: string } {
  return {
    id,
    sourceId,
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:blue",
    relation: "harmonizes-with",
    payload: { neighborHueStepDegrees: 30 },
    conditions: {},
    confidence: 0.8,
    status: "NEW",
    sourceRefs: [{ sourceId, documentId }],
    version: 1,
    fingerprint,
    createdAt: "2026-08-20T10:00:00+08:00",
    updatedAt: "2026-08-20T10:00:00+08:00",
    ...overrides
  } as KnowledgeRule & { sourceId: string };
}

test("knowledge storage lifecycle verification matrix", { skip: !databaseUrl }, async (t) => {
  const prisma = createPrismaClient(databaseUrl);
  await prisma.$connect();
  const repository = new KnowledgeRepository(prisma);

  // Isolate the run on shared local databases.
  await prisma.knowledgeRule.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.knowledgeVersion.deleteMany();
  await prisma.knowledgeSource.deleteMany();

  await t.test("sources register disabled and can be enabled", async () => {
    const created = await repository.upsertSource(sourceFixture("source-color-book"));
    assert.equal(created.enabled, false);

    await repository.setSourceEnabled("source-color-book", true);
    const enabled = await repository.getSource("source-color-book");
    assert.equal(enabled.enabled, true);

    const disabled = await repository.upsertSource(sourceFixture("source-tarot-manual", {
      name: "塔罗意象手册",
      allowedKnowledgeDomains: ["knowledge-domain:tarot"],
      sourceType: "MANUAL"
    }));
    assert.equal(disabled.enabled, false);

    const enabledOnly = await repository.listSources({ enabledOnly: true });
    assert.deepEqual(enabledOnly.map((source) => source.id), ["source-color-book"]);
  });

  await t.test("documents deduplicate by content hash, not by URL", async () => {
    const first = await repository.upsertDocument(
      documentFixture("doc-ch3", "source-color-book", "a".repeat(64))
    );
    assert.equal(first.created, true);

    const duplicate = await repository.upsertDocument(
      documentFixture("doc-ch3-copy", "source-color-book", "a".repeat(64), {
        url: "https://books.example.com/other-page"
      })
    );
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.document.id, "doc-ch3");

    const revised = await repository.upsertDocument(
      documentFixture("doc-ch3-v2", "source-color-book", "b".repeat(64), {
        url: "https://books.example.com/color-theory/doc-ch3"
      })
    );
    assert.equal(revised.created, true);
    assert.equal(revised.document.urlNormalized, revised.document.url);

    const total = await prisma.knowledgeDocument.count();
    assert.equal(total, 2);
  });

  await t.test("url normalization strips fragments and trailing slashes", () => {
    assert.equal(
      normalizeKnowledgeUrl("https://Books.example.com/ch3/?utm=1#section"),
      "https://books.example.com/ch3?utm=1"
    );
  });

  await t.test("claimType survives insert and read-back (Batch B gem facts)", async () => {
    await repository.insertRule(
      ruleFixture("rule-claim-type", "source-color-book", "doc-ch3", "9".repeat(64), {
        claimType: "GEMOLOGICAL_FACT"
      })
    );
    const stored = await repository.getRule("rule-claim-type");
    assert.equal(stored.claimType, "GEMOLOGICAL_FACT");

    await repository.insertRule(
      ruleFixture("rule-no-claim-type", "source-color-book", "doc-ch3", "8".repeat(64), {
        subject: "color:violet"
      })
    );
    const bare = await repository.getRule("rule-no-claim-type");
    assert.equal(bare.claimType, undefined);
  });

  await t.test("rules require resolvable provenance and unique fingerprints", async () => {
    await assert.rejects(
      repository.insertRule(ruleFixture("rule-broken", "source-color-book", "doc-missing", "c".repeat(64))),
      (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
    );

    await repository.insertRule(
      ruleFixture("rule-adjacent-blue", "source-color-book", "doc-ch3", "d".repeat(64))
    );
    await assert.rejects(
      repository.insertRule(
        ruleFixture("rule-adjacent-blue-duplicate", "source-color-book", "doc-ch3", "d".repeat(64))
      ),
      (error: unknown) => error instanceof PersistenceError && error.code === "DUPLICATE_KNOWLEDGE"
    );
  });

  await t.test("the status machine rejects illegal jumps and accepts the review path", async () => {
    await repository.insertRule(
      ruleFixture("rule-review-path", "source-color-book", "doc-ch3", "e".repeat(64))
    );

    await assert.rejects(
      repository.transitionRule("rule-review-path", "APPROVED"),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );

    for (const next of ["EXTRACTED", "VALIDATED", "NEEDS_REVIEW", "APPROVED"] as const) {
      const rule = await repository.transitionRule("rule-review-path", next);
      assert.equal(rule.status, next);
    }

    await assert.rejects(
      repository.transitionRule("rule-review-path", "NEW"),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
  });

  await t.test("only versioned APPROVED rules reach production", async () => {
    const empty = await repository.getProductionKnowledge();
    assert.equal(empty.rules.length, 0);

    // A rejected rule and a conflicted rule must never reach production.
    await repository.insertRule(
      ruleFixture("rule-rejected", "source-color-book", "doc-ch3", "f".repeat(64), {
        subject: "color:red",
        status: "NEEDS_REVIEW"
      })
    );
    await repository.transitionRule("rule-rejected", "REJECTED");

    await repository.insertRule(
      ruleFixture("rule-conflicted", "source-color-book", "doc-ch3", "0".repeat(64), {
        subject: "color:green",
        status: "NEEDS_REVIEW"
      })
    );
    await repository.transitionRule("rule-conflicted", "CONFLICTED");

    // An approved-but-unpublished rule is not production yet.
    await repository.insertRule(
      ruleFixture("rule-approved-late", "source-color-book", "doc-ch3", "1".repeat(64), {
        subject: "color:white",
        status: "NEEDS_REVIEW"
      })
    );
    await repository.transitionRule("rule-approved-late", "APPROVED");

    await repository.createKnowledgeVersion("kv-2026-08", "knowledge-2026-08-v1");
    const published = await repository.publishKnowledgeVersion("kv-2026-08");
    assert.equal(published.status, "PUBLISHED");
    assert.equal(published.ruleCount, 2);

    const production = await repository.getProductionKnowledge();
    assert.equal(production.knowledgeVersion, "knowledge-2026-08-v1");
    assert.deepEqual(
      production.rules.map((rule) => rule.id),
      ["rule-approved-late", "rule-review-path"]
    );

    for (const rule of production.rules) {
      assert.equal(rule.status, "APPROVED");
      assert.notEqual(rule.knowledgeVersionId, null);
      for (const ref of rule.sourceRefs) {
        const source = await repository.getSource(ref.sourceId);
        assert.equal(source.id, ref.sourceId);
        if (ref.documentId !== undefined) {
          const document = await repository.getDocument(ref.documentId);
          assert.equal(document.id, ref.documentId);
        }
      }
    }
  });

  await t.test("republishing retires the previous version and captures late approvals", async () => {
    // rule-adjacent-blue is approved only after v1 was published; v2 must capture it.
    for (const next of ["EXTRACTED", "VALIDATED", "NEEDS_REVIEW", "APPROVED"] as const) {
      await repository.transitionRule("rule-adjacent-blue", next);
    }

    await repository.createKnowledgeVersion("kv-2026-09", "knowledge-2026-09-v1");
    const published = await repository.publishKnowledgeVersion("kv-2026-09");
    assert.equal(published.ruleCount, 3);

    const production = await repository.getProductionKnowledge();
    assert.equal(production.knowledgeVersion, "knowledge-2026-09-v1");
    assert.deepEqual(
      production.rules.map((rule) => rule.id),
      ["rule-adjacent-blue", "rule-approved-late", "rule-review-path"]
    );

    const retired = await repository.getLatestPublishedVersion();
    assert.equal(retired?.status, "PUBLISHED");

    const versions = await prisma.knowledgeVersion.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(
      versions.map((version) => version.status),
      ["RETIRED", "PUBLISHED"]
    );

    await assert.rejects(
      repository.publishKnowledgeVersion("kv-2026-09"),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
  });

  await t.test("english full-text search finds indexed documents deterministically", async () => {
    await repository.upsertDocument(
      documentFixture("doc-fts-labradorite", "source-color-book", "2".repeat(64), {
        title: "Labradorite flash and gray undertones",
        contentText: "Labradorite shows an iridescent blue flash over a gray base."
      })
    );

    const hits = await repository.searchDocuments("labradorite flash");
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.documentId, "doc-fts-labradorite");

    const none = await repository.searchDocuments("supercalifragilistic");
    assert.equal(none.length, 0);
  });

  await prisma.$disconnect();
});
