import { createHash } from "node:crypto";

import type {
  BeadV1,
  BraceletV1,
  DesignDecisionTrace,
  LayoutStrategy
} from "@mystcrag/design-contract";

import { allocateComposition } from "./allocation.js";
import { selectCandidates } from "./candidate-selection.js";
import { buildDraftFacts } from "./facts.js";
import { LAYOUT_STRATEGIES, layoutSequence, toBeadV1Sequence } from "./layout.js";
import { planQuantities } from "./quantity.js";
import { evaluateRuleSet } from "./rule-evaluation.js";
import { computeDesignScore } from "./scoring.js";
import type {
  CatalogProduct,
  ConstraintViolation,
  DesignCandidate,
  DesignDraft,
  EngineRuleSet,
  RecommendationContext,
  StockSnapshot
} from "./types.js";
import { validateDesignDraft } from "./validation.js";

const DEFAULT_ELASTIC_ALLOWANCE_MM = 7;
const DEFAULT_BEAD_GAP_MM = 0.4;

function contentId(prefix: string, payload: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 12);
  return `${prefix}-${digest}`;
}

function buildBracelet(
  context: RecommendationContext,
  totalBeadCount: number
): BraceletV1 {
  const wrist = context.hardConstraints.wristCircumferenceMm;
  const target =
    context.hardConstraints.targetInnerCircumferenceMm ??
    wrist + DEFAULT_ELASTIC_ALLOWANCE_MM;
  return {
    wristCircumferenceMm: wrist,
    targetInnerCircumferenceMm: target,
    elasticAllowanceMm: DEFAULT_ELASTIC_ALLOWANCE_MM,
    braceletLayout: "CIRCLE" as const,
    beadGapMm: DEFAULT_BEAD_GAP_MM,
    totalBeadCount
  };
}

function materialCostMinor(beads: readonly BeadV1[]): number {
  return beads.reduce((total, bead) => total + bead.unitPriceMinor, 0);
}

/**
 * EPIC 9 pipeline: selection → allocation → quantity → layout (all four
 * strategies) → rule evaluation → validation → scoring → trace. Returns the
 * top `candidateCount` candidates (default 3) ranked by overall score with
 * strategy-order tiebreak; fully deterministic for identical inputs.
 */
export async function generateDesignCandidates(input: {
  context: RecommendationContext;
  products: readonly CatalogProduct[];
  ruleSet: EngineRuleSet;
  stock?: StockSnapshot;
  /** IsoDateTime stamped into each trace; caller controls the clock. */
  now: string;
  candidateCount?: number;
}): Promise<DesignCandidate[]> {
  const { context, products, ruleSet, stock, now } = input;
  const candidateCount = Math.min(
    Math.max(1, input.candidateCount ?? 3),
    LAYOUT_STRATEGIES.length
  );

  const selection = selectCandidates({ context, products, stock });
  if (selection.ranked.length === 0) return [];

  const allocation = allocateComposition({ ranked: selection.ranked, context });
  if (allocation.length === 0) return [];

  const bracelet = buildBracelet(context, 0);
  const plan = planQuantities({
    targetInnerCircumferenceMm: bracelet.targetInnerCircumferenceMm,
    beadGapMm: bracelet.beadGapMm,
    allocation,
    stock,
    maxBudgetMinor: context.hardConstraints.maxBudgetMinor
  });
  if (plan.totalBeadCount === 0) return [];

  const productsById = new Map(
    allocation.map((entry) => [entry.product.beadProductId, entry.product])
  );
  const compositionRoles = [
    ...new Set(
      allocation.map((entry) => `composition-role:${entry.role.toLowerCase()}`)
    )
  ];

  const candidates: DesignCandidate[] = [];
  for (const strategy of LAYOUT_STRATEGIES) {
    const sequence = layoutSequence({ strategy, allocation, counts: plan.counts });
    if (sequence.length !== plan.totalBeadCount) continue;

    const designId = contentId("design", {
      contextId: context.contextId,
      strategy,
      sequence: sequence.map((instance) => instance.product.beadProductId),
      counts: [...plan.counts.entries()]
    });
    const beads = toBeadV1Sequence(sequence, { idPrefix: designId });
    const draft: DesignDraft = {
      bracelet: buildBracelet(context, beads.length),
      beads,
      accessories: [],
      materialCostMinor: materialCostMinor(beads)
    };

    const facts = buildDraftFacts({
      draftProductIds: [...new Set(beads.map((bead) => bead.beadProductId))],
      productsById,
      context,
      compositionRoles
    });
    const ruleEvaluation = await evaluateRuleSet(ruleSet.rules, facts);
    const violations: ConstraintViolation[] = [
      ...validateDesignDraft({ draft, context, stock }),
      ...ruleEvaluation.violations
    ];

    const score = computeDesignScore({
      strategy,
      beads,
      productsById,
      context,
      violations
    });

    const firedRules = ruleSet.rules.filter((rule) =>
      ruleEvaluation.firedRuleIds.includes(rule.id)
    );
    const trace: DesignDecisionTrace = {
      traceId: contentId("trace", { designId, strategy, score }),
      designId,
      revision: 1,
      knowledgeVersion: ruleSet.knowledgeVersion,
      productCatalogVersion: ruleSet.productCatalogVersion,
      decisionRuleSetVersion: ruleSet.decisionRuleSetVersion,
      layoutStrategy: strategy,
      activeRuleIds: ruleEvaluation.firedRuleIds,
      knowledgeRefs: [...new Set(firedRules.flatMap((rule) => rule.knowledgeRefs))],
      contextRefs: [...new Set(firedRules.flatMap((rule) => rule.contextRefs))],
      scores: score,
      warnings: violations.map((violation) => ({
        code: violation.code,
        message: violation.message
      })),
      createdAt: now
    };

    candidates.push({ designId, layoutStrategy: strategy, draft, score, trace });
  }

  const strategyRank = new Map(
    LAYOUT_STRATEGIES.map((strategy, index) => [strategy, index])
  );
  candidates.sort((a, b) => {
    if (a.score.overallScore !== b.score.overallScore) {
      return b.score.overallScore - a.score.overallScore;
    }
    return (strategyRank.get(a.layoutStrategy) ?? 0) - (strategyRank.get(b.layoutStrategy) ?? 0);
  });

  return candidates.slice(0, candidateCount);
}
