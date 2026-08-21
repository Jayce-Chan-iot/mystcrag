import { createHash, randomUUID } from "node:crypto";

import { resolveQuestionnaireContext } from "@mystcrag/context-resolver";
import {
  BeadShapeSchema,
  DesignV1Schema,
  VisualProfileSchema,
  toPublicDesign,
  type BeadV1,
  type DesignDecisionTrace,
  type DesignTraceResponse,
  type DesignV1,
  type EvaluateDesignRequest,
  type EvaluateDesignResponse,
  type LayoutStrategy,
  type MaterialSuggestResponse,
  type OptimizeDesignRequest,
  type OptimizeDesignResponse,
  type RecommendDesignRequest,
  type RecommendDesignResponse,
  type RecommendationContext,
  type UpdateDesignOperation
} from "@mystcrag/design-contract";
import {
  evaluateDesignDraft,
  evaluateRuleSet,
  generateDesignCandidates,
  pairHarmony,
  taxonomyColorOklch,
  type CatalogProduct as EngineCatalogProduct,
  type DesignCandidate,
  type DesignFacts
} from "@mystcrag/design-engine";
import type {
  CatalogFeasibilitySnapshot,
  CompiledRuleSet,
  RuleCompileOptions
} from "@mystcrag/knowledge-core";

import { DomainApiError } from "../../contracts/api-error.js";
import {
  hasSameCandidateAuthority,
  quantitiesByProduct,
  rebuildDerived,
  type CatalogProduct,
  type CatalogStore,
  type DesignStore,
  type InventoryStore,
  type PriceStore
} from "./design-api.service.js";

export type ActiveRuleCompiler = {
  compileActiveRules(
    catalog: CatalogFeasibilitySnapshot,
    options?: RuleCompileOptions
  ): Promise<CompiledRuleSet>;
};

export type DecisionTraceStore = {
  createTrace(
    designId: string,
    revisionNumber: number,
    input: unknown
  ): Promise<DesignDecisionTrace>;
  getTrace(designId: string, revisionNumber: number): Promise<DesignDecisionTrace | null>;
  getLatestTrace(designId: string): Promise<DesignDecisionTrace | null>;
};

export type StockSnapshotStore = {
  getAvailableQuantities(
    productIds: readonly string[]
  ): Promise<ReadonlyMap<string, number>>;
};

export type RecommendationApplicationDependencies = {
  designs: DesignStore;
  catalog: CatalogStore;
  pricing: PriceStore;
  inventory: InventoryStore;
  rules: ActiveRuleCompiler;
  traces: DecisionTraceStore;
  stock: StockSnapshotStore;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

export interface RecommendationApiService {
  recommend(actorId: string, request: RecommendDesignRequest): Promise<RecommendDesignResponse>;
  evaluate(actorId: string, request: EvaluateDesignRequest): Promise<EvaluateDesignResponse>;
  trace(actorId: string, designId: string): Promise<DesignTraceResponse>;
  suggest(
    actorId: string,
    materialId: string,
    currency: "CNY" | "TWD",
    locale?: string
  ): Promise<MaterialSuggestResponse>;
  optimize(actorId: string, request: OptimizeDesignRequest): Promise<OptimizeDesignResponse>;
}

const STRATEGY_LABELS_ZH: Record<LayoutStrategy, string> = {
  SYMMETRIC_BALANCE: "对称平衡",
  CENTER_FOCAL: "中心聚焦",
  REPEAT_RHYTHM: "重复韵律",
  LOW_CONTRAST_FLOW: "低对比渐变"
};

const STRATEGY_LABELS_EN: Record<LayoutStrategy, string> = {
  SYMMETRIC_BALANCE: "Symmetric Balance",
  CENTER_FOCAL: "Center Focal",
  REPEAT_RHYTHM: "Repeat Rhythm",
  LOW_CONTRAST_FLOW: "Low Contrast Flow"
};

function strategyLabel(strategy: LayoutStrategy, locale: string): string {
  return locale.startsWith("zh") ? STRATEGY_LABELS_ZH[strategy] : STRATEGY_LABELS_EN[strategy];
}

function isChinese(locale: string): boolean {
  return locale.startsWith("zh");
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function catalogVersionOf(products: readonly EngineCatalogProduct[]): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        products.map((product) => [
          product.beadProductId,
          product.unitPriceMinor,
          product.colorTags,
          product.styleTags,
          product.materialKey
        ])
      )
    )
    .digest("hex")
    .slice(0, 12);
  return `catalog-${digest}`;
}

function toEngineProducts(rows: readonly CatalogProduct[]): EngineCatalogProduct[] {
  const products: EngineCatalogProduct[] = [];
  for (const row of rows) {
    if (
      row.productType !== "MATERIAL" ||
      !row.active ||
      !row.crystalId ||
      !row.materialKey ||
      !row.shape ||
      row.diameterMm === undefined ||
      !row.modelAssetKey ||
      !row.textureAssetKey
    ) {
      continue;
    }
    const shape = BeadShapeSchema.safeParse(row.shape);
    if (!shape.success) continue;
    let visualProfile: ReturnType<typeof VisualProfileSchema.safeParse> | undefined;
    if (row.visualProfile !== undefined && row.visualProfile !== null) {
      const parsed = VisualProfileSchema.safeParse(row.visualProfile);
      if (!parsed.success) continue;
      visualProfile = parsed;
    }
    products.push({
      beadProductId: row.id,
      displayName: row.name,
      crystalId: row.crystalId,
      crystalNameCn: row.crystalNameCn ?? row.name,
      crystalNameEn: row.crystalNameEn ?? row.name,
      colorTags: row.colorTags ?? [],
      visualTags: row.visualTags ?? [],
      styleTags: row.styleTags ?? [],
      emotionTags: row.emotionTags ?? [],
      cultureTags: row.cultureTags ?? [],
      materialKey: row.materialKey,
      shape: shape.data,
      diameterMm: row.diameterMm,
      ...(row.lengthAlongStringMm === null || row.lengthAlongStringMm === undefined
        ? {}
        : { lengthAlongStringMm: row.lengthAlongStringMm }),
      ...(visualProfile?.success ? { visualProfile: visualProfile.data } : {}),
      modelAssetKey: row.modelAssetKey,
      textureAssetKey: row.textureAssetKey,
      currency: row.currency,
      unitPriceMinor: row.unitPriceMinor
    });
  }
  return products;
}

function feasibilitySnapshotOf(
  products: readonly EngineCatalogProduct[]
): CatalogFeasibilitySnapshot {
  return {
    productCatalogVersion: catalogVersionOf(products),
    availableTaxonomyRefs: [
      ...new Set(products.flatMap((product) => [...product.colorTags, product.materialKey]))
    ]
  };
}

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function mainBeadOf(beads: readonly BeadV1[]): BeadV1 | undefined {
  return beads.find((bead) => bead.role === "MAIN") ?? beads[0];
}

function accentNamesOf(
  beads: readonly BeadV1[],
  productsById: ReadonlyMap<string, EngineCatalogProduct>,
  limit: number
): string[] {
  const names: string[] = [];
  for (const bead of beads) {
    if (bead.role === "ACCENT") {
      const name = productsById.get(bead.beadProductId)?.displayName;
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names.slice(0, limit);
}

/**
 * EPIC 10 orchestration: Context Resolver → Rule Compiler (knowledge-core) →
 * Design Engine → DesignV1 + decision-trace sidecar. The service is I/O
 * orchestration only — every design decision is made by the deterministic
 * engine and recorded in the trace.
 */
export class RecommendationApplicationService implements RecommendationApiService {
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(private readonly dependencies: RecommendationApplicationDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  private async compileRules(
    context: RecommendationContext,
    catalog: CatalogFeasibilitySnapshot,
    contextFilter: boolean
  ): Promise<CompiledRuleSet> {
    return this.dependencies.rules.compileActiveRules(catalog, {
      context,
      contextFilter
    });
  }

  private async loadStock(productIds: readonly string[]): Promise<Map<string, number>> {
    return new Map(await this.dependencies.stock.getAvailableQuantities(productIds));
  }

  async recommend(
    actorId: string,
    request: RecommendDesignRequest
  ): Promise<RecommendDesignResponse> {
    const context =
      request.context ??
      resolveQuestionnaireContext({
        wristCircumferenceMm: request.wristCircumferenceMm,
        ...(request.targetInnerCircumferenceMm === undefined
          ? {}
          : { targetInnerCircumferenceMm: request.targetInnerCircumferenceMm }),
        ...(request.maxBudgetMinor === undefined
          ? {}
          : { maxBudgetMinor: request.maxBudgetMinor }),
        excludedProductIds: request.excludedProductIds,
        emotionTags: request.emotionTags,
        styleTags: request.styleTags,
        colorTags: request.colorTags,
        locale: request.locale,
        currency: request.currency
      });

    const catalogRows = await this.dependencies.catalog.listActiveCatalogProducts(
      context.currency,
      context.hardConstraints.excludedProductIds
    );
    const products = toEngineProducts(catalogRows);
    if (products.length === 0) {
      return {
        requestId: request.requestId,
        candidates: [],
        warnings: [{ code: "NO_CANDIDATES", message: "No active catalog materials available." }]
      };
    }

    const ruleSet = await this.compileRules(
      context,
      feasibilitySnapshotOf(products),
      true
    );
    const stock = await this.loadStock(products.map((product) => product.beadProductId));
    const timestamp = this.now().toISOString();

    const engineCandidates = await generateDesignCandidates({
      context,
      products,
      ruleSet,
      stock,
      now: timestamp,
      candidateCount: 3
    });
    if (engineCandidates.length === 0) {
      return {
        requestId: request.requestId,
        candidates: [],
        warnings: [
          {
            code: "NO_CANDIDATES",
            message: "The design engine produced no candidates for this context."
          }
        ]
      };
    }

    const candidates: RecommendDesignResponse["candidates"] = [];
    for (const candidate of engineCandidates) {
      const persisted = await this.materializeCandidate({
        actorId,
        request,
        context,
        candidate,
        ruleSet,
        products,
        timestamp
      });
      candidates.push({
        designId: persisted.snapshot.designId,
        layoutStrategy: candidate.layoutStrategy,
        score: candidate.score,
        design: toPublicDesign(persisted.snapshot)
      });
    }

    return { requestId: request.requestId, candidates, warnings: [] };
  }

  private async materializeCandidate(input: {
    actorId: string;
    request: RecommendDesignRequest;
    context: RecommendationContext;
    candidate: DesignCandidate;
    ruleSet: CompiledRuleSet;
    products: readonly EngineCatalogProduct[];
    timestamp: string;
  }): Promise<{ snapshot: DesignV1; currentRevision: number }> {
    const { actorId, request, context, candidate, ruleSet, products, timestamp } = input;
    const designIdSeed = candidate.designId;
    const draft = this.buildDesignFromCandidate({
      designId: designIdSeed,
      locale: request.locale,
      currency: request.currency,
      context,
      candidate,
      ruleSet,
      products,
      timestamp
    });

    const priced = await this.priceAndValidate(draft);
    try {
      const persisted = await this.dependencies.designs.createDesign(actorId, priced);
      await this.dependencies.traces.createTrace(persisted.id, 1, {
        ...candidate.trace,
        designId: persisted.id,
        revision: 1
      });
      return { snapshot: persisted.snapshot, currentRevision: persisted.currentRevision };
    } catch (error) {
      if (errorCodeOf(error) !== "CONFLICT") throw error;
      const existing = await this.dependencies.designs.getDesign(actorId, priced.designId);
      if (hasSameCandidateAuthority(existing.snapshot, priced, designIdSeed)) {
        return { snapshot: existing.snapshot, currentRevision: existing.currentRevision };
      }
      // The content-addressed id collides with a design the user has since
      // edited — fall back to a fresh id so re-recommendation never fails.
      const freshId = this.createId("design");
      const rebuilt = this.buildDesignFromCandidate({
        designId: freshId,
        locale: request.locale,
        currency: request.currency,
        context,
        candidate,
        ruleSet,
        products,
        timestamp
      });
      const repriced = await this.priceAndValidate(rebuilt);
      const persisted = await this.dependencies.designs.createDesign(actorId, repriced);
      await this.dependencies.traces.createTrace(persisted.id, 1, {
        ...candidate.trace,
        designId: persisted.id,
        revision: 1
      });
      return { snapshot: persisted.snapshot, currentRevision: persisted.currentRevision };
    }
  }

  private buildDesignFromCandidate(input: {
    designId: string;
    locale: string;
    currency: "CNY" | "TWD";
    context: RecommendationContext;
    candidate: DesignCandidate;
    ruleSet: CompiledRuleSet;
    products: readonly EngineCatalogProduct[];
    timestamp: string;
  }): DesignV1 {
    const { designId, locale, currency, context, candidate, ruleSet, products, timestamp } = input;
    const beads = candidate.draft.beads.map((bead, index) => ({
      ...bead,
      componentId: `${designId}-bead-${index}`,
      positionIndex: index
    }));
    const productsById = new Map(products.map((product) => [product.beadProductId, product]));
    const main = mainBeadOf(beads);
    const mainProduct = main ? productsById.get(main.beadProductId) : undefined;
    const mainName =
      mainProduct === undefined
        ? isChinese(locale)
          ? "主材"
          : "main material"
        : isChinese(locale)
          ? mainProduct.crystalNameCn
          : mainProduct.crystalNameEn;
    const accents = accentNamesOf(beads, productsById, 3);
    const zh = isChinese(locale);
    const label = strategyLabel(candidate.layoutStrategy, locale);
    const designName = zh
      ? `${label} · ${mainName}`
      : `${label} · ${mainName}`;
    const accentText = accents.length > 0 ? accents.join(zh ? "、" : ", ") : null;
    const designStory = zh
      ? `以${mainName}为主材${accentText ? `，${accentText}点缀` : ""}，采用${label}布局，适配${context.hardConstraints.wristCircumferenceMm}mm腕围。`
      : `Built around ${mainName}${accentText ? ` with ${accentText} accents` : ""} in a ${label} layout for a ${context.hardConstraints.wristCircumferenceMm}mm wrist.`;
    const recommendationReasons = [
      zh
        ? `布局策略：${label}（构图 ${candidate.score.compositionScore} 分）`
        : `Layout strategy: ${label} (composition ${candidate.score.compositionScore}).`,
      zh
        ? `配色协调 ${candidate.score.colorScore} 分，材质多样性 ${candidate.score.materialScore} 分，风格匹配 ${candidate.score.styleScore} 分。`
        : `Color harmony ${candidate.score.colorScore}, material variety ${candidate.score.materialScore}, style match ${candidate.score.styleScore}.`,
      zh
        ? `命中 ${candidate.trace.activeRuleIds.length} 条已审核知识规则（${ruleSet.knowledgeVersion}）。`
        : `${candidate.trace.activeRuleIds.length} approved knowledge rules fired (${ruleSet.knowledgeVersion}).`
    ];

    const materialSubtotalMinor = beads.reduce((total, bead) => total + bead.unitPriceMinor, 0);
    const design = {
      schemaVersion: "1.0.0" as const,
      designId,
      designName,
      designMode: "AI_GENERATED" as const,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      locale,
      currency,
      bracelet: candidate.draft.bracelet,
      beads,
      accessories: [],
      story: {
        emotionTags: [...context.preferences.emotionTags],
        styleTags: [...context.preferences.styleTags],
        colorPalette: [...context.preferences.colorPreferences],
        culturalInspiration: [],
        designStory,
        recommendationReasons,
        sourceTemplateIds: []
      },
      pricing: {
        materialSubtotalMinor,
        accessorySubtotalMinor: 0,
        laborFeeMinor: 0,
        designFeeMinor: 0,
        packagingFeeMinor: 0,
        platformFeeEstimateMinor: 0,
        logisticsFeeEstimateMinor: 0,
        discountMinor: 0,
        adjustments: [],
        totalPriceMinor: materialSubtotalMinor,
        pricingVersion: "catalog-pending",
        priceCalculatedAt: timestamp
      },
      production: {
        wristCircumferenceMm: candidate.draft.bracelet.wristCircumferenceMm,
        billOfMaterials: [],
        componentSequence: [],
        anchoredComponents: [],
        productionNotes: [],
        substitutionRules: []
      },
      compliance: {
        complianceStatus: "PASSED" as const,
        restrictedClaims: [],
        disclaimerKeys: [],
        reviewRequired: false
      },
      provenance: {
        generatedBy: "AI" as const,
        modelProvider: "design-engine",
        modelName: "deterministic-pipeline",
        promptVersion: "design-engine-v1",
        knowledgeBaseVersion: ruleSet.knowledgeVersion,
        designTemplateVersion: null,
        pricingRuleVersion: "catalog-pending",
        sourceDesignId: null
      },
      community: {
        visibility: "PRIVATE" as const,
        publishConsent: false,
        allowRemix: false,
        creatorDisplayMode: "ANONYMOUS" as const
      }
    };
    return rebuildDerived(design as DesignV1);
  }

  private async priceAndValidate(design: DesignV1): Promise<DesignV1> {
    const priced = DesignV1Schema.parse(
      await this.dependencies.pricing.recalculateDesignPrice(design)
    );
    await this.dependencies.inventory.validateAvailability(quantitiesByProduct(priced));
    return priced;
  }

  async evaluate(
    actorId: string,
    request: EvaluateDesignRequest
  ): Promise<EvaluateDesignResponse> {
    const stored = await this.dependencies.designs.getDesign(actorId, request.designId);
    const design = stored.snapshot;
    const trace = await this.dependencies.traces.getLatestTrace(request.designId);
    const warnings: EvaluateDesignResponse["warnings"] = [];
    let layoutStrategy: LayoutStrategy;
    if (trace === null) {
      layoutStrategy = "SYMMETRIC_BALANCE";
      warnings.push({
        code: "TRACE_MISSING",
        message: "No decision trace for this design; composition scored with a fallback strategy."
      });
    } else {
      layoutStrategy = trace.layoutStrategy;
      if (trace.revision !== design.revision) {
        warnings.push({
          code: "TRACE_STALE",
          message: `Trace records revision ${trace.revision}; the design is at revision ${design.revision}.`
        });
      }
    }

    const context = this.contextFromDesign(design);
    const catalogRows = await this.dependencies.catalog.listActiveCatalogProducts(design.currency);
    const products = toEngineProducts(catalogRows);
    const ruleSet = await this.compileRules(context, feasibilitySnapshotOf(products), true);
    const stock = await this.loadStock(products.map((product) => product.beadProductId));

    const draft = {
      bracelet: design.bracelet,
      beads: design.beads,
      accessories: design.accessories,
      materialCostMinor: design.beads.reduce((total, bead) => total + bead.unitPriceMinor, 0)
    };
    const evaluation = await evaluateDesignDraft({
      draft,
      layoutStrategy,
      context,
      products,
      ruleSet,
      stock
    });

    const zh = isChinese(design.locale);
    const label = strategyLabel(layoutStrategy, design.locale);
    const reasons = [
      zh
        ? `综合 ${evaluation.scores.overallScore} 分（公式 ${evaluation.scores.formulaVersion}）。`
        : `Overall ${evaluation.scores.overallScore} (formula ${evaluation.scores.formulaVersion}).`,
      zh
        ? `配色 ${evaluation.scores.colorScore} · 材质 ${evaluation.scores.materialScore} · 风格 ${evaluation.scores.styleScore} · 构图（${label}）${evaluation.scores.compositionScore} · 约束 ${evaluation.scores.constraintScore}。`
        : `Color ${evaluation.scores.colorScore} · material ${evaluation.scores.materialScore} · style ${evaluation.scores.styleScore} · composition (${label}) ${evaluation.scores.compositionScore} · constraints ${evaluation.scores.constraintScore}.`,
      zh
        ? `命中 ${evaluation.firedRuleIds.length} 条活跃知识规则，软规则得分 ${round2(evaluation.softRuleScore)}。`
        : `${evaluation.firedRuleIds.length} active knowledge rules fired; soft rule score ${round2(evaluation.softRuleScore)}.`
    ];
    for (const violation of evaluation.violations) {
      warnings.push({ code: violation.code, message: violation.message });
    }

    return {
      requestId: request.requestId,
      designId: request.designId,
      layoutStrategy,
      scores: evaluation.scores,
      reasons,
      warnings
    };
  }

  private contextFromDesign(design: DesignV1): RecommendationContext {
    return resolveQuestionnaireContext({
      wristCircumferenceMm: design.bracelet.wristCircumferenceMm,
      targetInnerCircumferenceMm: design.bracelet.targetInnerCircumferenceMm,
      emotionTags: design.story.emotionTags,
      styleTags: design.story.styleTags,
      colorTags: design.story.colorPalette,
      locale: design.locale,
      currency: design.currency
    });
  }

  async trace(actorId: string, designId: string): Promise<DesignTraceResponse> {
    await this.dependencies.designs.getDesign(actorId, designId);
    const trace = await this.dependencies.traces.getLatestTrace(designId);
    return { designId, trace };
  }

  async suggest(
    actorId: string,
    materialId: string,
    currency: "CNY" | "TWD",
    locale: string = "zh-CN"
  ): Promise<MaterialSuggestResponse> {
    void actorId;
    const catalogRows = await this.dependencies.catalog.listActiveCatalogProducts(currency);
    const products = toEngineProducts(catalogRows);
    const base = products.find((product) => product.beadProductId === materialId);
    if (base === undefined) {
      throw new DomainApiError("NOT_FOUND", "Material not found in the active catalog.");
    }

    // Context-free compile: cacheable per (knowledge version, catalog version).
    const ruleSet = await this.dependencies.rules.compileActiveRules(
      feasibilitySnapshotOf(products)
    );

    const zh = isChinese(locale);
    const baseColor = firstKnownColor(base);
    const suggestions: MaterialSuggestResponse["suggestions"] = [];
    for (const partner of products) {
      if (partner.beadProductId === base.beadProductId) continue;
      const facts: DesignFacts = {
        designTaxonomyRefs: [
          ...new Set([
            ...base.colorTags,
            ...base.visualTags,
            ...base.styleTags,
            ...base.emotionTags,
            base.materialKey,
            ...partner.colorTags,
            ...partner.visualTags,
            ...partner.styleTags,
            ...partner.emotionTags,
            partner.materialKey
          ])
        ],
        contextTaxonomyRefs: []
      };
      const evaluation = await evaluateRuleSet(ruleSet.rules, facts);
      if (evaluation.violations.length > 0) continue;

      const partnerColor = firstKnownColor(partner);
      const harmony =
        baseColor !== undefined && partnerColor !== undefined
          ? pairHarmony(baseColor, partnerColor)
          : 0.5;
      const softScore = Math.min(100, evaluation.softScore);
      const score = round2(0.6 * 100 * harmony + 0.4 * softScore);
      const knowledgeRefs = [
        ...new Set(
          ruleSet.rules
            .filter((rule) => evaluation.firedRuleIds.includes(rule.id))
            .flatMap((rule) => rule.knowledgeRefs)
        )
      ];
      const hueLabel = hueLabelOf(baseColor, partnerColor, zh);
      suggestions.push({
        material: {
          beadProductId: partner.beadProductId,
          displayName: partner.displayName,
          colorTags: [...partner.colorTags],
          styleTags: [...partner.styleTags],
          materialKey: partner.materialKey
        },
        score,
        reason: zh
          ? `与${base.displayName}形成${hueLabel}搭配（协调度 ${Math.round(harmony * 100)}），命中 ${evaluation.firedRuleIds.length} 条搭配规则。`
          : `${hueLabel} pairing with ${base.displayName} (harmony ${Math.round(harmony * 100)}); ${evaluation.firedRuleIds.length} pairing rules matched.`,
        knowledgeRefs
      });
    }

    suggestions.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.material.beadProductId < b.material.beadProductId ? -1 : 1;
    });

    return {
      materialId,
      currency,
      suggestions: suggestions.slice(0, 8)
    };
  }

  async optimize(
    actorId: string,
    request: OptimizeDesignRequest
  ): Promise<OptimizeDesignResponse> {
    const stored = await this.dependencies.designs.getDesign(actorId, request.designId);
    if (stored.currentRevision !== request.expectedRevision) {
      throw new DomainApiError("CONFLICT", "Design revision conflict");
    }
    const current = stored.snapshot;

    const knownIds = new Set(
      [...current.beads, ...current.accessories].map((component) => component.componentId)
    );
    for (const lockedId of request.lockedComponentIds) {
      if (!knownIds.has(lockedId)) {
        throw new DomainApiError(
          "VALIDATION_ERROR",
          `Locked component ${lockedId} does not exist on the design.`
        );
      }
    }

    const lockedBeads = current.beads.filter((bead) =>
      request.lockedComponentIds.includes(bead.componentId)
    );
    const lockedInlineAccessories = current.accessories.filter(
      (accessory): accessory is Extract<typeof accessory, { placementMode: "INLINE" }> =>
        accessory.placementMode === "INLINE" &&
        request.lockedComponentIds.includes(accessory.componentId)
    );

    const context = resolveQuestionnaireContext({
      wristCircumferenceMm: current.bracelet.wristCircumferenceMm,
      targetInnerCircumferenceMm:
        request.targetInnerCircumferenceMm ?? current.bracelet.targetInnerCircumferenceMm,
      ...(request.maxBudgetMinor === undefined ? {} : { maxBudgetMinor: request.maxBudgetMinor }),
      requiredProductIds: [...new Set(lockedBeads.map((bead) => bead.beadProductId))],
      emotionTags: current.story.emotionTags,
      styleTags: current.story.styleTags,
      colorTags: current.story.colorPalette,
      locale: current.locale,
      currency: current.currency
    });

    const catalogRows = await this.dependencies.catalog.listActiveCatalogProducts(current.currency);
    const products = toEngineProducts(catalogRows);
    const ruleSet = await this.compileRules(context, feasibilitySnapshotOf(products), true);
    const stock = await this.loadStock(products.map((product) => product.beadProductId));
    const timestamp = this.now().toISOString();

    const engineCandidates = await generateDesignCandidates({
      context,
      products,
      ruleSet,
      stock,
      now: timestamp,
      candidateCount: 4
    });
    if (engineCandidates.length === 0) {
      throw new DomainApiError(
        "VALIDATION_ERROR",
        "The design engine produced no optimization candidates for this design."
      );
    }

    const optimized = this.rebuildOptimizedDesign({
      current,
      candidates: engineCandidates,
      lockedBeads,
      lockedInlineAccessories,
      timestamp
    });
    const priced = DesignV1Schema.parse(
      await this.dependencies.pricing.recalculateDesignPrice(optimized.design)
    );
    await this.dependencies.inventory.validateAvailability(quantitiesByProduct(priced));

    const evaluation = await evaluateDesignDraft({
      draft: {
        bracelet: priced.bracelet,
        beads: priced.beads,
        accessories: priced.accessories,
        materialCostMinor: priced.beads.reduce((total, bead) => total + bead.unitPriceMinor, 0)
      },
      layoutStrategy: optimized.layoutStrategy,
      context,
      products,
      ruleSet,
      stock
    });

    const zh = isChinese(current.locale);
    const label = strategyLabel(optimized.layoutStrategy, current.locale);
    const reasons = [
      zh
        ? `优化布局：${label}（构图 ${evaluation.scores.compositionScore} 分，综合 ${evaluation.scores.overallScore} 分）。`
        : `Optimized layout: ${label} (composition ${evaluation.scores.compositionScore}, overall ${evaluation.scores.overallScore}).`,
      zh
        ? `保留 ${request.lockedComponentIds.length} 个锁定组件，共 ${priced.beads.length} 颗珠子。`
        : `${request.lockedComponentIds.length} locked components preserved; ${priced.beads.length} beads in total.`
    ];

    return {
      requestId: request.requestId,
      design: toPublicDesign(priced),
      layoutStrategy: optimized.layoutStrategy,
      score: evaluation.scores,
      operations: optimized.operations,
      reasons,
      warnings: evaluation.violations.map((violation) => ({
        code: violation.code,
        message: violation.message
      }))
    };
  }

  private rebuildOptimizedDesign(input: {
    current: DesignV1;
    candidates: readonly DesignCandidate[];
    lockedBeads: readonly BeadV1[];
    lockedInlineAccessories: readonly Extract<
      DesignV1["accessories"][number],
      { placementMode: "INLINE" }
    >[];
    timestamp: string;
  }): {
    design: DesignV1;
    layoutStrategy: LayoutStrategy;
    operations: UpdateDesignOperation[];
  } {
    const { current, candidates, lockedBeads, lockedInlineAccessories, timestamp } = input;

    for (const candidate of candidates) {
      const rebuilt = this.remapLockedComponents(candidate, lockedBeads);
      if (rebuilt === null) continue;

      const inlineAccessories = current.accessories.filter(
        (accessory): accessory is Extract<typeof accessory, { placementMode: "INLINE" }> =>
          accessory.placementMode === "INLINE"
      );
      const anchoredAccessories = current.accessories
        .filter(
          (accessory): accessory is Extract<typeof accessory, { placementMode: "ANCHORED" }> =>
            accessory.placementMode === "ANCHORED"
        )
        .map((accessory) => {
          const stillPresent = rebuilt.some((bead) => bead.componentId === accessory.anchorComponentId);
          if (stillPresent) return accessory;
          const anchor =
            rebuilt.find((bead) => bead.componentId === accessory.anchorComponentId) ??
            rebuilt.find((bead) => bead.role === "FOCAL") ??
            rebuilt[0]!;
          return { ...accessory, anchorComponentId: anchor.componentId, anchorSlot: accessory.anchorSlot };
        });

      const beads = rebuilt;
      const accessories = [
        ...inlineAccessories.map((accessory, index) => ({
          ...accessory,
          positionIndex: beads.length + index
        })),
        ...anchoredAccessories
      ];

      const design: DesignV1 = {
        ...current,
        revision: current.revision + 1,
        updatedAt: timestamp,
        bracelet: { ...candidate.draft.bracelet, totalBeadCount: beads.length },
        beads,
        accessories,
        pricing: {
          ...current.pricing,
          materialSubtotalMinor: beads.reduce((total, bead) => total + bead.unitPriceMinor, 0),
          totalPriceMinor: beads.reduce((total, bead) => total + bead.unitPriceMinor, 0),
          priceCalculatedAt: timestamp
        }
      };
      const operations = diffOperations(current, design);
      return { design: rebuildDerived(design), layoutStrategy: candidate.layoutStrategy, operations };
    }

    throw new DomainApiError(
      "VALIDATION_ERROR",
      "No optimization candidate preserves every locked component."
    );
  }

  private remapLockedComponents(
    candidate: DesignCandidate,
    lockedBeads: readonly BeadV1[]
  ): BeadV1[] | null {
    if (lockedBeads.length === 0) return [...candidate.draft.beads];
    const availableByProduct = new Map<string, string[]>();
    for (const bead of lockedBeads) {
      const list = availableByProduct.get(bead.beadProductId) ?? [];
      list.push(bead.componentId);
      availableByProduct.set(bead.beadProductId, list);
    }
    const used = new Set<string>();
    const remapped = candidate.draft.beads.map((bead) => {
      const lockedIds = availableByProduct.get(bead.beadProductId);
      if (lockedIds === undefined) return bead;
      const free = lockedIds.find((id) => !used.has(id));
      if (free === undefined) return bead;
      used.add(free);
      return { ...bead, componentId: free };
    });
    const allPresent = lockedBeads.every((bead) =>
      remapped.some((candidate) => candidate.componentId === bead.componentId)
    );
    return allPresent ? remapped : null;
  }
}

function firstKnownColor(product: EngineCatalogProduct) {
  for (const tag of product.colorTags) {
    const color = taxonomyColorOklch(tag);
    if (color !== undefined) return color;
  }
  return undefined;
}

function hueLabelOf(
  base: ReturnType<typeof taxonomyColorOklch>,
  partner: ReturnType<typeof taxonomyColorOklch>,
  zh: boolean
): string {
  if (base === undefined || partner === undefined) {
    return zh ? "中性配色" : "neutral pairing";
  }
  const distance = Math.abs(((base.h - partner.h) % 360 + 360) % 360);
  const hue = Math.min(distance, 360 - distance);
  if (hue <= 60) return zh ? "邻近色" : "analogous";
  if (hue >= 150) return zh ? "互补色" : "complementary";
  return zh ? "对比色" : "contrasting";
}

/**
 * Deterministic edit script transforming `current` into `optimized` through
 * the public /api/design/update operation vocabulary: add new ring members,
 * re-anchor anchored accessories, remove retired ones, then selection-sort
 * the surviving ring into the target order.
 */
function diffOperations(
  current: DesignV1,
  optimized: DesignV1
): UpdateDesignOperation[] {
  const currentRing = [
    ...current.beads,
    ...current.accessories.filter((item) => item.placementMode === "INLINE")
  ].sort((left, right) => left.positionIndex - right.positionIndex);
  const optimizedRing = [
    ...optimized.beads,
    ...optimized.accessories.filter((item) => item.placementMode === "INLINE")
  ].sort((left, right) => left.positionIndex - right.positionIndex);

  const currentIds = new Set(currentRing.map((component) => component.componentId));
  const optimizedIds = new Set(optimizedRing.map((component) => component.componentId));

  const operations: UpdateDesignOperation[] = [];

  let working = [...currentRing];
  for (const component of optimizedRing) {
    if (currentIds.has(component.componentId)) continue;
    operations.push({ operation: "ADD_COMPONENT", component });
    working.splice(Math.min(component.positionIndex, working.length), 0, component);
  }

  for (const accessory of optimized.accessories) {
    if (accessory.placementMode !== "ANCHORED") continue;
    const before = current.accessories.find(
      (item) => item.componentId === accessory.componentId
    );
    if (
      before !== undefined &&
      before.placementMode === "ANCHORED" &&
      (before.anchorComponentId !== accessory.anchorComponentId ||
        before.anchorSlot !== accessory.anchorSlot)
    ) {
      operations.push({
        operation: "REPLACE_COMPONENT",
        componentId: accessory.componentId,
        replacement: accessory
      });
    }
  }

  working = working.filter((component) => optimizedIds.has(component.componentId));
  for (const component of currentRing) {
    if (optimizedIds.has(component.componentId)) continue;
    operations.push({ operation: "REMOVE_COMPONENT", componentId: component.componentId });
  }

  for (let index = 0; index < optimizedRing.length; index += 1) {
    const targetId = optimizedRing[index]!.componentId;
    const currentIndex = working.findIndex((component) => component.componentId === targetId);
    if (currentIndex === index) continue;
    operations.push({
      operation: "MOVE_COMPONENT",
      componentId: targetId,
      targetPositionIndex: index
    });
    const [moved] = working.splice(currentIndex, 1);
    working.splice(index, 0, moved!);
  }

  if (
    current.bracelet.wristCircumferenceMm !== optimized.bracelet.wristCircumferenceMm ||
    current.bracelet.targetInnerCircumferenceMm !==
      optimized.bracelet.targetInnerCircumferenceMm ||
    current.bracelet.beadGapMm !== optimized.bracelet.beadGapMm
  ) {
    operations.push({ operation: "UPDATE_BRACELET", bracelet: optimized.bracelet });
  }

  return operations;
}
