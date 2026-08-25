import type { FastifyReply, FastifyRequest } from "fastify";

import { DomainApiError, toApiErrorEnvelope } from "../contracts/api-error.js";
import {
  authErrorCategory,
  CredentialRejectedError,
  IdentityMappingFailedError,
  ProviderUnavailableError
} from "./auth-errors.js";

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

export interface AuthProvider {
  verifyAccessToken(token: string): Promise<VerifiedAuthClaims>;
}

export interface ActorAuthenticator {
  authenticateAccessToken(token: string): Promise<ActorContext>;
}

declare module "fastify" {
  interface FastifyRequest {
    actorContext?: ActorContext;
  }
}

function isActorAuthenticator(
  provider: AuthProvider
): provider is AuthProvider & ActorAuthenticator {
  return (
    typeof (provider as Partial<ActorAuthenticator>).authenticateAccessToken === "function"
  );
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
    let token: string;
    try {
      token = bearerTokenFromRequest(request);
    } catch {
      return sendUnauthorized(request, reply);
    }

    if (isActorAuthenticator(provider)) {
      try {
        request.actorContext = await provider.authenticateAccessToken(token);
        return;
      } catch (error) {
        const providerSideFailure =
          error instanceof ProviderUnavailableError ||
          error instanceof IdentityMappingFailedError;
        if (providerSideFailure) {
          request.log.error(
            {
              authCategory: authErrorCategory(error),
              authDurationMs: Date.now() - startedAtMs
            },
            "Authentication failed."
          );
          return sendInternalError(request, reply);
        }
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
        request.log.warn(
          {
            authCategory: authErrorCategory(error),
            authDurationMs: Date.now() - startedAtMs
          },
          "Access token rejected."
        );
        return sendUnauthorized(request, reply);
      }
    }

    try {
      const claims = await provider.verifyAccessToken(token);
      if (claims.subject.trim().length === 0) {
        throw new Error("Verified subject is empty");
      }
      request.actorContext = { actorId: claims.subject.trim(), claims };
    } catch {
      return sendUnauthorized(request, reply);
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
