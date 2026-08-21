import assert from "node:assert/strict";
import test from "node:test";

import type {
  KnowledgeRepository,
  StoredKnowledgeRule,
  StoredKnowledgeSource,
  StoredKnowledgeVersion
} from "@mystcrag/database";
import { KnowledgeSourceSchema, type SourceReviewStatus } from "@mystcrag/design-contract";

import {
  KnowledgeReviewService,
  parseExtractionMetadata
} from "../src/review/review-service.js";
import { KnowledgeSourceAdminService } from "../src/admin/source-admin.js";

type RuleOverrides = Partial<StoredKnowledgeRule> & { payload?: unknown };

function rule(overrides: RuleOverrides = {}): StoredKnowledgeRule {
  return {
    id: "rule-a",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:purple",
    relation: "pairs-well-with",
    payload: (overrides.payload ?? {}) as StoredKnowledgeRule["payload"],
    conditions: {},
    confidence: 0.72,
    status: "NEEDS_REVIEW",
    sourceRefs: [{ sourceId: "source-a", documentId: "doc-a" }],
    version: 1,
    fingerprint: "a".repeat(64),
    createdAt: "2026-08-21T00:00:00+08:00",
    updatedAt: "2026-08-21T00:00:00+08:00",
    sourceId: "source-a",
    knowledgeVersionId: null,
    ...overrides
  } as StoredKnowledgeRule;
}

function source(overrides: Partial<StoredKnowledgeSource> = {}): StoredKnowledgeSource {
  return KnowledgeSourceSchema.parse({
    id: "source-a",
    name: "测试来源",
    sourceType: "BOOK",
    enabled: true,
    authorityScore: 0.9,
    allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
    language: "zh-CN",
    reviewStatus: "APPROVED",
    ...overrides
  });
}

function fakeRepository(init: {
  rules?: StoredKnowledgeRule[];
  sources?: StoredKnowledgeSource[];
  latestVersion?: StoredKnowledgeVersion | null;
  ruleCounts?: Record<string, number>;
  reviewTransitions?: Record<string, StoredKnowledgeSource>;
}): KnowledgeRepository {
  const rules = new Map((init.rules ?? []).map((entry) => [entry.id, entry]));
  const sources = new Map((init.sources ?? []).map((entry) => [entry.id, entry]));
  const reviewTransitions = init.reviewTransitions ?? {};
  return {
    listRules: async (filter?: { status?: string }) =>
      [...rules.values()].filter(
        (entry) => filter?.status === undefined || entry.status === filter.status
      ),
    countRulesByStatus: async () =>
      init.ruleCounts ?? {
        NEW: 0,
        EXTRACTED: 0,
        VALIDATED: 0,
        NEEDS_REVIEW: 0,
        APPROVED: 0,
        REJECTED: 0,
        CONFLICTED: 0,
        SUPERSEDED: 0
      },
    getSource: async (id: string) => {
      const found = sources.get(id);
      if (found === undefined) {
        throw new Error(`Knowledge source ${id} was not found`);
      }
      return found;
    },
    getDocument: async (id: string) => ({
      id,
      sourceId: "source-a",
      url: "https://example.com/doc-a",
      contentHash: "a".repeat(64),
      title: "测试文档",
      contentText: "",
      fetchedAt: "2026-08-21T00:00:00+08:00",
      parser: "static-html-basic",
      language: "zh-CN",
      status: "PARSED",
      urlNormalized: "https://example.com/doc-a"
    }),
    listSources: async () => [...sources.values()],
    getLatestPublishedVersion: async () => init.latestVersion ?? null,
    reviewSource: async (id: string, next: SourceReviewStatus) => {
      const replacement = reviewTransitions[`${id}:${next}`];
      if (replacement === undefined) {
        throw new Error(`transition ${id} -> ${next} rejected`);
      }
      sources.set(id, replacement);
      return replacement;
    },
    setSourceEnabled: async (id: string, enabled: boolean) => {
      const found = sources.get(id);
      if (found === undefined) {
        throw new Error(`Knowledge source ${id} was not found`);
      }
      sources.set(id, { ...found, enabled });
    },
    updateSourcePolicy: async (
      id: string,
      policy: {
        allowedKnowledgeDomains?: string[];
        rateLimit?: { maxRequestsPerMinute: number } | null;
      }
    ) => {
      const found = sources.get(id);
      if (found === undefined) {
        throw new Error(`Knowledge source ${id} was not found`);
      }
      const updated: StoredKnowledgeSource = {
        ...found,
        ...(policy.allowedKnowledgeDomains === undefined
          ? {}
          : { allowedKnowledgeDomains: policy.allowedKnowledgeDomains }),
        ...(policy.rateLimit === undefined || policy.rateLimit === null
          ? {}
          : { rateLimit: policy.rateLimit })
      };
      sources.set(id, updated);
      return updated;
    }
  } as unknown as KnowledgeRepository;
}

test("parseExtractionMetadata returns Q2 evidence when present and valid", () => {
  const extraction = {
    extractor: "pattern-extractor-v1",
    method: "pattern",
    evidence: [
      {
        documentId: "doc-a",
        sentence: "Amethyst purple pairs well with citrine yellow.",
        startOffset: 0,
        endOffset: 44
      }
    ]
  };
  const parsed = parseExtractionMetadata({ extraction, matchedDomains: ["color:purple"] });
  assert.notEqual(parsed, null);
  assert.equal(parsed?.extractor, "pattern-extractor-v1");
  assert.equal(parsed?.evidence.length, 1);
});

test("parseExtractionMetadata tolerates legacy and malformed payloads", () => {
  assert.equal(parseExtractionMetadata({ companionColors: ["color:teal"] }), null);
  assert.equal(parseExtractionMetadata("scalar"), null);
  assert.equal(
    parseExtractionMetadata({ extraction: { extractor: "", method: "nope", evidence: [] } }),
    null
  );
});

test("listReviewQueue surfaces extraction evidence for reviewable candidates", async () => {
  const repository = fakeRepository({
    rules: [
      rule({
        payload: {
          extraction: {
            extractor: "pattern-extractor-v1",
            method: "pattern",
            evidence: [
              {
                documentId: "doc-a",
                sentence: "Amethyst purple pairs well with citrine yellow.",
                startOffset: 0,
                endOffset: 44
              }
            ]
          }
        }
      })
    ],
    sources: [source()]
  });
  const service = new KnowledgeReviewService({ database: {} as never, repository });
  const items = await service.listReviewQueue({ status: "NEEDS_REVIEW" });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.extraction?.method, "pattern");
  assert.equal(items[0]?.extraction?.evidence[0]?.documentId, "doc-a");
});

test("getAdminOverview aggregates rule counts, source counts, conflicts, and version", async () => {
  const repository = fakeRepository({
    ruleCounts: {
      NEW: 1,
      EXTRACTED: 2,
      VALIDATED: 0,
      NEEDS_REVIEW: 4,
      APPROVED: 9,
      REJECTED: 0,
      CONFLICTED: 0,
      SUPERSEDED: 0
    },
    sources: [
      source({ id: "source-a", reviewStatus: "APPROVED", enabled: true }),
      source({ id: "source-b", reviewStatus: "NEEDS_REVIEW", enabled: false }),
      source({ id: "source-c", reviewStatus: "DISCOVERED", enabled: false })
    ],
    latestVersion: {
      id: "kv-2026-08-v1",
      version: "2026-08-v1",
      status: "PUBLISHED",
      ruleCount: 9,
      publishedAt: new Date("2026-08-21T10:00:00.000Z"),
      createdAt: new Date("2026-08-21T09:00:00.000Z")
    }
  });
  const service = new KnowledgeReviewService({ database: {} as never, repository });
  const overview = await service.getAdminOverview();
  assert.equal(overview.rules.NEEDS_REVIEW, 4);
  assert.equal(overview.rules.APPROVED, 9);
  assert.equal(overview.sources.APPROVED, 1);
  assert.equal(overview.sources.NEEDS_REVIEW, 1);
  assert.equal(overview.sources.DISCOVERED, 1);
  assert.equal(overview.sources.enabled, 1);
  assert.equal(overview.conflictGroups, 0);
  assert.equal(overview.latestVersion?.version, "2026-08-v1");
  assert.equal(overview.latestVersion?.publishedAt, "2026-08-21T10:00:00.000Z");
});

test("getAdminOverview reports a null latest version before any publish", async () => {
  const repository = fakeRepository({ sources: [] });
  const service = new KnowledgeReviewService({ database: {} as never, repository });
  const overview = await service.getAdminOverview();
  assert.equal(overview.latestVersion, null);
  assert.equal(overview.sources.enabled, 0);
});

test("getAdminOverview counts conflicting candidate groups", async () => {
  const repository = fakeRepository({
    rules: [
      rule({ id: "rule-1", status: "NEEDS_REVIEW", payload: { companionColors: ["color:teal"] } }),
      rule({
        id: "rule-2",
        fingerprint: "b".repeat(64),
        status: "NEEDS_REVIEW",
        payload: { companionColors: ["color:orange"] }
      })
    ]
  });
  const service = new KnowledgeReviewService({ database: {} as never, repository });
  const overview = await service.getAdminOverview();
  assert.equal(overview.conflictGroups, 1);
});

test("source admin queue filters by review status and reports filtered total", async () => {
  const repository = fakeRepository({
    sources: [
      source({ id: "source-a", reviewStatus: "APPROVED" }),
      source({ id: "source-b", reviewStatus: "NEEDS_REVIEW" })
    ]
  });
  const service = new KnowledgeSourceAdminService({ repository });
  const queue = await service.listSourceQueue({ reviewStatus: "NEEDS_REVIEW" });
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.id, "source-b");
  assert.equal(queue.total, 1);
  const all = await service.listSourceQueue();
  assert.equal(all.total, 2);
});

test("source admin review delegates to the repository state machine", async () => {
  const approved = source({ id: "source-b", reviewStatus: "APPROVED", enabled: false });
  const repository = fakeRepository({
    sources: [source({ id: "source-b", reviewStatus: "NEEDS_REVIEW", enabled: false })],
    reviewTransitions: { "source-b:APPROVED": approved }
  });
  const service = new KnowledgeSourceAdminService({ repository });
  const result = await service.reviewSource("source-b", "APPROVED");
  assert.deepEqual(result, {
    sourceId: "source-b",
    reviewStatus: "APPROVED",
    enabled: false
  });
});

test("source admin enable toggle and policy updates round-trip", async () => {
  const repository = fakeRepository({
    sources: [source({ id: "source-a", reviewStatus: "APPROVED", enabled: false })]
  });
  const service = new KnowledgeSourceAdminService({ repository });

  const toggled = await service.setSourceEnabled("source-a", true);
  assert.equal(toggled.enabled, true);

  const policy = await service.updateSourcePolicy("source-a", {
    allowedKnowledgeDomains: ["knowledge-domain:material-compatibility"],
    maxRequestsPerMinute: 12
  });
  assert.equal(policy.reviewStatus, "APPROVED");
  const updated = await repository.getSource("source-a");
  assert.deepEqual(updated.allowedKnowledgeDomains, [
    "knowledge-domain:material-compatibility"
  ]);
  assert.deepEqual(updated.rateLimit, { maxRequestsPerMinute: 12 });
});
