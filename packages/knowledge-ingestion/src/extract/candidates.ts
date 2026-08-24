import { createHash } from "node:crypto";

import {
  KnowledgeTypeSchema,
  knowledgeDomainForType,
  type JsonValue
} from "@mystcrag/design-contract";
import { z } from "zod";

import type { KnowledgeRuleSeed } from "./extractor.js";

export type { KnowledgeRuleSeed };

/** Structured (JSON/CSV/API) sources are auto-extracted (task book section 30). */
export const StructuredRuleSchema = z.strictObject({
  knowledgeType: KnowledgeTypeSchema,
  subject: z.string().trim().min(1).max(160),
  relation: z.string().trim().min(1).max(160),
  payload: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1)
});

export const StructuredDocumentSchema = z.strictObject({
  url: z.url(),
  title: z.string().trim().min(1).max(300),
  contentText: z.string().max(200_000).default(""),
  rules: z.array(StructuredRuleSchema).default([])
});

export const StructuredFeedSchema = z.strictObject({
  documents: z.array(StructuredDocumentSchema).min(1)
});

export type StructuredFeed = z.infer<typeof StructuredFeedSchema>;

export function structuredRuleToSeed(
  rule: z.infer<typeof StructuredRuleSchema>,
  context: { sourceId: string; documentId: string; fetchedAt: string }
): KnowledgeRuleSeed {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        knowledgeType: rule.knowledgeType,
        subject: rule.subject,
        relation: rule.relation,
        payload: rule.payload
      })
    )
    .digest("hex");
  return {
    id: `cand-${fingerprint.slice(0, 24)}`,
    sourceId: context.sourceId,
    knowledgeType: rule.knowledgeType,
    knowledgeDomain: knowledgeDomainForType(rule.knowledgeType),
    subject: rule.subject,
    relation: rule.relation,
    payload: rule.payload as JsonValue,
    conditions: {},
    confidence: rule.confidence,
    status: "NEW",
    sourceRefs: [{ sourceId: context.sourceId, documentId: context.documentId }],
    version: 1,
    fingerprint,
    createdAt: context.fetchedAt,
    updatedAt: context.fetchedAt
  };
}
