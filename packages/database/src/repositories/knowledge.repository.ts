import {
  KnowledgeDocumentSchema,
  KnowledgeRuleSchema,
  KnowledgeSourceSchema,
  SOURCE_REVIEW_TRANSITIONS,
  type KnowledgeDocument,
  type KnowledgeRule,
  type KnowledgeSource,
  type SourceCrawlStrategy,
  type SourceReviewStatus
} from "@mystcrag/design-contract";

import { Prisma, type PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { toPrismaJson } from "../mappers/snapshot.mapper.js";

export type KnowledgeStatusValue =
  | "NEW"
  | "EXTRACTED"
  | "VALIDATED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CONFLICTED"
  | "SUPERSEDED";

const ALLOWED_KNOWLEDGE_TRANSITIONS: Record<KnowledgeStatusValue, readonly KnowledgeStatusValue[]> = {
  NEW: ["EXTRACTED", "REJECTED", "SUPERSEDED"],
  EXTRACTED: ["VALIDATED", "NEEDS_REVIEW", "REJECTED", "SUPERSEDED"],
  VALIDATED: ["NEEDS_REVIEW", "APPROVED", "REJECTED", "SUPERSEDED"],
  NEEDS_REVIEW: ["APPROVED", "REJECTED", "CONFLICTED", "SUPERSEDED"],
  APPROVED: ["SUPERSEDED", "CONFLICTED"],
  CONFLICTED: ["NEEDS_REVIEW", "SUPERSEDED"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: []
};

export type StoredKnowledgeSource = KnowledgeSource;

export type StoredKnowledgeDocument = KnowledgeDocument & { urlNormalized: string };

export type StoredKnowledgeRule = KnowledgeRule & {
  sourceId: string;
  knowledgeVersionId: string | null;
};

export type StoredKnowledgeVersion = {
  id: string;
  version: string;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  ruleCount: number;
  publishedAt: Date | null;
  createdAt: Date;
};

export type ProductionKnowledgeSet = {
  knowledgeVersion: string;
  rules: StoredKnowledgeRule[];
};

export function normalizeKnowledgeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path === "" ? "/" : path;
  return `${url.protocol}//${url.host}${url.pathname}${url.search}`;
}

function parseSource(row: {
  id: string;
  name: string;
  sourceType: string;
  baseUrl: string | null;
  enabled: boolean;
  authorityScore: number;
  allowedKnowledgeDomains: string[];
  crawlFrequency: string | null;
  language: string;
  rateLimit: unknown;
  legalNote: string | null;
  sourceCategory: string;
  reliabilityLevel: string;
  countryOrRegion: string | null;
  contentType: string;
  crawlStrategy: unknown;
  reviewStatus: string;
  lastSuccessfulFetch: Date | null;
  lastFailure: unknown;
}): StoredKnowledgeSource {
  return KnowledgeSourceSchema.parse({
    id: row.id,
    name: row.name,
    sourceType: row.sourceType,
    ...(row.baseUrl === null ? {} : { baseUrl: row.baseUrl }),
    enabled: row.enabled,
    authorityScore: row.authorityScore,
    allowedKnowledgeDomains: [...row.allowedKnowledgeDomains],
    ...(row.crawlFrequency === null ? {} : { crawlFrequency: row.crawlFrequency }),
    language: row.language,
    ...(row.rateLimit === null || row.rateLimit === undefined
      ? {}
      : { rateLimit: structuredClone(row.rateLimit) }),
    ...(row.legalNote === null ? {} : { legalNote: row.legalNote }),
    sourceCategory: row.sourceCategory,
    reliabilityLevel: row.reliabilityLevel,
    ...(row.countryOrRegion === null ? {} : { countryOrRegion: row.countryOrRegion }),
    contentType: row.contentType,
    ...(row.crawlStrategy === null || row.crawlStrategy === undefined
      ? {}
      : { crawlStrategy: structuredClone(row.crawlStrategy) }),
    reviewStatus: row.reviewStatus,
    ...(row.lastSuccessfulFetch === null
      ? {}
      : { lastSuccessfulFetch: row.lastSuccessfulFetch.toISOString() }),
    ...(row.lastFailure === null || row.lastFailure === undefined
      ? {}
      : { lastFailure: structuredClone(row.lastFailure) })
  });
}

function parseDocument(row: {
  id: string;
  sourceId: string;
  url: string;
  urlNormalized: string;
  contentHash: string;
  title: string;
  contentText: string;
  fetchedAt: Date;
  parser: string;
  language: string;
  status: string;
}): StoredKnowledgeDocument {
  const parsed = KnowledgeDocumentSchema.parse({
    id: row.id,
    sourceId: row.sourceId,
    url: row.url,
    contentHash: row.contentHash,
    title: row.title,
    contentText: row.contentText,
    fetchedAt: row.fetchedAt.toISOString(),
    parser: row.parser,
    language: row.language,
    ...(row.status === "FETCHED" ? {} : { status: row.status as "PARSED" | "FAILED" })
  });
  return { ...parsed, urlNormalized: row.urlNormalized };
}

function parseRule(row: {
  id: string;
  sourceId: string;
  knowledgeType: string;
  knowledgeDomain: string;
  subject: string;
  relation: string;
  payload: unknown;
  conditions: unknown;
  confidence: number;
  claimType: string | null;
  status: KnowledgeStatusValue;
  fingerprint: string;
  sourceRefs: unknown;
  version: number;
  knowledgeVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StoredKnowledgeRule {
  const parsed = KnowledgeRuleSchema.parse({
    id: row.id,
    knowledgeType: row.knowledgeType,
    knowledgeDomain: row.knowledgeDomain,
    subject: row.subject,
    relation: row.relation,
    payload: structuredClone(row.payload),
    conditions: structuredClone(row.conditions),
    confidence: row.confidence,
    ...(row.claimType === null ? {} : { claimType: row.claimType }),
    status: row.status,
    sourceRefs: structuredClone(row.sourceRefs),
    version: row.version,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
  return { ...parsed, sourceId: row.sourceId, knowledgeVersionId: row.knowledgeVersionId };
}

function parseRawRuleRow(row: Record<string, unknown>): StoredKnowledgeRule {
  return parseRule({
    id: String(row.id),
    sourceId: String(row.source_id),
    knowledgeType: String(row.knowledge_type),
    knowledgeDomain: String(row.knowledge_domain),
    subject: String(row.subject),
    relation: String(row.relation),
    payload: row.payload,
    conditions: row.conditions,
    confidence: Number(row.confidence),
    claimType: row.claim_type === undefined || row.claim_type === null ? null : String(row.claim_type),
    status: row.status as KnowledgeStatusValue,
    fingerprint: String(row.fingerprint),
    sourceRefs: row.source_refs,
    version: Number(row.version),
    knowledgeVersionId: row.knowledge_version_id === null ? null : String(row.knowledge_version_id),
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date)
  });
}

export class KnowledgeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertSource(input: unknown): Promise<StoredKnowledgeSource> {
    const source = KnowledgeSourceSchema.parse(input);
    const common = {
      name: source.name,
      sourceType: source.sourceType,
      baseUrl: source.baseUrl ?? null,
      enabled: source.enabled,
      authorityScore: source.authorityScore,
      allowedKnowledgeDomains: [...source.allowedKnowledgeDomains],
      crawlFrequency: source.crawlFrequency ?? null,
      language: source.language,
      ...(source.rateLimit === undefined ? {} : { rateLimit: toPrismaJson(source.rateLimit) }),
      legalNote: source.legalNote ?? null,
      sourceCategory: source.sourceCategory,
      reliabilityLevel: source.reliabilityLevel,
      countryOrRegion: source.countryOrRegion ?? null,
      contentType: source.contentType,
      ...(source.crawlStrategy === undefined
        ? {}
        : { crawlStrategy: toPrismaJson(source.crawlStrategy) }),
      reviewStatus: source.reviewStatus,
      ...(source.lastSuccessfulFetch === undefined
        ? {}
        : { lastSuccessfulFetch: new Date(source.lastSuccessfulFetch) }),
      ...(source.lastFailure === undefined
        ? {}
        : {
            lastFailure: toPrismaJson(source.lastFailure),
            consecutiveFailures: source.lastFailure.consecutive
          })
    };
    try {
      const row = await this.prisma.knowledgeSource.upsert({
        where: { id: source.id },
        create: { id: source.id, ...common },
        update: common
      });
      return parseSource(row);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Registers a discovered or operator-submitted source candidate. Candidates
   * always enter review (DISCOVERED or NEEDS_REVIEW) — never APPROVED — so
   * nothing reaches the crawler without a human approval step (Q0.3/Q0.4).
   */
  async registerSourceCandidate(
    input: unknown,
    options?: { submitForReview?: boolean }
  ): Promise<{ source: StoredKnowledgeSource; created: boolean }> {
    const parsed = KnowledgeSourceSchema.parse(input);
    const reviewStatus: SourceReviewStatus = options?.submitForReview === true
      ? "NEEDS_REVIEW"
      : "DISCOVERED";
    const candidate = { ...parsed, enabled: false, reviewStatus };
    try {
      const existing = await this.prisma.knowledgeSource.findUnique({
        where: { id: candidate.id }
      });
      if (existing !== null) {
        return { source: parseSource(existing), created: false };
      }
      const row = await this.prisma.knowledgeSource.create({
        data: {
          id: candidate.id,
          name: candidate.name,
          sourceType: candidate.sourceType,
          baseUrl: candidate.baseUrl ?? null,
          enabled: false,
          authorityScore: candidate.authorityScore,
          allowedKnowledgeDomains: [...candidate.allowedKnowledgeDomains],
          crawlFrequency: candidate.crawlFrequency ?? null,
          language: candidate.language,
          ...(candidate.rateLimit === undefined
            ? {}
            : { rateLimit: toPrismaJson(candidate.rateLimit) }),
          legalNote: candidate.legalNote ?? null,
          sourceCategory: candidate.sourceCategory,
          reliabilityLevel: candidate.reliabilityLevel,
          countryOrRegion: candidate.countryOrRegion ?? null,
          contentType: candidate.contentType,
          ...(candidate.crawlStrategy === undefined
            ? {}
            : { crawlStrategy: toPrismaJson(candidate.crawlStrategy) }),
          reviewStatus
        }
      });
      return { source: parseSource(row), created: true };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async reviewSource(id: string, next: SourceReviewStatus): Promise<StoredKnowledgeSource> {
    try {
      const current = await this.prisma.knowledgeSource.findUnique({ where: { id } });
      if (current === null) {
        throw new PersistenceError("NOT_FOUND", `Knowledge source ${id} was not found`);
      }
      const allowed =
        SOURCE_REVIEW_TRANSITIONS[current.reviewStatus as SourceReviewStatus] ?? [];
      if (!allowed.includes(next)) {
        throw new PersistenceError(
          "CONFLICT",
          `Knowledge source ${id} cannot transition from ${current.reviewStatus} to ${next}`
        );
      }
      const row = await this.prisma.knowledgeSource.update({
        where: { id },
        data: { reviewStatus: next }
      });
      return parseSource(row);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async updateSourcePolicy(
    id: string,
    policy: {
      authorityScore?: number;
      allowedKnowledgeDomains?: string[];
      crawlFrequency?: string | null;
      rateLimit?: { maxRequestsPerMinute: number } | null;
      crawlStrategy?: SourceCrawlStrategy | null;
      enabled?: boolean;
    }
  ): Promise<StoredKnowledgeSource> {
    try {
      const row = await this.prisma.knowledgeSource.update({
        where: { id },
        data: {
          ...(policy.authorityScore === undefined
            ? {}
            : { authorityScore: KnowledgeSourceSchema.shape.authorityScore.parse(policy.authorityScore) }),
          ...(policy.allowedKnowledgeDomains === undefined
            ? {}
            : {
                allowedKnowledgeDomains: KnowledgeSourceSchema.shape.allowedKnowledgeDomains.parse(
                  policy.allowedKnowledgeDomains
                )
              }),
          ...(policy.crawlFrequency === undefined ? {} : { crawlFrequency: policy.crawlFrequency }),
          ...(policy.rateLimit === undefined
            ? {}
            : {
                rateLimit:
                  policy.rateLimit === null ? Prisma.DbNull : toPrismaJson(policy.rateLimit)
              }),
          ...(policy.crawlStrategy === undefined
            ? {}
            : {
                crawlStrategy:
                  policy.crawlStrategy === null
                    ? Prisma.DbNull
                    : toPrismaJson(policy.crawlStrategy)
              }),
          ...(policy.enabled === undefined ? {} : { enabled: policy.enabled })
        }
      });
      return parseSource(row);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Records one fetch outcome. Three consecutive failures auto-disable the
   * source (enabled=false) so a dead site never keeps the worker busy; the
   * review status stays APPROVED so an operator can re-enable after review.
   */
  async recordFetchOutcome(
    id: string,
    outcome: { success: boolean; reason?: string; at?: Date; autoDisableThreshold?: number }
  ): Promise<StoredKnowledgeSource> {
    const threshold = Math.max(1, outcome.autoDisableThreshold ?? 3);
    try {
      const current = await this.prisma.knowledgeSource.findUnique({ where: { id } });
      if (current === null) {
        throw new PersistenceError("NOT_FOUND", `Knowledge source ${id} was not found`);
      }
      const at = outcome.at ?? new Date();
      let consecutiveFailures = current.consecutiveFailures;
      let lastFailure: unknown = current.lastFailure;
      let lastSuccessfulFetch: Date | null = current.lastSuccessfulFetch;
      if (outcome.success) {
        consecutiveFailures = 0;
        lastFailure = null;
        lastSuccessfulFetch = at;
      } else {
        consecutiveFailures = current.consecutiveFailures + 1;
        lastFailure = toPrismaJson({
          at: at.toISOString(),
          reason: (outcome.reason ?? "unknown failure").slice(0, 500),
          consecutive: consecutiveFailures
        });
      }
      const row = await this.prisma.knowledgeSource.update({
        where: { id },
        data: {
          consecutiveFailures,
          lastFailure: lastFailure === null ? Prisma.DbNull : (lastFailure as Prisma.InputJsonValue),
          lastSuccessfulFetch,
          enabled: consecutiveFailures >= threshold ? false : current.enabled
        }
      });
      return parseSource(row);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /** Sources the worker may fetch: human-approved AND enabled (Q0.3). */
  async listCrawlableSources(): Promise<StoredKnowledgeSource[]> {
    const rows = await this.prisma.knowledgeSource.findMany({
      where: { reviewStatus: "APPROVED", enabled: true },
      orderBy: { id: "asc" }
    });
    return rows.map(parseSource);
  }

  async setSourceEnabled(id: string, enabled: boolean): Promise<void> {
    try {
      const result = await this.prisma.knowledgeSource.updateMany({
        where: { id },
        data: { enabled }
      });
      if (result.count !== 1) {
        throw new PersistenceError("NOT_FOUND", `Knowledge source ${id} was not found`);
      }
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async getSource(id: string): Promise<StoredKnowledgeSource> {
    const row = await this.prisma.knowledgeSource.findUnique({ where: { id } });
    if (row === null) {
      throw new PersistenceError("NOT_FOUND", `Knowledge source ${id} was not found`);
    }
    return parseSource(row);
  }

  async listSources(options?: { enabledOnly?: boolean }): Promise<StoredKnowledgeSource[]> {
    const rows = await this.prisma.knowledgeSource.findMany({
      where: options?.enabledOnly === true ? { enabled: true } : undefined,
      orderBy: { id: "asc" }
    });
    return rows.map(parseSource);
  }

  async upsertDocument(
    input: KnowledgeDocument & { urlNormalized?: string }
  ): Promise<{ document: StoredKnowledgeDocument; created: boolean }> {
    const document = KnowledgeDocumentSchema.parse(input);
    const urlNormalized = input.urlNormalized ?? normalizeKnowledgeUrl(document.url);
    try {
      const existing = await this.prisma.knowledgeDocument.findUnique({
        where: { contentHash: document.contentHash }
      });
      if (existing !== null) {
        return { document: parseDocument(existing), created: false };
      }
      const row = await this.prisma.knowledgeDocument.create({
        data: {
          id: document.id,
          sourceId: document.sourceId,
          url: document.url,
          urlNormalized,
          contentHash: document.contentHash,
          title: document.title,
          contentText: document.contentText,
          fetchedAt: new Date(document.fetchedAt),
          parser: document.parser,
          language: document.language,
          status: document.status
        }
      });
      return { document: parseDocument(row), created: true };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async getDocument(id: string): Promise<StoredKnowledgeDocument> {
    const row = await this.prisma.knowledgeDocument.findUnique({ where: { id } });
    if (row === null) {
      throw new PersistenceError("NOT_FOUND", `Knowledge document ${id} was not found`);
    }
    return parseDocument(row);
  }

  async searchDocuments(
    query: string,
    options?: { limit?: number }
  ): Promise<Array<{ documentId: string; title: string; rank: number }>> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; title: string; rank: number }>>`
        SELECT "id", "title", ts_rank("search_vector", plainto_tsquery('english', ${trimmed})) AS "rank"
        FROM "knowledge_documents"
        WHERE "search_vector" @@ plainto_tsquery('english', ${trimmed})
        ORDER BY "rank" DESC, "id" ASC
        LIMIT ${limit}
      `;
      return rows.map((row) => ({ documentId: row.id, title: row.title, rank: Number(row.rank) }));
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async insertRule(input: KnowledgeRule & { sourceId: string }): Promise<StoredKnowledgeRule> {
    const { sourceId, ...ruleInput } = input;
    const rule = KnowledgeRuleSchema.parse(ruleInput);
    try {
      const source = await this.prisma.knowledgeSource.findUnique({
        where: { id: sourceId }
      });
      if (source === null) {
        throw new PersistenceError(
          "NOT_FOUND",
          `Knowledge rule ${rule.id} references unknown source ${sourceId}`
        );
      }
      for (const ref of rule.sourceRefs) {
        if (ref.sourceId !== sourceId && ref.sourceId !== source.id) {
          const refSource = await this.prisma.knowledgeSource.findUnique({
            where: { id: ref.sourceId }
          });
          if (refSource === null) {
            throw new PersistenceError(
              "NOT_FOUND",
              `Knowledge rule ${rule.id} references unknown source ${ref.sourceId}`
            );
          }
        }
        if (ref.documentId !== undefined) {
          const document = await this.prisma.knowledgeDocument.findUnique({
            where: { id: ref.documentId }
          });
          if (document === null) {
            throw new PersistenceError(
              "NOT_FOUND",
              `Knowledge rule ${rule.id} references unknown document ${ref.documentId}`
            );
          }
        }
      }
      const duplicate = await this.prisma.knowledgeRule.findUnique({
        where: { fingerprint: rule.fingerprint }
      });
      if (duplicate !== null) {
        throw new PersistenceError(
          "DUPLICATE_KNOWLEDGE",
          `Knowledge rule fingerprint ${rule.fingerprint} already exists as ${duplicate.id}`
        );
      }
      const row = await this.prisma.knowledgeRule.create({
        data: {
          id: rule.id,
          sourceId,
          knowledgeType: rule.knowledgeType,
          knowledgeDomain: rule.knowledgeDomain,
          subject: rule.subject,
          relation: rule.relation,
          payload: toPrismaJson(rule.payload),
          conditions: toPrismaJson(rule.conditions),
          confidence: rule.confidence,
          claimType: rule.claimType ?? null,
          status: rule.status,
          fingerprint: rule.fingerprint,
          sourceRefs: toPrismaJson(rule.sourceRefs),
          version: rule.version
        }
      });
      return parseRule(row);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async getRule(id: string): Promise<StoredKnowledgeRule> {
    const row = await this.prisma.knowledgeRule.findUnique({ where: { id } });
    if (row === null) {
      throw new PersistenceError("NOT_FOUND", `Knowledge rule ${id} was not found`);
    }
    return parseRule(row);
  }

  /**
   * Console V1 review "Edit": a reviewer may adjust a candidate's confidence
   * and claimType classification before approving. Payload, subject, relation,
   * and evidence stay immutable — they carry the fact's identity (fingerprint)
   * and its provenance, which a review edit must never rewrite.
   */
  async updateRuleReview(
    id: string,
    changes: { confidence?: number; claimType?: string | null }
  ): Promise<StoredKnowledgeRule> {
    if (changes.confidence !== undefined) {
      if (!Number.isFinite(changes.confidence) || changes.confidence < 0 || changes.confidence > 1) {
        throw new PersistenceError(
          "VALIDATION_ERROR",
          "confidence must be a number between 0 and 1"
        );
      }
    }
    if (changes.confidence === undefined && changes.claimType === undefined) {
      throw new PersistenceError(
        "VALIDATION_ERROR",
        "At least one of confidence or claimType is required"
      );
    }
    try {
      const row = await this.prisma.knowledgeRule.update({
        where: { id },
        data: {
          ...(changes.confidence === undefined ? {} : { confidence: changes.confidence }),
          ...(changes.claimType === undefined ? {} : { claimType: changes.claimType })
        }
      });
      return parseRule(row);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Task book §19 corroboration: when an ingest run extracts a fact whose
   * fingerprint already exists (an independent source reported the same
   * value), the new sourceRef is merged into the existing rule instead of
   * being dropped, so high-confidence FACT claims accumulate their ≥2
   * independent sources on one reviewable rule. Sentence evidence from the
   * corroborating document is appended to the payload's extraction block.
   * Returns null when the ref is already recorded (a true duplicate).
   */
  async corroborateRule(
    fingerprint: string,
    ref: { sourceId: string; documentId?: string },
    evidence?: ReadonlyArray<{
      documentId: string;
      sentence: string;
      startOffset: number;
      endOffset: number;
    }>
  ): Promise<StoredKnowledgeRule | null> {
    try {
      const row = await this.prisma.knowledgeRule.findUnique({ where: { fingerprint } });
      if (row === null) {
        throw new PersistenceError(
          "NOT_FOUND",
          `Knowledge rule with fingerprint ${fingerprint} was not found`
        );
      }
      const rule = parseRule(row);
      const alreadyRecorded = rule.sourceRefs.some(
        (existing) =>
          existing.sourceId === ref.sourceId && existing.documentId === ref.documentId
      );
      if (alreadyRecorded) {
        return null;
      }

      let payload = rule.payload;
      if (evidence !== undefined && evidence.length > 0) {
        const extraction = (payload as { extraction?: { evidence?: unknown[] } }).extraction;
        if (
          typeof payload === "object" &&
          payload !== null &&
          !Array.isArray(payload) &&
          typeof extraction === "object" &&
          extraction !== null &&
          Array.isArray(extraction.evidence)
        ) {
          const merged: unknown[] = [...extraction.evidence, ...evidence].slice(0, 20);
          payload = {
            ...(payload as Record<string, unknown>),
            extraction: { ...extraction, evidence: merged }
          } as typeof payload;
        }
      }

      const updated = await this.prisma.knowledgeRule.update({
        where: { id: rule.id },
        data: {
          sourceRefs: toPrismaJson([...rule.sourceRefs, ref]),
          payload: toPrismaJson(payload)
        }
      });
      return parseRule(updated);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  /**
   * Console V1 / §19 corroboration merge: two candidate rules that assert the
   * same fact in different surface formats ("6.5–7" vs "6.5 to 7") are one
   * reviewable fact reported by two sources. The secondary's sourceRef and
   * sentence evidence fold into the primary (which keeps its own value and
   * fingerprint), and the secondary retires to SUPERSEDED. Idempotent per
   * sourceRef: re-merging an already-merged pair is a no-op.
   */
  async mergeCorroboratingRules(
    primaryId: string,
    secondaryId: string
  ): Promise<StoredKnowledgeRule> {
    try {
      const primaryRow = await this.prisma.knowledgeRule.findUnique({ where: { id: primaryId } });
      if (primaryRow === null) {
        throw new PersistenceError("NOT_FOUND", `Knowledge rule ${primaryId} was not found`);
      }
      const secondaryRow = await this.prisma.knowledgeRule.findUnique({ where: { id: secondaryId } });
      if (secondaryRow === null) {
        throw new PersistenceError("NOT_FOUND", `Knowledge rule ${secondaryId} was not found`);
      }
      const primary = parseRule(primaryRow);
      const secondary = parseRule(secondaryRow);

      const alreadyRecorded = secondary.sourceRefs.every((ref) =>
        primary.sourceRefs.some(
          (existing) =>
            existing.sourceId === ref.sourceId && existing.documentId === ref.documentId
        )
      );
      if (alreadyRecorded) {
        if (secondary.status !== "SUPERSEDED") {
          await this.transitionRule(secondaryId, "SUPERSEDED");
        }
        return primary;
      }

      const mergedRefs = [
        ...primary.sourceRefs,
        ...secondary.sourceRefs.filter(
          (ref) =>
            !primary.sourceRefs.some(
              (existing) =>
                existing.sourceId === ref.sourceId && existing.documentId === ref.documentId
            )
        )
      ];

      let payload = primary.payload;
      const secondaryEvidence = (secondary.payload as { extraction?: { evidence?: unknown[] } })
        .extraction?.evidence;
      if (Array.isArray(secondaryEvidence) && secondaryEvidence.length > 0) {
        const extraction = (payload as { extraction?: { evidence?: unknown[] } }).extraction;
        if (
          typeof payload === "object" &&
          payload !== null &&
          !Array.isArray(payload) &&
          typeof extraction === "object" &&
          extraction !== null &&
          Array.isArray(extraction.evidence)
        ) {
          payload = {
            ...(payload as Record<string, unknown>),
            extraction: {
              ...extraction,
              evidence: [...extraction.evidence, ...secondaryEvidence].slice(0, 20)
            }
          } as typeof payload;
        }
      }

      await this.transitionRule(secondaryId, "SUPERSEDED");
      const updated = await this.prisma.knowledgeRule.update({
        where: { id: primaryId },
        data: {
          sourceRefs: toPrismaJson(mergedRefs),
          payload: toPrismaJson(payload)
        }
      });
      return parseRule(updated);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async transitionRule(id: string, next: KnowledgeStatusValue): Promise<StoredKnowledgeRule> {
    try {
      const current = await this.prisma.knowledgeRule.findUnique({ where: { id } });
      if (current === null) {
        throw new PersistenceError("NOT_FOUND", `Knowledge rule ${id} was not found`);
      }
      const allowed = ALLOWED_KNOWLEDGE_TRANSITIONS[current.status as KnowledgeStatusValue] ?? [];
      if (!allowed.includes(next)) {
        throw new PersistenceError(
          "CONFLICT",
          `Knowledge rule ${id} cannot transition from ${current.status} to ${next}`
        );
      }
      const row = await this.prisma.knowledgeRule.update({
        where: { id },
        data: { status: next }
      });
      return parseRule(row);
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async listRules(filter?: {
    status?: KnowledgeStatusValue;
    knowledgeDomain?: string;
    knowledgeType?: string;
    subject?: string;
    limit?: number;
  }): Promise<StoredKnowledgeRule[]> {
    const rows = await this.prisma.knowledgeRule.findMany({
      where: {
        status: filter?.status,
        knowledgeDomain: filter?.knowledgeDomain,
        knowledgeType: filter?.knowledgeType,
        subject: filter?.subject
      },
      orderBy: { id: "asc" },
      take: Math.min(Math.max(filter?.limit ?? 500, 1), 2000)
    });
    return rows.map(parseRule);
  }

  async countRulesByStatus(): Promise<Record<KnowledgeStatusValue, number>> {
    const groups = await this.prisma.knowledgeRule.groupBy({
      by: ["status"],
      _count: { _all: true }
    });
    const counts: Record<KnowledgeStatusValue, number> = {
      NEW: 0,
      EXTRACTED: 0,
      VALIDATED: 0,
      NEEDS_REVIEW: 0,
      APPROVED: 0,
      REJECTED: 0,
      CONFLICTED: 0,
      SUPERSEDED: 0
    };
    for (const group of groups) {
      counts[group.status as KnowledgeStatusValue] = group._count._all;
    }
    return counts;
  }

  /**
   * Console V1 coverage/atlas input: every rule in one read. The console
   * computes domain coverage and per-crystal completeness in memory, so a
   * cap here would silently under-report coverage. Round-1 scale is hundreds
   * to low thousands of rows; revisit if the corpus grows past that.
   */
  async listAllRules(): Promise<StoredKnowledgeRule[]> {
    const rows = await this.prisma.knowledgeRule.findMany({
      orderBy: [{ subject: "asc" }, { id: "asc" }]
    });
    return rows.map(parseRule);
  }

  /** Console V1 overview: total stored knowledge documents. */
  async countDocuments(): Promise<number> {
    return this.prisma.knowledgeDocument.count();
  }

  /** Console V1 source stats: document count per source id. */
  async countDocumentsBySource(): Promise<Record<string, number>> {
    const groups = await this.prisma.knowledgeDocument.groupBy({
      by: ["sourceId"],
      _count: { _all: true }
    });
    const counts: Record<string, number> = {};
    for (const group of groups) {
      counts[group.sourceId] = group._count._all;
    }
    return counts;
  }

  /** Console V1 source stats: consecutive fetch failures per source id. */
  async listSourceFailureCounts(): Promise<Record<string, number>> {
    const rows = await this.prisma.knowledgeSource.findMany({
      select: { id: true, consecutiveFailures: true }
    });
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.id] = row.consecutiveFailures;
    }
    return counts;
  }

  async createKnowledgeVersion(id: string, version: string): Promise<StoredKnowledgeVersion> {
    try {
      const row = await this.prisma.knowledgeVersion.create({
        data: { id, version }
      });
      return {
        id: row.id,
        version: row.version,
        status: row.status,
        ruleCount: row.ruleCount,
        publishedAt: row.publishedAt,
        createdAt: row.createdAt
      };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async publishKnowledgeVersion(id: string): Promise<StoredKnowledgeVersion> {
    try {
      const published = await this.prisma.$transaction(async (tx) => {
        const target = await tx.knowledgeVersion.findUnique({ where: { id } });
        if (target === null) {
          throw new PersistenceError("NOT_FOUND", `Knowledge version ${id} was not found`);
        }
        if (target.status !== "DRAFT") {
          throw new PersistenceError(
            "CONFLICT",
            `Knowledge version ${id} is ${target.status}, only DRAFT versions can be published`
          );
        }

        await tx.knowledgeVersion.updateMany({
          where: { status: "PUBLISHED" },
          data: { status: "RETIRED" }
        });

        const assigned = await tx.knowledgeRule.updateMany({
          where: { status: "APPROVED" },
          data: { knowledgeVersionId: id }
        });

        return tx.knowledgeVersion.update({
          where: { id },
          data: { status: "PUBLISHED", ruleCount: assigned.count, publishedAt: new Date() }
        });
      });
      return {
        id: published.id,
        version: published.version,
        status: published.status,
        ruleCount: published.ruleCount,
        publishedAt: published.publishedAt,
        createdAt: published.createdAt
      };
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async getProductionKnowledge(): Promise<ProductionKnowledgeSet> {
    const version = await this.prisma.knowledgeVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }]
    });
    if (version === null) {
      return { knowledgeVersion: "none", rules: [] };
    }
    const rows = await this.prisma.knowledgeRule.findMany({
      where: { status: "APPROVED", knowledgeVersionId: version.id },
      orderBy: { id: "asc" }
    });
    return { knowledgeVersion: version.version, rules: rows.map(parseRule) };
  }

  async listProductionRules(filter?: {
    knowledgeTypes?: string[];
    knowledgeDomains?: string[];
    subjects?: string[];
    limit?: number;
  }): Promise<StoredKnowledgeRule[]> {
    const rows = await this.prisma.knowledgeRule.findMany({
      where: {
        status: "APPROVED",
        knowledgeVersionId: { not: null },
        knowledgeType: filter?.knowledgeTypes === undefined ? undefined : { in: filter.knowledgeTypes },
        knowledgeDomain: filter?.knowledgeDomains === undefined ? undefined : { in: filter.knowledgeDomains },
        subject: filter?.subjects === undefined ? undefined : { in: filter.subjects }
      },
      orderBy: { id: "asc" },
      take: Math.min(Math.max(filter?.limit ?? 2000, 1), 5000)
    });
    const published = await this.prisma.knowledgeVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }]
    });
    if (published === null) return [];
    return rows
      .filter((row) => row.knowledgeVersionId === published.id)
      .map(parseRule);
  }

  async listRulesByDocumentIds(
    documentIds: readonly string[],
    options?: { productionOnly?: boolean }
  ): Promise<StoredKnowledgeRule[]> {
    if (documentIds.length === 0) return [];
    try {
      const productionOnly = options?.productionOnly !== false;
      const productionClause = productionOnly
        ? `r."status" = 'APPROVED' AND r."knowledge_version_id" IN (SELECT "id" FROM "knowledge_versions" WHERE "status" = 'PUBLISHED') AND`
        : "";
      const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT r.* FROM "knowledge_rules" r
         WHERE ${productionClause} r."source_refs" @> ANY (
           SELECT jsonb_build_array(jsonb_build_object('documentId', d))
           FROM unnest($1::text[]) AS d
         )
         ORDER BY r."id" ASC`,
        [...documentIds]
      );
      return rows.map((row) => parseRawRuleRow(row));
    } catch (error) {
      rethrowPersistenceError(error);
    }
  }

  async listRulesByIds(ids: readonly string[]): Promise<StoredKnowledgeRule[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.knowledgeRule.findMany({
      where: { id: { in: [...ids] } },
      orderBy: { id: "asc" }
    });
    return rows.map(parseRule);
  }

  async getLatestPublishedVersion(): Promise<StoredKnowledgeVersion | null> {
    const row = await this.prisma.knowledgeVersion.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }]
    });
    if (row === null) return null;
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      ruleCount: row.ruleCount,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt
    };
  }
}
