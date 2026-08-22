import type { CatalogMaterialProduct, KnowledgeRule } from "@mystcrag/design-contract";
import { KnowledgeRuleSchema } from "@mystcrag/design-contract";
import type { StoredKnowledgeRule, StoredKnowledgeSource } from "@mystcrag/database";

import { generateDesignCandidates, type DesignCandidate } from "@mystcrag/design-engine";

import { catalogFeasibilitySnapshotOf } from "../catalog.js";
import type { CatalogFeasibilitySnapshot } from "../compiler/rule-compiler.js";
import { compileDecisionRules } from "../compiler/rule-compiler.js";
import type { KnowledgeRuleSeed } from "../fixtures/knowledge-rules.js";
import { KNOWLEDGE_CORPUS_FIXTURES } from "../fixtures/corpus-bootstrap.js";
import { KNOWLEDGE_SOURCE_FIXTURES } from "../fixtures/knowledge-sources.js";
import { GOLDEN_CATALOG, GOLDEN_CATALOG_VERSION } from "./golden-catalog.js";
import { GOLDEN_SCENARIOS, GOLDEN_SET_VERSION, type GoldenScenario } from "./golden-set.js";

export const DESIGN_EVAL_VERSION = "design-eval-v1";

/**
 * Quality gate for the design-quality evaluation. The corpus, compiler and
 * engine may only regress the golden set to zero failures; the aggregate
 * mean score floor guards against quiet quality erosion.
 */
export const DESIGN_QUALITY_GATE = {
  scenarioPassRate: 1,
  hardRuleSatisfaction: 1,
  candidateYield: 1,
  determinism: true,
  minMeanOverallScore: 85
} as const;

const EVAL_NOW = "2026-08-22T00:00:00.000Z";
const CANDIDATE_COUNT = 3;

export type ExpectationCheck = {
  expectation: string;
  passed: boolean;
  detail: string;
};

export type ScenarioEvalResult = {
  scenarioId: string;
  candidateCount: number;
  topOverallScore: number | null;
  hardRuleViolations: number;
  firedRuleCount: number;
  checks: readonly ExpectationCheck[];
  passed: boolean;
};

export type DesignQualityMetrics = {
  scenarioCount: number;
  scenarioPassRate: number;
  hardRuleSatisfaction: number;
  meanOverallScore: number;
  meanColorScore: number;
  meanMaterialScore: number;
  meanStyleScore: number;
  meanCompositionScore: number;
  meanConstraintScore: number;
  preferenceCoverageRate: number;
  candidateYield: number;
  determinismVerified: boolean;
};

export type DesignQualityEvalReport = {
  evalVersion: string;
  goldenSetVersion: string;
  catalogVersion: string;
  knowledgeVersion: string;
  decisionRuleSetVersion: string;
  scenarios: readonly ScenarioEvalResult[];
  metrics: DesignQualityMetrics;
  gate: typeof DESIGN_QUALITY_GATE;
  meetsGate: boolean;
};

function asStored(seed: KnowledgeRuleSeed): StoredKnowledgeRule {
  const { sourceId, ...rule } = seed;
  return {
    ...(KnowledgeRuleSchema.parse(rule) as KnowledgeRule),
    sourceId,
    knowledgeVersionId: null
  };
}

function productsById(catalog: readonly CatalogMaterialProduct[]): Map<string, CatalogMaterialProduct> {
  return new Map(catalog.map((product) => [product.beadProductId, product]));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function preferenceCoverage(
  scenario: GoldenScenario,
  topProductIds: readonly string[],
  catalogById: ReadonlyMap<string, CatalogMaterialProduct>,
  kind: "color" | "style" | "emotion"
): number {
  const preferred =
    kind === "color"
      ? scenario.context.preferences.colorPreferences
      : kind === "style"
        ? scenario.context.preferences.styleTags
        : scenario.context.preferences.emotionTags;
  if (preferred.length === 0) return 1;
  const designTags = new Set<string>();
  for (const productId of topProductIds) {
    const product = catalogById.get(productId);
    if (product === undefined) continue;
    for (const tag of kind === "color" ? product.colorTags : kind === "style" ? product.styleTags : product.emotionTags) {
      designTags.add(tag);
    }
  }
  const hits = preferred.filter((tag) => designTags.has(tag)).length;
  return hits / preferred.length;
}

async function evaluateScenario(input: {
  scenario: GoldenScenario;
  catalog: readonly CatalogMaterialProduct[];
  catalogById: ReadonlyMap<string, CatalogMaterialProduct>;
  rules: readonly StoredKnowledgeRule[];
  sources: ReadonlyMap<string, StoredKnowledgeSource>;
  snapshot: CatalogFeasibilitySnapshot;
  now: string;
}): Promise<{ result: ScenarioEvalResult; candidates: readonly DesignCandidate[] }> {
  const { scenario, catalog, catalogById, rules, sources, snapshot, now } = input;
  const ruleSet = compileDecisionRules({
    knowledgeVersion: "golden-corpus-v1",
    rules,
    sources,
    catalog: snapshot,
    options: { context: scenario.context, contextFilter: true }
  });

  const candidates = await generateDesignCandidates({
    context: scenario.context,
    products: catalog,
    ruleSet,
    stock: scenario.stock,
    now,
    candidateCount: CANDIDATE_COUNT
  });

  const top = candidates[0] ?? null;
  const topProductIds = top === null ? [] : [...new Set(top.draft.beads.map((bead) => bead.beadProductId))];
  const checks: ExpectationCheck[] = [];

  const expectations = scenario.expectations;
  const hardViolations = candidates.reduce(
    (total, candidate) =>
      total + candidate.trace.warnings.filter((warning) => warning.code === "HARD_RULE").length,
    0
  );

  if (expectations.minOverallScore !== undefined) {
    const score = top?.score.overallScore ?? null;
    checks.push({
      expectation: `minOverallScore >= ${expectations.minOverallScore}`,
      passed: score !== null && score >= expectations.minOverallScore,
      detail: `top overallScore=${score ?? "none"}`
    });
  }

  if (expectations.minPreferenceCoverage !== undefined) {
    const { kind, rate } = expectations.minPreferenceCoverage;
    const coverage = top === null ? 0 : preferenceCoverage(scenario, topProductIds, catalogById, kind);
    checks.push({
      expectation: `${kind} preference coverage >= ${rate}`,
      passed: coverage >= rate,
      detail: `coverage=${round4(coverage)}`
    });
  }

  if (expectations.hardViolationFree === true) {
    checks.push({
      expectation: "hardViolationFree",
      passed: candidates.length > 0 && hardViolations === 0,
      detail: `${hardViolations} HARD rule violation(s) across ${candidates.length} candidate(s)`
    });
  }

  if (expectations.budgetRespected === true) {
    const budget = scenario.context.hardConstraints.maxBudgetMinor;
    const maxCost = Math.max(...candidates.map((candidate) => candidate.draft.materialCostMinor), 0);
    checks.push({
      expectation: "budgetRespected",
      passed:
        budget !== undefined && candidates.length > 0 && candidates.every((c) => c.draft.materialCostMinor <= budget),
      detail: `maxCost=${maxCost} budget=${budget ?? "none"}`
    });
  }

  if (expectations.excludedAbsent === true) {
    const excluded = new Set(scenario.context.hardConstraints.excludedProductIds);
    const used = new Set(candidates.flatMap((c) => c.draft.beads.map((bead) => bead.beadProductId)));
    const offenders = [...used].filter((id) => excluded.has(id));
    checks.push({
      expectation: "excludedAbsent",
      passed: candidates.length > 0 && offenders.length === 0,
      detail: offenders.length === 0 ? "no excluded product used" : `used excluded: ${offenders.join(", ")}`
    });
  }

  if (expectations.requiredPresent === true) {
    const required = scenario.context.hardConstraints.requiredProductIds;
    const missing = candidates.filter(
      (candidate) =>
        !required.every((id) => candidate.draft.beads.some((bead) => bead.beadProductId === id))
    );
    checks.push({
      expectation: "requiredPresent",
      passed: candidates.length > 0 && missing.length === 0,
      detail: missing.length === 0 ? `all candidates carry ${required.join(", ")}` : `${missing.length} candidate(s) miss a required product`
    });
  }

  if (expectations.avoidedMaterialAbsent === true) {
    const avoided = new Set(scenario.context.avoidances.materialIds);
    const usedMaterials = new Set(
      candidates.flatMap((candidate) =>
        candidate.draft.beads.flatMap((bead) => catalogById.get(bead.beadProductId)?.materialKey ?? [])
      )
    );
    const offenders = [...usedMaterials].filter((material) => avoided.has(material));
    checks.push({
      expectation: "avoidedMaterialAbsent",
      passed: candidates.length > 0 && offenders.length === 0,
      detail: offenders.length === 0 ? "no avoided material used" : `used avoided: ${offenders.join(", ")}`
    });
  }

  if (expectations.minCandidates !== undefined) {
    checks.push({
      expectation: `minCandidates >= ${expectations.minCandidates}`,
      passed: candidates.length >= expectations.minCandidates,
      detail: `candidates=${candidates.length}`
    });
  }

  if (expectations.mustFireRules === true) {
    const fired = top?.trace.activeRuleIds.length ?? 0;
    checks.push({
      expectation: "mustFireRules",
      passed: fired > 0,
      detail: `${fired} knowledge rule(s) fired for the top candidate`
    });
  }

  return {
    result: {
      scenarioId: scenario.id,
      candidateCount: candidates.length,
      topOverallScore: top?.score.overallScore ?? null,
      hardRuleViolations: hardViolations,
      firedRuleCount: top?.trace.activeRuleIds.length ?? 0,
      checks,
      passed: checks.length > 0 && checks.every((check) => check.passed)
    },
    candidates
  };
}

type RunCore = {
  knowledgeVersion: string;
  decisionRuleSetVersion: string;
  topScores: (number | null)[];
  subScores: { color: number; material: number; style: number; composition: number; constraint: number }[];
  preferenceCoverages: number[];
  hardSatisfactionCandidates: { total: number; clean: number };
  scenarios: ScenarioEvalResult[];
};

async function runCore(input: {
  scenarios: readonly GoldenScenario[];
  catalog: readonly CatalogMaterialProduct[];
  catalogById: ReadonlyMap<string, CatalogMaterialProduct>;
  rules: readonly StoredKnowledgeRule[];
  sources: ReadonlyMap<string, StoredKnowledgeSource>;
  snapshot: CatalogFeasibilitySnapshot;
  now: string;
}): Promise<RunCore> {
  const identity = compileDecisionRules({
    knowledgeVersion: "golden-corpus-v1",
    rules: input.rules,
    sources: input.sources,
    catalog: input.snapshot
  });

  const scenarios: ScenarioEvalResult[] = [];
  const topScores: (number | null)[] = [];
  const subScores: RunCore["subScores"] = [];
  const preferenceCoverages: number[] = [];
  let totalCandidates = 0;
  let cleanCandidates = 0;

  for (const scenario of input.scenarios) {
    const { result, candidates } = await evaluateScenario({
      scenario,
      catalog: input.catalog,
      catalogById: input.catalogById,
      rules: input.rules,
      sources: input.sources,
      snapshot: input.snapshot,
      now: input.now
    });
    scenarios.push(result);

    totalCandidates += candidates.length;
    for (const candidate of candidates) {
      if (!candidate.trace.warnings.some((warning) => warning.code === "HARD_RULE")) {
        cleanCandidates += 1;
      }
    }

    const top = candidates[0] ?? null;
    topScores.push(top?.score.overallScore ?? null);
    if (top !== null) {
      subScores.push({
        color: top.score.colorScore,
        material: top.score.materialScore,
        style: top.score.styleScore,
        composition: top.score.compositionScore,
        constraint: top.score.constraintScore
      });
      const preferred = [
        ...scenario.context.preferences.colorPreferences,
        ...scenario.context.preferences.styleTags,
        ...scenario.context.preferences.emotionTags
      ];
      if (preferred.length > 0) {
        const topProductIds = [...new Set(top.draft.beads.map((bead) => bead.beadProductId))];
        const colorCoverage = preferenceCoverage(scenario, topProductIds, input.catalogById, "color");
        const styleCoverage = preferenceCoverage(scenario, topProductIds, input.catalogById, "style");
        const emotionCoverage = preferenceCoverage(scenario, topProductIds, input.catalogById, "emotion");
        const colorWeight = scenario.context.preferences.colorPreferences.length;
        const styleWeight = scenario.context.preferences.styleTags.length;
        const emotionWeight = scenario.context.preferences.emotionTags.length;
        const weighted =
          colorCoverage * colorWeight + styleCoverage * styleWeight + emotionCoverage * emotionWeight;
        preferenceCoverages.push(weighted / (colorWeight + styleWeight + emotionWeight));
      }
    }
  }

  return {
    knowledgeVersion: identity.knowledgeVersion,
    decisionRuleSetVersion: identity.decisionRuleSetVersion,
    topScores,
    subScores,
    preferenceCoverages,
    hardSatisfactionCandidates: { total: totalCandidates, clean: cleanCandidates },
    scenarios
  };
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round4(values.reduce((total, value) => total + value, 0) / values.length);
}

/**
 * Runs the golden design-quality evaluation (§17.5): compile the fixture
 * corpus per scenario (context-filtered, mirroring the production recommend
 * path), generate candidates with the design engine, check every declared
 * expectation, and aggregate gate metrics. Pure and deterministic — the
 * harness runs the full pipeline twice and verifies byte-identical results.
 */
export async function runDesignQualityEval(
  options: {
    rules?: readonly KnowledgeRuleSeed[];
    extraRules?: readonly KnowledgeRuleSeed[];
    scenarios?: readonly GoldenScenario[];
    catalog?: readonly CatalogMaterialProduct[];
    now?: string;
  } = {}
): Promise<DesignQualityEvalReport> {
  const seeds = [...(options.rules ?? KNOWLEDGE_CORPUS_FIXTURES), ...(options.extraRules ?? [])];
  const scenarios = options.scenarios ?? GOLDEN_SCENARIOS;
  const catalog = options.catalog ?? GOLDEN_CATALOG;
  const now = options.now ?? EVAL_NOW;
  const catalogById = productsById(catalog);
  const sources: ReadonlyMap<string, StoredKnowledgeSource> = new Map(
    KNOWLEDGE_SOURCE_FIXTURES.map((source) => [source.id, source])
  );
  const snapshot = catalogFeasibilitySnapshotOf(catalog);
  const rules = seeds.map(asStored);

  const runInput = {
    scenarios,
    catalog,
    catalogById,
    rules,
    sources,
    snapshot,
    now
  };

  const first = await runCore(runInput);
  const second = await runCore(runInput);
  const determinismVerified = JSON.stringify(first) === JSON.stringify(second);

  const passedScenarios = first.scenarios.filter((scenario) => scenario.passed).length;
  const scored = first.topScores.filter((score): score is number => score !== null);
  const hardRuleSatisfaction =
    first.hardSatisfactionCandidates.total === 0
      ? 0
      : round4(
          first.hardSatisfactionCandidates.clean / first.hardSatisfactionCandidates.total
        );

  const metrics: DesignQualityMetrics = {
    scenarioCount: scenarios.length,
    scenarioPassRate: scenarios.length === 0 ? 0 : round4(passedScenarios / scenarios.length),
    hardRuleSatisfaction,
    meanOverallScore: mean(scored),
    meanColorScore: mean(first.subScores.map((score) => score.color)),
    meanMaterialScore: mean(first.subScores.map((score) => score.material)),
    meanStyleScore: mean(first.subScores.map((score) => score.style)),
    meanCompositionScore: mean(first.subScores.map((score) => score.composition)),
    meanConstraintScore: mean(first.subScores.map((score) => score.constraint)),
    preferenceCoverageRate: mean(first.preferenceCoverages),
    candidateYield:
      scenarios.length === 0
        ? 0
        : round4(first.scenarios.filter((scenario) => scenario.candidateCount > 0).length / scenarios.length),
    determinismVerified
  };

  const meetsGate =
    metrics.scenarioPassRate >= DESIGN_QUALITY_GATE.scenarioPassRate &&
    metrics.hardRuleSatisfaction >= DESIGN_QUALITY_GATE.hardRuleSatisfaction &&
    metrics.candidateYield >= DESIGN_QUALITY_GATE.candidateYield &&
    metrics.determinismVerified === DESIGN_QUALITY_GATE.determinism &&
    metrics.meanOverallScore >= DESIGN_QUALITY_GATE.minMeanOverallScore;

  return {
    evalVersion: DESIGN_EVAL_VERSION,
    goldenSetVersion: GOLDEN_SET_VERSION,
    catalogVersion: GOLDEN_CATALOG_VERSION,
    knowledgeVersion: first.knowledgeVersion,
    decisionRuleSetVersion: first.decisionRuleSetVersion,
    scenarios: first.scenarios,
    metrics,
    gate: DESIGN_QUALITY_GATE,
    meetsGate
  };
}
