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
 * A rule is "external" when at least one of its source refs comes from a
 * real acquired source rather than the seeded fixture corpus. Console V1
 * overview and the Batch B KPIs use this to report acquisition progress
 * separately from the bootstrap baseline.
 */
export function isExternalRule(rule: StoredKnowledgeRule): boolean {
  return rule.sourceRefs.some((ref) => isExternalSourceRef(ref.sourceId));
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

/** Crystal-system synonyms reported by different gem references. */
const CRYSTAL_SYSTEM_SYNONYMS: Readonly<Record<string, string>> = {
  isometric: "cubic"
};

/**
 * Canonicalizes a `has-property` value for comparison so that the same
 * gemological fact reported in two surface formats ("6.5–7" vs "6.5 to 7",
 * "Cubic" vs "Isometric", "SiO 2" vs "SiO2") compares equal and registers as
 * §19 corroboration instead of a false conflict. Genuinely different values
 * (2.66 vs 2.65, disjoint ranges) must still compare unequal.
 */
export function canonicalPropertyValue(property: string, rawValue: string): string {
  let value = rawValue.trim().replace(/\s+/g, " ");
  // Source-page annotations trail some values ("KAlSi3O8 IMA status Variety of
  // microcline") — they describe nomenclature, not the value itself.
  value = value.split(" IMA status")[0]!.trim();
  const lower = value.toLowerCase();
  const withoutSpaces = value.replace(/\s+/g, "");

  // Numeric or numeric range: normalize to "<min> to <max>" with trailing
  // zeros stripped so "7.0" === "7" and dashes === "to".
  const numeric = lower.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)$/);
  if (numeric !== null) {
    return `${trimNumber(numeric[1]!)} to ${trimNumber(numeric[2]!)}`;
  }
  const singleNumber = lower.match(/^(\d+(?:\.\d+)?)$/);
  if (singleNumber !== null) {
    return trimNumber(singleNumber[1]!);
  }

  if (property === "chemicalFormula") {
    // Parenthesized explanations ("(silicon dioxide)") are annotations, so the
    // canonical form is the bare spaced-out formula.
    return value.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, "").toLowerCase();
  }

  if (property === "crystalSystem") {
    return CRYSTAL_SYSTEM_SYNONYMS[lower] ?? lower;
  }

  // Comma-separated categorical lists compare as sets.
  if (value.includes(",")) {
    return [...new Set(value.split(",").map((part) => part.trim().toLowerCase()))]
      .sort()
      .join(",");
  }
  return lower;
}

function trimNumber(raw: string): string {
  return String(Number(raw));
}

function propertyOfRule(rule: StoredKnowledgeRule): string | null {
  if (rule.relation !== "has-property") return null;
  const payload = rule.payload as { property?: unknown };
  return typeof payload.property === "string" ? payload.property : null;
}

function valueOfRule(rule: StoredKnowledgeRule): string | null {
  const payload = rule.payload as { value?: unknown };
  return typeof payload.value === "string" ? payload.value : null;
}

/**
 * Two rules with the same (knowledgeType, subject, relation) but different
 * payloads disagree about the same fact, so neither may be auto-approved.
 * Identical payloads are already deduplicated by the unique fingerprint.
 * `has-property` rules carry the fact's identity in `payload.property`, so a
 * crystal's Mohs hardness and crystal system are different facts — and two
 * sources reporting the SAME property with canonically equal values (§19
 * corroboration) do not disagree at all.
 */
function conflictGroupKey(rule: StoredKnowledgeRule): string {
  const base = `${rule.knowledgeType}\u0000${rule.subject}\u0000${rule.relation}`;
  const property = propertyOfRule(rule);
  if (property === null) return base;
  return `${base}\u0000${property}`;
}

export type CorroborationMergePlan = {
  primary: StoredKnowledgeRule;
  secondaries: StoredKnowledgeRule[];
};

/** Production-stable and retired rules never fold into a corroboration merge. */
const NON_MERGEABLE_STATUSES = new Set(["APPROVED", "REJECTED", "SUPERSEDED"]);

/**
 * Task book §19 / Console V1 corroboration planning: two candidate rules that
 * assert the same `has-property` fact in different surface formats ("6.5–7" vs
 * "6.5 to 7") are one reviewable fact reported by two independent sources.
 * Each returned plan folds the secondaries' sourceRefs and sentence evidence
 * into the primary (which keeps its own value and fingerprint) and retires the
 * secondaries to SUPERSEDED — so a high-confidence FACT claim accumulates its
 * ≥2 independent sources on a single rule. Genuinely divergent values join no
 * plan: they stay separate for human conflict review. A plan requires ≥2
 * distinct sourceIds, because one source restating itself is not corroboration.
 * The primary is the most trustworthy rendering: highest confidence first,
 * then the cleanest (shortest) raw value, then a stable id order.
 */
export function planCorroborationMerges(
  rules: readonly StoredKnowledgeRule[]
): CorroborationMergePlan[] {
  const buckets = new Map<string, StoredKnowledgeRule[]>();
  for (const rule of rules) {
    if (NON_MERGEABLE_STATUSES.has(rule.status)) continue;
    const property = propertyOfRule(rule);
    if (property === null) continue;
    const value = valueOfRule(rule);
    if (value === null) continue;
    const key = `${conflictGroupKey(rule)}\u0000${canonicalPropertyValue(property, value)}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [rule]);
    } else {
      bucket.push(rule);
    }
  }

  const plans: CorroborationMergePlan[] = [];
  for (const bucket of buckets.values()) {
    const sources = new Set(
      bucket.flatMap((rule) => rule.sourceRefs.map((ref) => ref.sourceId))
    );
    if (bucket.length < 2 || sources.size < 2) continue;
    const ordered = [...bucket].sort(compareMergeCandidates);
    plans.push({ primary: ordered[0]!, secondaries: ordered.slice(1) });
  }
  return plans;
}

function compareMergeCandidates(a: StoredKnowledgeRule, b: StoredKnowledgeRule): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  const aLength = valueOfRule(a)?.length ?? Number.MAX_SAFE_INTEGER;
  const bLength = valueOfRule(b)?.length ?? Number.MAX_SAFE_INTEGER;
  if (aLength !== bLength) return aLength - bLength;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function detectRuleConflicts(
  rules: readonly StoredKnowledgeRule[]
): KnowledgeConflictGroup[] {
  const groups = new Map<string, StoredKnowledgeRule[]>();
  for (const rule of rules) {
    const key = conflictGroupKey(rule);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [rule]);
    } else {
      bucket.push(rule);
    }
  }

  const conflicts: KnowledgeConflictGroup[] = [];
  for (const [serialized, bucket] of groups) {
    const property = propertyOfRule(bucket[0]!);
    const disagrees =
      property !== null
        ? new Set(
            bucket.map((rule) => canonicalPropertyValue(property, valueOfRule(rule) ?? ""))
          ).size > 1
        : new Set(bucket.map((rule) => rule.fingerprint)).size > 1;
    if (!disagrees) continue;
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
