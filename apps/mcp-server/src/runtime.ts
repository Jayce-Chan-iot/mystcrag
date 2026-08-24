import {
  createPrismaClient,
  InventoryRepository,
  KnowledgeRepository,
  ProductRepository,
  type DatabaseClient
} from "@mystcrag/database";
import { createEmbeddingProviderFromEnv, KnowledgeCore } from "@mystcrag/knowledge-core";

import type { McpToolDependencies } from "./deps.js";

export type McpRuntimeOptions = {
  databaseUrl: string;
};

export type McpRuntime = {
  dependencies: McpToolDependencies;
  database: DatabaseClient;
  stop(): Promise<void>;
};

/**
 * Composition root: wires repository-backed ports for the five MCP tools
 * (ADR-12). Tools only see the narrow ports in deps.ts; Prisma stays here.
 * The shared env-driven embedding provider keeps the vector channel of
 * search_knowledge on the same model the knowledge-worker indexes with.
 */
export function createMcpRuntime(options: McpRuntimeOptions): McpRuntime {
  const database = createPrismaClient(options.databaseUrl);
  const knowledge = new KnowledgeCore({
    database,
    repository: new KnowledgeRepository(database),
    embeddings: createEmbeddingProviderFromEnv()
  });
  const catalog = new ProductRepository(database);
  const stock = new InventoryRepository(database);

  return {
    dependencies: { knowledge, catalog, stock },
    database,
    async stop() {
      await database.$disconnect();
    }
  };
}
