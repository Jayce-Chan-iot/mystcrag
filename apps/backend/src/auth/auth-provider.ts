import type { FastifyReply, FastifyRequest } from "fastify";

import { DomainApiError, toApiErrorEnvelope } from "../contracts/api-error.js";

export type VerifiedAuthClaims = {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly expiresAtEpochSeconds: number;
};

export type ActorContext = {
  readonly actorId: string;
  readonly claims: VerifiedAuthClaims;
};

export interface AuthProvider {
  verifyAccessToken(token: string): Promise<VerifiedAuthClaims>;
}

declare module "fastify" {
  interface FastifyRequest {
    actorContext?: ActorContext;
  }
}

function bearerTokenFromRequest(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  const match =
    typeof authorization === "string" ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
  if (!match) {
    throw new DomainApiError("UNAUTHORIZED", "Authentication is required.");
  }
  return match[1]!;
}

export function createAuthenticationPreHandler(provider: AuthProvider) {
  return async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
    try {
      const token = bearerTokenFromRequest(request);
      const claims = await provider.verifyAccessToken(token);
      if (claims.subject.trim().length === 0) {
        throw new Error("Verified subject is empty");
      }
      request.actorContext = { actorId: claims.subject.trim(), claims };
    } catch {
      const error = new DomainApiError("UNAUTHORIZED", "Authentication is required.");
      return reply.status(error.statusCode).send(toApiErrorEnvelope(error, request.id));
    }
  };
}

export function actorIdFromVerifiedContext(request: FastifyRequest): string {
  const actorId = request.actorContext?.actorId;
  if (!actorId) {
    throw new DomainApiError("UNAUTHORIZED", "Authentication is required.");
  }
  return actorId;
}
