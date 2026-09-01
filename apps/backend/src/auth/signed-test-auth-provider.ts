import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { AccessTokenVerifier, VerifiedAuthClaims } from "./auth-provider.js";
import { CredentialRejectedError } from "./auth-errors.js";

const TokenHeaderSchema = z.strictObject({
  alg: z.literal("HS256"),
  typ: z.literal("JWT")
});

const TokenClaimsSchema = z.strictObject({
  sub: z.string().trim().min(1),
  iss: z.string().trim().min(1),
  aud: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative().optional()
});

export type SignedTestTokenOptions = {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly now?: () => Date;
};

export type SignedTestTokenClaims = {
  readonly subject: string;
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly expiresAtEpochSeconds: number;
  readonly issuedAtEpochSeconds?: number;
};

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signatureFor(input: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

function parseJsonSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

export class SignedTestTokenAuthProvider implements AccessTokenVerifier {
  readonly #secret: string;
  readonly #issuer: string;
  readonly #audience: string;
  readonly #now: () => Date;

  constructor(options: SignedTestTokenOptions) {
    if (options.secret.length < 32) {
      throw new Error("Signed test auth secret must contain at least 32 characters.");
    }
    this.#secret = options.secret;
    this.#issuer = options.issuer;
    this.#audience = options.audience;
    this.#now = options.now ?? (() => new Date());
  }

  async verifyAccessToken(token: string): Promise<VerifiedAuthClaims> {
    const segments = token.split(".");
    if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
      throw new CredentialRejectedError("malformed");
    }
    const [encodedHeader, encodedClaims, encodedSignature] = segments as [string, string, string];
    const signature = Buffer.from(encodedSignature, "base64url");
    const expectedSignature = signatureFor(`${encodedHeader}.${encodedClaims}`, this.#secret);
    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(signature, expectedSignature)
    ) {
      throw new CredentialRejectedError("signature");
    }

    try {
      TokenHeaderSchema.parse(parseJsonSegment(encodedHeader));
    } catch {
      throw new CredentialRejectedError("malformed");
    }
    let claims: z.infer<typeof TokenClaimsSchema>;
    try {
      claims = TokenClaimsSchema.parse(parseJsonSegment(encodedClaims));
    } catch {
      throw new CredentialRejectedError("malformed");
    }
    const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    const nowEpochSeconds = Math.floor(this.#now().getTime() / 1000);
    if (claims.iss !== this.#issuer) {
      throw new CredentialRejectedError("issuer");
    }
    if (!audience.includes(this.#audience)) {
      throw new CredentialRejectedError("audience");
    }
    if (claims.exp <= nowEpochSeconds) {
      throw new CredentialRejectedError("expired");
    }

    return {
      subject: claims.sub,
      issuer: claims.iss,
      audience,
      expiresAtEpochSeconds: claims.exp
    };
  }
}

export function signTestAccessToken(
  claims: SignedTestTokenClaims,
  secret: string
): string {
  const encodedHeader = encodeJson({ alg: "HS256", typ: "JWT" });
  const encodedClaims = encodeJson({
    sub: claims.subject,
    iss: claims.issuer,
    aud: claims.audience,
    exp: claims.expiresAtEpochSeconds,
    ...(claims.issuedAtEpochSeconds === undefined
      ? {}
      : { iat: claims.issuedAtEpochSeconds })
  });
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = signatureFor(signingInput, secret).toString("base64url");
  return `${signingInput}.${signature}`;
}
