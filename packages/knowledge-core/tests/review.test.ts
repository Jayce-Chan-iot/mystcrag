import assert from "node:assert/strict";
import test from "node:test";

import type { StoredKnowledgeRule, StoredKnowledgeSource } from "@mystcrag/database";
import { KnowledgeSourceSchema } from "@mystcrag/design-contract";

import {
  classifyCandidate,
  detectRuleConflicts,
  validateKnowledgeRuleCandidate,
  AUTO_VALIDATE_CONFIDENCE_THRESHOLD,
  AUTO_VALIDATE_AUTHORITY_THRESHOLD
} from "../src/review/rules.js";
import { ruleFingerprint } from "../src/review/rules.js";

function baseRule(overrides: Partial<StoredKnowledgeRule> = {}): StoredKnowledgeRule {
  const knowledgeType = overrides.knowledgeType ?? "COLOR_THEORY";
  const subject = overrides.subject ?? "color:blue";
  const relation = overrides.relation ?? "harmonizes-with";
  const payload = overrides.payload ?? { companionColors: ["color:teal"] };
  return {
    id: "rule-test-01",
    knowledgeType,
    knowledgeDomain: "knowledge-domain:color-theory",
    subject,
    relation,
    payload,
    conditions: {},
    confidence: 0.9,
    status: "EXTRACTED",
    sourceRefs: [{ sourceId: "source-a", documentId: "doc-a" }],
    version: 1,
    fingerprint: ruleFingerprint(knowledgeType, subject, relation, payload),
    createdAt: "2026-08-21T00:00:00+08:00",
    updatedAt: "2026-08-21T00:00:00+08:00",
    sourceId: "source-a",
    knowledgeVersionId: null,
    ...overrides
  };
}

function baseSource(overrides: Partial<StoredKnowledgeSource> = {}): StoredKnowledgeSource {
  return KnowledgeSourceSchema.parse({
    id: "source-a",
    name: "测试来源",
    sourceType: "OFFICIAL_API",
    enabled: true,
    authorityScore: 0.9,
    allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
    language: "zh-CN",
    ...overrides
  });
}

test("validateKnowledgeRuleCandidate accepts a well-formed rule", () => {
  const result = validateKnowledgeRuleCandidate(baseRule());
  assert.deepEqual(result.issues, []);
  assert.equal(result.valid, true);
});

test("validateKnowledgeRuleCandidate rejects a subject outside the taxonomy", () => {
  const result = validateKnowledgeRuleCandidate(baseRule({ subject: "color:not-a-real-color" }));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("subject")));
});

test("validateKnowledgeRuleCandidate accepts compound subjects when every part resolves", () => {
  const result = validateKnowledgeRuleCandidate(
    baseRule({ subject: "color:purple+emotion:calm" })
  );
  assert.equal(result.valid, true);
});

test("validateKnowledgeRuleCandidate rejects compound subjects with one bad part", () => {
  const result = validateKnowledgeRuleCandidate(
    baseRule({ subject: "color:purple+material:nope" })
  );
  assert.equal(result.valid, false);
});

test("validateKnowledgeRuleCandidate flags a knowledge domain that mismatches the type", () => {
  const result = validateKnowledgeRuleCandidate(
    baseRule({ knowledgeDomain: "knowledge-domain:style-rule" })
  );
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("knowledgeDomain")));
});

test("validateKnowledgeRuleCandidate flags non-object payloads", () => {
  const result = validateKnowledgeRuleCandidate(baseRule({ payload: ["not", "an", "object"] }));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("payload")));
});

test("validateKnowledgeRuleCandidate flags forbidden effect claims in payload text", () => {
  const result = validateKnowledgeRuleCandidate(
    baseRule({
      knowledgeType: "CULTURAL_SYMBOLISM",
      knowledgeDomain: "knowledge-domain:cultural-symbolism",
      payload: { note: "佩戴后可治疗失眠并保证转运" }
    })
  );
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.includes("claim")),
    `expected a claim issue, got ${JSON.stringify(result.issues)}`
  );
});

test("classifyCandidate auto-validates only high confidence from authoritative sources", () => {
  assert.equal(
    classifyCandidate(baseRule(), baseSource({ authorityScore: 0.9 })),
    "VALIDATED"
  );
  assert.equal(
    classifyCandidate(baseRule({ confidence: 0.6 }), baseSource({ authorityScore: 0.9 })),
    "NEEDS_REVIEW"
  );
  assert.equal(
    classifyCandidate(baseRule(), baseSource({ authorityScore: 0.5 })),
    "NEEDS_REVIEW"
  );
  assert.equal(AUTO_VALIDATE_CONFIDENCE_THRESHOLD, 0.8);
  assert.equal(AUTO_VALIDATE_AUTHORITY_THRESHOLD, 0.8);
});

test("classifyCandidate sends invalid rules to human review instead of auto-approval", () => {
  assert.equal(
    classifyCandidate(
      baseRule({ subject: "color:bogus" }),
      baseSource({ authorityScore: 0.95 })
    ),
    "NEEDS_REVIEW"
  );
});

test("detectRuleConflicts groups same-key rules with divergent payloads", () => {
  const a = baseRule({ id: "r1", payload: { companionColors: ["color:teal"] } });
  const b = baseRule({ id: "r2", payload: { companionColors: ["color:orange"] } });
  const same = baseRule({ id: "r3" });
  const otherKey = baseRule({
    id: "r4",
    subject: "color:red",
    payload: { companionColors: ["color:orange"] }
  });

  const groups = detectRuleConflicts([a, b, same, otherKey]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]!.key,
    { knowledgeType: "COLOR_THEORY", subject: "color:blue", relation: "harmonizes-with" }
  );
  // The reviewer needs every rule in the disagreement, including the ones
  // that agree with each other, to resolve the group in one pass.
  assert.deepEqual(
    groups[0]!.rules.map((rule) => rule.id).sort(),
    ["r1", "r2", "r3"]
  );
});

test("detectRuleConflicts returns no groups when payloads agree", () => {
  const a = baseRule({ id: "r1" });
  const b = baseRule({ id: "r2" });
  assert.deepEqual(detectRuleConflicts([a, b]), []);
});
