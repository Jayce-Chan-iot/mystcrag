import {
  KnowledgeAdminAtlasDetailResponseSchema,
  KnowledgeAdminAtlasResponseSchema,
  KnowledgeAdminCollectionRunsResponseSchema,
  KnowledgeAdminConflictsResponseSchema,
  KnowledgeAdminCoverageResponseSchema,
  KnowledgeAdminEditRuleRequestSchema,
  KnowledgeAdminEditRuleResponseSchema,
  KnowledgeAdminGraphResponseSchema,
  KnowledgeAdminOverviewResponseSchema,
  KnowledgeAdminPipelineResponseSchema,
  KnowledgeAdminPublishVersionResponseSchema,
  KnowledgeAdminReviewQueueResponseSchema,
  KnowledgeAdminRuleActionResponseSchema,
  KnowledgeAdminSourceMutationResponseSchema,
  KnowledgeAdminSourceQueueResponseSchema,
  KnowledgeAdminSourceStatsResponseSchema,
  type KnowledgeAdminAtlasDetailResponse,
  type KnowledgeAdminAtlasResponse,
  type KnowledgeAdminCollectionRunsResponse,
  type KnowledgeAdminConflictsResponse,
  type KnowledgeAdminCoverageResponse,
  type KnowledgeAdminEditRuleResponse,
  type KnowledgeAdminGraphResponse,
  type KnowledgeAdminOverview,
  type KnowledgeAdminPipelineResponse,
  type KnowledgeAdminPublishVersionResponse,
  type KnowledgeAdminReviewQueueResponse,
  type KnowledgeAdminRuleActionResponse,
  type KnowledgeAdminSourceMutationResponse,
  type KnowledgeAdminSourceQueueResponse,
  type KnowledgeAdminSourceStatsResponse,
  type KnowledgeStatus,
  type SourceReviewStatus
} from "@mystcrag/design-contract";

import { resolveKnowledgeAdminKey } from "./admin-auth";

/**
 * Server-side Admin API client. Runs only in Server Components and Server
 * Actions: it reads the admin key from server env and attaches it as the
 * x-admin-key header, so the key never enters the client bundle. The browser
 * talks only to Next server-side code (task book security flow:
 * Browser → Next server → Admin API).
 */

export class KnowledgeConsoleError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function backendOrigin(env: Record<string, string | undefined>): string {
  return (env.MYSTCRAG_BACKEND_ORIGIN ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

type FetchLike = typeof fetch;

export type KnowledgeAdminClientOptions = {
  env?: Record<string, string | undefined>;
  fetcher?: FetchLike;
};

async function knowledgeAdminFetch<T>(
  path: string,
  parse: (payload: unknown) => T,
  options: KnowledgeAdminClientOptions & {
    method?: "GET" | "POST";
    body?: unknown;
  }
): Promise<T> {
  const env = options.env ?? process.env;
  const key = resolveKnowledgeAdminKey(env);
  if (key === null) {
    throw new KnowledgeConsoleError(
      "NOT_CONFIGURED",
      "The knowledge console is not configured (missing admin key).",
      503
    );
  }
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${backendOrigin(env)}/api/admin/knowledge${path}`, {
      method: options.method ?? "GET",
      headers: {
        "x-admin-key": key,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store"
    });
  } catch (error) {
    throw new KnowledgeConsoleError(
      "NETWORK_ERROR",
      error instanceof Error ? error.message : "The knowledge admin API is unreachable.",
      502
    );
  }
  if (!response.ok) {
    let code = "INTERNAL_ERROR";
    let message = `Knowledge admin API returned HTTP ${response.status}.`;
    try {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      if (payload.error) {
        code = payload.error.code ?? code;
        message = payload.error.message ?? message;
      }
    } catch {
      // keep the HTTP status message
    }
    throw new KnowledgeConsoleError(code, message, response.status);
  }
  return parse(await response.json());
}

export function createKnowledgeAdminClient(options: KnowledgeAdminClientOptions = {}) {
  return {
    getOverview(): Promise<KnowledgeAdminOverview> {
      return knowledgeAdminFetch("/overview", (payload) =>
        KnowledgeAdminOverviewResponseSchema.parse(payload), options
      );
    },
    getCoverage(): Promise<KnowledgeAdminCoverageResponse> {
      return knowledgeAdminFetch("/console/coverage", (payload) =>
        KnowledgeAdminCoverageResponseSchema.parse(payload), options
      );
    },
    getSourceStats(): Promise<KnowledgeAdminSourceStatsResponse> {
      return knowledgeAdminFetch("/console/sources-stats", (payload) =>
        KnowledgeAdminSourceStatsResponseSchema.parse(payload), options
      );
    },
    getCrystalAtlas(): Promise<KnowledgeAdminAtlasResponse> {
      return knowledgeAdminFetch("/console/atlas", (payload) =>
        KnowledgeAdminAtlasResponseSchema.parse(payload), options
      );
    },
    getCrystalAtlasDetail(crystalId: string): Promise<KnowledgeAdminAtlasDetailResponse> {
      return knowledgeAdminFetch(
        `/console/atlas/${encodeURIComponent(crystalId)}`,
        (payload) => KnowledgeAdminAtlasDetailResponseSchema.parse(payload),
        options
      );
    },
    listCollectionRuns(limit?: number): Promise<KnowledgeAdminCollectionRunsResponse> {
      const suffix = limit === undefined ? "" : `?limit=${encodeURIComponent(limit)}`;
      return knowledgeAdminFetch(`/console/collection-runs${suffix}`, (payload) =>
        KnowledgeAdminCollectionRunsResponseSchema.parse(payload), options
      );
    },
    getKnowledgeGraph(query: {
      node?: string;
      domain?: string;
      status?: KnowledgeStatus;
      claimType?: string;
      depth?: number;
      limit?: number;
      includeSynthetic?: boolean;
    }): Promise<KnowledgeAdminGraphResponse> {
      const params = new URLSearchParams();
      if (query.node !== undefined && query.node !== "") params.set("node", query.node);
      if (query.domain !== undefined && query.domain !== "") params.set("domain", query.domain);
      if (query.status !== undefined) params.set("status", query.status);
      if (query.claimType !== undefined && query.claimType !== "") {
        params.set("claimType", query.claimType);
      }
      if (query.depth !== undefined) params.set("depth", String(query.depth));
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      if (query.includeSynthetic !== undefined) {
        params.set("includeSynthetic", String(query.includeSynthetic));
      }
      const suffix = params.size === 0 ? "" : `?${params.toString()}`;
      return knowledgeAdminFetch(`/graph${suffix}`, (payload) =>
        KnowledgeAdminGraphResponseSchema.parse(payload), options
      );
    },
    listReviewQueue(filter?: {
      status?: KnowledgeStatus;
      limit?: number;
    }): Promise<KnowledgeAdminReviewQueueResponse> {
      const params = new URLSearchParams();
      if (filter?.status !== undefined) params.set("status", filter.status);
      if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
      const suffix = params.size === 0 ? "" : `?${params.toString()}`;
      return knowledgeAdminFetch(`/review-queue${suffix}`, (payload) =>
        KnowledgeAdminReviewQueueResponseSchema.parse(payload), options
      );
    },
    listConflicts(): Promise<KnowledgeAdminConflictsResponse> {
      return knowledgeAdminFetch("/conflicts", (payload) =>
        KnowledgeAdminConflictsResponseSchema.parse(payload), options
      );
    },
    listSources(reviewStatus?: SourceReviewStatus): Promise<KnowledgeAdminSourceQueueResponse> {
      const suffix =
        reviewStatus === undefined ? "" : `?reviewStatus=${encodeURIComponent(reviewStatus)}`;
      return knowledgeAdminFetch(`/sources${suffix}`, (payload) =>
        KnowledgeAdminSourceQueueResponseSchema.parse(payload), options
      );
    },
    actOnRule(
      ruleId: string,
      action: "approve" | "reject" | "supersede"
    ): Promise<KnowledgeAdminRuleActionResponse> {
      return knowledgeAdminFetch(
        `/rules/${encodeURIComponent(ruleId)}/${action}`,
        (payload) => KnowledgeAdminRuleActionResponseSchema.parse(payload),
        { ...options, method: "POST" }
      );
    },
    editRule(
      ruleId: string,
      input: { confidence?: number; claimType?: string | null }
    ): Promise<KnowledgeAdminEditRuleResponse> {
      const body = KnowledgeAdminEditRuleRequestSchema.parse(input);
      return knowledgeAdminFetch(
        `/rules/${encodeURIComponent(ruleId)}/edit`,
        (payload) => KnowledgeAdminEditRuleResponseSchema.parse(payload),
        { ...options, method: "POST", body }
      );
    },
    reviewSource(
      sourceId: string,
      reviewStatus: SourceReviewStatus
    ): Promise<KnowledgeAdminSourceMutationResponse> {
      return knowledgeAdminFetch(
        `/sources/${encodeURIComponent(sourceId)}/review`,
        (payload) => KnowledgeAdminSourceMutationResponseSchema.parse(payload),
        { ...options, method: "POST", body: { reviewStatus } }
      );
    },
    setSourceEnabled(
      sourceId: string,
      enabled: boolean
    ): Promise<KnowledgeAdminSourceMutationResponse> {
      return knowledgeAdminFetch(
        `/sources/${encodeURIComponent(sourceId)}/enabled`,
        (payload) => KnowledgeAdminSourceMutationResponseSchema.parse(payload),
        { ...options, method: "POST", body: { enabled } }
      );
    },
    runReviewPipeline(): Promise<KnowledgeAdminPipelineResponse> {
      return knowledgeAdminFetch(
        "/review-pipeline/run",
        (payload) => KnowledgeAdminPipelineResponseSchema.parse(payload),
        { ...options, method: "POST" }
      );
    },
    publishVersion(version: string): Promise<KnowledgeAdminPublishVersionResponse> {
      return knowledgeAdminFetch(
        "/versions",
        (payload) => KnowledgeAdminPublishVersionResponseSchema.parse(payload),
        { ...options, method: "POST", body: { version } }
      );
    }
  };
}

export const knowledgeAdminApi = createKnowledgeAdminClient();
