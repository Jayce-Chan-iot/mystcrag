import { IdentityMappingFailedError } from "./auth-errors.js";
import type { ActorContext, AuthProvider, VerifiedAuthClaims } from "./auth-provider.js";

export type ExternalIdentityMappingInput = {
  readonly issuer: string;
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly displayName?: string;
};

export type ExternalIdentityMappingResult = {
  readonly actorId: string;
};

export type ExternalIdentityMappingPort = {
  findOrProvisionExternalIdentity(
    input: ExternalIdentityMappingInput
  ): Promise<ExternalIdentityMappingResult>;
};

export type AuthenticatedActorProviderOptions = {
  readonly provider: AuthProvider;
  readonly identities: ExternalIdentityMappingPort;
};

export class AuthenticatedActorProvider implements AuthProvider {
  readonly #provider: AuthProvider;
  readonly #identities: ExternalIdentityMappingPort;

  constructor(options: AuthenticatedActorProviderOptions) {
    this.#provider = options.provider;
    this.#identities = options.identities;
  }

  verifyAccessToken(token: string): Promise<VerifiedAuthClaims> {
    return this.#provider.verifyAccessToken(token);
  }

  async authenticateAccessToken(token: string): Promise<ActorContext> {
    const claims = await this.#provider.verifyAccessToken(token);
    try {
      const mapping = await this.#identities.findOrProvisionExternalIdentity({
        issuer: claims.issuer,
        subject: claims.subject,
        ...(claims.email === undefined ? {} : { email: claims.email }),
        ...(claims.emailVerified === undefined ? {} : { emailVerified: claims.emailVerified }),
        ...(claims.displayName === undefined ? {} : { displayName: claims.displayName })
      });
      return { actorId: mapping.actorId, claims };
    } catch (error) {
      throw new IdentityMappingFailedError(error);
    }
  }
}
