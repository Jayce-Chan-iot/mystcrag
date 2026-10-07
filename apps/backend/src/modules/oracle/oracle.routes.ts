import {
  CreateOracleSessionRequestSchema,
  CreateOracleSessionResponseSchema,
  GenerateOracleRecommendationsRequestSchema,
  GenerateOracleRecommendationsResponseSchema,
  GetOracleSessionResponseSchema,
  LocalizedPresentationRequestSchema,
  OraclePresentationResponseSchema,
  SaveOracleSessionRequestSchema,
  SaveOracleSessionResponseSchema
} from "@mystcrag/design-contract";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

import {
  actorIdFromVerifiedContext,
  createAuthenticationPreHandler,
  type AuthProvider
} from "../../auth/auth-provider.js";
import { DomainApiError, toApiErrorEnvelope } from "../../contracts/api-error.js";
import type { ApiErrorCode } from "../../contracts/api-error.js";
import { validateRequest } from "../../validation/validate-request.js";
import { validateResponse } from "../../validation/validate-response.js";
import type { OracleApiService } from "./oracle.types.js";

function requestIdFromBody(body: unknown, fallback: string): string {
  return typeof body === "object" && body !== null && "requestId" in body &&
    typeof body.requestId === "string" && body.requestId.length > 0
    ? body.requestId
    : fallback;
}

const ROUTABLE_ORACLE_CODES = new Set<ApiErrorCode>([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "COMPLIANCE_BLOCKED",
  "INVENTORY_CHANGED",
  "PRICE_CHANGED"
]);

function isRoutableOracleCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && ROUTABLE_ORACLE_CODES.has(value as ApiErrorCode);
}

function mapOracleError(error: unknown, ownerScoped: boolean): DomainApiError {
  if (error instanceof DomainApiError) {
    if (ownerScoped && error.code === "NOT_FOUND") {
      return new DomainApiError("FORBIDDEN", "You do not have access to this resource.");
    }
    return error;
  }
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
  if (isRoutableOracleCode(code)) {
    if (ownerScoped && code === "NOT_FOUND") {
      return new DomainApiError("FORBIDDEN", "You do not have access to this resource.");
    }
    return new DomainApiError(code, error instanceof Error ? error.message : "Oracle operation failed.");
  }
  return new DomainApiError("INTERNAL_ERROR", "Unexpected Oracle API failure.");
}

async function handlePost<TRequest, TResponse>(
  request: FastifyRequest,
  reply: FastifyReply,
  requestSchema: z.ZodType<TRequest>,
  responseSchema: z.ZodType<TResponse>,
  execute: (actorId: string, input: TRequest) => Promise<TResponse>,
  options: { readonly enabled?: boolean; readonly ownerScoped?: boolean } = {}
) {
  const requestId = requestIdFromBody(request.body, request.id);
  try {
    const actorId = actorIdFromVerifiedContext(request);
    if (options.enabled === false) {
      throw new DomainApiError("NOT_IMPLEMENTED", "Oracle session creation is disabled.");
    }
    const input = validateRequest(requestSchema, request.body);
    return reply.status(200).send(validateResponse(responseSchema, await execute(actorId, input)));
  } catch (error) {
    const domain = mapOracleError(error, options.ownerScoped === true);
    return reply.status(domain.statusCode).send(toApiErrorEnvelope(domain, requestId));
  }
}

export function registerOracleRoutes(
  app: FastifyInstance,
  service: OracleApiService,
  authProvider: AuthProvider,
  enabled: boolean
) {
  const protectedRoute = { preHandler: createAuthenticationPreHandler(authProvider) };
  app.post("/api/oracle/sessions", protectedRoute, (request, reply) =>
    handlePost(request, reply, CreateOracleSessionRequestSchema, CreateOracleSessionResponseSchema,
      (actorId, input) => service.create(actorId, input), { enabled, ownerScoped: true }));
  app.post<{ Params: { id: string } }>("/api/oracle/sessions/:id/recommendations", protectedRoute, (request, reply) =>
    handlePost(request, reply, GenerateOracleRecommendationsRequestSchema, GenerateOracleRecommendationsResponseSchema,
      (actorId, input) => service.recommendations(actorId, request.params.id, input), { ownerScoped: true }));
  app.get<{ Params: { id: string } }>("/api/oracle/sessions/:id", protectedRoute, async (request, reply) => {
    try {
      const actorId = actorIdFromVerifiedContext(request);
      const output = await service.get(actorId, request.params.id);
      return reply.status(200).send(validateResponse(GetOracleSessionResponseSchema, {
        ...output,
        requestId: request.id
      }));
    } catch (error) {
      const domain = mapOracleError(error, true);
      return reply.status(domain.statusCode).send(toApiErrorEnvelope(domain, request.id));
    }
  });
  app.get<{ Params: { sessionId: string }; Querystring: { locale?: string } }>(
    "/api/oracle/sessions/:sessionId/presentation",
    protectedRoute,
    async (request, reply) => {
      try {
        const actorId = actorIdFromVerifiedContext(request);
        const query = validateRequest(LocalizedPresentationRequestSchema, request.query);
        const output = await service.presentation(actorId, request.params.sessionId, query.locale);
        return reply.status(200).send(validateResponse(OraclePresentationResponseSchema, output));
      } catch (error) {
        const domain = mapOracleError(error, true);
        return reply.status(domain.statusCode).send(toApiErrorEnvelope(domain, request.id));
      }
    }
  );
  app.post<{ Params: { id: string } }>("/api/oracle/sessions/:id/save", protectedRoute, (request, reply) =>
    handlePost(request, reply, SaveOracleSessionRequestSchema, SaveOracleSessionResponseSchema,
      (actorId, input) => service.save(actorId, request.params.id, input), { ownerScoped: true }));
}
