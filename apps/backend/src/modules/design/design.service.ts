import type {
  DatabaseClient,
  DesignRepository,
  PersistedDesign,
  PersistedDesignRevision
} from "@mystcrag/database";
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
import { KnowledgeCore } from "@mystcrag/knowledge-core";
import type { DesignV1 } from "@mystcrag/design-contract";

import { DomainApiError } from "../../contracts/api-error.js";
import { knowledgeUsageRecorderFromRepository } from "../../observability/knowledge-usage-recorder.js";
import { AiRecommendationDesignAdapter } from "./ai-recommendation-design.adapter.js";
import { DesignApplicationService } from "./design-api.service.js";
import { RecommendationApplicationService } from "./recommendation.service.js";

export type DesignStubOperation =
  | "GENERATE"
  | "UPDATE"
  | "PRICE"
  | "SAVE"
  | "PUBLISH"
  | "CREATE_ORDER";

export interface DesignStubService {
  execute(operation: DesignStubOperation, input: unknown): Promise<unknown>;
}

export class NotImplementedDesignStubService implements DesignStubService {
  async execute(operation: DesignStubOperation): Promise<never> {
    throw new DomainApiError(
      "NOT_IMPLEMENTED",
      `${operation} orchestration is not implemented in Phase 2B.`
    );
  }
}

export class DesignService {
  constructor(private readonly designs: DesignRepository) {}

  createDesign(actorId: string, snapshot: DesignV1): Promise<PersistedDesign> {
    return this.designs.createDesign(actorId, snapshot);
  }

  getDesign(actorId: string, designId: string): Promise<PersistedDesign> {
    return this.designs.getDesign(actorId, designId);
  }

  updateDesign(
    actorId: string,
    designId: string,
    expectedRevision: number,
    snapshot: DesignV1,
    changeReason: string
  ): Promise<PersistedDesign> {
    return this.designs.updateDesign(
      actorId,
      designId,
      expectedRevision,
      snapshot,
      changeReason
    );
  }

  createRevision(
    actorId: string,
    designId: string,
    expectedRevision: number,
    snapshot: DesignV1,
    changeReason: string
  ): Promise<PersistedDesign> {
    return this.updateDesign(actorId, designId, expectedRevision, snapshot, changeReason);
  }

  listDesignRevisions(
    actorId: string,
    designId: string
  ): Promise<PersistedDesignRevision[]> {
    return this.designs.listDesignRevisions(actorId, designId);
  }
}

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
    repository: new DatabaseKnowledgeRepository(client)
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
