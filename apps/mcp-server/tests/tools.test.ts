import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { resolveQuestionnaireContext } from "@mystcrag/context-resolver";
import { toContractCatalogMaterials, type CatalogRowInput } from "@mystcrag/database";
import {
  buildBracelet,
  evaluateDesignDraft,
  recommendPalettes,
  type PaletteColorRule
} from "@mystcrag/design-engine";
import {
  compileDecisionRules,
  KNOWLEDGE_RULE_FIXTURES,
  KNOWLEDGE_SOURCE_FIXTURES,
  catalogFeasibilitySnapshotOf,
  type CatalogFeasibilitySnapshot,
  type RuleCompileOptions
} from "@mystcrag/knowledge-core";
import type { KnowledgeType } from "@mystcrag/design-contract";

import type { McpToolDependencies, StoredKnowledgeRule } from "../src/deps.js";
import { toPublicRuleSummary } from "../src/projection.js";
import {
  createMcpToolRegistrations,
  MCP_TOOL_NAMES,
  EvaluateDesignInput,
  GetMaterialCompatibilityInput,
  GetRulesInput,
  RecommendPaletteInput,
  SearchKnowledgeInput
} from "../src/tools.js";
import { createMcpServer } from "../src/server.js";

const RULES: StoredKnowledgeRule[] = KNOWLEDGE_RULE_FIXTURES.map((seed) => ({
  ...seed,
  knowledgeVersionId: null
}));

const SOURCES = new Map(KNOWLEDGE_SOURCE_FIXTURES.map((source) => [source.id, source]));

const CATALOG_ROWS: CatalogRowInput[] = [
  {
    id: "product-amethyst-8",
    productType: "MATERIAL",
    sku: "BEAD-AMETHYST-8",
    name: "紫水晶 8mm",
    currency: "CNY",
    unitPriceMinor: 600,
    active: true,
    crystalId: "crystal-amethyst",
    crystalNameCn: "紫水晶",
    crystalNameEn: "Amethyst",
    colorTags: ["color:purple"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 8,
    materialKey: "material:amethyst",
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: "texture-amethyst-v1"
  },
  {
    id: "product-aquamarine-8",
    productType: "MATERIAL",
    sku: "BEAD-AQUAMARINE-8",
    name: "海蓝宝 8mm",
    currency: "CNY",
    unitPriceMinor: 700,
    active: true,
    crystalId: "crystal-aquamarine",
    crystalNameCn: "海蓝宝",
    crystalNameEn: "Aquamarine",
    colorTags: ["color:blue"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 8,
    materialKey: "material:aquamarine",
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: "texture-aquamarine-v1"
  },
  {
    id: "product-moonstone-6",
    productType: "MATERIAL",
    sku: "BEAD-MOONSTONE-6",
    name: "月光石 6mm",
    currency: "CNY",
    unitPriceMinor: 450,
    active: true,
    crystalId: "crystal-moonstone",
    crystalNameCn: "月光石",
    crystalNameEn: "Moonstone",
    colorTags: ["color:white"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:ethereal"],
    emotionTags: ["emotion:hope"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 6,
    materialKey: "material:moonstone",
    modelAssetKey: "sphere-round-6mm-v1",
    textureAssetKey: "texture-moonstone-v1"
  },
  {
    id: "product-citrine-10",
    productType: "MATERIAL",
    sku: "BEAD-CITRINE-10",
    name: "黄水晶 10mm",
    currency: "CNY",
    unitPriceMinor: 800,
    active: true,
    crystalId: "crystal-citrine",
    crystalNameCn: "黄水晶",
    crystalNameEn: "Citrine",
    colorTags: ["color:yellow"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:natural"],
    emotionTags: ["emotion:joy"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 10,
    materialKey: "material:citrine",
    modelAssetKey: "sphere-round-10mm-v1",
    textureAssetKey: "texture-citrine-v1"
  }
];

function payloadText(rule: StoredKnowledgeRule): string {
  if (typeof rule.payload !== "object" || rule.payload === null) return "";
  const payload = rule.payload as Record<string, unknown>;
  return [payload.rule, payload.note]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function createFakeKnowledge(failSearch = false): McpToolDependencies["knowledge"] {
  return {
    async searchKnowledge(query) {
      if (failSearch) throw new Error("database connection lost");
      let hits = RULES.filter((rule) => {
        if (query.knowledgeTypes && !query.knowledgeTypes.includes(rule.knowledgeType)) {
          return false;
        }
        if (query.knowledgeDomains && !query.knowledgeDomains.includes(rule.knowledgeDomain)) {
          return false;
        }
        if (query.subjects && !query.subjects.includes(rule.subject)) return false;
        if (query.text) {
          const text = query.text.toLowerCase();
          if (
            !payloadText(rule).toLowerCase().includes(text) &&
            !rule.subject.includes(text)
          ) {
            return false;
          }
        }
        return true;
      });
      hits = hits.slice(0, query.limit ?? 20);
      return {
        knowledgeVersion: "kv-fixture-1",
        strategy: hits.length > 0 ? "hybrid" : "structured",
        hits: hits.map((rule, index) => ({
          rule,
          score: Number((0.9 - index * 0.01).toFixed(4)),
          channels: { structured: true, keyword: Boolean(query.text), vector: false }
        }))
      };
    },
    async getRules(filter) {
      let rules = RULES;
      if (filter?.knowledgeTypes) {
        rules = rules.filter((rule) => filter.knowledgeTypes!.includes(rule.knowledgeType));
      }
      if (filter?.knowledgeDomains) {
        rules = rules.filter((rule) => filter.knowledgeDomains!.includes(rule.knowledgeDomain));
      }
      if (filter?.subjects) {
        rules = rules.filter((rule) => filter.subjects!.includes(rule.subject));
      }
      return rules.slice(0, filter?.limit ?? 200);
    },
    async getMaterialCompatibility(materialTaxonomyId) {
      return RULES.filter(
        (rule) =>
          rule.knowledgeType === "MATERIAL_COMPATIBILITY" &&
          rule.subject === materialTaxonomyId
      );
    },
    async getColorRules(colorTaxonomyId) {
      return RULES.filter(
        (rule) => rule.knowledgeType === "COLOR_THEORY" && rule.subject === colorTaxonomyId
      );
    },
    async compileActiveRules(
      catalog: CatalogFeasibilitySnapshot,
      options?: RuleCompileOptions
    ) {
      return compileDecisionRules({
        knowledgeVersion: "kv-fixture-1",
        rules: RULES,
        sources: SOURCES,
        catalog,
        options
      });
    }
  };
}

function createFakeDeps(failSearch = false): McpToolDependencies {
  return {
    knowledge: createFakeKnowledge(failSearch),
    catalog: {
      async listActiveCatalogProducts(currency) {
        return CATALOG_ROWS.filter((row) => row.currency === currency);
      }
    },
    stock: {
      async getAvailableQuantities(productIds) {
        return new Map(productIds.map((id) => [id, 9999]));
      }
    }
  };
}

type ToolClient = {
  client: Client;
  server: ReturnType<typeof createMcpServer>;
};

async function createToolClient(deps: McpToolDependencies): Promise<ToolClient> {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "mcp-test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return { client, server };
}

async function callTool(
  deps: McpToolDependencies,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const harness = await createToolClient(deps);
  try {
    const result = (await harness.client.callTool({ name, arguments: args })) as unknown as {
      isError?: boolean;
      structuredContent?: unknown;
      content?: Array<{ text?: string }>;
    };
    if (result.isError === true) {
      throw new Error(`Tool ${name} returned isError: ${JSON.stringify(result.content)}`);
    }
    assert.ok(result.structuredContent, "expected structuredContent in tool result");
    return result.structuredContent as Record<string, unknown>;
  } finally {
    await harness.client.close();
    await harness.server.close();
  }
}

test("registers exactly the five documented tools with metadata and schemas", () => {
  const registrations = createMcpToolRegistrations(createFakeDeps());
  assert.deepEqual(
    registrations.map((tool) => tool.name),
    [...MCP_TOOL_NAMES]
  );
  for (const tool of registrations) {
    assert.ok(tool.title.length > 0, `${tool.name} needs a title`);
    assert.ok(tool.description.length > 20, `${tool.name} needs a description`);
    assert.ok(tool.inputSchema instanceof z.ZodType, `${tool.name} needs a Zod schema`);
  }
});

test("tools/list over in-memory transport advertises the five tools", async () => {
  const harness = await createToolClient(createFakeDeps());
  try {
    const listed = await harness.client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [...MCP_TOOL_NAMES].sort()
    );
    for (const tool of listed.tools) {
      assert.ok(tool.description && tool.description.length > 0);
      assert.ok(tool.inputSchema, `${tool.name} must expose an input schema`);
    }
  } finally {
    await harness.client.close();
    await harness.server.close();
  }
});

test("input schemas reject invalid arguments (schema layer)", () => {
  const cases: Array<[z.ZodType, unknown, string]> = [
    [SearchKnowledgeInput, { subjects: ["not a taxonomy id"] }, "search_knowledge bad subject"],
    [SearchKnowledgeInput, { limit: 0 }, "search_knowledge limit below range"],
    [SearchKnowledgeInput, { unknownKey: true }, "search_knowledge rejects unknown keys"],
    [GetRulesInput, { knowledgeTypes: ["NOT_A_TYPE"] }, "get_rules bad knowledge type"],
    [GetMaterialCompatibilityInput, { materialTaxonomyId: "quartz" }, "compatibility bad id"],
    [RecommendPaletteInput, { baseColorTaxonomyId: "color:blue", paletteSize: 9 }, "palette size out of range"],
    [
      EvaluateDesignInput,
      { beads: [], wristCircumferenceMm: 160 },
      "evaluate_design empty beads"
    ],
    [
      EvaluateDesignInput,
      { beads: [{ beadProductId: "x" }], wristCircumferenceMm: 50 },
      "evaluate_design wrist below range"
    ],
    [
      EvaluateDesignInput,
      { beads: [{ beadProductId: "x", role: "BAD" }], wristCircumferenceMm: 160 },
      "evaluate_design bad role"
    ]
  ];
  for (const [schema, input, label] of cases) {
    assert.equal(schema.safeParse(input).success, false, label);
  }
});

type InBandError = { isError?: boolean; content?: Array<{ text?: string }> };

async function callToolExpectError(
  deps: McpToolDependencies,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const harness = await createToolClient(deps);
  try {
    const result = (await harness.client.callTool({ name, arguments: args })) as unknown as InBandError;
    assert.equal(result.isError, true, `expected in-band error from ${name}`);
    return result.content?.[0]?.text ?? "";
  } finally {
    await harness.client.close();
    await harness.server.close();
  }
}

test("client-side invalid arguments surface as JSON-RPC InvalidParams", async () => {
  const text = await callToolExpectError(createFakeDeps(), "get_material_compatibility", {
    materialTaxonomyId: "quartz"
  });
  assert.match(text, /-32602/);
  assert.match(text, /Expected a taxonomy id/);
});

test("unknown tool name surfaces an in-band unknown-tool error", async () => {
  const text = await callToolExpectError(createFakeDeps(), "not_a_tool", {});
  assert.match(text, /-32602/);
  assert.match(text, /not_a_tool/);
});

test("search_knowledge returns public projection without internal fields", async () => {
  const result = await callTool(createFakeDeps(), "search_knowledge", {
    subjects: ["material:quartz"],
    limit: 10
  });
  assert.equal(result.knowledgeVersion, "kv-fixture-1");
  const hits = result.hits as Array<Record<string, unknown>>;
  assert.ok(hits.length > 0, "expected compatibility hits for material:quartz");
  for (const hit of hits) {
    assert.ok(hit.ruleId, "hit needs ruleId");
    assert.equal(typeof hit.confidence, "number");
    assert.ok(hit.channels, "hit needs channels");
    assert.equal("fingerprint" in hit, false, "fingerprint must stay server-side");
    assert.equal("sourceRefs" in hit, false, "sourceRefs must stay server-side");
    assert.equal("sourceId" in hit, false, "sourceId must stay server-side");
    assert.equal("status" in hit, false, "status must stay server-side");
  }
});

test("search_knowledge results match the knowledge port exactly", async () => {
  const deps = createFakeDeps();
  const query = {
    knowledgeTypes: ["COLOR_THEORY"] as KnowledgeType[],
    subjects: ["color:blue"]
  };
  const direct = await deps.knowledge.searchKnowledge(query);
  const result = await callTool(deps, "search_knowledge", query);
  const hits = result.hits as Array<{ ruleId: string; score: number }>;
  assert.deepEqual(
    hits.map((hit) => hit.ruleId),
    direct.hits.map((hit) => hit.rule.id)
  );
  assert.deepEqual(
    hits.map((hit) => hit.score),
    direct.hits.map((hit) => hit.score)
  );
});

test("get_rules filters by knowledge type and projects rules", async () => {
  const result = await callTool(createFakeDeps(), "get_rules", {
    knowledgeTypes: ["MATERIAL_COMPATIBILITY"],
    subjects: ["material:quartz"]
  });
  const rules = result.rules as Array<{ ruleId: string; knowledgeType: string; subject: string }>;
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.equal(rule.knowledgeType, "MATERIAL_COMPATIBILITY");
    assert.equal(rule.subject, "material:quartz");
  }
  assert.equal(result.count, rules.length);
});

test("get_material_compatibility aggregates compatible and conflicting companions", async () => {
  const result = await callTool(createFakeDeps(), "get_material_compatibility", {
    materialTaxonomyId: "material:quartz"
  });
  assert.equal(result.material, "material:quartz");
  const compatible = result.compatibleWith as string[];
  assert.ok(compatible.includes("material:feldspar"), "quartz is compatible with feldspar");
  assert.ok(compatible.includes("material:chalcedony"), "quartz is compatible with chalcedony");
  assert.deepEqual(compatible, [...compatible].sort(), "compatible list is sorted");
});

test("recommend_palette output matches the design engine directly (consistency)", async () => {
  const deps = createFakeDeps();
  const base = "color:blue";
  const toolResult = await callTool(deps, "recommend_palette", {
    baseColorTaxonomyId: base,
    paletteSize: 3,
    limit: 5
  });

  const colorRules = await deps.knowledge.getColorRules(base);
  const companionColors = [
    ...new Set(
      colorRules.flatMap((rule) => {
        const payload = rule.payload as Record<string, unknown> | null;
        const value = payload?.companionColors;
        return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
      })
    )
  ];
  const companionRules = (await Promise.all(companionColors.map((c) => deps.knowledge.getColorRules(c)))).flat();
  const projected: PaletteColorRule[] = [...colorRules, ...companionRules].map((rule) => ({
    ruleId: rule.id,
    subject: rule.subject,
    relation: rule.relation,
    companions: companionColorsOf(rule),
    confidence: rule.confidence
  }));
  const direct = recommendPalettes({
    baseColorTaxonomyId: base,
    rules: projected,
    paletteSize: 3,
    limit: 5
  });

  assert.equal(toolResult.baseColor, base);
  assert.deepEqual(toolResult.palettes, direct);
  assert.equal(toolResult.paletteCount, direct.length);
  assert.ok(direct.length > 0, "fixture color rules should yield palettes");
});

function companionColorsOf(rule: StoredKnowledgeRule): string[] {
  const payload = rule.payload as Record<string, unknown> | null;
  const value = payload?.companionColors;
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string") : [];
}

test("evaluate_design rejects unknown bead product ids with InvalidParams", async () => {
  const text = await callToolExpectError(createFakeDeps(), "evaluate_design", {
    beads: [{ beadProductId: "product-does-not-exist" }],
    wristCircumferenceMm: 160
  });
  assert.match(text, /-32602/);
  assert.match(text, /product-does-not-exist/);
});

test("evaluate_design matches the direct knowledge-core + design-engine pipeline (consistency)", async () => {
  const deps = createFakeDeps();
  const args = {
    beads: [
      { beadProductId: "product-amethyst-8" },
      { beadProductId: "product-aquamarine-8" },
      { beadProductId: "product-amethyst-8" },
      { beadProductId: "product-moonstone-6", role: "ACCENT" }
    ],
    wristCircumferenceMm: 160,
    maxBudgetMinor: 5000,
    colorTags: ["color:purple", "color:blue"],
    styleTags: ["style:minimal"],
    layoutStrategy: "SYMMETRIC_BALANCE"
  };
  const toolResult = await callTool(deps, "evaluate_design", args);

  const products = toContractCatalogMaterials(
    await deps.catalog.listActiveCatalogProducts("CNY")
  );
  const productsById = new Map(products.map((product) => [product.beadProductId, product]));
  const context = resolveQuestionnaireContext({
    wristCircumferenceMm: args.wristCircumferenceMm,
    maxBudgetMinor: args.maxBudgetMinor,
    emotionTags: [],
    styleTags: args.styleTags,
    colorTags: args.colorTags,
    locale: "zh-CN",
    currency: "CNY"
  });
  const ruleSet = await deps.knowledge.compileActiveRules(
    catalogFeasibilitySnapshotOf(products),
    { context }
  );
  const beads = args.beads.map((bead, index) => {
    const product = productsById.get(bead.beadProductId)!;
    return {
      componentId: `mcp-bead-${index}`,
      positionIndex: index,
      beadProductId: product.beadProductId,
      crystalId: product.crystalId,
      materialKey: product.materialKey,
      shape: product.shape,
      diameterMm: product.diameterMm,
      quantity: 1 as const,
      role: (bead.role ?? "MAIN") as "MAIN" | "ACCENT" | "FOCAL",
      modelAssetKey: product.modelAssetKey,
      textureAssetKey: product.textureAssetKey,
      unitPriceMinor: product.unitPriceMinor
    };
  });
  const stock = await deps.stock.getAvailableQuantities(beads.map((bead) => bead.beadProductId));
  const evaluation = await evaluateDesignDraft({
    draft: {
      bracelet: buildBracelet(context, beads.length),
      beads,
      accessories: [],
      materialCostMinor: beads.reduce((total, bead) => total + bead.unitPriceMinor, 0)
    },
    layoutStrategy: "SYMMETRIC_BALANCE",
    context,
    products,
    ruleSet,
    stock
  });

  assert.equal(toolResult.knowledgeVersion, ruleSet.knowledgeVersion);
  assert.equal(toolResult.productCatalogVersion, ruleSet.productCatalogVersion);
  assert.equal(toolResult.beadCount, beads.length);
  assert.deepEqual(toolResult.scores, evaluation.scores);
  assert.deepEqual(toolResult.firedRuleIds, evaluation.firedRuleIds);
  assert.deepEqual(toolResult.violations, evaluation.violations);
});

test("unexpected dependency failures surface in-band without crashing the server", async () => {
  const text = await callToolExpectError(createFakeDeps(true), "search_knowledge", {
    text: "quartz"
  });
  assert.match(text, /database connection lost/);
});

test("empty catalog maps to a typed InternalError via the tool layer", async () => {
  const deps = createFakeDeps();
  deps.catalog = {
    async listActiveCatalogProducts() {
      return [];
    }
  };
  const text = await callToolExpectError(deps, "evaluate_design", {
    beads: [{ beadProductId: "product-amethyst-8" }],
    wristCircumferenceMm: 160
  });
  assert.match(text, /-32603/);
  assert.match(text, /No active catalog materials/);
});

test("public projection keeps deterministic summary and hides internals", () => {
  const rule = RULES[0]!;
  const summary = toPublicRuleSummary(rule);
  assert.equal(summary.ruleId, rule.id);
  assert.equal(summary.knowledgeType, rule.knowledgeType);
  assert.equal(summary.subject, rule.subject);
  assert.equal(summary.relation, rule.relation);
  assert.equal(summary.confidence, rule.confidence);
  assert.ok(summary.summary.length > 0);
  assert.equal("fingerprint" in summary, false);
  assert.equal("sourceRefs" in summary, false);
  assert.equal("sourceId" in summary, false);
});
