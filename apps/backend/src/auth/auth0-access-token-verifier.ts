import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  errors as joseErrors,
  type JWK
} from "jose";

import {
  CredentialRejectedError,
  ProviderUnavailableError,
  type CredentialRejectionReason
} from "./auth-errors.js";
import type { AuthProvider, VerifiedAuthClaims } from "./auth-provider.js";
import type { JsonWebKeySet, JwksKeySource } from "./jwks-key-source.js";

const AUTH0_CLOCK_SKEW_SECONDS = 60;
const AUTH0_SIGNING_ALGORITHM = "RS256";

export type Auth0AccessTokenVerifierOptions = {
  readonly issuer: string;
  readonly audience: string;
  readonly keySource: Pick<JwksKeySource, "getJwks"> | { getJwks(kid?: string): Promise<JsonWebKeySet> };
  readonly now?: () => Date;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function rejectionFor(
  error: unknown,
  kid: string | undefined
): CredentialRejectedError | ProviderUnavailableError {
  if (
    error instanceof CredentialRejectedError ||
    error instanceof ProviderUnavailableError
  ) {
    return error;
  }
  let reason: CredentialRejectionReason | undefined;
  if (error instanceof joseErrors.JWTExpired) {
    reason = "expired";
  } else if (error instanceof joseErrors.JWTClaimValidationFailed) {
    const claim = (error as joseErrors.JWTClaimValidationFailed & { claim?: string }).claim;
    reason =
      claim === "iss"
        ? "issuer"
        : claim === "aud"
          ? "audience"
          : claim === "exp"
            ? "expired"
            : claim === "sub"
              ? "subject"
              : "malformed";
  } else if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
    reason = "signature";
  } else if (error instanceof joseErrors.JWKSNoMatchingKey) {
    reason = "unknown_key";
  } else if (
    error instanceof joseErrors.JWSInvalid ||
    error instanceof joseErrors.JWTInvalid ||
    error instanceof joseErrors.JOSEAlgNotAllowed ||
    error instanceof joseErrors.JWKSMultipleMatchingKeys
  ) {
    reason = "malformed";
  } else if (error instanceof joseErrors.JWKInvalid || error instanceof joseErrors.JOSENotSupported) {
    return new ProviderUnavailableError("The provider key set is unusable.");
  }
  if (reason) {
    return new CredentialRejectedError(reason, kid);
  }
  return new ProviderUnavailableError("Access token verification failed unexpectedly.", {
    cause: error
  });
}

export class Auth0AccessTokenVerifier implements AuthProvider {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #keySource: Auth0AccessTokenVerifierOptions["keySource"];
  readonly #now: () => Date;

  constructor(options: Auth0AccessTokenVerifierOptions) {
    this.#issuer = options.issuer;
    this.#audience = options.audience;
    this.#keySource = options.keySource;
    this.#now = options.now ?? (() => new Date());
  }

  async verifyAccessToken(token: string): Promise<VerifiedAuthClaims> {
    let kid: string | undefined;
    try {
      let header: ReturnType<typeof decodeProtectedHeader>;
      try {
        header = decodeProtectedHeader(token);
      } catch {
        throw new CredentialRejectedError("malformed");
      }
      if (header.alg !== AUTH0_SIGNING_ALGORITHM) {
        throw new CredentialRejectedError("algorithm", header.kid);
      }
      kid = header.kid;
      if (typeof kid !== "string" || kid.length === 0) {
        throw new CredentialRejectedError("malformed");
      }

      const jwks = await this.#keySource.getJwks(kid);
      if (!jwks.keys.some((key) => key.kid === kid)) {
        throw new CredentialRejectedError("unknown_key", kid);
      }
      const keySet = { keys: [...jwks.keys] as JWK[] };

      const { payload } = await jwtVerify(token, createLocalJWKSet(keySet), {
        issuer: this.#issuer,
        audience: this.#audience,
        algorithms: [AUTH0_SIGNING_ALGORITHM],
        clockTolerance: AUTH0_CLOCK_SKEW_SECONDS,
        currentDate: this.#now(),
        requiredClaims: ["exp", "sub"]
      });

      if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
        throw new CredentialRejectedError("subject", kid);
      }
      if (typeof payload.iss !== "string" || payload.iss.length === 0) {
        throw new CredentialRejectedError("issuer", kid);
      }
      if (typeof payload.exp !== "number") {
        throw new CredentialRejectedError("expired", kid);
      }
      const audience = (Array.isArray(payload.aud) ? payload.aud : [payload.aud]).filter(
        (value): value is string => typeof value === "string" && value.length > 0
      );
      const emailVerified =
        typeof payload.email_verified === "boolean" ? payload.email_verified : undefined;

      const email = nonEmptyString(payload.email);
      const displayName = nonEmptyString(payload.name);

      return {
        subject: payload.sub,
        issuer: payload.iss,
        audience,
        expiresAtEpochSeconds: payload.exp,
        ...(email === undefined ? {} : { email }),
        ...(emailVerified === undefined ? {} : { emailVerified }),
        ...(displayName === undefined ? {} : { displayName })
      };
    } catch (error) {
      throw rejectionFor(error, kid);
    }
  }
}
