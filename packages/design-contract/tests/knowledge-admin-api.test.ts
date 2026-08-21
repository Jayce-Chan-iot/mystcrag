import assert from "node:assert/strict";
import test from "node:test";

import {
  KnowledgeAdminConflictsResponseSchema,
  KnowledgeAdminOverviewResponseSchema,
  KnowledgeAdminPublishVersionRequestSchema,
  KnowledgeAdminQueueItemSchema,
  KnowledgeAdminReviewQueueResponseSchema,
  KnowledgeAdminReviewSourceRequestSchema,
  KnowledgeAdminSetSourceEnabledRequestSchema,
  KnowledgeAdminSourceMutationResponseSchema,
  KnowledgeAdminSourceQueueItemSchema,
  KnowledgeAdminSourceQueueResponseSchema,
  KnowledgeAdminUpdateSourcePolicyRequestSchema
} from "../src/index";

const queueItem = {
  ruleId: "cand-abc123",
  status: "NEEDS_REVIEW",
  knowledgeType: "COLOR_THEORY",
  knowledgeDomain: "knowledge-domain:color-theory",
  subject: "color:purple",
  relation: "pairs-well-with",
  confidence: 0.72,
  validation: { valid: true, issues: [] },
  evidence: [
    {
      source: {
        id: "source-handbook",
        name: "色彩设计手册",
        sourceType: "BOOK",
        sourceCategory: "BOOK",
        authorityScore: 0.9,
        reliabilityLevel: "HIGH",
        enabled: true
      },
      document: {
        id: "doc-ch3",
        title: "第三章 邻近色",
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
        documentId: "doc-ch3",
        sentence: "Amethyst purple pairs well with citrine yellow.",
        startOffset: 0,
        endOffset: 44
      }
    ]
  },
  payload: { matchedDomains: ["color:purple"] }
};

test("a fully evidenced review queue item parses", () => {
  assert.equal(KnowledgeAdminQueueItemSchema.safeParse(queueItem).success, true);
});

test("legacy candidates without extraction metadata parse as null extraction", () => {
  const legacy = { ...queueItem, extraction: null };
  assert.equal(KnowledgeAdminQueueItemSchema.safeParse(legacy).success, true);
});

test("queue items must not leak unknown storage fields (strict projection)", () => {
  const leaked = { ...queueItem, sourceId: "source-handbook" };
  assert.equal(KnowledgeAdminQueueItemSchema.safeParse(leaked).success, false);
});

test("queue item evidence document may be null but source may not", () => {
  const noDocument = {
    ...queueItem,
    evidence: [{ ...queueItem.evidence[0], document: null }]
  };
  assert.equal(KnowledgeAdminQueueItemSchema.safeParse(noDocument).success, true);
});

test("review queue response counts items", () => {
  const response = { items: [queueItem], total: 1 };
  assert.equal(KnowledgeAdminReviewQueueResponseSchema.safeParse(response).success, true);
  assert.equal(
    KnowledgeAdminReviewQueueResponseSchema.safeParse({ items: [queueItem] }).success,
    false
  );
});

test("overview counts every rule and source status explicitly", () => {
  const overview = {
    rules: {
      NEW: 1,
      EXTRACTED: 2,
      VALIDATED: 3,
      NEEDS_REVIEW: 4,
      APPROVED: 5,
      REJECTED: 6,
      CONFLICTED: 7,
      SUPERSEDED: 8
    },
    sources: {
      DISCOVERED: 1,
      NEEDS_REVIEW: 2,
      APPROVED: 3,
      REJECTED: 0,
      DISABLED: 0,
      enabled: 3
    },
    conflictGroups: 7,
    latestVersion: {
      id: "kv-2026-08-v1",
      version: "2026-08-v1",
      status: "PUBLISHED",
      ruleCount: 42,
      publishedAt: "2026-08-21T10:00:00+08:00"
    }
  };
  assert.equal(KnowledgeAdminOverviewResponseSchema.safeParse(overview).success, true);
  assert.equal(
    KnowledgeAdminOverviewResponseSchema.safeParse({
      ...overview,
      latestVersion: null
    }).success,
    true
  );
  const missingStatus = { ...overview, rules: { ...overview.rules, NEW: undefined } };
  assert.equal(KnowledgeAdminOverviewResponseSchema.safeParse(missingStatus).success, false);
  assert.equal(
    KnowledgeAdminOverviewResponseSchema.safeParse({
      ...overview,
      rules: { ...overview.rules, NEW: -1 }
    }).success,
    false
  );
});

test("conflict groups require at least two rules", () => {
  const group = {
    key: { knowledgeType: "COLOR_THEORY", subject: "color:blue", relation: "harmonizes-with" },
    rules: [
      { ruleId: "rule-a", status: "APPROVED", confidence: 0.9, payload: {} },
      { ruleId: "rule-b", status: "NEEDS_REVIEW", confidence: 0.7, payload: {} }
    ]
  };
  assert.equal(
    KnowledgeAdminConflictsResponseSchema.safeParse({ groups: [group] }).success,
    true
  );
  const lonely = { ...group, rules: group.rules.slice(0, 1) };
  assert.equal(
    KnowledgeAdminConflictsResponseSchema.safeParse({ groups: [lonely] }).success,
    false
  );
});

test("version slugs are required for publishing", () => {
  assert.equal(
    KnowledgeAdminPublishVersionRequestSchema.safeParse({ version: "2026-08-v2" }).success,
    true
  );
  assert.equal(
    KnowledgeAdminPublishVersionRequestSchema.safeParse({ version: "2026 08 v2" }).success,
    false
  );
  assert.equal(
    KnowledgeAdminPublishVersionRequestSchema.safeParse({ version: "" }).success,
    false
  );
});

const sourceItem = {
  id: "source-handbook",
  name: "色彩设计手册",
  sourceType: "BOOK",
  sourceCategory: "BOOK",
  contentType: "TEXTBOOK",
  reliabilityLevel: "HIGH",
  reviewStatus: "APPROVED",
  enabled: true,
  authorityScore: 0.9,
  allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
  language: "zh-CN"
};

test("source queue items project fetch health and policy", () => {
  assert.equal(KnowledgeAdminSourceQueueItemSchema.safeParse(sourceItem).success, true);
  const withHealth = {
    ...sourceItem,
    lastSuccessfulFetch: "2026-08-21T10:00:00+08:00",
    lastFailure: {
      at: "2026-08-20T10:00:00+08:00",
      reason: "upstream 503",
      consecutive: 2
    },
    rateLimit: { maxRequestsPerMinute: 10 },
    crawlStrategy: { maxPages: 5, followLinks: false, respectRobots: true }
  };
  assert.equal(KnowledgeAdminSourceQueueItemSchema.safeParse(withHealth).success, true);
  assert.equal(
    KnowledgeAdminSourceQueueResponseSchema.safeParse({ items: [withHealth], total: 1 })
      .success,
    true
  );
});

test("source review requests only allow human decision transitions", () => {
  assert.equal(
    KnowledgeAdminReviewSourceRequestSchema.safeParse({ reviewStatus: "APPROVED" }).success,
    true
  );
  assert.equal(
    KnowledgeAdminReviewSourceRequestSchema.safeParse({ reviewStatus: "DISCOVERED" })
      .success,
    false
  );
  assert.equal(
    KnowledgeAdminReviewSourceRequestSchema.safeParse({ reviewStatus: "DISABLED" }).success,
    false
  );
});

test("source policy updates require at least one field", () => {
  assert.equal(
    KnowledgeAdminUpdateSourcePolicyRequestSchema.safeParse({
      allowedKnowledgeDomains: ["knowledge-domain:material-compatibility"]
    }).success,
    true
  );
  assert.equal(
    KnowledgeAdminUpdateSourcePolicyRequestSchema.safeParse({
      maxRequestsPerMinute: 30
    }).success,
    true
  );
  assert.equal(
    KnowledgeAdminUpdateSourcePolicyRequestSchema.safeParse({
      maxRequestsPerMinute: 601
    }).success,
    false
  );
  assert.equal(
    KnowledgeAdminUpdateSourcePolicyRequestSchema.safeParse({}).success,
    false
  );
});

test("enable toggle and mutation responses are strict", () => {
  assert.equal(
    KnowledgeAdminSetSourceEnabledRequestSchema.safeParse({ enabled: false }).success,
    true
  );
  assert.equal(
    KnowledgeAdminSourceMutationResponseSchema.safeParse({
      sourceId: "source-handbook",
      reviewStatus: "DISABLED",
      enabled: false
    }).success,
    true
  );
});
