import { timingSafeEqual } from "node:crypto";

import {
  KnowledgeAdminPublishVersionRequestSchema,
  KnowledgeAdminReviewSourceRequestSchema,
  KnowledgeAdminRuleActionParamsSchema,
  KnowledgeAdminSetSourceEnabledRequestSchema,
  KnowledgeAdminSourceActionParamsSchema,
  KnowledgeAdminUpdateSourcePolicyRequestSchema,
  KnowledgeStatusSchema,
  SourceReviewStatusSchema
} from "@mystcrag/design-contract";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { DomainApiError, toApiErrorEnvelope } from "../../contracts/api-error.js";
import { validateRequest } from "../../validation/validate-request.js";
import type { KnowledgeAdminApplicationService } from "./knowledge-admin.service.js";

const ADMIN_KEY_HEADER = "x-admin-key";
const MAX_QUEUE_LIMIT = 500;

/**
 * Fail closed: an unconfigured or mismatched admin key never reaches the
 * service. The comparison runs on equal-length buffers so a mismatch also
 * fails before any timing-sensitive work.
 */
function requireAdminKey(request: FastifyRequest, adminKey: string): void {
  const provided = request.headers[ADMIN_KEY_HEADER];
  const candidate = Array.isArray(provided) ? provided[0] : provided;
  if (
    typeof candidate !== "string" ||
    candidate.length !== adminKey.length ||
    !timingSafeEqual(Buffer.from(candidate), Buffer.from(adminKey))
  ) {
    throw new DomainApiError("FORBIDDEN", "A valid admin key is required.");
  }
}

function parseQueueLimit(rawLimit: unknown): number | undefined {
  if (rawLimit === undefined) {
    return undefined;
  }
  const parsed = z.coerce.number().int().min(1).max(MAX_QUEUE_LIMIT).safeParse(rawLimit);
  if (!parsed.success) {
    throw new DomainApiError(
      "VALIDATION_ERROR",
      "limit must be an integer between 1 and 500."
    );
  }
  return parsed.data;
}

function parseStatusFilter(rawStatus: unknown): z.infer<typeof KnowledgeStatusSchema> | undefined {
  if (rawStatus === undefined || rawStatus === "") {
    return undefined;
  }
  const parsed = KnowledgeStatusSchema.safeParse(rawStatus);
  if (!parsed.success) {
    throw new DomainApiError("VALIDATION_ERROR", "status must be a knowledge status.");
  }
  return parsed.data;
}

function parseSourceReviewStatusFilter(
  rawStatus: unknown
): z.infer<typeof SourceReviewStatusSchema> | undefined {
  if (rawStatus === undefined || rawStatus === "") {
    return undefined;
  }
  const parsed = SourceReviewStatusSchema.safeParse(rawStatus);
  if (!parsed.success) {
    throw new DomainApiError("VALIDATION_ERROR", "reviewStatus must be a source review status.");
  }
  return parsed.data;
}

async function handleAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  execute: () => Promise<unknown>
): Promise<FastifyReply> {
  try {
    const output = await execute();
    return reply.status(200).send(output);
  } catch (error) {
    const domainError =
      error instanceof DomainApiError
        ? error
        : new DomainApiError("INTERNAL_ERROR", "Unexpected knowledge admin failure.");
    return reply
      .status(domainError.statusCode)
      .send(toApiErrorEnvelope(domainError, request.id));
  }
}

export function registerKnowledgeAdminRoutes(
  app: FastifyInstance,
  service: KnowledgeAdminApplicationService,
  adminKey: string
): void {
  app.addHook("onRequest", async (request, reply) => {
    const url = request.raw.url ?? "";
    if (!url.startsWith("/api/admin/knowledge")) {
      return;
    }
    try {
      requireAdminKey(request, adminKey);
    } catch (error) {
      const domainError =
        error instanceof DomainApiError
          ? error
          : new DomainApiError("FORBIDDEN", "A valid admin key is required.");
      return reply
        .status(domainError.statusCode)
        .send(toApiErrorEnvelope(domainError, request.id));
    }
  });

  app.get("/api/admin/knowledge/overview", (request, reply) =>
    handleAdmin(request, reply, () => service.getOverview())
  );

  app.get("/api/admin/knowledge/review-queue", (request, reply) =>
    handleAdmin(request, reply, () =>
      service.listReviewQueue({
        status: parseStatusFilter((request.query as Record<string, unknown>).status),
        limit: parseQueueLimit((request.query as Record<string, unknown>).limit)
      })
    )
  );

  app.get("/api/admin/knowledge/conflicts", (request, reply) =>
    handleAdmin(request, reply, () => service.listConflicts())
  );

  app.post("/api/admin/knowledge/review-pipeline/run", (request, reply) =>
    handleAdmin(request, reply, () => service.runReviewPipeline())
  );

  for (const action of ["approve", "reject", "supersede"] as const) {
    app.post<{ Params: { ruleId: string } }>(
      `/api/admin/knowledge/rules/:ruleId/${action}`,
      (request, reply) =>
        handleAdmin(request, reply, () => {
          const params = validateRequest(
            KnowledgeAdminRuleActionParamsSchema,
            request.params
          );
          return service.actOnRule(params.ruleId, action);
        })
    );
  }

  app.post("/api/admin/knowledge/versions", (request, reply) =>
    handleAdmin(request, reply, () => {
      const input = validateRequest(
        KnowledgeAdminPublishVersionRequestSchema,
        request.body
      );
      return service.publishVersion(input.version);
    })
  );

  app.get("/api/admin/knowledge/sources", (request, reply) =>
    handleAdmin(request, reply, () =>
      service.listSourceQueue(
        parseSourceReviewStatusFilter((request.query as Record<string, unknown>).reviewStatus)
      )
    )
  );

  app.post<{ Params: { sourceId: string } }>(
    "/api/admin/knowledge/sources/:sourceId/review",
    (request, reply) =>
      handleAdmin(request, reply, () => {
        const params = validateRequest(
          KnowledgeAdminSourceActionParamsSchema,
          request.params
        );
        const input = validateRequest(
          KnowledgeAdminReviewSourceRequestSchema,
          request.body
        );
        return service.reviewSource(params.sourceId, input.reviewStatus);
      })
  );

  app.post<{ Params: { sourceId: string } }>(
    "/api/admin/knowledge/sources/:sourceId/enabled",
    (request, reply) =>
      handleAdmin(request, reply, () => {
        const params = validateRequest(
          KnowledgeAdminSourceActionParamsSchema,
          request.params
        );
        const input = validateRequest(
          KnowledgeAdminSetSourceEnabledRequestSchema,
          request.body
        );
        return service.setSourceEnabled(params.sourceId, input.enabled);
      })
  );

  app.post<{ Params: { sourceId: string } }>(
    "/api/admin/knowledge/sources/:sourceId/policy",
    (request, reply) =>
      handleAdmin(request, reply, () => {
        const params = validateRequest(
          KnowledgeAdminSourceActionParamsSchema,
          request.params
        );
        const input = validateRequest(
          KnowledgeAdminUpdateSourcePolicyRequestSchema,
          request.body
        );
        return service.updateSourcePolicy(params.sourceId, input);
      })
  );
}
