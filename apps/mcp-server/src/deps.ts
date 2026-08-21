import type { StoredKnowledgeRule } from "@mystcrag/database";
import type { KnowledgeType } from "@mystcrag/design-contract";
import type {
  CatalogFeasibilitySnapshot,
  CompiledRuleSet,
  RuleCompileOptions
} from "@mystcrag/knowledge-core";
import type { CatalogRowInput } from "@mystcrag/database";

export type KnowledgeSearchPort = {
  searchKnowledge(query: {
    text?: string;
    knowledgeTypes?: KnowledgeType[];
    knowledgeDomains?: string[];
    subjects?: string[];
    productionOnly?: boolean;
    limit?: number;
  }): Promise<{
    knowledgeVersion: string;
    strategy: string;
    hits: Array<{
      rule: StoredKnowledgeRule;
      score: number;
      channels: { structured: boolean; keyword: boolean; vector: boolean };
    }>;
  }>;
  getRules(filter?: {
    knowledgeTypes?: KnowledgeType[];
    knowledgeDomains?: string[];
    subjects?: string[];
    limit?: number;
  }): Promise<StoredKnowledgeRule[]>;
  getMaterialCompatibility(materialTaxonomyId: string): Promise<StoredKnowledgeRule[]>;
  getColorRules(colorTaxonomyId: string): Promise<StoredKnowledgeRule[]>;
  compileActiveRules(
    catalog: CatalogFeasibilitySnapshot,
    options?: RuleCompileOptions
  ): Promise<CompiledRuleSet>;
};

export type CatalogPort = {
  listActiveCatalogProducts(currency: "CNY" | "TWD"): Promise<CatalogRowInput[]>;
};

export type StockPort = {
  getAvailableQuantities(
    productIds: readonly string[]
  ): Promise<ReadonlyMap<string, number>>;
};

/**
 * Narrow ports the five MCP tools consume. The composition root (runtime.ts)
 * wires repository-backed implementations; tests wire in-memory fakes. Tools
 * never touch Prisma directly (ADR-12).
 */
export type McpToolDependencies = {
  knowledge: KnowledgeSearchPort;
  catalog: CatalogPort;
  stock: StockPort;
};

export type { StoredKnowledgeRule };
