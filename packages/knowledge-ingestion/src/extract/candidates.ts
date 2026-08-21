import { createHash } from "node:crypto";

import {
  KnowledgeTypeSchema,
  resolveTaxonomyId,
  type JsonValue,
  type KnowledgeRule,
  type KnowledgeType
} from "@mystcrag/design-contract";
import { z } from "zod";

import { knowledgeDomainForType } from "../security.js";

export type KnowledgeRuleSeed = KnowledgeRule & { sourceId: string };

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

/**
 * Free-text sources only produce low-confidence NEEDS_REVIEW candidates
 * (task book section 30): honest extraction without pretending the program
 * reliably understands arbitrary prose. Low-confidence rules are never
 * auto-approved.
 */
export function extractFreeTextCandidates(
  contentText: string,
  context: { documentId: string; sourceId: string; fetchedAt: string }
): KnowledgeRuleSeed[] {
  const seeds: KnowledgeRuleSeed[] = [];
  const sentences = contentText
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  const seen = new Set<string>();
  for (const sentence of sentences) {
    const lowercased = sentence.toLowerCase();
    const matched = new Map<string, string>();
    for (const token of lowercased.split(/[^\p{L}\p{N}]+/u)) {
      if (token.length === 0) continue;
      const taxonomyId = resolveTaxonomyId(token);
      if (taxonomyId === null) continue;
      const domain = taxonomyId.split(":")[0];
      if (domain === undefined) continue;
      if (["color", "material", "style", "emotion"].includes(domain) && !matched.has(domain)) {
        matched.set(domain, taxonomyId);
      }
    }
    if (matched.size === 0) continue;

    const subjects = [...matched.values()].sort().slice(0, 2);
    const knowledgeType: KnowledgeType =
      matched.has("color") ? "COLOR_THEORY"
      : matched.has("material") ? "MATERIAL_COMPATIBILITY"
      : matched.has("style") ? "STYLE_RULE"
      : "CULTURAL_SYMBOLISM";
    const relation = "mentioned-with";
    const payload = {
      evidence: sentence.slice(0, 300),
      matchedDomains: [...matched.keys()].sort()
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ knowledgeType, subjects, relation, payload }))
      .digest("hex");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    seeds.push({
      id: `cand-${fingerprint.slice(0, 24)}`,
      sourceId: context.sourceId,
      knowledgeType,
      knowledgeDomain: knowledgeDomainForType(knowledgeType),
      subject: subjects.join("+"),
      relation,
      payload,
      conditions: {},
      confidence: 0.5,
      status: "NEEDS_REVIEW",
      sourceRefs: [{ sourceId: context.sourceId, documentId: context.documentId }],
      version: 1,
      fingerprint,
      createdAt: context.fetchedAt,
      updatedAt: context.fetchedAt
    });
  }
  return seeds;
}

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
