import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgeSource } from "@mystcrag/design-contract";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { KnowledgeRepository } from "./knowledge.repository.js";

const databaseUrl = process.env.DATABASE_URL;

function candidateFixture(
  id: string,
  overrides?: Partial<KnowledgeSource>
): KnowledgeSource {
  return {
    id,
    name: `候选来源 ${id}`,
    sourceType: "STATIC_HTML",
    baseUrl: "https://gemology.example.org/references",
    authorityScore: 0.9,
    allowedKnowledgeDomains: ["knowledge-domain:material-compatibility"],
    language: "en",
    enabled: true,
    sourceCategory: "GEMOLOGY",
    reliabilityLevel: "HIGH",
    countryOrRegion: "United States",
    contentType: "DATASHEET",
    crawlStrategy: { maxPages: 5, followLinks: false, respectRobots: true },
    rateLimit: { maxRequestsPerMinute: 12 },
    legalNote: "Public reference pages; evidence excerpts only.",
    ...overrides
  } as KnowledgeSource;
}

test("source registry lifecycle (Q0.3)", { skip: !databaseUrl }, async () => {
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  try {
    // Discovery-style registration: never APPROVED, never enabled.
    const registered = await repository.registerSourceCandidate(
      candidateFixture("source-candidate-lifecycle")
    );
    assert.equal(registered.created, true);
    assert.equal(registered.source.reviewStatus, "DISCOVERED");
    assert.equal(registered.source.enabled, false);

    // Re-registration is an idempotent no-op.
    const again = await repository.registerSourceCandidate(
      candidateFixture("source-candidate-lifecycle")
    );
    assert.equal(again.created, false);
    assert.equal(again.source.reviewStatus, "DISCOVERED");

    // DISCOVERED -> APPROVED is forbidden; the review queue is mandatory.
    await assert.rejects(
      repository.reviewSource("source-candidate-lifecycle", "APPROVED"),
      (error: unknown) =>
        error instanceof PersistenceError && error.code === "CONFLICT"
    );

    await repository.reviewSource("source-candidate-lifecycle", "NEEDS_REVIEW");
    const approved = await repository.reviewSource("source-candidate-lifecycle", "APPROVED");
    assert.equal(approved.reviewStatus, "APPROVED");

    // Not crawlable until enabled.
    assert.equal(
      (await repository.listCrawlableSources()).some((s) => s.id === "source-candidate-lifecycle"),
      false
    );
    const enabled = await repository.updateSourcePolicy("source-candidate-lifecycle", {
      enabled: true,
      authorityScore: 0.92,
      crawlFrequency: "weekly",
      crawlStrategy: { maxPages: 8, followLinks: true, maxDepth: 1, respectRobots: true }
    });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.authorityScore, 0.92);
    assert.equal(enabled.crawlFrequency, "weekly");
    assert.equal(enabled.crawlStrategy?.maxPages, 8);
    assert.equal(
      (await repository.listCrawlableSources()).some((s) => s.id === "source-candidate-lifecycle"),
      true
    );

    // APPROVED -> DISABLED, then back through review.
    await repository.reviewSource("source-candidate-lifecycle", "DISABLED");
    assert.equal(
      (await repository.listCrawlableSources()).some((s) => s.id === "source-candidate-lifecycle"),
      false
    );
    await repository.reviewSource("source-candidate-lifecycle", "NEEDS_REVIEW");
    const reApproved = await repository.reviewSource("source-candidate-lifecycle", "APPROVED");
    assert.equal(reApproved.reviewStatus, "APPROVED");
  } finally {
    await database.knowledgeSource.deleteMany({ where: { id: "source-candidate-lifecycle" } });
    await database.$disconnect();
  }
});

test("fetch outcome tracking auto-disables after three consecutive failures (Q0)", {
  skip: !databaseUrl
}, async () => {
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  try {
    const { source } = await repository.registerSourceCandidate(
      candidateFixture("source-candidate-outcome"),
      { submitForReview: true }
    );
    assert.equal(source.reviewStatus, "NEEDS_REVIEW");
    await repository.reviewSource("source-candidate-outcome", "APPROVED");
    await repository.updateSourcePolicy("source-candidate-outcome", { enabled: true });

    const first = await repository.recordFetchOutcome("source-candidate-outcome", {
      success: false,
      reason: "http 503"
    });
    assert.equal(first.lastFailure?.consecutive, 1);
    assert.equal(first.enabled, true);

    const second = await repository.recordFetchOutcome("source-candidate-outcome", {
      success: false,
      reason: "timeout"
    });
    assert.equal(second.enabled, true);

    const third = await repository.recordFetchOutcome("source-candidate-outcome", {
      success: false,
      reason: "dns failure"
    });
    assert.equal(third.lastFailure?.consecutive, 3);
    assert.equal(third.enabled, false, "auto-disable on the third consecutive failure");
    assert.equal(third.reviewStatus, "APPROVED", "auto-disable keeps review status");

    const recovered = await repository.recordFetchOutcome("source-candidate-outcome", {
      success: true
    });
    assert.equal(recovered.lastFailure, undefined);
    assert.ok(recovered.lastSuccessfulFetch);
    assert.equal(recovered.enabled, false, "recovery records the fetch but does not re-enable");
  } finally {
    await database.knowledgeSource.deleteMany({ where: { id: "source-candidate-outcome" } });
    await database.$disconnect();
  }
});

async function seedDisabledPolicySource(
  database: ReturnType<typeof createPrismaClient>,
  repository: KnowledgeRepository,
  id: string
): Promise<{ updatedAt: Date; crawlStrategy: unknown; rateLimit: unknown }> {
  const { source } = await repository.registerSourceCandidate(candidateFixture(id, {
    enabled: false,
    authorityScore: 0.42,
    allowedKnowledgeDomains: ["knowledge-domain:material-compatibility"],
    crawlFrequency: "monthly",
    rateLimit: { maxRequestsPerMinute: 18 },
    crawlStrategy: { maxPages: 4, followLinks: false, maxDepth: 1, respectRobots: true }
  }));
  assert.equal(source.enabled, false);

  const baseline = await database.knowledgeSource.findUniqueOrThrow({ where: { id } });
  return {
    updatedAt: baseline.updatedAt,
    crawlStrategy: baseline.crawlStrategy,
    rateLimit: baseline.rateLimit
  };
}

test("updateSourcePolicy rejects invalid crawlStrategy without any write", {
  skip: !databaseUrl
}, async () => {
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  const id = "source-policy-atomic-crawl-strategy";
  try {
    const baseline = await seedDisabledPolicySource(database, repository, id);

    await assert.rejects(
      repository.updateSourcePolicy(id, {
        enabled: true,
        crawlStrategy: {
          maxPages: 6,
          followLinks: true,
          maxDepth: 1,
          respectRobots: true,
          seedPaths: ["/search.php?name=amethyst"]
        }
      }),
      (error: unknown) =>
        error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
    );

    const row = await database.knowledgeSource.findUniqueOrThrow({ where: { id } });
    assert.equal(row.enabled, false, "enabled must not flip when policy validation fails");
    assert.deepEqual(row.crawlStrategy, baseline.crawlStrategy);
    assert.deepEqual(row.rateLimit, baseline.rateLimit);
    assert.equal(
      row.updatedAt.getTime(),
      baseline.updatedAt.getTime(),
      "a rejected policy update must not touch updatedAt"
    );

    // Re-read through the repository parse path as a second integrity check.
    const reread = await repository.getSource(id);
    assert.equal(reread.enabled, false);
    assert.deepEqual(reread.crawlStrategy, baseline.crawlStrategy);
    assert.deepEqual(reread.rateLimit, baseline.rateLimit);
  } finally {
    await database.knowledgeSource.deleteMany({ where: { id } });
    await database.$disconnect();
  }
});

test("updateSourcePolicy rejects invalid rateLimit and writes neither valid nor invalid fields", {
  skip: !databaseUrl
}, async () => {
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  const id = "source-policy-atomic-rate-limit";
  try {
    const baseline = await seedDisabledPolicySource(database, repository, id);

    await assert.rejects(
      repository.updateSourcePolicy(id, {
        authorityScore: 0.87,
        rateLimit: { maxRequestsPerMinute: 0 }
      }),
      (error: unknown) =>
        error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
    );

    const row = await database.knowledgeSource.findUniqueOrThrow({ where: { id } });
    assert.equal(row.authorityScore, 0.42, "the valid sibling field must not be written");
    assert.deepEqual(row.rateLimit, baseline.rateLimit);
    assert.deepEqual(row.crawlStrategy, baseline.crawlStrategy);
    assert.equal(row.enabled, false);
    assert.equal(
      row.updatedAt.getTime(),
      baseline.updatedAt.getTime(),
      "a rejected policy update must not touch updatedAt"
    );
  } finally {
    await database.knowledgeSource.deleteMany({ where: { id } });
    await database.$disconnect();
  }
});

test("updateSourcePolicy applies a legal multi-field update and round-trips", {
  skip: !databaseUrl
}, async () => {
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  const id = "source-policy-atomic-legal-update";
  try {
    await seedDisabledPolicySource(database, repository, id);

    const updated = await repository.updateSourcePolicy(id, {
      enabled: true,
      authorityScore: 0.76,
      allowedKnowledgeDomains: [
        "knowledge-domain:material-compatibility",
        "knowledge-domain:style-rule"
      ],
      rateLimit: { maxRequestsPerMinute: 24 },
      crawlStrategy: {
        maxPages: 9,
        followLinks: true,
        maxDepth: 2,
        respectRobots: true,
        seedPaths: ["/gems/amethyst", "/gems/citrine"]
      }
    });

    assert.equal(updated.enabled, true);
    assert.equal(updated.authorityScore, 0.76);
    assert.deepEqual(updated.allowedKnowledgeDomains, [
      "knowledge-domain:material-compatibility",
      "knowledge-domain:style-rule"
    ]);
    assert.deepEqual(updated.rateLimit, { maxRequestsPerMinute: 24 });
    assert.equal(updated.crawlStrategy?.maxPages, 9);
    assert.equal(updated.crawlStrategy?.followLinks, true);
    assert.equal(updated.crawlStrategy?.maxDepth, 2);
    assert.deepEqual(updated.crawlStrategy?.seedPaths, ["/gems/amethyst", "/gems/citrine"]);

    const row = await database.knowledgeSource.findUniqueOrThrow({ where: { id } });
    assert.equal(row.enabled, true);
    assert.equal(row.authorityScore, 0.76);
    assert.deepEqual(row.allowedKnowledgeDomains, [
      "knowledge-domain:material-compatibility",
      "knowledge-domain:style-rule"
    ]);
    assert.deepEqual(row.rateLimit, { maxRequestsPerMinute: 24 });
    assert.equal(
      (row.crawlStrategy as { maxPages?: number } | null)?.maxPages,
      9
    );
    assert.deepEqual(
      (row.crawlStrategy as { seedPaths?: string[] } | null)?.seedPaths,
      ["/gems/amethyst", "/gems/citrine"]
    );

    const reread = await repository.getSource(id);
    assert.equal(reread.enabled, true);
    assert.equal(reread.authorityScore, 0.76);
    assert.deepEqual(reread.rateLimit, { maxRequestsPerMinute: 24 });
    assert.equal(reread.crawlStrategy?.maxPages, 9);
  } finally {
    await database.knowledgeSource.deleteMany({ where: { id } });
    await database.$disconnect();
  }
});

test("updateSourcePolicy rejects invalid crawlFrequency without any write", {
  skip: !databaseUrl
}, async () => {
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  const id = "source-policy-atomic-crawl-frequency";
  try {
    const baseline = await seedDisabledPolicySource(database, repository, id);

    // Minimal local cast simulates a runtime caller that bypasses TypeScript;
    // production method types stay narrow.
    const unsafePolicy = {
      enabled: true,
      crawlFrequency: ""
    } as Parameters<KnowledgeRepository["updateSourcePolicy"]>[1];

    await assert.rejects(
      repository.updateSourcePolicy(id, unsafePolicy),
      (error: unknown) =>
        error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
    );

    const row = await database.knowledgeSource.findUniqueOrThrow({ where: { id } });
    assert.equal(row.enabled, false, "the valid sibling field must not be written");
    assert.equal(row.crawlFrequency, "monthly", "crawlFrequency must stay at its baseline value");
    assert.deepEqual(row.rateLimit, baseline.rateLimit);
    assert.deepEqual(row.crawlStrategy, baseline.crawlStrategy);
    assert.equal(
      row.updatedAt.getTime(),
      baseline.updatedAt.getTime(),
      "a rejected policy update must not touch updatedAt"
    );
  } finally {
    await database.knowledgeSource.deleteMany({ where: { id } });
    await database.$disconnect();
  }
});
