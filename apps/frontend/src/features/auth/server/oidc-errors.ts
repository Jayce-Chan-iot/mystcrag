/**
 * Privacy-safe OIDC dependency errors for the Authing BFF.
 * Never carries tokens, codes, or raw provider payloads into logs/responses.
 */

export class ProviderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderUnavailableError";
  }
}

export class AuthenticationRejectedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Authentication rejected: ${reason}`);
    this.name = "AuthenticationRejectedError";
    this.reason = reason;
  }
}

export type OidcFailureClass = "unauthorized" | "internal";

const AUTH_REJECTION_REASONS = new Set([
  "missing_state",
  "invalid_state",
  "session_expired",
  "access_denied",
  "login_required",
  "interaction_required",
  "consent_required",
  "account_selection_required",
  "invalid_grant",
  "unknown_error",
  "id_token_invalid",
  "nonce_mismatch"
]);

export function classifyOidcFailure(error: unknown): OidcFailureClass {
  if (error instanceof AuthenticationRejectedError) {
    return AUTH_REJECTION_REASONS.has(error.reason) ? "unauthorized" : "internal";
  }
  if (error instanceof ProviderUnavailableError) {
    return "internal";
  }
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : undefined;
  if (code && AUTH_REJECTION_REASONS.has(code)) {
    return "unauthorized";
  }
  return "internal";
}
