import { buildDraftFacts } from "./facts.js";
import { evaluateRuleSet } from "./rule-evaluation.js";
import { computeDesignScore } from "./scoring.js";
import type { LayoutStrategy } from "@mystcrag/design-contract";
import type {
  CatalogProduct,
  ConstraintViolation,
  DesignDraft,
  EngineRuleSet,
  RecommendationContext,
  StockSnapshot
} from "./types.js";
import { validateDesignDraft } from "./validation.js";

export type DesignEvaluation = {
  scores: ReturnType<typeof computeDesignScore>;
  violations: ConstraintViolation[];
  firedRuleIds: string[];
  softRuleScore: number;
};

/**
 * Scores and validates an existing draft against the context and rule set
 * (the /api/design/evaluate path). Pure: identical inputs produce identical
 * results; the draft is never mutated.
 */
export async function evaluateDesignDraft(input: {
  draft: DesignDraft;
  layoutStrategy: LayoutStrategy;
  context: RecommendationContext;
  products: readonly CatalogProduct[];
  ruleSet: EngineRuleSet;
  stock?: StockSnapshot;
}): Promise<DesignEvaluation> {
  const { draft, layoutStrategy, context, products, ruleSet, stock } = input;

  const productsById = new Map(
    products.map((product) => [product.beadProductId, product])
  );
  const compositionRoles = [
    ...new Set(draft.beads.map((bead) => `composition-role:${bead.role.toLowerCase()}`))
  ];

  const facts = buildDraftFacts({
    draftProductIds: [...new Set(draft.beads.map((bead) => bead.beadProductId))],
    productsById,
    context,
    compositionRoles
  });
  const ruleEvaluation = await evaluateRuleSet(ruleSet.rules, facts);
  const violations: ConstraintViolation[] = [
    ...validateDesignDraft({ draft, context, stock }),
    ...ruleEvaluation.violations
  ];

  const scores = computeDesignScore({
    strategy: layoutStrategy,
    beads: draft.beads,
    productsById,
    context,
    violations
  });

  return {
    scores,
    violations,
    firedRuleIds: ruleEvaluation.firedRuleIds,
    softRuleScore: ruleEvaluation.softScore
  };
}
