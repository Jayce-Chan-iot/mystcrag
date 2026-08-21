import assert from "node:assert/strict";
import test from "node:test";

import {
  KnowledgeDocumentSchema,
  KnowledgeRuleSchema,
  KnowledgeSourceSchema,
  SOURCE_REVIEW_TRANSITIONS,
  PRODUCTION_KNOWLEDGE_STATUSES,
  isProductionEligibleKnowledgeStatus
} from "../src/index";

const validSource = {
  id: "source-color-theory-book",
  name: "色彩设计手册（第三版）",
  sourceType: "BOOK",
  authorityScore: 0.8,
  allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
  language: "zh-CN"
};

const validDocument = {
  id: "doc-color-theory-ch3",
  sourceId: "source-color-theory-book",
  url: "https://books.example.com/color-theory/ch3",
  contentHash: "a".repeat(64),
  title: "第三章 邻近色与类似色",
  contentText: "Adjacent hues on the color wheel share undertones...",
  fetchedAt: "2026-08-20T10:00:00+08:00",
  parser: "static-html-basic",
  language: "zh-CN"
};

const validRule = {
  id: "rule-color-adjacent-hue",
  knowledgeType: "COLOR_THEORY",
  knowledgeDomain: "knowledge-domain:color-theory",
  subject: "color:blue",
  relation: "harmonizes-with",
  payload: { neighborHueStepDegrees: 30 },
  conditions: { appliesToStyleTags: ["style:minimal"] },
  confidence: 0.8,
  status: "APPROVED",
  sourceRefs: [{ sourceId: "source-color-theory-book", documentId: "doc-color-theory-ch3" }],
  version: 1,
  fingerprint: "b".repeat(64),
  createdAt: "2026-08-20T10:00:00+08:00",
  updatedAt: "2026-08-20T10:00:00+08:00"
};

test("valid knowledge sources, documents, and rules parse", () => {
  assert.equal(KnowledgeSourceSchema.safeParse(validSource).success, true);
  assert.equal(KnowledgeDocumentSchema.safeParse(validDocument).success, true);
  assert.equal(KnowledgeRuleSchema.safeParse(validRule).success, true);
});

test("a knowledge rule without source refs is rejected (provenance is mandatory)", () => {
  const noProvenance = { ...validRule, sourceRefs: [] };
  assert.equal(KnowledgeRuleSchema.safeParse(noProvenance).success, false);
});

test("knowledge rule confidence must stay within [0, 1]", () => {
  const tooConfident = { ...validRule, confidence: 1.5 };
  assert.equal(KnowledgeRuleSchema.safeParse(tooConfident).success, false);
  const zeroConfidence = { ...validRule, confidence: 0 };
  assert.equal(KnowledgeRuleSchema.safeParse(zeroConfidence).success, true);
});

test("all eleven knowledge types and all eight statuses are accepted; others are rejected", () => {
  const knowledgeTypes = [
    "COLOR_THEORY", "MATERIAL_COMPATIBILITY", "STYLE_RULE", "PROPORTION_RULE",
    "COMPOSITION_RULE", "TRANSITION_RULE", "FOCAL_RULE", "NEGATIVE_RULE",
    "CULTURAL_SYMBOLISM", "TAROT", "MARKET_OBSERVATION"
  ];
  for (const knowledgeType of knowledgeTypes) {
    assert.equal(
      KnowledgeRuleSchema.safeParse({ ...validRule, knowledgeType }).success,
      true,
      `expected ${knowledgeType} to be accepted`
    );
  }
  assert.equal(
    KnowledgeRuleSchema.safeParse({ ...validRule, knowledgeType: "VIBES" }).success,
    false
  );

  const statuses = [
    "NEW", "EXTRACTED", "VALIDATED", "NEEDS_REVIEW",
    "APPROVED", "REJECTED", "CONFLICTED", "SUPERSEDED"
  ];
  for (const status of statuses) {
    assert.equal(
      KnowledgeRuleSchema.safeParse({ ...validRule, status }).success,
      true,
      `expected ${status} to be accepted`
    );
  }
  assert.equal(KnowledgeRuleSchema.safeParse({ ...validRule, status: "LIVE" }).success, false);
});

test("knowledge domains must reference the controlled knowledge-domain taxonomy", () => {
  const unknownDomain = { ...validRule, knowledgeDomain: "knowledge-domain:vibes" };
  assert.equal(KnowledgeRuleSchema.safeParse(unknownDomain).success, false);

  const wrongDomain = { ...validRule, knowledgeDomain: "color:purple" };
  assert.equal(KnowledgeRuleSchema.safeParse(wrongDomain).success, false);
});

test("documents validate url, content hash, parser identity, and content text", () => {
  const badUrl = { ...validDocument, url: "not-a-url" };
  assert.equal(KnowledgeDocumentSchema.safeParse(badUrl).success, false);

  const badHash = { ...validDocument, contentHash: "xyz" };
  assert.equal(KnowledgeDocumentSchema.safeParse(badHash).success, false);

  const missingParser = { ...validDocument } as { parser?: string };
  delete missingParser.parser;
  assert.equal(KnowledgeDocumentSchema.safeParse(missingParser).success, false);

  const oversized = { ...validDocument, contentText: "x".repeat(200_001) };
  assert.equal(KnowledgeDocumentSchema.safeParse(oversized).success, false);

  const parsed = KnowledgeDocumentSchema.parse({ ...validDocument, contentText: undefined });
  assert.equal(parsed.contentText, "");
});

test("sources validate score bounds, source types, and allowed domains", () => {
  const badScore = { ...validSource, authorityScore: 1.5 };
  assert.equal(KnowledgeSourceSchema.safeParse(badScore).success, false);

  const badType = { ...validSource, sourceType: "WORD_OF_MOUTH" };
  assert.equal(KnowledgeSourceSchema.safeParse(badType).success, false);

  const noDomains = { ...validSource, allowedKnowledgeDomains: [] };
  assert.equal(KnowledgeSourceSchema.safeParse(noDomains).success, false);

  const unknownDomain = { ...validSource, allowedKnowledgeDomains: ["knowledge-domain:vibes"] };
  assert.equal(KnowledgeSourceSchema.safeParse(unknownDomain).success, false);
});

test("only APPROVED knowledge is production-eligible", () => {
  assert.deepEqual(PRODUCTION_KNOWLEDGE_STATUSES, ["APPROVED"]);
  assert.equal(isProductionEligibleKnowledgeStatus("APPROVED"), true);
  assert.equal(isProductionEligibleKnowledgeStatus("NEEDS_REVIEW"), false);
  assert.equal(isProductionEligibleKnowledgeStatus("CONFLICTED"), false);
});

test("unknown fields are rejected on all knowledge schemas", () => {
  assert.equal(
    KnowledgeRuleSchema.safeParse({ ...validRule, llmPrompt: "hidden" }).success,
    false
  );
  assert.equal(
    KnowledgeSourceSchema.safeParse({ ...validSource, secretKey: "x" }).success,
    false
  );
});

test("Q0 source registry fields: category, reliability, review status, crawl strategy", () => {
  const parsed = KnowledgeSourceSchema.parse({
    ...validSource,
    sourceCategory: "GEMOLOGY",
    reliabilityLevel: "HIGH",
    countryOrRegion: "United States",
    contentType: "DATASHEET",
    crawlStrategy: { maxPages: 5, followLinks: true, respectRobots: true },
    reviewStatus: "APPROVED",
    lastSuccessfulFetch: "2026-08-21T10:00:00Z",
    lastFailure: { at: "2026-08-20T10:00:00Z", reason: "http 503", consecutive: 1 }
  });
  assert.equal(parsed.sourceCategory, "GEMOLOGY");
  assert.equal(parsed.reliabilityLevel, "HIGH");
  assert.equal(parsed.reviewStatus, "APPROVED");
  assert.equal(parsed.crawlStrategy?.maxPages, 5);
  assert.equal(parsed.lastFailure?.consecutive, 1);
});

test("Q0 source registry defaults keep legacy fixtures parseable", () => {
  const parsed = KnowledgeSourceSchema.parse(validSource);
  assert.equal(parsed.sourceCategory, "MANUAL");
  assert.equal(parsed.reliabilityLevel, "MEDIUM");
  assert.equal(parsed.contentType, "OTHER");
  assert.equal(parsed.reviewStatus, "NEEDS_REVIEW");
  assert.equal(parsed.crawlStrategy, undefined);
});

test("Q0 source registry rejects invalid category, review status, and crawl strategy", () => {
  assert.equal(
    KnowledgeSourceSchema.safeParse({ ...validSource, sourceCategory: "INFLUENCER" }).success,
    false
  );
  assert.equal(
    KnowledgeSourceSchema.safeParse({ ...validSource, reviewStatus: "LIVE" }).success,
    false
  );
  assert.equal(
    KnowledgeSourceSchema.safeParse({
      ...validSource,
      crawlStrategy: { maxPages: 0 }
    }).success,
    false
  );
  assert.equal(
    KnowledgeSourceSchema.safeParse({
      ...validSource,
      crawlStrategy: { maxPages: 5, followLinks: true, extra: 1 }
    }).success,
    false
  );
});

test("Q0 source review transitions never allow direct DISCOVERED -> APPROVED", () => {
  assert.equal(SOURCE_REVIEW_TRANSITIONS.DISCOVERED.includes("APPROVED"), false);
  assert.equal(SOURCE_REVIEW_TRANSITIONS.NEEDS_REVIEW.includes("APPROVED"), true);
  assert.equal(SOURCE_REVIEW_TRANSITIONS.APPROVED.includes("DISABLED"), true);
  assert.equal(SOURCE_REVIEW_TRANSITIONS.DISABLED.includes("NEEDS_REVIEW"), true);
  assert.equal(SOURCE_REVIEW_TRANSITIONS.REJECTED.includes("NEEDS_REVIEW"), true);
});
