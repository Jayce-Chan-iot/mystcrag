import { createHash } from "node:crypto";

import {
  knowledgeDomainForType,
  resolveTaxonomyId,
  type ClaimType,
  type KnowledgeType
} from "@mystcrag/design-contract";
import type { StoredKnowledgeRule, StoredKnowledgeSource } from "@mystcrag/database";

/**
 * Review-chain pure logic (task book sections 12, 18, 34): candidate
 * validation, auto-validation classification, and conflict detection.
 * Only APPROVED rules ever reach production; everything below that line is
 * decided here or by a human reviewer.
 */

export const AUTO_VALIDATE_CONFIDENCE_THRESHOLD = 0.8;
export const AUTO_VALIDATE_AUTHORITY_THRESHOLD = 0.8;

/**
 * Task book §12: externally-acquired rules (i.e. not seeded from the internal
 * fixture corpus) must declare a claimType before they may be reviewed, so the
 * reviewer knows what grade of fact they are handling.
 */
const EXTERNAL_SOURCE_PREFIXES: readonly string[] = ["source-fixture-"];

function isExternalSourceRef(sourceId: string): boolean {
  return !EXTERNAL_SOURCE_PREFIXES.some((prefix) => sourceId.startsWith(prefix));
}

/**
 * Task book §19: high-confidence scientific/gemological facts are the ones that
 * drive downstream recommendations, so they require corroboration from at least
 * two independent sources before they may auto-validate.
 */
const FACT_CLAIM_TYPES: readonly ClaimType[] = [
  "SCIENTIFIC_FACT",
  "GEMOLOGICAL_FACT"
];

function distinctSourceIds(rule: StoredKnowledgeRule): Set<string> {
  return new Set(rule.sourceRefs.map((ref) => ref.sourceId));
}

function isSingleSourceFact(rule: StoredKnowledgeRule): boolean {
  return (
    rule.claimType !== undefined &&
    FACT_CLAIM_TYPES.includes(rule.claimType) &&
    distinctSourceIds(rule).size < 2
  );
}

/**
 * Claim phrases that must never ship inside production knowledge text
 * (task book compliance boundary: no medical, guaranteed-effect, or
 * deterministic-fortune claims). Matches are validation issues, which route
 * the rule to NEEDS_REVIEW instead of auto-validation.
 */
const FORBIDDEN_CLAIM_PHRASES: readonly string[] = [
  "治疗",
  "治愈",
  "疗效",
  "医用",
  "药用",
  "保证",
  "必定",
  "必然",
  "转运",
  "招财",
  "辟邪",
  "开运",
  "带来好运",
  "改变运势",
  "改变命运",
  "cure",
  "heal",
  "healing",
  "medical",
  "guarantee",
  "guaranteed"
];

export function ruleFingerprint(
  knowledgeType: KnowledgeType,
  subject: string,
  relation: string,
  payload: unknown
): string {
  return createHash("sha256")
    .update(JSON.stringify({ knowledgeType, subject, relation, payload }))
    .digest("hex");
}

export type KnowledgeRuleValidation = {
  valid: boolean;
  issues: string[];
};

export function validateKnowledgeRuleCandidate(
  rule: StoredKnowledgeRule
): KnowledgeRuleValidation {
  const issues: string[] = [];

  const expectedDomain = knowledgeDomainForType(rule.knowledgeType);
  if (rule.knowledgeDomain !== expectedDomain) {
    issues.push(
      `knowledgeDomain "${rule.knowledgeDomain}" does not match the domain for ${rule.knowledgeType} ("${expectedDomain}")`
    );
  }

  const unresolvedSubject = rule.subject
    .split("+")
    .filter((part) => part.length > 0 && resolveTaxonomyId(part) === null);
  if (unresolvedSubject.length > 0) {
    issues.push(`subject "${rule.subject}" is not a canonical taxonomy ref (${unresolvedSubject.join(", ")})`);
  }

  if (
    typeof rule.payload !== "object" ||
    rule.payload === null ||
    Array.isArray(rule.payload)
  ) {
    issues.push("payload must be a JSON object");
  }

  // The forbidden-claims rules ARE the compliance boundary: their payloads
  // name the banned phrases, so the claim scan must not flag them.
  if (rule.relation !== "forbidden-claims") {
    const claimHits = forbiddenClaimsIn(JSON.stringify(rule.payload ?? {}), FORBIDDEN_CLAIM_PHRASES);
    if (claimHits.length > 0) {
      issues.push(`payload contains forbidden claim phrases: ${claimHits.join(", ")}`);
    }
  }

  // Task book §12: external-source rules must declare what grade of fact they
  // assert so the review chain can route them correctly.
  const hasExternalSource = rule.sourceRefs.some((ref) =>
    isExternalSourceRef(ref.sourceId)
  );
  if (hasExternalSource && rule.claimType === undefined) {
    issues.push("external-source rules must declare claimType (task book §12)");
  }

  // Task book §19: high-confidence factual claims need independent corroboration.
  if (
    isSingleSourceFact(rule) &&
    (rule.confidence ?? 0) >= AUTO_VALIDATE_CONFIDENCE_THRESHOLD
  ) {
    issues.push(
      "high-confidence SCIENTIFIC/GEMOLOGICAL facts require ≥2 independent sources (task book §19)"
    );
  }

  return { valid: issues.length === 0, issues };
}

function forbiddenClaimsIn(text: string, phrases: readonly string[]): string[] {
  const lowercased = text.toLowerCase();
  return phrases.filter((phrase) => lowercased.includes(phrase.toLowerCase()));
}

export type CandidateClassification = "VALIDATED" | "NEEDS_REVIEW";

/**
 * Structured, high-confidence knowledge from authoritative sources can be
 * machine-validated (EXTRACTED → VALIDATED); everything else — low
 * confidence, weak source, invalid payload, or claim-flagged text — goes to
 * a human (task book section 30).
 */
export function classifyCandidate(
  rule: StoredKnowledgeRule,
  source: StoredKnowledgeSource
): CandidateClassification {
  if (!validateKnowledgeRuleCandidate(rule).valid) {
    return "NEEDS_REVIEW";
  }
  if (rule.confidence < AUTO_VALIDATE_CONFIDENCE_THRESHOLD) {
    return "NEEDS_REVIEW";
  }
  if (source.authorityScore < AUTO_VALIDATE_AUTHORITY_THRESHOLD) {
    return "NEEDS_REVIEW";
  }
  // Non-load-bearing invariant (task book §7.5): a single-source scientific/
  // gemological fact may never auto-validate, regardless of confidence or
  // authority. This guard is deliberately redundant with the validate
  // two-source issue (confidence ≥ 0.8) and the confidence check (< 0.8)
  // above — it is kept purely as defense-in-depth so that a future weakening
  // of validateKnowledgeRuleCandidate can never auto-validate a single-source
  // FACT claim.
  if (isSingleSourceFact(rule)) {
    return "NEEDS_REVIEW";
  }
  return "VALIDATED";
}

export type KnowledgeConflictKey = {
  knowledgeType: KnowledgeType;
  subject: string;
  relation: string;
};

export type KnowledgeConflictGroup = {
  key: KnowledgeConflictKey;
  rules: StoredKnowledgeRule[];
};

/**
 * Two rules with the same (knowledgeType, subject, relation) but different
 * payloads disagree about the same fact, so neither may be auto-approved.
 * Identical payloads are already deduplicated by the unique fingerprint.
 */
export function detectRuleConflicts(
  rules: readonly StoredKnowledgeRule[]
): KnowledgeConflictGroup[] {
  const groups = new Map<string, StoredKnowledgeRule[]>();
  for (const rule of rules) {
    const key = `${rule.knowledgeType}\u0000${rule.subject}\u0000${rule.relation}`;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [rule]);
    } else {
      bucket.push(rule);
    }
  }

  const conflicts: KnowledgeConflictGroup[] = [];
  for (const [serialized, bucket] of groups) {
    const fingerprints = new Set(bucket.map((rule) => rule.fingerprint));
    if (fingerprints.size <= 1) continue;
    const [knowledgeType, subject, relation] = serialized.split("\u0000");
    conflicts.push({
      key: {
        knowledgeType: knowledgeType as KnowledgeType,
        subject: subject!,
        relation: relation!
      },
      rules: bucket.sort((a, b) => (a.id < b.id ? -1 : 1))
    });
  }
  return conflicts;
}
