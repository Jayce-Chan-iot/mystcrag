import {
  KnowledgeDocumentSchema,
  KnowledgeRuleSchema,
  KnowledgeSourceSchema,
  type KnowledgeDocument,
  type KnowledgeRule,
  type KnowledgeSource
} from "@mystcrag/design-contract";

import type { PrismaClient } from "../../generated/client/client.js";
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
  NEW: ["EXTRACTED", "REJECTED"],
  EXTRACTED: ["VALIDATED", "NEEDS_REVIEW", "REJECTED"],
  VALIDATED: ["NEEDS_REVIEW", "APPROVED", "REJECTED"],
  NEEDS_REVIEW: ["APPROVED", "REJECTED", "CONFLICTED"],
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
    ...(row.legalNote === null ? {} : { legalNote: row.legalNote })
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
    status: row.status,
    sourceRefs: structuredClone(row.sourceRefs),
    version: row.version,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
  return { ...parsed, sourceId: row.sourceId, knowledgeVersionId: row.knowledgeVersionId };
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
      legalNote: source.legalNote ?? null
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
