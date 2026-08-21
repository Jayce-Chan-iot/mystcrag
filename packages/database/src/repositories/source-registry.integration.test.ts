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
      crawlStrategy: { maxPages: 8, followLinks: true, respectRobots: true }
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
