import type { KnowledgeDocument, KnowledgeSource } from "@mystcrag/design-contract";

export const KNOWLEDGE_SOURCE_FIXTURES: readonly KnowledgeSource[] = [
  {
    id: "source-fixture-handbook",
    name: "玄矶设计手册（内部审定）",
    sourceType: "MANUAL",
    authorityScore: 0.95,
    allowedKnowledgeDomains: [
      "knowledge-domain:color-theory",
      "knowledge-domain:material-compatibility",
      "knowledge-domain:style-rule",
      "knowledge-domain:proportion-rule",
      "knowledge-domain:composition-rule",
      "knowledge-domain:transition-rule",
      "knowledge-domain:focal-rule",
      "knowledge-domain:negative-rule",
      "knowledge-domain:cultural-symbolism",
      "knowledge-domain:tarot",
      "knowledge-domain:market-observation"
    ],
    language: "zh-CN",
    enabled: true,
    sourceCategory: "MANUAL",
    reliabilityLevel: "HIGH",
    contentType: "TEXTBOOK",
    reviewStatus: "APPROVED"
  },
  {
    id: "source-fixture-market",
    name: "市场观察记录",
    sourceType: "MANUAL",
    authorityScore: 0.7,
    allowedKnowledgeDomains: ["knowledge-domain:market-observation"],
    language: "zh-CN",
    enabled: true,
    sourceCategory: "MANUAL",
    reliabilityLevel: "MEDIUM",
    contentType: "OTHER",
    reviewStatus: "APPROVED"
  }
];

export const KNOWLEDGE_DOCUMENT_FIXTURES: readonly KnowledgeDocument[] = [
  {
    id: "doc-fixture-handbook",
    sourceId: "source-fixture-handbook",
    url: "https://fixtures.mystcrag.internal/handbook",
    contentHash: "f".repeat(64),
    title: "玄矶设计手册",
    contentText:
      "Color harmony, material compatibility, proportion and composition rules reviewed by the design team.",
    fetchedAt: "2026-08-20T08:00:00+08:00",
    parser: "fixture",
    language: "zh-CN",
    status: "FETCHED"
  },
  {
    id: "doc-fixture-market",
    sourceId: "source-fixture-market",
    url: "https://fixtures.mystcrag.internal/market",
    contentHash: "e".repeat(64),
    title: "市场观察记录",
    contentText: "Market observations on palette popularity for crystal bracelets.",
    fetchedAt: "2026-08-20T08:00:00+08:00",
    parser: "fixture",
    language: "zh-CN",
    status: "FETCHED"
  }
];
