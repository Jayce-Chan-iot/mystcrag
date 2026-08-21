export { allocateComposition, beadUnitLengthMm, type AllocatedProduct, type BeadRole } from "./allocation.js";
export { COLOR_HEX_BY_TAXONOMY_ID, hueDistance, pairHarmony, taxonomyColorOklch } from "./color.js";
export {
  recommendPalettes,
  type PaletteColorRule,
  type PaletteSuggestion
} from "./palette.js";
export { selectCandidates, type RejectedProduct, type SelectionResult } from "./candidate-selection.js";
export { buildDesignFacts, buildDraftFacts, type DesignFacts } from "./facts.js";
export { buildBracelet, generateDesignCandidates } from "./generate.js";
export { evaluateDesignDraft, type DesignEvaluation } from "./evaluate.js";
export { LAYOUT_STRATEGIES, layoutSequence, toBeadV1Sequence } from "./layout.js";
export { planQuantities, type QuantityPlan } from "./quantity.js";
export { evaluateRuleSet, NEGATIVE_RELATIONS, type RuleEvaluation } from "./rule-evaluation.js";
export { computeDesignScore, DESIGN_SCORE_FORMULA_VERSION, OVERALL_WEIGHTS } from "./scoring.js";
export {
  validateDesignDraft,
  geometryToleranceMm
} from "./validation.js";
export type {
  CatalogProduct,
  ConstraintViolation,
  DesignCandidate,
  DesignDraft,
  EngineRuleSet,
  StockSnapshot
} from "./types.js";
