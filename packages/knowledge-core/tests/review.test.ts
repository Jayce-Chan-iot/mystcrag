import assert from "node:assert/strict";
import test from "node:test";

import type { StoredKnowledgeRule, StoredKnowledgeSource } from "@mystcrag/database";
import { KnowledgeSourceSchema } from "@mystcrag/design-contract";

import {
  canonicalPropertyValue,
  classifyCandidate,
  detectRuleConflicts,
  planCorroborationMerges,
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
    sourceRefs: [{ sourceId: "source-fixture-handbook", documentId: "doc-a" }],
    version: 1,
    fingerprint: ruleFingerprint(knowledgeType, subject, relation, payload),
    createdAt: "2026-08-21T00:00:00+08:00",
    updatedAt: "2026-08-21T00:00:00+08:00",
    sourceId: "source-fixture-handbook",
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

test("has-property rules of one crystal conflict only per property, not across properties", () => {
  const gemRule = (id: string, property: string, value: string): StoredKnowledgeRule =>
    baseRule({
      id,
      knowledgeType: "CRYSTAL_GEMOLOGY",
      knowledgeDomain: "knowledge-domain:crystal-gemology",
      subject: "material:amethyst",
      relation: "has-property",
      payload: { property, value },
      claimType: "GEMOLOGICAL_FACT"
    });

  // Different properties of the same crystal are different facts, not a
  // disagreement — grouping them would park every crystal profile in CONFLICTED.
  const mohs = gemRule("r-mohs", "mohsHardness", "7");
  const system = gemRule("r-system", "crystalSystem", "Trigonal");
  assert.deepEqual(detectRuleConflicts([mohs, system]), []);

  // Diverging values for the SAME property stay a reviewable conflict.
  const mohsDivergent = gemRule("r-mohs-alt", "mohsHardness", "6");
  const groups = detectRuleConflicts([mohs, system, mohsDivergent]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]!.rules.map((rule) => rule.id).sort(),
    ["r-mohs", "r-mohs-alt"]
  );
});

test("external-source rules require claimType", () => {
  const rule = baseRule({
    sourceRefs: [{ sourceId: "source-gia-gem-encyclopedia" }]
  });
  const result = validateKnowledgeRuleCandidate(rule);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.includes("claimType")));
});

test("fixture-source rules do not require claimType", () => {
  const result = validateKnowledgeRuleCandidate(
    baseRule({ sourceRefs: [{ sourceId: "source-fixture-handbook" }] })
  );
  assert.equal(result.valid, true);
});

test("high-confidence scientific facts require two independent sources", () => {
  const one = baseRule({
    claimType: "GEMOLOGICAL_FACT",
    confidence: 0.85,
    sourceRefs: [{ sourceId: "source-gia-gem-encyclopedia" }]
  });
  assert.ok(
    validateKnowledgeRuleCandidate(one).issues.some((i) => i.includes("independent"))
  );
  const two = baseRule({
    claimType: "GEMOLOGICAL_FACT",
    confidence: 0.85,
    sourceRefs: [
      { sourceId: "source-gia-gem-encyclopedia" },
      { sourceId: "source-gemdat-gemstone-pages" }
    ]
  });
  assert.equal(validateKnowledgeRuleCandidate(two).valid, true);
});

test("single-source scientific fact never auto-validates", () => {
  const rule = baseRule({
    claimType: "GEMOLOGICAL_FACT",
    confidence: 0.85,
    sourceRefs: [{ sourceId: "source-gia-gem-encyclopedia" }]
  });
  const source = baseSource({
    id: "source-gia-gem-encyclopedia",
    authorityScore: 0.95
  });
  assert.equal(classifyCandidate(rule, source), "NEEDS_REVIEW");
});

test("two-source scientific fact auto-validates at high confidence and authority", () => {
  const rule = baseRule({
    claimType: "GEMOLOGICAL_FACT",
    confidence: 0.85,
    sourceRefs: [
      { sourceId: "source-gia-gem-encyclopedia" },
      { sourceId: "source-gemdat-gemstone-pages" }
    ]
  });
  const source = baseSource({
    id: "source-gia-gem-encyclopedia",
    authorityScore: 0.95
  });
  assert.equal(classifyCandidate(rule, source), "VALIDATED");
});

test("canonicalPropertyValue unifies surface formats of the same gem fact", () => {
  // Range dashes and the word "to" are the same fact (GemDat vs Wikipedia).
  assert.equal(canonicalPropertyValue("mohsHardness", "6.5–7"), canonicalPropertyValue("mohsHardness", "6.5 to 7"));
  assert.equal(canonicalPropertyValue("mohsHardness", "1.530-1.543"), canonicalPropertyValue("mohsHardness", "1.530 to 1.543"));
  // Trailing zeros and standalone numbers are numeric equality.
  assert.equal(canonicalPropertyValue("mohsHardness", "7"), canonicalPropertyValue("mohsHardness", "7.0"));
  // Case-insensitive categorical values.
  assert.equal(canonicalPropertyValue("fracture", "Conchoidal"), canonicalPropertyValue("fracture", "conchoidal"));
  // Chemical formulas ignore spacing introduced by HTML extraction.
  assert.equal(canonicalPropertyValue("chemicalFormula", "SiO 2"), canonicalPropertyValue("chemicalFormula", "SiO2"));
  // Crystal-system synonyms.
  assert.equal(canonicalPropertyValue("crystalSystem", "Cubic"), canonicalPropertyValue("crystalSystem", "Isometric"));
  // Comma lists compare as sets.
  assert.equal(
    canonicalPropertyValue("transparency", "Translucent,Opaque"),
    canonicalPropertyValue("transparency", "Opaque,Translucent")
  );
  // Annotation suffixes from the source page are not part of the value.
  assert.equal(
    canonicalPropertyValue("chemicalFormula", "KAlSi3O8 IMA status Variety of microcline"),
    canonicalPropertyValue("chemicalFormula", "KAlSi3O8")
  );
});

test("canonicalPropertyValue keeps genuinely different facts different", () => {
  assert.notEqual(canonicalPropertyValue("mohsHardness", "2.66"), canonicalPropertyValue("mohsHardness", "2.65"));
  assert.notEqual(
    canonicalPropertyValue("refractiveIndex", "1.739 to 1.770"),
    canonicalPropertyValue("refractiveIndex", "1.746 to 1.755")
  );
  assert.notEqual(
    canonicalPropertyValue("transparency", "Transparent"),
    canonicalPropertyValue("transparency", "Translucent")
  );
});

test("canonically equal has-property values from two sources are corroboration, not conflict", () => {
  const gemRule = (id: string, property: string, value: string, sourceId: string): StoredKnowledgeRule =>
    baseRule({
      id,
      knowledgeType: "CRYSTAL_GEMOLOGY",
      knowledgeDomain: "knowledge-domain:crystal-gemology",
      subject: "material:agate",
      relation: "has-property",
      payload: { property, value },
      claimType: "GEMOLOGICAL_FACT",
      sourceRefs: [{ sourceId, documentId: `doc-${id}` }],
      sourceId
    });

  // GemDat and Wikipedia describe the same hardness with different dashes —
  // that is §19 corroboration, so it must NOT park both rules in CONFLICTED.
  const gemdat = gemRule("r-gemdat", "mohsHardness", "6.5–7", "source-gemdat-gemstone-pages");
  const wiki = gemRule("r-wiki", "mohsHardness", "6.5 to 7", "source-wikipedia-reference");
  assert.deepEqual(detectRuleConflicts([gemdat, wiki]), []);

  // A genuinely divergent third value still conflicts.
  const divergent = gemRule("r-gia", "mohsHardness", "6", "source-gia-gem-encyclopedia");
  const groups = detectRuleConflicts([gemdat, wiki, divergent]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]!.rules.map((rule) => rule.id).sort(),
    ["r-gemdat", "r-gia", "r-wiki"]
  );
});

test("planCorroborationMerges folds canonically equal duplicates into one plan", () => {
  const gemRule = (
    id: string,
    property: string,
    value: string,
    sourceId: string,
    confidence = 0.9
  ): StoredKnowledgeRule =>
    baseRule({
      id,
      knowledgeType: "CRYSTAL_GEMOLOGY",
      knowledgeDomain: "knowledge-domain:crystal-gemology",
      subject: "material:agate",
      relation: "has-property",
      payload: { property, value },
      claimType: "GEMOLOGICAL_FACT",
      confidence,
      sourceRefs: [{ sourceId, documentId: `doc-${id}` }],
      sourceId
    });

  const annotated = gemRule("r-annotated", "chemicalFormula", "SiO2 (silicon dioxide) IMA status Variety of quartz", "source-gia-gem-encyclopedia");
  const clean = gemRule("r-clean", "chemicalFormula", "SiO 2", "source-gemdat-gemstone-pages");
  const sameValueOtherSource = gemRule("r-wiki", "mohsHardness", "6.5 to 7", "source-wikipedia-reference");
  const gemdatRange = gemRule("r-gemdat-range", "mohsHardness", "6.5–7", "source-gemdat-gemstone-pages");

  // Two independent corroborating facts, plus one genuine conflict pair that
  // must NOT be merged (different canonical values stay for human review).
  const genuine = gemRule("r-genuine-divergent", "mohsHardness", "6", "source-gia-gem-encyclopedia");
  const plans = planCorroborationMerges([
    annotated,
    clean,
    sameValueOtherSource,
    gemdatRange,
    genuine
  ]);

  // The chemicalFormula pair merges to the cleanest value; the hardness pair
  // merges; the divergent hardness rule joins no plan.
  assert.equal(plans.length, 2);

  const formulaPlan = plans.find((plan) => plan.primary.id === "r-clean");
  assert.ok(formulaPlan !== undefined);
  assert.deepEqual(formulaPlan.secondaries.map((rule) => rule.id), ["r-annotated"]);

  const hardnessPlan = plans.find((plan) =>
    ["r-gemdat-range", "r-wiki"].includes(plan.primary.id)
  );
  assert.ok(hardnessPlan !== undefined);
  const hardnessIds = [hardnessPlan.primary.id, ...hardnessPlan.secondaries.map((r) => r.id)].sort();
  assert.deepEqual(hardnessIds, ["r-gemdat-range", "r-wiki"]);
  assert.ok(!hardnessIds.includes("r-genuine-divergent"));
});

test("planCorroborationMerges returns no plan for single rules or exact duplicates", () => {
  const gemRule = (id: string, value: string, sourceId: string): StoredKnowledgeRule =>
    baseRule({
      id,
      knowledgeType: "CRYSTAL_GEMOLOGY",
      knowledgeDomain: "knowledge-domain:crystal-gemology",
      subject: "material:amethyst",
      relation: "has-property",
      payload: { property: "mohsHardness", value },
      claimType: "GEMOLOGICAL_FACT",
      sourceRefs: [{ sourceId, documentId: `doc-${id}` }],
      sourceId
    });

  // A lone rule has nothing to corroborate with.
  assert.deepEqual(planCorroborationMerges([gemRule("r-lone", "7", "source-gia-gem-encyclopedia")]), []);

  // APPROVED / REJECTED / SUPERSEDED rules never join a merge plan: approved
  // facts are production-stable and retired facts stay retired.
  const approved = { ...gemRule("r-approved", "7", "source-gia-gem-encyclopedia"), status: "APPROVED" as const };
  const candidate = gemRule("r-candidate", "7.0", "source-gemdat-gemstone-pages");
  assert.deepEqual(planCorroborationMerges([approved, candidate]), []);
});
