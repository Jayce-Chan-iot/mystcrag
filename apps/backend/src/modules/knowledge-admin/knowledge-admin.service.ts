import { PersistenceError } from "@mystcrag/database";
import {
  KnowledgeAdminConflictsResponseSchema,
  KnowledgeAdminOverviewResponseSchema,
  KnowledgeAdminPipelineResponseSchema,
  KnowledgeAdminPublishVersionResponseSchema,
  KnowledgeAdminReviewQueueResponseSchema,
  KnowledgeAdminRuleActionResponseSchema,
  KnowledgeAdminSourceMutationResponseSchema,
  KnowledgeAdminSourceQueueResponseSchema,
  type KnowledgeAdminConflictsResponse,
  type KnowledgeAdminOverview,
  type KnowledgeAdminPipelineResponse,
  type KnowledgeAdminPublishVersionResponse,
  type KnowledgeAdminReviewQueueResponse,
  type KnowledgeAdminRuleActionResponse,
  type KnowledgeAdminSourceMutationResponse,
  type KnowledgeAdminSourceQueueResponse,
  type KnowledgeStatus,
  type SourceReviewStatus
} from "@mystcrag/design-contract";
import {
  KnowledgeSourceAdminService,
  KnowledgeReviewService,
  type ReviewQueueItem
} from "@mystcrag/knowledge-core";

import { DomainApiError } from "../../contracts/api-error.js";
import { validateResponse } from "../../validation/validate-response.js";

export type ReviewQueueFilter = {
  status?: KnowledgeStatus;
  limit?: number;
};

export type SourcePolicyInput = {
  allowedKnowledgeDomains?: readonly string[];
  maxRequestsPerMinute?: number;
};

export type KnowledgeAdminServiceDependencies = {
  reviewService: KnowledgeReviewService;
  sourceAdminService: KnowledgeSourceAdminService;
};

function mapPersistenceError(error: unknown): DomainApiError {
  if (error instanceof DomainApiError) {
    return error;
  }
  if (error instanceof PersistenceError) {
    if (error.code === "NOT_FOUND") {
      return new DomainApiError("NOT_FOUND", error.message);
    }
    if (error.code === "CONFLICT" || error.code === "DUPLICATE_KNOWLEDGE") {
      return new DomainApiError("CONFLICT", error.message);
    }
    if (error.code === "VALIDATION_ERROR") {
      return new DomainApiError("VALIDATION_ERROR", error.message);
    }
    return new DomainApiError("INTERNAL_ERROR", "Knowledge persistence failed.");
  }
  return new DomainApiError("INTERNAL_ERROR", "Unexpected knowledge admin failure.");
}

function projectQueueItem(item: ReviewQueueItem): unknown {
  const { rule, validation, evidence, extraction } = item;
  return {
    ruleId: rule.id,
    status: rule.status,
    knowledgeType: rule.knowledgeType,
    knowledgeDomain: rule.knowledgeDomain,
    subject: rule.subject,
    relation: rule.relation,
    confidence: rule.confidence,
    validation,
    evidence: evidence.map((entry) => ({
      source: {
        id: entry.source.id,
        name: entry.source.name,
        sourceType: entry.source.sourceType,
        sourceCategory: entry.source.sourceCategory,
        authorityScore: entry.source.authorityScore,
        reliabilityLevel: entry.source.reliabilityLevel,
        enabled: entry.source.enabled
      },
      document: entry.document === null ? null : { ...entry.document }
    })),
    extraction,
    payload: rule.payload
  };
}

/**
 * Q3 admin application service: a thin projection over the review and source
 * admin services shared with the CLI, so both entrances behave identically.
 */
export class KnowledgeAdminApplicationService {
  private readonly reviewService: KnowledgeReviewService;
  private readonly sourceAdminService: KnowledgeSourceAdminService;

  constructor(dependencies: KnowledgeAdminServiceDependencies) {
    this.reviewService = dependencies.reviewService;
    this.sourceAdminService = dependencies.sourceAdminService;
  }

  async getOverview(): Promise<KnowledgeAdminOverview> {
    try {
      const overview = await this.reviewService.getAdminOverview();
      return validateResponse(KnowledgeAdminOverviewResponseSchema, overview);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async listReviewQueue(filter: ReviewQueueFilter): Promise<KnowledgeAdminReviewQueueResponse> {
    try {
      const items = await this.reviewService.listReviewQueue({
        status: filter.status,
        limit: filter.limit
      });
      return validateResponse(KnowledgeAdminReviewQueueResponseSchema, {
        items: items.map(projectQueueItem),
        total: items.length
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async listConflicts(): Promise<KnowledgeAdminConflictsResponse> {
    try {
      const groups = await this.reviewService.listConflictGroups();
      return validateResponse(KnowledgeAdminConflictsResponseSchema, {
        groups: groups.map((group) => ({
          key: { ...group.key },
          rules: group.rules.map((rule) => ({
            ruleId: rule.id,
            status: rule.status,
            confidence: rule.confidence,
            payload: rule.payload
          }))
        }))
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async runReviewPipeline(): Promise<KnowledgeAdminPipelineResponse> {
    try {
      const summary = await this.reviewService.runReviewPipeline();
      return validateResponse(KnowledgeAdminPipelineResponseSchema, summary);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async actOnRule(
    ruleId: string,
    action: "approve" | "reject" | "supersede"
  ): Promise<KnowledgeAdminRuleActionResponse> {
    try {
      const rule =
        action === "approve"
          ? await this.reviewService.approveRule(ruleId)
          : action === "reject"
            ? await this.reviewService.rejectRule(ruleId)
            : await this.reviewService.supersedeRule(ruleId);
      return validateResponse(KnowledgeAdminRuleActionResponseSchema, {
        ruleId: rule.id,
        status: rule.status
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async publishVersion(version: string): Promise<KnowledgeAdminPublishVersionResponse> {
    try {
      const published = await this.reviewService.publishVersion(version);
      return validateResponse(KnowledgeAdminPublishVersionResponseSchema, {
        id: published.id,
        version: published.version,
        status: published.status,
        ruleCount: published.ruleCount,
        publishedAt:
          published.publishedAt === null ? null : published.publishedAt.toISOString()
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async listSourceQueue(
    reviewStatus?: SourceReviewStatus
  ): Promise<KnowledgeAdminSourceQueueResponse> {
    try {
      const queue = await this.sourceAdminService.listSourceQueue({
        reviewStatus
      });
      return validateResponse(KnowledgeAdminSourceQueueResponseSchema, {
        items: queue.items.map((item) => {
          const {
            id,
            name,
            sourceType,
            sourceCategory,
            contentType,
            reliabilityLevel,
            reviewStatus: status,
            enabled,
            authorityScore,
            allowedKnowledgeDomains,
            language,
            lastSuccessfulFetch,
            lastFailure,
            rateLimit,
            crawlStrategy
          } = item;
          return {
            id,
            name,
            sourceType,
            sourceCategory,
            contentType,
            reliabilityLevel,
            reviewStatus: status,
            enabled,
            authorityScore,
            allowedKnowledgeDomains,
            language,
            ...(lastSuccessfulFetch === undefined ? {} : { lastSuccessfulFetch }),
            ...(lastFailure === undefined ? {} : { lastFailure }),
            ...(rateLimit === undefined ? {} : { rateLimit }),
            ...(crawlStrategy === undefined ? {} : { crawlStrategy })
          };
        }),
        total: queue.total
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async reviewSource(
    sourceId: string,
    reviewStatus: SourceReviewStatus
  ): Promise<KnowledgeAdminSourceMutationResponse> {
    try {
      const result = await this.sourceAdminService.reviewSource(sourceId, reviewStatus);
      return validateResponse(KnowledgeAdminSourceMutationResponseSchema, result);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async setSourceEnabled(
    sourceId: string,
    enabled: boolean
  ): Promise<KnowledgeAdminSourceMutationResponse> {
    try {
      const result = await this.sourceAdminService.setSourceEnabled(sourceId, enabled);
      return validateResponse(KnowledgeAdminSourceMutationResponseSchema, result);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async updateSourcePolicy(
    sourceId: string,
    policy: SourcePolicyInput
  ): Promise<KnowledgeAdminSourceMutationResponse> {
    try {
      const result = await this.sourceAdminService.updateSourcePolicy(sourceId, policy);
      return validateResponse(KnowledgeAdminSourceMutationResponseSchema, result);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
