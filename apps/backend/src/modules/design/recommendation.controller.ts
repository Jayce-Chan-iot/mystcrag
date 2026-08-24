import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { MaterialSuggestQuerySchema } from "@mystcrag/design-contract";

import { actorIdFromVerifiedContext } from "../../auth/auth-provider.js";
import { toApiErrorEnvelope } from "../../contracts/api-error.js";
import { validateRequest } from "../../validation/validate-request.js";
import { validateResponse } from "../../validation/validate-response.js";
import { mapError } from "./design.controller.js";
import type { RecommendationApiService } from "./recommendation.service.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestIdFromBody(body: unknown, fallback: string): string {
  return isRecord(body) && typeof body.requestId === "string" && body.requestId.length > 0
    ? body.requestId
    : fallback;
}

export async function handleRecommendationPost<TRequest, TResponse>(
  request: FastifyRequest,
  reply: FastifyReply,
  requestSchema: z.ZodType<TRequest>,
  responseSchema: z.ZodType<TResponse>,
  execute: (service: RecommendationApiService, actorId: string, input: TRequest) => Promise<TResponse>,
  service: RecommendationApiService
) {
  const requestId = requestIdFromBody(request.body, request.id);
  try {
    const actorId = actorIdFromVerifiedContext(request);
    const validated = validateRequest(requestSchema, request.body);
    const output = await execute(service, actorId, validated);
    return reply.status(200).send(validateResponse(responseSchema, output));
  } catch (error) {
    const domainError = mapError(error, true);
    return reply.status(domainError.statusCode).send(toApiErrorEnvelope(domainError, requestId));
  }
}

export async function handleDesignTraceGet(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  service: RecommendationApiService
) {
  try {
    const actorId = actorIdFromVerifiedContext(request);
    const output = await service.trace(actorId, request.params.id);
    return reply.status(200).send(output);
  } catch (error) {
    const domainError = mapError(error, true);
    return reply
      .status(domainError.statusCode)
      .send(toApiErrorEnvelope(domainError, request.id));
  }
}

export async function handleMaterialSuggestGet(
  request: FastifyRequest<{ Params: { id: string }; Querystring: { currency?: string; locale?: string } }>,
  reply: FastifyReply,
  service: RecommendationApiService
) {
  try {
    const actorId = actorIdFromVerifiedContext(request);
    const query = validateRequest(MaterialSuggestQuerySchema, request.query);
    const output = await service.suggest(
      actorId,
      request.params.id,
      query.currency,
      query.locale ?? "zh-CN"
    );
    return reply.status(200).send(output);
  } catch (error) {
    const domainError = mapError(error, false);
    return reply
      .status(domainError.statusCode)
      .send(toApiErrorEnvelope(domainError, request.id));
  }
}
