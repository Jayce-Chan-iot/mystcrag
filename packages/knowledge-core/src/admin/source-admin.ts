import type {
  KnowledgeRepository,
  StoredKnowledgeSource
} from "@mystcrag/database";
import type { SourceReviewStatus } from "@mystcrag/design-contract";

export type SourceAdminQueueFilter = {
  reviewStatus?: SourceReviewStatus;
};

export type SourceAdminQueuePage = {
  items: StoredKnowledgeSource[];
  total: number;
};

export type SourceAdminMutationResult = {
  sourceId: string;
  reviewStatus: SourceReviewStatus;
  enabled: boolean;
};

export type SourcePolicyUpdate = {
  allowedKnowledgeDomains?: readonly string[];
  maxRequestsPerMinute?: number;
};

export type KnowledgeSourceAdminServiceOptions = {
  repository: KnowledgeRepository;
};

/**
 * Q3 admin surface for the Q0 source review machine. Transitions stay
 * enforced by the repository (SOURCE_REVIEW_TRANSITIONS); this service only
 * shapes the queue and policy edits for the Admin API and CLI.
 */
export class KnowledgeSourceAdminService {
  private readonly repository: KnowledgeRepository;

  constructor(options: KnowledgeSourceAdminServiceOptions) {
    this.repository = options.repository;
  }

  async listSourceQueue(filter?: SourceAdminQueueFilter): Promise<SourceAdminQueuePage> {
    const all = await this.repository.listSources();
    const items =
      filter?.reviewStatus === undefined
        ? all
        : all.filter((source) => source.reviewStatus === filter.reviewStatus);
    return { items, total: items.length };
  }

  async reviewSource(id: string, next: SourceReviewStatus): Promise<SourceAdminMutationResult> {
    const source = await this.repository.reviewSource(id, next);
    return {
      sourceId: source.id,
      reviewStatus: source.reviewStatus,
      enabled: source.enabled
    };
  }

  async setSourceEnabled(id: string, enabled: boolean): Promise<SourceAdminMutationResult> {
    await this.repository.setSourceEnabled(id, enabled);
    const source = await this.repository.getSource(id);
    return {
      sourceId: source.id,
      reviewStatus: source.reviewStatus,
      enabled: source.enabled
    };
  }

  async updateSourcePolicy(
    id: string,
    policy: SourcePolicyUpdate
  ): Promise<SourceAdminMutationResult> {
    const source = await this.repository.updateSourcePolicy(id, {
      ...(policy.allowedKnowledgeDomains === undefined
        ? {}
        : { allowedKnowledgeDomains: [...policy.allowedKnowledgeDomains] }),
      ...(policy.maxRequestsPerMinute === undefined
        ? {}
        : { rateLimit: { maxRequestsPerMinute: policy.maxRequestsPerMinute } })
    });
    return {
      sourceId: source.id,
      reviewStatus: source.reviewStatus,
      enabled: source.enabled
    };
  }
}
