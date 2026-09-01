import type { FastifyReply, FastifyRequest } from "fastify";

import { DomainApiError, toApiErrorEnvelope } from "../contracts/api-error.js";
import { authErrorCategory, CredentialRejectedError } from "./auth-errors.js";

export type VerifiedAuthClaims = {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly expiresAtEpochSeconds: number;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly displayName?: string;
};

export type ActorContext = {
  readonly actorId: string;
  readonly claims: VerifiedAuthClaims;
};

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<VerifiedAuthClaims>;
}

export interface AuthProvider {
  authenticateAccessToken(token: string): Promise<ActorContext>;
}

declare module "fastify" {
  interface FastifyRequest {
    actorContext?: ActorContext;
  }
}

function bearerTokenFromRequest(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  const match =
    typeof authorization === "string" ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
  return match ? match[1]! : null;
}

function sendUnauthorized(request: FastifyRequest, reply: FastifyReply) {
  const error = new DomainApiError("UNAUTHORIZED", "Authentication is required.");
  return reply.status(error.statusCode).send(toApiErrorEnvelope(error, request.id));
}

function sendInternalError(request: FastifyRequest, reply: FastifyReply) {
  const error = new DomainApiError("INTERNAL_ERROR", "An internal error occurred.");
  return reply.status(error.statusCode).send(toApiErrorEnvelope(error, request.id));
}

export function createAuthenticationPreHandler(provider: AuthProvider) {
  return async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
    const startedAtMs = Date.now();
    const token = bearerTokenFromRequest(request);
    if (!token) {
      return sendUnauthorized(request, reply);
    }

    try {
      request.actorContext = await provider.authenticateAccessToken(token);
    } catch (error) {
      if (error instanceof CredentialRejectedError) {
        request.log.warn(
          {
            authCategory: error.category,
            authReason: error.reason,
            authKid: error.kid,
            authDurationMs: Date.now() - startedAtMs
          },
          "Access token rejected."
        );
        return sendUnauthorized(request, reply);
      }
      request.log.error(
        {
          authCategory: authErrorCategory(error),
          authDurationMs: Date.now() - startedAtMs
        },
        "Authentication failed."
      );
      return sendInternalError(request, reply);
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
