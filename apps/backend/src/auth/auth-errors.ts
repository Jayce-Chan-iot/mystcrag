export type CredentialRejectionReason =
  | "malformed"
  | "algorithm"
  | "expired"
  | "issuer"
  | "audience"
  | "signature"
  | "subject"
  | "unknown_key";

export const AUTH_CREDENTIAL_REJECTED = "AUTH_CREDENTIAL_REJECTED";
export const AUTH_PROVIDER_UNAVAILABLE = "AUTH_PROVIDER_UNAVAILABLE";
export const AUTH_IDENTITY_MAPPING_FAILED = "AUTH_IDENTITY_MAPPING_FAILED";
export const AUTH_INTERNAL_ERROR = "AUTH_INTERNAL_ERROR";

export class CredentialRejectedError extends Error {
  readonly category = AUTH_CREDENTIAL_REJECTED;

  constructor(
    readonly reason: CredentialRejectionReason,
    readonly kid?: string
  ) {
    super("The presented access token was rejected.");
    this.name = "CredentialRejectedError";
  }
}

export class ProviderUnavailableError extends Error {
  readonly category = AUTH_PROVIDER_UNAVAILABLE;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ProviderUnavailableError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class IdentityMappingFailedError extends Error {
  readonly category = AUTH_IDENTITY_MAPPING_FAILED;

  constructor(cause: unknown) {
    super("The verified identity could not be mapped to an internal actor.");
    this.name = "IdentityMappingFailedError";
    this.cause = cause;
  }
}

export function authErrorCategory(error: unknown): string {
  if (
    error instanceof CredentialRejectedError ||
    error instanceof ProviderUnavailableError ||
    error instanceof IdentityMappingFailedError
  ) {
    return error.category;
  }
  return AUTH_INTERNAL_ERROR;
}
