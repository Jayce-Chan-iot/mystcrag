import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";

import { DomainApiError, toApiErrorEnvelope } from "../../contracts/api-error.js";
import { validateRequest } from "../../validation/validate-request.js";
import { validateResponse } from "../../validation/validate-response.js";
import { mapPriceRequestToServerIntent } from "./design.mapper.js";
import type { DesignStubOperation, DesignStubService } from "./design.service.js";

export type StubRouteContract = {
  readonly operation: DesignStubOperation;
  readonly requestSchema: z.ZodType;
  readonly responseSchema: z.ZodType;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestIdFromBody(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.requestId === "string" && body.requestId.length > 0) {
    return body.requestId;
  }
  return fallback;
}

function applyPreValidationGuards(operation: DesignStubOperation, body: unknown): void {
  if (!isRecord(body)) {
    return;
  }
  if (
    operation === "PUBLISH" &&
    (body.visibility === "PUBLIC" || body.visibility === "UNLISTED") &&
    body.publishConsent !== true
  ) {
    throw new DomainApiError("CONSENT_REQUIRED", "Publication requires explicit consent.");
  }
  if (operation === "CREATE_ORDER") {
    const design = isRecord(body.design) ? body.design : undefined;
    const compliance = design && isRecord(design.compliance) ? design.compliance : undefined;
    if (compliance?.complianceStatus === "REJECTED") {
      throw new DomainApiError(
        "COMPLIANCE_BLOCKED",
        "Rejected designs cannot create orders."
      );
    }
  }
}

export async function handleStubRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  contract: StubRouteContract,
  service: DesignStubService
) {
  const requestId = requestIdFromBody(request.body, request.id);
  try {
    applyPreValidationGuards(contract.operation, request.body);
    const validatedRequest = validateRequest(contract.requestSchema, request.body);
    const serviceInput =
      contract.operation === "PRICE"
        ? mapPriceRequestToServerIntent(validatedRequest)
        : validatedRequest;
    const serviceOutput = await service.execute(contract.operation, serviceInput);
    return reply.status(200).send(validateResponse(contract.responseSchema, serviceOutput));
  } catch (error) {
    const domainError =
      error instanceof DomainApiError
        ? error
        : new DomainApiError("INTERNAL_ERROR", "Unexpected design stub failure.");
    return reply.status(domainError.statusCode).send(toApiErrorEnvelope(domainError, requestId));
  }
}
