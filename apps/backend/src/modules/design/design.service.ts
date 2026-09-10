import type { DatabaseClient } from "@mystcrag/database";
import {
  DesignRepository as DatabaseDesignRepository,
  DesignDecisionTraceRepository,
  InventoryRepository as DatabaseInventoryRepository,
  KnowledgeRepository as DatabaseKnowledgeRepository,
  KnowledgeUsageEventRepository,
  OrderRepository as DatabaseOrderRepository,
  PricingRepository as DatabasePricingRepository,
  ProductRepository as DatabaseProductRepository,
  PublicationRepository as DatabasePublicationRepository
} from "@mystcrag/database";
import { createEmbeddingProviderFromEnv, KnowledgeCore } from "@mystcrag/knowledge-core";

import { knowledgeUsageRecorderFromRepository } from "../../observability/knowledge-usage-recorder.js";
import { AiRecommendationDesignAdapter } from "./ai-recommendation-design.adapter.js";
import { DesignApplicationService } from "./design-api.service.js";
import { RecommendationApplicationService } from "./recommendation.service.js";

export function createDesignApplicationService(client: DatabaseClient) {
  return new DesignApplicationService({
    designs: new DatabaseDesignRepository(client),
    catalog: new DatabaseProductRepository(client),
    pricing: new DatabasePricingRepository(client),
    inventory: new DatabaseInventoryRepository(client),
    publications: new DatabasePublicationRepository(client),
    orders: new DatabaseOrderRepository(client),
    generator: new AiRecommendationDesignAdapter(),
    usage: knowledgeUsageRecorderFromRepository(new KnowledgeUsageEventRepository(client))
  });
}

export function createRecommendationApplicationService(client: DatabaseClient) {
  const inventory = new DatabaseInventoryRepository(client);
  const knowledge = new KnowledgeCore({
    database: client,
    repository: new DatabaseKnowledgeRepository(client),
    embeddings: createEmbeddingProviderFromEnv()
  });
  return new RecommendationApplicationService({
    designs: new DatabaseDesignRepository(client),
    catalog: new DatabaseProductRepository(client),
    pricing: new DatabasePricingRepository(client),
    inventory,
    rules: knowledge,
    traces: new DesignDecisionTraceRepository(client),
    stock: inventory,
    usage: knowledgeUsageRecorderFromRepository(new KnowledgeUsageEventRepository(client))
  });
}
