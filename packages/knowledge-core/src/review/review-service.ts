import {
  PersistenceError,
  type DatabaseClient,
  type KnowledgeRepository,
  type StoredKnowledgeRule,
  type StoredKnowledgeSource,
  type StoredKnowledgeVersion
} from "@mystcrag/database";
import {
  ExtractionMetadataSchema,
  KnowledgeAdminOverviewResponseSchema,
  type ExtractionMetadata,
  type KnowledgeRule
} from "@mystcrag/design-contract";
import type { z } from "zod";

import { KNOWLEDGE_DOCUMENT_FIXTURES, KNOWLEDGE_SOURCE_FIXTURES } from "../fixtures/knowledge-sources.js";
import { KNOWLEDGE_CORPUS_FIXTURES } from "../fixtures/corpus-bootstrap.js";
import {
  classifyCandidate,
  detectRuleConflicts,
  isExternalRule,
  planCorroborationMerges,
  validateKnowledgeRuleCandidate,
  type KnowledgeConflictGroup,
  type KnowledgeRuleValidation
} from "./rules.js";

export type KnowledgeAdminOverview = z.infer<typeof KnowledgeAdminOverviewResponseSchema>;

export type ReviewPipelineSummary = {
  extracted: number;
  validated: number;
  needsReview: number;
  conflicted: number;
  /** §19 corroboration merges: canonical-equal duplicates folded into one rule. */
  merged: number;
};

export type ReviewEvidence = {
  source: {
    id: string;
    name: string;
    sourceType: StoredKnowledgeSource["sourceType"];
    sourceCategory: StoredKnowledgeSource["sourceCategory"];
    reliabilityLevel: StoredKnowledgeSource["reliabilityLevel"];
    authorityScore: number;
    enabled: boolean;
  };
  document: {
    id: string;
    title: string;
    url: string;
    fetchedAt: string;
  } | null;
};

export type ReviewQueueItem = {
  rule: StoredKnowledgeRule;
  validation: KnowledgeRuleValidation;
  evidence: ReviewEvidence[];
  /** Q2 sentence-level extraction evidence; null for legacy candidates. */
  extraction: ExtractionMetadata | null;
};

export type FixtureImportSummary = {
  sources: number;
  documents: number;
  rules: number;
  inserted: number;
  duplicates: number;
};

export type KnowledgeReviewServiceOptions = {
  database: DatabaseClient;
  repository: KnowledgeRepository;
};

const CANDIDATE_STATUSES = ["VALIDATED", "NEEDS_REVIEW"] as const;
const LIST_LIMIT = 2000;

/**
 * Q3: surfaces the Q2 extraction metadata stored inside the rule payload.
 * Parsing is lenient on purpose — a malformed extraction block must never
 * hide a candidate from review, it just loses its evidence rendering.
 */
export function parseExtractionMetadata(payload: KnowledgeRule["payload"]): ExtractionMetadata | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const raw = (payload as Record<string, unknown>).extraction;
  if (raw === undefined || raw === null) {
    return null;
  }
  const parsed = ExtractionMetadataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Review chain (task book sections 12, 18, 30, 34): candidates extracted by
 * ingestion move NEW → EXTRACTED → VALIDATED | NEEDS_REVIEW, divergent
 * same-key candidates are parked in CONFLICTED, and a human approves,
 * rejects, or supersedes. Only APPROVED rules are ever published into a
 * knowledge version; the repository enforces that boundary.
 */
export class KnowledgeReviewService {
  private readonly repository: KnowledgeRepository;

  constructor(options: KnowledgeReviewServiceOptions) {
    this.repository = options.repository;
  }

  async runReviewPipeline(): Promise<ReviewPipelineSummary> {
    const summary: ReviewPipelineSummary = {
      extracted: 0,
      validated: 0,
      needsReview: 0,
      conflicted: 0,
      merged: 0
    };

    const fresh = await this.repository.listRules({ status: "NEW", limit: LIST_LIMIT });
    for (const rule of fresh) {
      await this.repository.transitionRule(rule.id, "EXTRACTED");
      summary.extracted += 1;
    }

    // §19 corroboration runs before classification so the merged primary's
    // accumulated sourceRefs are visible to classifyCandidate: a high-
    // confidence FACT claim reported by two sources in different surface
    // formats auto-validates instead of parking as two single-source rules.
    summary.merged = await this.mergeCorroborations();

    const extracted = await this.repository.listRules({ status: "EXTRACTED", limit: LIST_LIMIT });
    for (const rule of extracted) {
      const classification = await this.classify(rule);
      await this.repository.transitionRule(rule.id, classification);
      if (classification === "VALIDATED") {
        summary.validated += 1;
      } else {
        summary.needsReview += 1;
      }
    }

    summary.conflicted = await this.markCandidateConflicts();
    return summary;
  }

  /**
   * §19 corroboration merge over the candidate pool (EXTRACTED, VALIDATED,
   * NEEDS_REVIEW, CONFLICTED — never APPROVED / REJECTED / SUPERSEDED): each
   * plan folds a secondary's sourceRefs and sentence evidence into the primary
   * and retires the secondary to SUPERSEDED. Idempotent per pair.
   */
  private async mergeCorroborations(): Promise<number> {
    const rules: StoredKnowledgeRule[] = [];
    for (const status of [...CANDIDATE_STATUSES, "EXTRACTED", "CONFLICTED"] as const) {
      rules.push(...(await this.repository.listRules({ status, limit: LIST_LIMIT })));
    }
    let merged = 0;
    for (const plan of planCorroborationMerges(rules)) {
      for (const secondary of plan.secondaries) {
        await this.repository.mergeCorroboratingRules(plan.primary.id, secondary.id);
        merged += 1;
      }
    }
    return merged;
  }

  private async classify(rule: StoredKnowledgeRule): Promise<"VALIDATED" | "NEEDS_REVIEW"> {
    const sourceId = rule.sourceRefs[0]?.sourceId ?? rule.sourceId;
    const source = await this.repository.getSource(sourceId);
    return classifyCandidate(rule, source);
  }

  /**
   * Conflict detection compares candidates against each other and against
   * APPROVED rules, but only ever transitions the candidates: production
   * rules stay stable until a human supersedes them. CONFLICTED rules stay
   * in scope so their groups remain visible until a human resolves them.
   */
  private async markCandidateConflicts(): Promise<number> {
    const groups = await this.detectConflicts();
    let conflicted = 0;
    for (const group of groups) {
      for (const rule of group.rules) {
        if (rule.status === "APPROVED" || rule.status === "CONFLICTED") continue;
        if (rule.status === "VALIDATED") {
          await this.repository.transitionRule(rule.id, "NEEDS_REVIEW");
        }
        await this.repository.transitionRule(rule.id, "CONFLICTED");
        conflicted += 1;
      }
    }
    return conflicted;
  }

  private async detectConflicts(): Promise<KnowledgeConflictGroup[]> {
    const rules: StoredKnowledgeRule[] = [];
    for (const status of [...CANDIDATE_STATUSES, "APPROVED", "CONFLICTED"] as const) {
      rules.push(...(await this.repository.listRules({ status, limit: LIST_LIMIT })));
    }
    const groups = detectRuleConflicts(rules);
    return groups.filter((group) => group.rules.some((rule) => rule.status !== "APPROVED"));
  }

  async listConflictGroups(): Promise<KnowledgeConflictGroup[]> {
    return this.detectConflicts();
  }

  /**
   * Q3 admin dashboard projection. Rule counts come from a groupBy so the
   * numbers stay correct past the 2000-row list cap.
   */
  async getAdminOverview(): Promise<KnowledgeAdminOverview> {
    const ruleCounts = await this.repository.countRulesByStatus();
    const sources = await this.repository.listSources();
    const sourceCounts = {
      DISCOVERED: 0,
      NEEDS_REVIEW: 0,
      APPROVED: 0,
      REJECTED: 0,
      DISABLED: 0,
      enabled: 0
    };
    for (const source of sources) {
      sourceCounts[source.reviewStatus] += 1;
      if (source.enabled) {
        sourceCounts.enabled += 1;
      }
    }
    const documents = await this.repository.countDocuments();
    const allRules = await this.repository.listAllRules();
    const candidateStatuses = new Set([
      "NEW",
      "EXTRACTED",
      "VALIDATED",
      "NEEDS_REVIEW",
      "CONFLICTED"
    ]);
    let externalCandidates = 0;
    let externalApprovedRules = 0;
    for (const rule of allRules) {
      if (!isExternalRule(rule)) continue;
      if (candidateStatuses.has(rule.status)) {
        externalCandidates += 1;
      } else if (rule.status === "APPROVED") {
        externalApprovedRules += 1;
      }
    }
    const conflictGroups = await this.detectConflicts();
    const latest = await this.repository.getLatestPublishedVersion();
    return {
      rules: ruleCounts,
      sources: sourceCounts,
      documents,
      externalCandidates,
      externalApprovedRules,
      conflictGroups: conflictGroups.length,
      latestVersion:
        latest === null
          ? null
          : {
              id: latest.id,
              version: latest.version,
              status: latest.status,
              ruleCount: latest.ruleCount,
              publishedAt:
                latest.publishedAt === null ? null : latest.publishedAt.toISOString()
            }
    };
  }

  async listReviewQueue(filter?: {
    status?: StoredKnowledgeRule["status"];
    limit?: number;
  }): Promise<ReviewQueueItem[]> {
    const rules = await this.repository.listRules({
      status: filter?.status,
      limit: filter?.limit
    });
    const sourceCache = new Map<string, StoredKnowledgeSource>();
    const documentCache = new Map<string, { id: string; title: string; url: string; fetchedAt: string }>();

    const items: ReviewQueueItem[] = [];
    for (const rule of rules) {
      const evidence: ReviewEvidence[] = [];
      for (const ref of rule.sourceRefs) {
        let source = sourceCache.get(ref.sourceId);
        if (source === undefined) {
          source = await this.repository.getSource(ref.sourceId);
          sourceCache.set(ref.sourceId, source);
        }
        let document = ref.documentId === undefined ? undefined : documentCache.get(ref.documentId);
        if (document === undefined && ref.documentId !== undefined) {
          const stored = await this.repository.getDocument(ref.documentId);
          document = {
            id: stored.id,
            title: stored.title,
            url: stored.url,
            fetchedAt: stored.fetchedAt
          };
          documentCache.set(ref.documentId, document);
        }
        evidence.push({
          source: {
            id: source.id,
            name: source.name,
            sourceType: source.sourceType,
            sourceCategory: source.sourceCategory,
            reliabilityLevel: source.reliabilityLevel,
            authorityScore: source.authorityScore,
            enabled: source.enabled
          },
          document: document ?? null
        });
      }
      items.push({
        rule,
        validation: validateKnowledgeRuleCandidate(rule),
        evidence,
        extraction: parseExtractionMetadata(rule.payload)
      });
    }
    return items;
  }

  async approveRule(id: string): Promise<StoredKnowledgeRule> {
    const rule = await this.repository.getRule(id);
    if (rule.status === "CONFLICTED") {
      await this.repository.transitionRule(id, "NEEDS_REVIEW");
    }
    return this.repository.transitionRule(id, "APPROVED");
  }

  async rejectRule(id: string): Promise<StoredKnowledgeRule> {
    const rule = await this.repository.getRule(id);
    if (rule.status === "CONFLICTED") {
      await this.repository.transitionRule(id, "NEEDS_REVIEW");
    }
    return this.repository.transitionRule(id, "REJECTED");
  }

  async supersedeRule(id: string): Promise<StoredKnowledgeRule> {
    return this.repository.transitionRule(id, "SUPERSEDED");
  }

  /**
   * Console V1 review "Edit": a reviewer may adjust a candidate's confidence
   * and claimType before approving. Everything else stays immutable.
   */
  async editRule(
    id: string,
    changes: { confidence?: number; claimType?: string | null }
  ): Promise<StoredKnowledgeRule> {
    return this.repository.updateRuleReview(id, changes);
  }

  async publishVersion(version: string): Promise<StoredKnowledgeVersion> {
    const created = await this.repository.createKnowledgeVersion(`kv-${version}`, version);
    return this.repository.publishKnowledgeVersion(created.id);
  }

  /**
   * Loads the internally reviewed corpus as APPROVED rules: the handbook core
   * layer plus the Q4 bootstrap layers (taxonomy-coverage and combination,
   * see fixtures/corpus-bootstrap.ts). The corpus is the E2E-2 baseline
   * knowledge set; re-imports are idempotent via the unique fingerprint.
   */
  async importFixtureCorpus(): Promise<FixtureImportSummary> {
    for (const source of KNOWLEDGE_SOURCE_FIXTURES) {
      await this.repository.upsertSource(source);
    }
    for (const document of KNOWLEDGE_DOCUMENT_FIXTURES) {
      await this.repository.upsertDocument({ ...document, status: "PARSED" });
    }

    let inserted = 0;
    let duplicates = 0;
    for (const seed of KNOWLEDGE_CORPUS_FIXTURES) {
      try {
        await this.repository.insertRule(seed);
        inserted += 1;
      } catch (error) {
        if (error instanceof PersistenceError && error.code === "DUPLICATE_KNOWLEDGE") {
          duplicates += 1;
        } else {
          throw error;
        }
      }
    }

    return {
      sources: KNOWLEDGE_SOURCE_FIXTURES.length,
      documents: KNOWLEDGE_DOCUMENT_FIXTURES.length,
      rules: KNOWLEDGE_CORPUS_FIXTURES.length,
      inserted,
      duplicates
    };
  }
}
