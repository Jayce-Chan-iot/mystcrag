import assert from "node:assert/strict";
import test from "node:test";

import type { StoredKnowledgeRule } from "@mystcrag/database";
import {
  KnowledgeRuleSchema,
  type KnowledgeRule,
  listTaxonomyTerms,
  resolveTaxonomyId
} from "@mystcrag/design-contract";

import { detectRuleConflicts, validateKnowledgeRuleCandidate } from "../src/review/rules.js";
import { compileDecisionRules } from "../src/compiler/rule-compiler.js";
import { KNOWLEDGE_RULE_FIXTURES } from "../src/fixtures/knowledge-rules.js";
import { KNOWLEDGE_SOURCE_FIXTURES } from "../src/fixtures/knowledge-sources.js";
import {
  BOOTSTRAP_CORPUS_LAYERS,
  CORPUS_BOOTSTRAP_RULES
} from "../src/fixtures/corpus-bootstrap.js";

type CorpusSeed = (typeof KNOWLEDGE_RULE_FIXTURES)[number];

function asStored(seed: CorpusSeed): StoredKnowledgeRule {
  const { sourceId, ...rule } = seed;
  return {
    ...(KnowledgeRuleSchema.parse(rule) as KnowledgeRule),
    sourceId,
    knowledgeVersionId: null
  };
}

const fullCorpus: readonly CorpusSeed[] = [...KNOWLEDGE_RULE_FIXTURES, ...CORPUS_BOOTSTRAP_RULES];

test("the corpus reaches at least 500 approved rules", () => {
  assert.ok(fullCorpus.length >= 500, `expected >= 500 rules, got ${fullCorpus.length}`);
  assert.ok(CORPUS_BOOTSTRAP_RULES.length >= 384, `bootstrap layer too small: ${CORPUS_BOOTSTRAP_RULES.length}`);
});

test("every bootstrap rule is well-formed and carries a corpus layer marker", () => {
  for (const seed of CORPUS_BOOTSTRAP_RULES) {
    const { sourceId: _sourceId, ...rule } = seed;
    const parsed = KnowledgeRuleSchema.safeParse(rule);
    assert.equal(parsed.success, true, `${seed.id} must satisfy the knowledge rule contract`);
    const layer = (seed.payload as Record<string, unknown>).corpusLayer;
    assert.ok(
      layer === "taxonomy-coverage" || layer === "combination",
      `${seed.id} must carry a corpusLayer, got ${String(layer)}`
    );
    assert.equal(seed.status, "APPROVED");
  }
});

test("core handbook rules stay untouched (no layer marker, original count)", () => {
  assert.equal(KNOWLEDGE_RULE_FIXTURES.length, 116);
  for (const seed of KNOWLEDGE_RULE_FIXTURES) {
    const layer = (seed.payload as Record<string, unknown>).corpusLayer;
    assert.equal(layer, undefined, `${seed.id} is a core rule and must stay unlayered`);
  }
});

test("every bootstrap rule passes candidate validation", () => {
  for (const seed of CORPUS_BOOTSTRAP_RULES) {
    const validation = validateKnowledgeRuleCandidate(asStored(seed));
    assert.equal(
      validation.valid,
      true,
      `${seed.id} invalid: ${validation.issues.join("; ")}`
    );
  }
});

test("the whole corpus passes candidate validation with zero failures", () => {
  const failures: string[] = [];
  for (const seed of fullCorpus) {
    const validation = validateKnowledgeRuleCandidate(asStored(seed));
    if (!validation.valid) {
      failures.push(`${seed.id}: ${validation.issues.join("; ")}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("bootstrap keys never collide with core rules or each other", () => {
  const coreKeys = new Set(
    KNOWLEDGE_RULE_FIXTURES.map((seed) => `${seed.knowledgeType}|${seed.subject}|${seed.relation}`)
  );
  const seen = new Set<string>();
  for (const seed of CORPUS_BOOTSTRAP_RULES) {
    const key = `${seed.knowledgeType}|${seed.subject}|${seed.relation}`;
    assert.ok(!coreKeys.has(key), `bootstrap key collides with a core rule: ${key}`);
    assert.ok(!seen.has(key), `bootstrap key repeats: ${key}`);
    seen.add(key);
  }
});

test("bootstrap introduces no divergent groups beyond the known core handbook set", () => {
  // The 116-rule core handbook repeats same-key claims across chapters
  // (divergent payloads, distinct fingerprints); the compiler's conflict
  // ladder resolves those deterministically. The bootstrap layers must not
  // add a single new group to that set.
  const coreConflicts = detectRuleConflicts(KNOWLEDGE_RULE_FIXTURES.map(asStored));
  const fullConflicts = detectRuleConflicts(fullCorpus.map(asStored));
  assert.ok(coreConflicts.length > 0, "expected the documented core handbook groups");
  assert.equal(
    fullConflicts.length,
    coreConflicts.length,
    "bootstrap must not add divergent same-key groups"
  );
});

test("all eleven knowledge types gain bootstrap rules", () => {
  const gained = new Set(CORPUS_BOOTSTRAP_RULES.map((seed) => seed.knowledgeType));
  for (const knowledgeType of [
    "COLOR_THEORY",
    "MATERIAL_COMPATIBILITY",
    "STYLE_RULE",
    "PROPORTION_RULE",
    "COMPOSITION_RULE",
    "TRANSITION_RULE",
    "FOCAL_RULE",
    "NEGATIVE_RULE",
    "CULTURAL_SYMBOLISM",
    "TAROT",
    "MARKET_OBSERVATION"
  ] as const) {
    assert.ok(gained.has(knowledgeType), `${knowledgeType} needs bootstrap coverage`);
  }
});

test("every covered taxonomy term appears as a subject part at least once", () => {
  const subjects = new Set(fullCorpus.flatMap((seed) => seed.subject.split("+")));
  for (const domain of [
    "COLOR",
    "MATERIAL",
    "STYLE",
    "EMOTION",
    "TEXTURE",
    "LUSTER",
    "TRANSPARENCY",
    "COMPOSITION_ROLE"
  ] as const) {
    for (const term of listTaxonomyTerms(domain)) {
      assert.ok(
        subjects.has(term.id),
        `${term.id} (${domain}) never appears as a subject`
      );
    }
  }
});

test("all twenty-two tarot majors are covered by the corpus", () => {
  const tarotSubjects = new Set(
    fullCorpus
      .filter((seed) => seed.knowledgeType === "TAROT")
      .map((seed) => seed.subject)
  );
  for (let major = 0; major <= 21; major += 1) {
    const prefix = `tarot:major-${String(major).padStart(2, "0")}`;
    const match = [...tarotSubjects].find((subject) => subject.startsWith(prefix));
    assert.ok(match !== undefined, `${prefix}-* is missing from the tarot corpus`);
  }
});

test("bootstrap fingerprints are unique and stable across regenerations", () => {
  const fingerprints = CORPUS_BOOTSTRAP_RULES.map((seed) => seed.fingerprint);
  assert.equal(new Set(fingerprints).size, fingerprints.length);
  for (const seed of CORPUS_BOOTSTRAP_RULES) {
    const subjectParts = seed.subject.split("+").filter((part) => part.length > 0);
    for (const part of subjectParts) {
      assert.notEqual(resolveTaxonomyId(part), null, `${seed.id} subject part ${part} must resolve`);
    }
  }
});

test("layer summary counts are consistent with the generated rules", () => {
  const summary = BOOTSTRAP_CORPUS_LAYERS;
  const counts = new Map<string, number>();
  for (const seed of CORPUS_BOOTSTRAP_RULES) {
    const layer = (seed.payload as Record<string, unknown>).corpusLayer as string;
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  for (const [layer, count] of counts) {
    const summaryCount = summary[layer as keyof typeof summary];
    assert.equal(summaryCount, count, `layer ${layer} count mismatch`);
  }
  assert.equal(
    summary.total,
    CORPUS_BOOTSTRAP_RULES.length,
    "summary total must equal the bootstrap rule count"
  );
});

test("compileDecisionRules compiles the 500+ corpus deterministically", () => {
  const sources = new Map(KNOWLEDGE_SOURCE_FIXTURES.map((source) => [source.id, source]));
  const refs = new Set<string>();
  for (const seed of fullCorpus) {
    refs.add(seed.subject);
    for (const part of seed.subject.split("+")) {
      refs.add(part);
    }
  }
  const compile = () =>
    compileDecisionRules({
      knowledgeVersion: "corpus-fixture-v1",
      rules: fullCorpus.map(asStored),
      sources,
      catalog: {
        productCatalogVersion: "catalog-corpus-v1",
        availableTaxonomyRefs: [...refs].sort()
      }
    });

  const first = compile();
  const second = compile();

  assert.ok(
    first.stats.input >= 500,
    `expected >= 500 input rules, got ${first.stats.input}`
  );
  assert.ok(
    first.rules.length >= 450,
    `expected >= 450 active rules after conflict resolution, got ${first.rules.length}`
  );
  assert.equal(first.stats.infeasible, 0, "full-catalog compilation drops nothing");
  assert.equal(first.stats.duplicates, 0);
  assert.equal(
    first.decisionRuleSetVersion,
    second.decisionRuleSetVersion,
    "ruleSetVersion must stay stable across compilations"
  );
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  const priorities = new Set(first.rules.map((rule) => rule.priority));
  for (const priority of ["P3", "P4", "P5", "P6", "P7", "P8"] as const) {
    assert.ok(priorities.has(priority), `${priority} missing from the compiled corpus`);
  }
});
