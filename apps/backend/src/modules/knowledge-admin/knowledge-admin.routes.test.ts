import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError } from "@mystcrag/database";
import type { StoredKnowledgeRule } from "@mystcrag/database";
import type { SourceReviewStatus } from "@mystcrag/design-contract";
import type {
  KnowledgeConsoleService,
  KnowledgeSourceAdminService,
  KnowledgeReviewService,
  ReviewQueueItem
} from "@mystcrag/knowledge-core";

import { createApp } from "../../app.js";
import { KnowledgeAdminApplicationService } from "./knowledge-admin.service.js";

const ADMIN_KEY = "test-admin-key-0123456789abcdef";

const queueItem: ReviewQueueItem = {
  rule: {
    id: "cand-abc",
    knowledgeType: "COLOR_THEORY",
    knowledgeDomain: "knowledge-domain:color-theory",
    subject: "color:purple",
    relation: "pairs-well-with",
    payload: {
      extraction: {
        extractor: "pattern-extractor-v1",
        method: "pattern",
        evidence: [
          {
            documentId: "doc-1",
            sentence: "Amethyst purple pairs well with citrine yellow.",
            startOffset: 0,
            endOffset: 44
          }
        ]
      }
    },
    conditions: {},
    confidence: 0.72,
    status: "NEEDS_REVIEW",
    sourceRefs: [{ sourceId: "source-1", documentId: "doc-1" }],
    version: 1,
    fingerprint: "a".repeat(64),
    createdAt: "2026-08-21T00:00:00+08:00",
    updatedAt: "2026-08-21T00:00:00+08:00",
    sourceId: "source-1",
    knowledgeVersionId: null
  } as StoredKnowledgeRule,
  validation: { valid: true, issues: [] },
  evidence: [
    {
      source: {
        id: "source-1",
        name: "色彩设计手册",
        sourceType: "BOOK",
        sourceCategory: "BOOK",
        reliabilityLevel: "HIGH",
        authorityScore: 0.9,
        enabled: true
      },
      document: {
        id: "doc-1",
        title: "第三章",
        url: "https://books.example.com/ch3",
        fetchedAt: "2026-08-21T10:00:00+08:00"
      }
    }
  ],
  extraction: {
    extractor: "pattern-extractor-v1",
    method: "pattern",
    evidence: [
      {
        documentId: "doc-1",
        sentence: "Amethyst purple pairs well with citrine yellow.",
        startOffset: 0,
        endOffset: 44
      }
    ]
  }
};

function fakeReviewService(overrides: Partial<KnowledgeReviewService> = {}): KnowledgeReviewService {
  return {
    getAdminOverview: async () => ({
      rules: {
        NEW: 0,
        EXTRACTED: 0,
        VALIDATED: 0,
        NEEDS_REVIEW: 1,
        APPROVED: 2,
        REJECTED: 0,
        CONFLICTED: 0,
        SUPERSEDED: 0
      },
      sources: {
        DISCOVERED: 0,
        NEEDS_REVIEW: 1,
        APPROVED: 1,
        REJECTED: 0,
        DISABLED: 0,
        enabled: 1
      },
      documents: 12,
      externalCandidates: 3,
      externalApprovedRules: 2,
      conflictGroups: 1,
      latestVersion: {
        id: "kv-2026-08-v1",
        version: "2026-08-v1",
        status: "PUBLISHED",
        ruleCount: 2,
        publishedAt: "2026-08-21T10:00:00.000Z"
      }
    }),
    listReviewQueue: async (filter?: { status?: string }) =>
      filter?.status === undefined || filter.status === "NEEDS_REVIEW" ? [queueItem] : [],
    listConflictGroups: async () => [
      {
        key: {
          knowledgeType: "COLOR_THEORY",
          subject: "color:purple",
          relation: "pairs-well-with"
        },
        rules: [queueItem.rule, { ...queueItem.rule, id: "cand-def", fingerprint: "b".repeat(64) }]
      }
    ],
    runReviewPipeline: async () => ({
      extracted: 1,
      validated: 0,
      needsReview: 1,
      conflicted: 0,
      merged: 0
    }),
    approveRule: async (id: string) => ({ ...queueItem.rule, id, status: "APPROVED" }),
    rejectRule: async (id: string) => ({ ...queueItem.rule, id, status: "REJECTED" }),
    supersedeRule: async (id: string) => ({ ...queueItem.rule, id, status: "SUPERSEDED" }),
    editRule: async (id: string, changes: { confidence?: number; claimType?: string | null }) => ({
      ...queueItem.rule,
      id,
      status: "NEEDS_REVIEW",
      confidence: changes.confidence ?? queueItem.rule.confidence,
      claimType: changes.claimType ?? null
    }),
    publishVersion: async () => {
      throw new PersistenceError("DUPLICATE_KNOWLEDGE", "version already published");
    },
    ...overrides
  } as unknown as KnowledgeReviewService;
}

function fakeSourceAdminService(
  overrides: Partial<KnowledgeSourceAdminService> = {}
): KnowledgeSourceAdminService {
  return {
    listSourceQueue: async (filter?: { reviewStatus?: SourceReviewStatus }) => ({
      items:
        filter?.reviewStatus === undefined || filter.reviewStatus === "NEEDS_REVIEW"
          ? [
              {
                id: "source-1",
                name: "色彩设计手册",
                sourceType: "BOOK",
                sourceCategory: "BOOK",
                contentType: "TEXTBOOK",
                reliabilityLevel: "HIGH",
                reviewStatus: "NEEDS_REVIEW",
                enabled: false,
                authorityScore: 0.9,
                allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
                language: "zh-CN"
              }
            ]
          : [],
      total: filter?.reviewStatus === undefined ? 1 : 0
    }),
    reviewSource: async (id: string, next: SourceReviewStatus) => ({
      sourceId: id,
      reviewStatus: next,
      enabled: true
    }),
    setSourceEnabled: async (id: string, enabled: boolean) => ({
      sourceId: id,
      reviewStatus: "APPROVED",
      enabled
    }),
    updateSourcePolicy: async (id: string) => ({
      sourceId: id,
      reviewStatus: "APPROVED",
      enabled: true
    }),
    ...overrides
  } as unknown as KnowledgeSourceAdminService;
}

function fakeConsoleService(
  overrides: Partial<KnowledgeConsoleService> = {}
): KnowledgeConsoleService {
  return {
    getCoverage: async () => [
      {
        domain: "CRYSTAL_GEMOLOGY",
        target: 60,
        current: 42,
        missing: 18,
        percentage: 0.7,
        coveredTaxonomyTerms: [
          { id: "material:amethyst", displayName: { zh: "紫水晶", en: "Amethyst" } }
        ],
        missingTaxonomyTerms: [
          { id: "material:labradorite", displayName: { zh: "拉长石", en: "Labradorite" } }
        ]
      }
    ],
    getSourceStats: async () => [
      {
        sourceId: "source-gemdat-gemstone-pages",
        name: "GemDat Gemstone Pages",
        sourceType: "STATIC_HTML",
        sourceCategory: "GEMOLOGY",
        authorityScore: 0.9,
        reliabilityLevel: "HIGH",
        reviewStatus: "APPROVED",
        enabled: true,
        documents: 85,
        candidateCount: 572,
        approvedRuleCount: 12,
        lastFetch: "2026-08-22T16:00:00.000Z",
        failureCount: 0,
        yield: 6.7294
      }
    ],
    getCrystalAtlas: async () => [
      {
        crystalId: "material:amethyst",
        displayName: { zh: "紫水晶", en: "Amethyst" },
        gemologyCompleteness: 0.875,
        visualCompleteness: 1,
        culturalCompleteness: 0.5,
        associationCount: 3,
        conflictCount: 0
      }
    ],
    getCrystalAtlasDetail: async (crystalId: string) =>
      crystalId === "material:amethyst"
        ? {
            row: {
              crystalId: "material:amethyst",
              displayName: { zh: "紫水晶", en: "Amethyst" },
              gemologyCompleteness: 0.875,
              visualCompleteness: 1,
              culturalCompleteness: 0.5,
              associationCount: 3,
              conflictCount: 0
            },
            properties: [
              {
                property: "mohsHardness",
                value: "7",
                knowledgeDomain: "knowledge-domain:crystal-gemology",
                ruleId: "cand-001",
                status: "APPROVED",
                confidence: 0.95,
                sourceIds: ["source-gemdat-gemstone-pages"]
              }
            ],
            relations: [
              {
                relation: "pairs-well-with",
                knowledgeDomain: "knowledge-domain:color-theory",
                ruleId: "cand-002",
                status: "NEEDS_REVIEW",
                confidence: 0.72,
                payload: { object: "color:citrine" },
                sourceIds: ["source-gemdat-gemstone-pages"]
              }
            ],
            sources: [{ sourceId: "source-gemdat-gemstone-pages", ruleCount: 2 }]
          }
        : null,
    listCollectionRuns: async () => [
      {
        id: "run-001",
        status: "COMPLETED",
        startedAt: new Date("2026-08-22T15:00:00.000Z"),
        finishedAt: new Date("2026-08-22T16:28:09.000Z"),
        sourcesCrawled: 3,
        documentsAdded: 193,
        documentDuplicates: 0,
        candidatesInserted: 874,
        corroboratedCandidates: 5,
        candidateDuplicates: 0,
        needsReview: 875,
        conflicts: 433,
        errors: [],
        sourceResults: [
          {
            sourceId: "source-gemdat-gemstone-pages",
            documentsAdded: 85,
            duplicateDocuments: 0,
            candidatesInserted: 572,
            corroboratedCandidates: 0,
            duplicateCandidates: 0
          }
        ]
      }
    ],
    ...overrides
  } as unknown as KnowledgeConsoleService;
}

function buildApp(
  reviewService: KnowledgeReviewService = fakeReviewService(),
  sourceAdminService: KnowledgeSourceAdminService = fakeSourceAdminService(),
  adminKey: string | null = ADMIN_KEY,
  consoleService: KnowledgeConsoleService | null = fakeConsoleService()
) {
  const service = new KnowledgeAdminApplicationService({
    reviewService,
    sourceAdminService,
    ...(consoleService === null ? {} : { consoleService })
  });
  return createApp({
    knowledgeAdminService: service,
    ...(adminKey === null ? {} : { knowledgeAdminApiKey: adminKey }),
    logger: false
  });
}

const authedHeaders = { "x-admin-key": ADMIN_KEY };

test("createApp fails closed when the admin service has no key", async () => {
  assert.throws(() => buildApp(undefined, undefined, null));
});

test("createApp rejects a too-short admin key", async () => {
  assert.throws(() => buildApp(undefined, undefined, "short-key"));
});

test("admin routes reject a missing or wrong key with 403", async () => {
  const app = buildApp();
  const missing = await app.inject({ method: "GET", url: "/api/admin/knowledge/overview" });
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.json().error.code, "FORBIDDEN");

  const wrong = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/overview",
    headers: { "x-admin-key": "wrong-key-0123456789abcdef" }
  });
  assert.equal(wrong.statusCode, 403);
});

test("non-admin routes stay open without a key", async () => {
  const app = buildApp();
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
});

test("GET /overview returns the dashboard projection", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/overview",
    headers: authedHeaders
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.rules.NEEDS_REVIEW, 1);
  assert.equal(body.rules.APPROVED, 2);
  assert.equal(body.sources.enabled, 1);
  assert.equal(body.conflictGroups, 1);
  assert.equal(body.latestVersion.version, "2026-08-v1");
});

test("GET /review-queue returns extraction evidence and validates filters", async () => {
  const app = buildApp();
  const ok = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/review-queue?status=NEEDS_REVIEW&limit=50",
    headers: authedHeaders
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.total, 1);
  assert.equal(body.items[0].extraction.method, "pattern");
  assert.equal(body.items[0].extraction.evidence[0].sentence.length > 0, true);
  assert.equal(body.items[0].evidence[0].source.reliabilityLevel, "HIGH");
  assert.equal(body.items[0].sourceId, undefined);
  assert.equal(body.items[0].claimType, null);

  const badStatus = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/review-queue?status=NOT_A_STATUS",
    headers: authedHeaders
  });
  assert.equal(badStatus.statusCode, 400);
  assert.equal(badStatus.json().error.code, "VALIDATION_ERROR");

  const badLimit = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/review-queue?limit=9999",
    headers: authedHeaders
  });
  assert.equal(badLimit.statusCode, 400);
});

test("GET /conflicts returns conflict groups", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/conflicts",
    headers: authedHeaders
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.groups.length, 1);
  assert.equal(body.groups[0].rules.length, 2);
});

test("POST /review-pipeline/run returns the pipeline summary", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/review-pipeline/run",
    headers: authedHeaders
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().needsReview, 1);
});

test("rule actions map approve, reject, and supersede to statuses", async () => {
  const app = buildApp();
  for (const [action, status] of [
    ["approve", "APPROVED"],
    ["reject", "REJECTED"],
    ["supersede", "SUPERSEDED"]
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: `/api/admin/knowledge/rules/cand-abc/${action}`,
      headers: authedHeaders
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ruleId: "cand-abc", status });
  }
});

test("rule actions reject malformed ids and map NOT_FOUND to 404", async () => {
  const app = buildApp(
    fakeReviewService({
      approveRule: async () => {
        throw new PersistenceError("NOT_FOUND", "rule missing");
      }
    })
  );
  const malformed = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/%20/approve",
    headers: authedHeaders
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, "VALIDATION_ERROR");

  const notFound = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-missing/approve",
    headers: authedHeaders
  });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.json().error.code, "NOT_FOUND");
});

test("publishing a version validates the slug and maps duplicates to 409", async () => {
  const app = buildApp();
  const badSlug = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/versions",
    headers: authedHeaders,
    payload: { version: "not a slug" }
  });
  assert.equal(badSlug.statusCode, 400);

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/versions",
    headers: authedHeaders,
    payload: { version: "2026-08-v1" }
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "CONFLICT");
});

test("publishing a fresh version returns the version summary", async () => {
  const app = buildApp(
    fakeReviewService({
      publishVersion: async () => ({
        id: "kv-2026-08-v2",
        version: "2026-08-v2",
        status: "PUBLISHED",
        ruleCount: 12,
        publishedAt: new Date("2026-08-21T10:00:00.000Z"),
        createdAt: new Date("2026-08-21T09:00:00.000Z")
      })
    })
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/versions",
    headers: authedHeaders,
    payload: { version: "2026-08-v2" }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ruleCount, 12);
});

test("GET /sources filters by review status and validates the filter", async () => {
  const app = buildApp();
  const ok = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/sources?reviewStatus=NEEDS_REVIEW",
    headers: authedHeaders
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().total, 0);

  const all = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/sources",
    headers: authedHeaders
  });
  assert.equal(all.json().total, 1);
  assert.equal(all.json().items[0].sourceCategory, "BOOK");

  const bad = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/sources?reviewStatus=WHATEVER",
    headers: authedHeaders
  });
  assert.equal(bad.statusCode, 400);
});

test("source review actions enforce the request contract and state machine", async () => {
  const app = buildApp();
  const badBody = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/sources/source-1/review",
    headers: authedHeaders,
    payload: { reviewStatus: "DISCOVERED" }
  });
  assert.equal(badBody.statusCode, 400);

  const conflictApp = buildApp(
    undefined,
    fakeSourceAdminService({
      reviewSource: async () => {
        throw new PersistenceError("CONFLICT", "illegal transition");
      }
    })
  );
  const conflict = await conflictApp.inject({
    method: "POST",
    url: "/api/admin/knowledge/sources/source-1/review",
    headers: authedHeaders,
    payload: { reviewStatus: "APPROVED" }
  });
  assert.equal(conflict.statusCode, 409);

  const ok = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/sources/source-1/review",
    headers: authedHeaders,
    payload: { reviewStatus: "APPROVED" }
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().reviewStatus, "APPROVED");
});

test("source enable and policy updates round-trip through the contract", async () => {
  const app = buildApp();
  const enabled = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/sources/source-1/enabled",
    headers: authedHeaders,
    payload: { enabled: true }
  });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.json().enabled, true);

  const emptyPolicy = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/sources/source-1/policy",
    headers: authedHeaders,
    payload: {}
  });
  assert.equal(emptyPolicy.statusCode, 400);

  const policy = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/sources/source-1/policy",
    headers: authedHeaders,
    payload: { maxRequestsPerMinute: 30 }
  });
  assert.equal(policy.statusCode, 200);
  assert.equal(policy.json().sourceId, "source-1");
});

test("console endpoints reject a missing or wrong key with 403", async () => {
  const app = buildApp();
  for (const path of [
    "/api/admin/knowledge/console/coverage",
    "/api/admin/knowledge/console/sources-stats",
    "/api/admin/knowledge/console/atlas",
    "/api/admin/knowledge/console/atlas/material:amethyst",
    "/api/admin/knowledge/console/collection-runs"
  ]) {
    const missing = await app.inject({ method: "GET", url: path });
    assert.equal(missing.statusCode, 403);
    assert.equal(missing.json().error.code, "FORBIDDEN");

    const wrong = await app.inject({
      method: "GET",
      url: path,
      headers: { "x-admin-key": "wrong-key-0123456789abcdef" }
    });
    assert.equal(wrong.statusCode, 403);
  }

  const editMissing = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-abc/edit",
    payload: { confidence: 0.9 }
  });
  assert.equal(editMissing.statusCode, 403);
});

test("console endpoints report 404 when the console service is not configured", async () => {
  const app = buildApp(undefined, undefined, ADMIN_KEY, null);
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/coverage",
    headers: authedHeaders
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "NOT_FOUND");
});

test("GET /console/coverage returns domain targets with covered and missing terms", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/coverage",
    headers: authedHeaders
  });
  assert.equal(response.statusCode, 200);
  const domain = response.json().domains[0];
  assert.equal(domain.domain, "CRYSTAL_GEMOLOGY");
  assert.equal(domain.target, 60);
  assert.equal(domain.current, 42);
  assert.equal(domain.missing, 18);
  assert.equal(domain.percentage, 0.7);
  assert.equal(domain.coveredTaxonomyTerms[0].id, "material:amethyst");
  assert.equal(domain.missingTaxonomyTerms[0].displayName.zh, "拉长石");
});

test("GET /console/sources-stats returns per-source yield stats", async () => {
  const app = buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/sources-stats",
    headers: authedHeaders
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.total, 1);
  const stats = body.items[0];
  assert.equal(stats.sourceId, "source-gemdat-gemstone-pages");
  assert.equal(stats.documents, 85);
  assert.equal(stats.candidateCount, 572);
  assert.equal(stats.approvedRuleCount, 12);
  assert.equal(stats.lastFetch, "2026-08-22T16:00:00.000Z");
  assert.equal(stats.yield, 6.7294);
});

test("GET /console/atlas returns atlas rows and detail for a known crystal", async () => {
  const app = buildApp();
  const list = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/atlas",
    headers: authedHeaders
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().total, 1);
  assert.equal(list.json().items[0].crystalId, "material:amethyst");
  assert.equal(list.json().items[0].gemologyCompleteness, 0.875);

  const detail = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/atlas/material:amethyst",
    headers: authedHeaders
  });
  assert.equal(detail.statusCode, 200);
  const body = detail.json();
  assert.equal(body.properties[0].property, "mohsHardness");
  assert.equal(body.properties[0].value, "7");
  assert.equal(body.relations[0].relation, "pairs-well-with");
  assert.equal(body.sources[0].ruleCount, 2);
});

test("GET /console/atlas/:crystalId maps unknown crystals to 404 and malformed ids to 400", async () => {
  const app = buildApp();
  const unknown = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/atlas/material:nope",
    headers: authedHeaders
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error.code, "NOT_FOUND");

  const malformed = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/atlas/%20",
    headers: authedHeaders
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, "VALIDATION_ERROR");
});

test("GET /console/collection-runs returns runs with ISO dates and validates limit", async () => {
  const app = buildApp();
  const ok = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/collection-runs?limit=10",
    headers: authedHeaders
  });
  assert.equal(ok.statusCode, 200);
  const run = ok.json().items[0];
  assert.equal(ok.json().total, 1);
  assert.equal(run.status, "COMPLETED");
  assert.equal(run.startedAt, "2026-08-22T15:00:00.000Z");
  assert.equal(run.finishedAt, "2026-08-22T16:28:09.000Z");
  assert.equal(run.documentsAdded, 193);
  assert.equal(run.candidatesInserted, 874);
  assert.equal(run.sourceResults[0].candidatesInserted, 572);

  const badLimit = await app.inject({
    method: "GET",
    url: "/api/admin/knowledge/console/collection-runs?limit=9999",
    headers: authedHeaders
  });
  assert.equal(badLimit.statusCode, 400);
});

test("POST /rules/:ruleId/edit updates confidence and claimType via the review service", async () => {
  const app = buildApp();
  const edit = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-abc/edit",
    headers: authedHeaders,
    payload: { confidence: 0.88, claimType: "GEMOLOGICAL_FACT" }
  });
  assert.equal(edit.statusCode, 200);
  assert.deepEqual(edit.json(), {
    ruleId: "cand-abc",
    status: "NEEDS_REVIEW",
    confidence: 0.88,
    claimType: "GEMOLOGICAL_FACT"
  });

  const claimTypeOnly = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-abc/edit",
    headers: authedHeaders,
    payload: { claimType: null }
  });
  assert.equal(claimTypeOnly.statusCode, 200);
  assert.equal(claimTypeOnly.json().claimType, null);
});

test("POST /rules/:ruleId/edit validates the request body and maps NOT_FOUND", async () => {
  const app = buildApp();
  const empty = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-abc/edit",
    headers: authedHeaders,
    payload: {}
  });
  assert.equal(empty.statusCode, 400);

  const badConfidence = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-abc/edit",
    headers: authedHeaders,
    payload: { confidence: 1.5 }
  });
  assert.equal(badConfidence.statusCode, 400);

  const badClaimType = await app.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-abc/edit",
    headers: authedHeaders,
    payload: { claimType: "NOT_A_CLAIM" }
  });
  assert.equal(badClaimType.statusCode, 400);

  const notFoundApp = buildApp(
    fakeReviewService({
      editRule: async () => {
        throw new PersistenceError("NOT_FOUND", "rule missing");
      }
    })
  );
  const notFound = await notFoundApp.inject({
    method: "POST",
    url: "/api/admin/knowledge/rules/cand-missing/edit",
    headers: authedHeaders,
    payload: { confidence: 0.9 }
  });
  assert.equal(notFound.statusCode, 404);
});
