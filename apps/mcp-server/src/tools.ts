import { z } from "zod";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { resolveQuestionnaireContext } from "@mystcrag/context-resolver";
import { toContractCatalogMaterials } from "@mystcrag/database";
import {
  buildBracelet,
  evaluateDesignDraft,
  recommendPalettes,
  type PaletteColorRule
} from "@mystcrag/design-engine";
import { catalogFeasibilitySnapshotOf } from "@mystcrag/knowledge-core";

import type { McpToolDependencies, StoredKnowledgeRule } from "./deps.js";
import { toPublicRuleSummary } from "./projection.js";

const TAXONOMY_ID = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/, "Expected a taxonomy id like material:quartz");

const KNOWLEDGE_TYPE = z.enum([
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
]);

const SearchKnowledgeInput = z.strictObject({
  text: z.string().trim().max(400).optional(),
  knowledgeTypes: z.array(KNOWLEDGE_TYPE).max(11).optional(),
  knowledgeDomains: z.array(z.string().max(160)).max(10).optional(),
  subjects: z.array(TAXONOMY_ID).max(20).optional(),
  productionOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional()
});

const GetRulesInput = z.strictObject({
  knowledgeTypes: z.array(KNOWLEDGE_TYPE).max(11).optional(),
  knowledgeDomains: z.array(z.string().max(160)).max(10).optional(),
  subjects: z.array(TAXONOMY_ID).max(20).optional(),
  limit: z.number().int().min(1).max(200).optional()
});

const GetMaterialCompatibilityInput = z.strictObject({
  materialTaxonomyId: TAXONOMY_ID
});

const RecommendPaletteInput = z.strictObject({
  baseColorTaxonomyId: TAXONOMY_ID,
  paletteSize: z.number().int().min(2).max(5).optional(),
  limit: z.number().int().min(1).max(10).optional()
});

const EvaluateDesignInput = z.strictObject({
  beads: z
    .array(
      z.strictObject({
        beadProductId: z.string().trim().min(1).max(200),
        role: z.enum(["MAIN", "ACCENT", "FOCAL"]).optional()
      })
    )
    .min(1)
    .max(40),
  wristCircumferenceMm: z.number().int().min(100).max(250),
  targetInnerCircumferenceMm: z.number().int().min(100).max(300).optional(),
  maxBudgetMinor: z.number().int().min(0).max(100_000_000).optional(),
  layoutStrategy: z
    .enum(["SYMMETRIC_BALANCE", "CENTER_FOCAL", "REPEAT_RHYTHM", "LOW_CONTRAST_FLOW"])
    .optional(),
  currency: z.enum(["CNY", "TWD"]).default("CNY"),
  locale: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
  emotionTags: z.array(z.string().max(60)).max(30).default([]),
  styleTags: z.array(z.string().max(60)).max(30).default([]),
  colorTags: z.array(z.string().max(60)).max(30).default([])
});

function invalidParams(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

function internalError(message: string): McpError {
  return new McpError(ErrorCode.InternalError, message);
}

function structuredResult(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: unknown;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

/** Relations that contribute compatible companions. */
const COMPATIBLE_RELATIONS = new Set(["compatible-with", "pairs-with"]);
const CONFLICT_RELATIONS = new Set(["conflicts-with", "avoid", "avoids"]);

function payloadStringArray(payload: unknown, key: string): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const value = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function compatibilityView(rules: readonly StoredKnowledgeRule[]): {
  compatibleWith: string[];
  conflictsWith: string[];
} {
  const compatible = new Set<string>();
  const conflicts = new Set<string>();
  for (const rule of rules) {
    if (COMPATIBLE_RELATIONS.has(rule.relation)) {
      for (const material of payloadStringArray(rule.payload, "companionMaterials")) {
        compatible.add(material);
      }
    } else if (CONFLICT_RELATIONS.has(rule.relation)) {
      for (const material of [
        ...payloadStringArray(rule.payload, "companionMaterials"),
        ...payloadStringArray(rule.payload, "materials")
      ]) {
        conflicts.add(material);
      }
    }
  }
  return {
    compatibleWith: [...compatible].sort(),
    conflictsWith: [...conflicts].sort()
  };
}

function paletteRuleProjection(rules: readonly StoredKnowledgeRule[]): PaletteColorRule[] {
  return rules.map((rule) => ({
    ruleId: rule.id,
    subject: rule.subject,
    relation: rule.relation,
    companions: payloadStringArray(rule.payload, "companionColors"),
    confidence: rule.confidence
  }));
}

/**
 * Tool registration contract: the transport-facing server adapter calls this
 * with its native register function. Keeps tools.ts free of SDK server
 * internals so tests can drive handlers directly.
 */
export type RegisterToolFn = <T extends z.ZodType>(
  name: string,
  config: { title?: string; description?: string; inputSchema: T },
  handler: (input: z.output<T>) => Promise<unknown>
) => void;

/**
 * The five knowledge/design tools (task book section 36/37, ADR-12). Every
 * tool is a thin projection over knowledge-core/design-engine — zero
 * business logic lives here.
 */
export function registerMcpTools(deps: McpToolDependencies, register: RegisterToolFn): void {
  register(
    "search_knowledge",
    {
      title: "Search crystal knowledge",
      description:
        "Full-text/structured hybrid search over APPROVED crystal knowledge rules " +
        "(color theory, material compatibility, style, composition, cultural " +
        "symbolism, tarot, market observations). Optional free text plus " +
        "structural filters; returns scored hits with fired channels.",
      inputSchema: SearchKnowledgeInput
    },
    async (input) => {
      const result = await deps.knowledge.searchKnowledge(input);
      return structuredResult({
        knowledgeVersion: result.knowledgeVersion,
        strategy: result.strategy,
        hitCount: result.hits.length,
        hits: result.hits.map((hit) => ({
          ...toPublicRuleSummary(hit.rule),
          score: hit.score,
          channels: hit.channels
        }))
      });
    }
  );

  register(
    "get_rules",
    {
      title: "List active knowledge rules",
      description:
        "Lists production APPROVED knowledge rules with optional filters by " +
        "knowledge type, domain, or taxonomy subject (e.g. material:quartz, " +
        "color:blue). Deterministic id order.",
      inputSchema: GetRulesInput
    },
    async (input) => {
      const rules = await deps.knowledge.getRules(input);
      return structuredResult({
        count: rules.length,
        rules: rules.map(toPublicRuleSummary)
      });
    }
  );

  register(
    "get_material_compatibility",
    {
      title: "Material compatibility lookup",
      description:
        "Returns MATERIAL_COMPATIBILITY knowledge for one material taxonomy id " +
        "(e.g. material:quartz): compatible and conflicting companion materials " +
        "with the supporting rules, confidences, and notes.",
      inputSchema: GetMaterialCompatibilityInput
    },
    async (input) => {
      const rules = await deps.knowledge.getMaterialCompatibility(input.materialTaxonomyId);
      const view = compatibilityView(rules);
      return structuredResult({
        material: input.materialTaxonomyId,
        compatibleWith: view.compatibleWith,
        conflictsWith: view.conflictsWith,
        rules: rules.map(toPublicRuleSummary)
      });
    }
  );

  register(
    "recommend_palette",
    {
      title: "Recommend color palettes",
      description:
        "Recommends color palettes for one base color taxonomy id (e.g. " +
        "color:blue) by expanding COLOR_THEORY harmony rules and scoring each " +
        "palette with the OKLCH pair-harmony math the design engine uses. " +
        "Returns ranked palettes with supporting rule ids.",
      inputSchema: RecommendPaletteInput
    },
    async (input) => {
      const colorRules = await deps.knowledge.getColorRules(input.baseColorTaxonomyId);
      const companionColors = [
        ...new Set(
          colorRules.flatMap((rule) =>
            payloadStringArray(rule.payload, "companionColors")
          )
        )
      ];
      const companionRules = (
        await Promise.all(
          companionColors.map((color) => deps.knowledge.getColorRules(color))
        )
      ).flat();
      const palettes = recommendPalettes({
        baseColorTaxonomyId: input.baseColorTaxonomyId,
        rules: paletteRuleProjection([...colorRules, ...companionRules]),
        paletteSize: input.paletteSize,
        limit: input.limit
      });
      return structuredResult({
        baseColor: input.baseColorTaxonomyId,
        paletteCount: palettes.length,
        palettes
      });
    }
  );

  register(
    "evaluate_design",
    {
      title: "Evaluate a bead design",
      description:
        "Deterministically scores a bead sequence (catalog bead product ids with " +
        "optional roles) against the active catalog, published knowledge rules, " +
        "and stock snapshot. Returns the design-score-v1 breakdown, fired rule " +
        "ids, soft rule score, and constraint violations. Identical inputs " +
        "always produce identical results.",
      inputSchema: EvaluateDesignInput
    },
    async (input) => {
      const catalogRows = await deps.catalog.listActiveCatalogProducts(input.currency);
      const products = toContractCatalogMaterials(catalogRows);
      if (products.length === 0) {
        throw internalError(`No active catalog materials for currency ${input.currency}.`);
      }
      const productsById = new Map(
        products.map((product) => [product.beadProductId, product])
      );

      const unknown = [...new Set(input.beads.map((bead) => bead.beadProductId))].filter(
        (id) => !productsById.has(id)
      );
      if (unknown.length > 0) {
        throw invalidParams(
          `Unknown beadProductId(s) not in the active ${input.currency} catalog: ${unknown.join(", ")}.`
        );
      }

      const context = resolveQuestionnaireContext({
        wristCircumferenceMm: input.wristCircumferenceMm,
        targetInnerCircumferenceMm: input.targetInnerCircumferenceMm,
        maxBudgetMinor: input.maxBudgetMinor,
        emotionTags: input.emotionTags,
        styleTags: input.styleTags,
        colorTags: input.colorTags,
        locale: input.locale,
        currency: input.currency
      });

      const ruleSet = await deps.knowledge.compileActiveRules(
        catalogFeasibilitySnapshotOf(products),
        { context }
      );

      const beads = input.beads.map((bead, index) => {
        const product = productsById.get(bead.beadProductId)!;
        return {
          componentId: `mcp-bead-${index}`,
          positionIndex: index,
          beadProductId: product.beadProductId,
          crystalId: product.crystalId,
          materialKey: product.materialKey,
          shape: product.shape,
          diameterMm: product.diameterMm,
          ...(product.lengthAlongStringMm === undefined
            ? {}
            : { lengthAlongStringMm: product.lengthAlongStringMm }),
          quantity: 1 as const,
          role: bead.role ?? "MAIN",
          modelAssetKey: product.modelAssetKey,
          textureAssetKey: product.textureAssetKey,
          unitPriceMinor: product.unitPriceMinor
        };
      });

      const stock = await deps.stock.getAvailableQuantities(
        beads.map((bead) => bead.beadProductId)
      );

      const evaluation = await evaluateDesignDraft({
        draft: {
          bracelet: buildBracelet(context, beads.length),
          beads,
          accessories: [],
          materialCostMinor: beads.reduce((total, bead) => total + bead.unitPriceMinor, 0)
        },
        layoutStrategy: input.layoutStrategy ?? "SYMMETRIC_BALANCE",
        context,
        products,
        ruleSet,
        stock
      });

      return structuredResult({
        knowledgeVersion: ruleSet.knowledgeVersion,
        productCatalogVersion: ruleSet.productCatalogVersion,
        beadCount: beads.length,
        layoutStrategy: input.layoutStrategy ?? "SYMMETRIC_BALANCE",
        scores: evaluation.scores,
        firedRuleIds: evaluation.firedRuleIds,
        softRuleScore: evaluation.softRuleScore,
        violations: evaluation.violations
      });
    }
  );
}

export const MCP_TOOL_NAMES = [
  "search_knowledge",
  "get_rules",
  "get_material_compatibility",
  "recommend_palette",
  "evaluate_design"
] as const;

/**
 * Transport-facing tool definition. `invoke` receives arguments the caller
 * already parsed against `inputSchema`; the SDK's registerTool callback does
 * that parse before invoking, and tests do it explicitly.
 */
export type McpToolRegistration = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  invoke: (args: unknown) => Promise<unknown>;
};

export function createMcpToolRegistrations(
  deps: McpToolDependencies
): McpToolRegistration[] {
  const registrations: McpToolRegistration[] = [];
  registerMcpTools(deps, (name, config, handler) => {
    registrations.push({
      name,
      title: config.title ?? name,
      description: config.description ?? "",
      inputSchema: config.inputSchema,
      invoke: handler as (args: unknown) => Promise<unknown>
    });
  });
  return registrations;
}

export { SearchKnowledgeInput, GetRulesInput, GetMaterialCompatibilityInput, RecommendPaletteInput, EvaluateDesignInput };
