import assert from "node:assert/strict";
import test from "node:test";

import {
  CatalogMaterialProductSchema,
  RecommendationContextSchema,
  TaxonomyTermSchema
} from "@mystcrag/design-contract";

import { createHash } from "node:crypto";

import type { KnowledgeRuleSeed } from "../src/fixtures/knowledge-rules.js";
import {
  DESIGN_QUALITY_GATE,
  runDesignQualityEval
} from "../src/eval/design-eval.js";
import { GOLDEN_CATALOG, GOLDEN_CATALOG_VERSION } from "../src/eval/golden-catalog.js";
import {
  GOLDEN_SCENARIOS,
  GOLDEN_SET_VERSION,
  type GoldenScenario
} from "../src/eval/golden-set.js";

test("golden catalog is deterministic and schema-valid with broad coverage", () => {
  assert.ok(GOLDEN_CATALOG.length >= 18, `expected >= 18 products, got ${GOLDEN_CATALOG.length}`);

  for (const product of GOLDEN_CATALOG) {
    const parsed = CatalogMaterialProductSchema.safeParse(product);
    assert.ok(parsed.success, `${product.beadProductId} must be a valid catalog product`);
  }

  const ids = new Set(GOLDEN_CATALOG.map((product) => product.beadProductId));
  assert.equal(ids.size, GOLDEN_CATALOG.length, "product ids must be unique");

  const materials = new Set(GOLDEN_CATALOG.map((product) => product.materialKey));
  assert.ok(materials.size >= 10, `expected >= 10 materials, got ${materials.size}`);

  const colors = new Set(GOLDEN_CATALOG.flatMap((product) => product.colorTags));
  assert.ok(colors.size >= 8, `expected >= 8 colors, got ${colors.size}`);

  const styles = new Set(GOLDEN_CATALOG.flatMap((product) => product.styleTags));
  assert.ok(styles.size >= 5, `expected >= 5 styles, got ${styles.size}`);

  const diameters = new Set(GOLDEN_CATALOG.map((product) => product.diameterMm));
  assert.ok(diameters.size >= 3, "expected at least three bead diameters");

  for (const ref of [...materials, ...colors, ...styles]) {
    assert.notEqual(
      TaxonomyTermSchema.shape.id.safeParse(ref).success,
      false,
      `${ref} must look like a taxonomy ref`
    );
  }
});

test("golden set covers the required scenario matrix with schema-valid contexts", () => {
  assert.ok(GOLDEN_SCENARIOS.length >= 12, `expected >= 12 scenarios, got ${GOLDEN_SCENARIOS.length}`);

  const ids = new Set<string>();
  for (const scenario of GOLDEN_SCENARIOS) {
    assert.ok(!ids.has(scenario.id), `duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(scenario.description.length > 0, `${scenario.id} needs a description`);
    assert.ok(Object.keys(scenario.expectations).length > 0, `${scenario.id} needs expectations`);

    const parsed = RecommendationContextSchema.safeParse(scenario.context);
    assert.ok(parsed.success, `${scenario.id} context must be schema-valid`);
  }

  const byId = (fragment: string): GoldenScenario | undefined =>
    GOLDEN_SCENARIOS.find((scenario) => scenario.id.includes(fragment));

  const requiredScenarios = [
    "preference",
    "budget",
    "excluded",
    "required",
    "avoid-material",
    "small-wrist",
    "large-wrist",
    "tarot",
    "multi-material",
    "stock"
  ];
  for (const fragment of requiredScenarios) {
    assert.ok(byId(fragment) !== undefined, `golden set must include a *${fragment}* scenario`);
  }

  const firingScenarios = GOLDEN_SCENARIOS.filter(
    (scenario) => scenario.expectations.mustFireRules === true
  );
  assert.ok(firingScenarios.length >= 3, "at least three scenarios must assert rule firing");

  const hardFree = GOLDEN_SCENARIOS.filter(
    (scenario) => scenario.expectations.hardViolationFree === true
  );
  assert.ok(hardFree.length >= 8, "most scenarios must assert zero HARD violations");
});

test("golden set evaluation passes the quality gate at the baseline corpus", async () => {
  const report = await runDesignQualityEval();

  assert.ok(report.evalVersion.length > 0);
  assert.equal(report.goldenSetVersion, GOLDEN_SET_VERSION);
  assert.equal(report.catalogVersion, GOLDEN_CATALOG_VERSION);
  assert.equal(report.metrics.scenarioCount, GOLDEN_SCENARIOS.length);
  assert.equal(report.metrics.scenarioPassRate, 1, JSON.stringify(report.scenarios, null, 2));
  assert.equal(report.metrics.hardRuleSatisfaction, 1);
  assert.equal(report.metrics.candidateYield, 1);
  assert.equal(report.metrics.determinismVerified, true);
  assert.ok(
    report.metrics.meanOverallScore >= DESIGN_QUALITY_GATE.minMeanOverallScore,
    `mean overall score ${report.metrics.meanOverallScore} below gate`
  );
  assert.equal(report.meetsGate, true);

  for (const scenario of report.scenarios) {
    assert.equal(scenario.passed, true, `${scenario.scenarioId}: ${JSON.stringify(scenario.checks)}`);
    assert.ok(scenario.checks.length > 0, `${scenario.scenarioId} recorded no checks`);
    assert.ok(scenario.topOverallScore !== null);
  }
});

test("evaluation reports are deterministic across runs", async () => {
  const first = await runDesignQualityEval();
  const second = await runDesignQualityEval();
  assert.deepEqual(first, second);
});

test("a poisoned corpus with a hard material conflict must fail the gate", async () => {
  const poisoned: KnowledgeRuleSeed = {
    id: "kpoison-quartz-conflict",
    knowledgeType: "NEGATIVE_RULE",
    knowledgeDomain: "knowledge-domain:negative-rule",
    subject: "material:quartz",
    relation: "conflicts-with",
    payload: { note: "评审污染规则：石英类与任何组合冲突（仅用于敏感性测试）" },
    conditions: {},
    confidence: 0.99,
    status: "APPROVED",
    sourceRefs: [{ sourceId: "source-fixture-handbook", documentId: "doc-fixture-handbook" }],
    version: 1,
    fingerprint: createHash("sha256").update("a1kpoison-quartz-conflict").digest("hex"),
    createdAt: "2026-08-21T00:00:00+08:00",
    updatedAt: "2026-08-21T00:00:00+08:00",
    sourceId: "source-fixture-handbook"
  };

  const baseline = await runDesignQualityEval();
  const report = await runDesignQualityEval({ extraRules: [poisoned] });

  assert.equal(baseline.meetsGate, true);
  assert.equal(report.meetsGate, false, "poisoned corpus must fail the gate");
  assert.ok(
    report.metrics.hardRuleSatisfaction < 1,
    "poisoned corpus must break hard-rule satisfaction"
  );
  assert.notEqual(
    report.decisionRuleSetVersion,
    baseline.decisionRuleSetVersion,
    "poisoned corpus must change the compiled rule set version"
  );
});
