import type {
  AccessoryV1,
  BeadV1,
  BraceletV1,
  CatalogMaterialProduct,
  DecisionRule,
  DesignDecisionTrace,
  DesignScore,
  LayoutStrategy,
  RecommendationContext
} from "@mystcrag/design-contract";

/**
 * Structurally compatible subset of knowledge-core's CompiledRuleSet so the
 * engine never depends on knowledge-core (dependency graph: design-engine only
 * depends on design-contract + culori + json-rules-engine).
 */
export type EngineRuleSet = {
  knowledgeVersion: string;
  productCatalogVersion: string;
  decisionRuleSetVersion: string;
  rules: readonly DecisionRule[];
};

export type StockSnapshot = ReadonlyMap<string, number>;

/** Engine-owned slice of DesignV1; backend fills story/pricing/compliance. */
export type DesignDraft = {
  bracelet: BraceletV1;
  beads: readonly BeadV1[];
  accessories: readonly AccessoryV1[];
  materialCostMinor: number;
};

export type DesignCandidate = {
  designId: string;
  layoutStrategy: LayoutStrategy;
  draft: DesignDraft;
  score: DesignScore;
  trace: DesignDecisionTrace;
};

export type ConstraintViolation = {
  code:
    | "GEOMETRY_OVERFLOW"
    | "GEOMETRY_UNDERFILL"
    | "BUDGET_EXCEEDED"
    | "MUST_KEEP_MISSING"
    | "EXCLUDED_PRESENT"
    | "STOCK_EXCEEDED"
    | "HARD_RULE";
  message: string;
  ruleId?: string;
};

export type CatalogProduct = Pick<
  CatalogMaterialProduct,
  | "beadProductId"
  | "displayName"
  | "crystalId"
  | "crystalNameCn"
  | "crystalNameEn"
  | "colorTags"
  | "visualTags"
  | "styleTags"
  | "emotionTags"
  | "cultureTags"
  | "materialKey"
  | "shape"
  | "diameterMm"
  | "lengthAlongStringMm"
  | "visualProfile"
  | "modelAssetKey"
  | "textureAssetKey"
  | "currency"
  | "unitPriceMinor"
>;

export type { CatalogMaterialProduct, LayoutStrategy, RecommendationContext };
