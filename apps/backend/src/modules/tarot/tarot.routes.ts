import {
  CreateTarotSessionRequestSchema,
  CreateTarotSessionResponseSchema,
  GenerateTarotRecommendationsRequestSchema,
  GenerateTarotRecommendationsResponseSchema,
  GetTarotSessionResponseSchema,
  RevealTarotSessionRequestSchema,
  RevealTarotSessionResponseSchema,
  SaveTarotSessionRequestSchema,
  SaveTarotSessionResponseSchema,
  SelectTarotCardRequestSchema,
  SelectTarotCardResponseSchema
} from "@mystcrag/design-contract";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

import {
  actorIdFromVerifiedContext,
  createAuthenticationPreHandler,
  type AuthProvider
} from "../../auth/auth-provider.js";
import { DomainApiError, toApiErrorEnvelope } from "../../contracts/api-error.js";
import { validateRequest } from "../../validation/validate-request.js";
import { validateResponse } from "../../validation/validate-response.js";
import type { TarotApiService } from "./tarot.types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestIdFromBody(body: unknown, fallback: string): string {
  return isRecord(body) && typeof body.requestId === "string" && body.requestId.length > 0
    ? body.requestId
    : fallback;
}

function mapTarotError(error: unknown, ownerScoped: boolean): DomainApiError {
  if (error instanceof DomainApiError) {
    if (error.code === "NOT_FOUND" && ownerScoped) {
      return new DomainApiError("FORBIDDEN", "You do not have access to this resource.");
    }
    return error;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (
    code === "UNAUTHORIZED" ||
    code === "FORBIDDEN" ||
    code === "NOT_FOUND" ||
    code === "CONFLICT" ||
    code === "VALIDATION_ERROR" ||
    code === "COMPLIANCE_BLOCKED"
  ) {
    if (code === "NOT_FOUND" && ownerScoped) {
      return new DomainApiError("FORBIDDEN", "You do not have access to this resource.");
    }
    return new DomainApiError(
      code,
      error instanceof Error ? error.message : "Tarot persistence operation failed."
    );
  }
  if (code === "DATA_INTEGRITY_ERROR") {
    return new DomainApiError("INTERNAL_ERROR", "Persisted Tarot data is invalid.");
  }
  return new DomainApiError("INTERNAL_ERROR", "Unexpected Tarot API failure.");
}

async function handleTarotPost<TRequest, TResponse>(
  request: FastifyRequest,
  reply: FastifyReply,
  requestSchema: z.ZodType<TRequest>,
  responseSchema: z.ZodType<TResponse>,
  execute: (actorId: string, input: TRequest) => Promise<TResponse>,
  options: { readonly ownerScoped?: boolean; readonly enabled?: boolean } = {}
) {
  const requestId = requestIdFromBody(request.body, request.id);
  try {
    const actorId = actorIdFromVerifiedContext(request);
    if (options.enabled === false) {
      throw new DomainApiError("NOT_IMPLEMENTED", "Tarot session creation is disabled.");
    }
    const input = validateRequest(requestSchema, request.body);
    const output = await execute(actorId, input);
    return reply.status(200).send(validateResponse(responseSchema, output));
  } catch (error) {
    const domainError = mapTarotError(error, options.ownerScoped === true);
    return reply.status(domainError.statusCode).send(toApiErrorEnvelope(domainError, requestId));
  }
}

async function handleTarotGet(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  service: TarotApiService
) {
  try {
    const actorId = actorIdFromVerifiedContext(request);
    const output = await service.get(actorId, request.params.id);
    return reply.status(200).send(
      validateResponse(GetTarotSessionResponseSchema, {
        ...output,
        requestId: request.id
      })
    );
  } catch (error) {
    const domainError = mapTarotError(error, true);
    return reply
      .status(domainError.statusCode)
      .send(toApiErrorEnvelope(domainError, request.id));
  }
}

export function registerTarotRoutes(
  app: FastifyInstance,
  service: TarotApiService,
  authProvider: AuthProvider,
  enabled: boolean
) {
  const protectedRoute = { preHandler: createAuthenticationPreHandler(authProvider) };

  app.post("/api/tarot/sessions", protectedRoute, (request, reply) =>
    handleTarotPost(
      request,
      reply,
      CreateTarotSessionRequestSchema,
      CreateTarotSessionResponseSchema,
      (actorId, input) => service.create(actorId, input),
      { enabled, ownerScoped: true }
    )
  );
  app.post<{ Params: { id: string } }>(
    "/api/tarot/sessions/:id/select",
    protectedRoute,
    (request, reply) =>
      handleTarotPost(
        request,
        reply,
        SelectTarotCardRequestSchema,
        SelectTarotCardResponseSchema,
        (actorId, input) => service.select(actorId, request.params.id, input),
        { ownerScoped: true }
      )
  );
  app.post<{ Params: { id: string } }>(
    "/api/tarot/sessions/:id/reveal",
    protectedRoute,
    (request, reply) =>
      handleTarotPost(
        request,
        reply,
        RevealTarotSessionRequestSchema,
        RevealTarotSessionResponseSchema,
        (actorId, input) => service.reveal(actorId, request.params.id, input),
        { ownerScoped: true }
      )
  );
  app.post<{ Params: { id: string } }>(
    "/api/tarot/sessions/:id/recommendations",
    protectedRoute,
    (request, reply) =>
      handleTarotPost(
        request,
        reply,
        GenerateTarotRecommendationsRequestSchema,
        GenerateTarotRecommendationsResponseSchema,
        (actorId, input) => service.recommendations(actorId, request.params.id, input),
        { ownerScoped: true }
      )
  );
  app.get<{ Params: { id: string } }>(
    "/api/tarot/sessions/:id",
    protectedRoute,
    (request, reply) => handleTarotGet(request, reply, service)
  );
  app.post<{ Params: { id: string } }>(
    "/api/tarot/sessions/:id/save",
    protectedRoute,
    (request, reply) =>
      handleTarotPost(
        request,
        reply,
        SaveTarotSessionRequestSchema,
        SaveTarotSessionResponseSchema,
        (actorId, input) => service.save(actorId, request.params.id, input),
        { ownerScoped: true }
      )
  );
}
