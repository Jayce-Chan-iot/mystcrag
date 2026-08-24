import type { StoredKnowledgeRule } from "@mystcrag/database";

/**
 * Public projection of a knowledge rule for MCP responses: identity, subject,
 * relation, confidence, and a human-readable summary. Fingerprints, source
 * references, and internal version bookkeeping stay server-side.
 */
export type PublicRuleSummary = {
  ruleId: string;
  knowledgeType: string;
  knowledgeDomain: string;
  subject: string;
  relation: string;
  confidence: number;
  summary: string;
  note?: string;
};

function payloadNote(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const note = (payload as Record<string, unknown>).note;
  return typeof note === "string" ? note : undefined;
}

function payloadLabel(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const label = (payload as Record<string, unknown>).rule;
  return typeof label === "string" ? label : undefined;
}

export function toPublicRuleSummary(rule: StoredKnowledgeRule): PublicRuleSummary {
  const note = payloadNote(rule.payload);
  const label = payloadLabel(rule.payload);
  return {
    ruleId: rule.id,
    knowledgeType: rule.knowledgeType,
    knowledgeDomain: rule.knowledgeDomain,
    subject: rule.subject,
    relation: rule.relation,
    confidence: rule.confidence,
    summary: note ?? label ?? `${rule.subject} ${rule.relation}`,
    ...(note === undefined ? {} : { note })
  };
}
