/**
 * Design-quality evaluation command (Knowledge Quality Phase Q5, §17.5).
 *
 * Runs the golden scenario set through the full deterministic pipeline —
 * fixture corpus → compileDecisionRules (context-filtered, mirroring the
 * production recommend path) → generateDesignCandidates — and reports the
 * per-scenario expectation matrix plus aggregate gate metrics. Exits 1 when
 * the quality gate fails, so it can gate CI or local runs.
 *
 *   pnpm --filter @mystcrag/knowledge-core eval:design
 */
import {
  DESIGN_EVAL_VERSION,
  DESIGN_QUALITY_GATE,
  runDesignQualityEval
} from "../src/eval/design-eval.js";
import { GOLDEN_CATALOG, GOLDEN_CATALOG_VERSION } from "../src/eval/golden-catalog.js";
import { GOLDEN_SCENARIOS, GOLDEN_SET_VERSION } from "../src/eval/golden-set.js";

const status = (passed: boolean): string => (passed ? "PASS" : "FAIL");

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const report = await runDesignQualityEval();

console.log(`design-quality eval ${DESIGN_EVAL_VERSION}`);
console.log(
  `golden set ${GOLDEN_SET_VERSION} · ${GOLDEN_SCENARIOS.length} scenarios · catalog ${GOLDEN_CATALOG_VERSION} · ${GOLDEN_CATALOG.length} products`
);
console.log(`knowledge ${report.knowledgeVersion} · decision rules ${report.decisionRuleSetVersion}`);
console.log("");

for (const scenario of report.scenarios) {
  const marker = scenario.passed ? "✔" : "✘";
  console.log(
    `${marker} ${scenario.scenarioId}  candidates=${scenario.candidateCount} top=${scenario.topOverallScore ?? "none"} fired=${scenario.firedRuleCount} hardViolations=${scenario.hardRuleViolations}`
  );
  for (const check of scenario.checks) {
    console.log(`    ${status(check.passed)}  ${check.expectation}  (${check.detail})`);
  }
}

const metrics = report.metrics;
console.log("");
console.log("aggregate metrics");
console.log(`  scenarioPassRate        ${formatRate(metrics.scenarioPassRate)}`);
console.log(`  hardRuleSatisfaction    ${formatRate(metrics.hardRuleSatisfaction)}`);
console.log(`  candidateYield          ${formatRate(metrics.candidateYield)}`);
console.log(`  meanOverallScore        ${metrics.meanOverallScore}`);
console.log(`  meanColorScore          ${metrics.meanColorScore}`);
console.log(`  meanMaterialScore       ${metrics.meanMaterialScore}`);
console.log(`  meanStyleScore          ${metrics.meanStyleScore}`);
console.log(`  meanCompositionScore    ${metrics.meanCompositionScore}`);
console.log(`  meanConstraintScore     ${metrics.meanConstraintScore}`);
console.log(`  preferenceCoverageRate  ${formatRate(metrics.preferenceCoverageRate)}`);
console.log(`  determinismVerified     ${metrics.determinismVerified}`);
console.log("");
console.log(
  `gate: passRate>=${DESIGN_QUALITY_GATE.scenarioPassRate} hardSatisfaction>=${DESIGN_QUALITY_GATE.hardRuleSatisfaction} yield>=${DESIGN_QUALITY_GATE.candidateYield} meanOverall>=${DESIGN_QUALITY_GATE.minMeanOverallScore} determinism=${DESIGN_QUALITY_GATE.determinism}`
);
console.log(`meetsGate: ${report.meetsGate}`);

if (!report.meetsGate) {
  process.exit(1);
}
