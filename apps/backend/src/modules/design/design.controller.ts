import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

import { DomainApiError, toApiErrorEnvelope } from "../../contracts/api-error.js";
import { validateRequest } from "../../validation/validate-request.js";
import { validateResponse } from "../../validation/validate-response.js";
import type { DesignApiService } from "./design-api.service.js";

export type ActorResolver = (request: FastifyRequest) => string | Promise<string>;

export function actorIdFromRequestContext(request: FastifyRequest): string {
  const actorId = request.headers["x-actor-id"];
  if (typeof actorId !== "string" || actorId.trim().length === 0) {
    throw new DomainApiError("VALIDATION_ERROR", "Authenticated actor context is required.");
  }
  return actorId.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestIdFromBody(body: unknown, fallback: string): string {
  return isRecord(body) && typeof body.requestId === "string" && body.requestId.length > 0
    ? body.requestId
    : fallback;
}

function withoutInjectedOwnerId(input: unknown): unknown {
  if (!isRecord(input) || !("ownerId" in input)) return input;
  const { ownerId: _ignored, ...safeInput } = input;
  return safeInput;
}

function mapError(error: unknown): DomainApiError {
  if (error instanceof DomainApiError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (
    code === "NOT_FOUND" ||
    code === "CONFLICT" ||
    code === "VALIDATION_ERROR" ||
    code === "COMPLIANCE_BLOCKED" ||
    code === "CONSENT_REQUIRED" ||
    code === "PRICE_CHANGED" ||
    code === "INVENTORY_CHANGED" ||
    code === "DATA_INTEGRITY_ERROR"
  ) {
    if (code === "DATA_INTEGRITY_ERROR") {
      return new DomainApiError("INTERNAL_ERROR", "Persisted design data is invalid.");
    }
    return new DomainApiError(
      code,
      error instanceof Error ? error.message : "Design persistence operation failed."
    );
  }
  return new DomainApiError("INTERNAL_ERROR", "Unexpected design API failure.");
}

export async function handleDesignPost<TRequest, TResponse>(
  request: FastifyRequest,
  reply: FastifyReply,
  requestSchema: z.ZodType<TRequest>,
  responseSchema: z.ZodType<TResponse>,
  actorResolver: ActorResolver,
  execute: (service: DesignApiService, actorId: string, input: TRequest) => Promise<TResponse>,
  service: DesignApiService,
  options: { ignoreOwnerId?: boolean } = {}
) {
  const requestId = requestIdFromBody(request.body, request.id);
  try {
    const actorId = await actorResolver(request);
    const body = options.ignoreOwnerId ? withoutInjectedOwnerId(request.body) : request.body;

    if (isRecord(body) && isRecord(body.design)) {
      const compliance = isRecord(body.design.compliance) ? body.design.compliance : undefined;
      if (
        (request.url === "/api/design/publish" ||
          request.url === "/api/orders/from-design") &&
        compliance?.complianceStatus === "REJECTED"
      ) {
        throw new DomainApiError("COMPLIANCE_BLOCKED", "Rejected designs are blocked.");
      }
    }
    if (
      request.url === "/api/design/publish" &&
      isRecord(body) &&
      body.publishConsent !== true
    ) {
      throw new DomainApiError("CONSENT_REQUIRED", "Publication requires explicit consent.");
    }

    const validated = validateRequest(requestSchema, body);
    const output = await execute(service, actorId, validated);
    return reply.status(200).send(validateResponse(responseSchema, output));
  } catch (error) {
    const domainError = mapError(error);
    return reply.status(domainError.statusCode).send(toApiErrorEnvelope(domainError, requestId));
  }
}

export async function handleDesignGet(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  actorResolver: ActorResolver,
  service: DesignApiService,
  revisions: boolean
) {
  try {
    const actorId = await actorResolver(request);
    const output = revisions
      ? await service.revisions(actorId, request.params.id)
      : await service.get(actorId, request.params.id);
    return reply.status(200).send(output);
  } catch (error) {
    const domainError = mapError(error);
    return reply
      .status(domainError.statusCode)
      .send(toApiErrorEnvelope(domainError, request.id));
  }
}
