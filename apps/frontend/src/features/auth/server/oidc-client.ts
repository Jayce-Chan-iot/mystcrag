/**
 * Standard OIDC Authorization Code + PKCE (S256) client for Authing.
 *
 * - Token endpoint auth: client_secret_post (body client_id/client_secret, no Basic).
 * - Discovery endpoints only; all outbound calls are bounded (5s total).
 * - Tokens stay server-side. Access Tokens are never verified with client secret.
 * - Issuer is compared exactly (no trailing-slash mutation).
 */

import { createLocalJWKSet, jwtVerify, type JWK } from "jose";

import type { AuthConfig } from "../model/auth-config";
import { getOidcDiscoverySource, type OidcDiscoveryDocument } from "./oidc-discovery";
import { AuthenticationRejectedError, ProviderUnavailableError } from "./oidc-errors";
import { generateNonce, generatePkcePair, generateState } from "./oidc-session-crypto";
import type { OidcSessionPayload, OidcSessionUser } from "./oidc-session-store";

const OIDC_TOTAL_TIMEOUT_MS = 5_000;

export type AuthorizeRequest = {
  readonly returnTo: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
};

export type TokenEndpointSuccess = {
  readonly access_token: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly id_token?: string;
};

export async function loadDiscovery(config: AuthConfig): Promise<OidcDiscoveryDocument> {
  if (config.authProvider !== "authing") {
    throw new ProviderUnavailableError("OIDC client is only available for the authing provider");
  }
  return getOidcDiscoverySource(config.authIssuer, config.authIssuerHostAllowlist ?? []).getDocument();
}

export function buildAuthorizeUrl(
  document: OidcDiscoveryDocument,
  config: AuthConfig,
  request: AuthorizeRequest
): string {
  const url = new URL(document.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.authClientId);
  url.searchParams.set("redirect_uri", config.authCallbackUrl);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", request.state);
  url.searchParams.set("nonce", request.nonce);
  url.searchParams.set("code_challenge", request.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (config.authAudience) {
    url.searchParams.set("audience", config.authAudience);
  }
  return url.toString();
}

export function buildEndSessionUrl(
  document: OidcDiscoveryDocument,
  config: AuthConfig
): string {
  const endpoint = document.end_session_endpoint;
  if (!endpoint) {
    return config.authLogoutUrl;
  }
  const url = new URL(endpoint);
  url.searchParams.set("client_id", config.authClientId);
  url.searchParams.set("post_logout_redirect_uri", config.authLogoutUrl);
  return url.toString();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = OIDC_TOTAL_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "manual",
      cache: "no-store"
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new ProviderUnavailableError("OIDC request exceeded the total timeout", { cause: error });
    }
    throw new ProviderUnavailableError("OIDC request failed", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function postToken(
  tokenEndpoint: string,
  body: URLSearchParams,
  clientId: string,
  clientSecret: string
): Promise<TokenEndpointSuccess> {
  // Authing default confidential-client method is client_secret_post.
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  let response: Response;
  try {
    response = await fetchWithTimeout(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) throw error;
    throw new ProviderUnavailableError("OIDC token endpoint is unreachable", { cause: error });
  }

  if (response.status >= 300 && response.status < 400) {
    throw new ProviderUnavailableError("OIDC token endpoint redirects are not followed");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ProviderUnavailableError("OIDC token endpoint returned a non-JSON body", { cause: error });
  }
  if (!response.ok) {
    const error = payload as { error?: unknown };
    const code = typeof error?.error === "string" ? error.error : "server_error";
    if (
      code === "invalid_grant" ||
      code === "access_denied" ||
      code === "invalid_request" ||
      code === "unauthorized_client"
    ) {
      throw new AuthenticationRejectedError(code === "invalid_request" ? "unknown_error" : code);
    }
    throw new ProviderUnavailableError(`OIDC token endpoint status ${response.status}`);
  }
  const success = payload as TokenEndpointSuccess;
  if (typeof success.access_token !== "string" || success.access_token.length === 0) {
    throw new ProviderUnavailableError("OIDC token endpoint omitted access_token");
  }
  return success;
}

export async function exchangeAuthorizationCode(
  document: OidcDiscoveryDocument,
  config: AuthConfig,
  input: { code: string; codeVerifier: string }
): Promise<TokenEndpointSuccess> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", input.code);
  body.set("redirect_uri", config.authCallbackUrl);
  body.set("code_verifier", input.codeVerifier);
  return postToken(document.token_endpoint, body, config.authClientId, config.authClientSecret);
}

export async function refreshAccessToken(
  document: OidcDiscoveryDocument,
  config: AuthConfig,
  refreshToken: string
): Promise<TokenEndpointSuccess> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  return postToken(document.token_endpoint, body, config.authClientId, config.authClientSecret);
}

export async function validateIdToken(
  document: OidcDiscoveryDocument,
  config: AuthConfig,
  idToken: string,
  expectedNonce: string
): Promise<OidcSessionUser> {
  let jwksBody: unknown;
  let response: Response;
  try {
    response = await fetchWithTimeout(document.jwks_uri, {
      method: "GET",
      headers: { accept: "application/json" }
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) throw error;
    throw new ProviderUnavailableError("OIDC JWKS request failed", { cause: error });
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ProviderUnavailableError("OIDC JWKS redirects are not followed");
  }
  if (!response.ok) {
    throw new ProviderUnavailableError(`OIDC JWKS status ${response.status}`);
  }
  try {
    jwksBody = await response.json();
  } catch (error) {
    throw new ProviderUnavailableError("OIDC JWKS returned a non-JSON body", { cause: error });
  }
  const keys = (jwksBody as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new ProviderUnavailableError("OIDC JWKS document is empty");
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, createLocalJWKSet({ keys: keys as JWK[] }), {
      // Exact configured/discovery issuer — no trailing-slash mutation.
      issuer: document.issuer,
      audience: config.authClientId,
      algorithms: ["RS256"],
      clockTolerance: 60,
      requiredClaims: ["exp", "sub", "iss", "aud"]
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    throw new AuthenticationRejectedError(
      error instanceof Error && error.name === "JWTExpired" ? "session_expired" : "id_token_invalid"
    );
  }

  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    throw new AuthenticationRejectedError("nonce_mismatch");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new AuthenticationRejectedError("id_token_invalid");
  }

  return {
    ...(typeof payload.name === "string" && payload.name.trim()
      ? { name: payload.name.trim() }
      : {}),
    ...(typeof payload.email === "string" && payload.email.trim()
      ? { email: payload.email.trim() }
      : {}),
    ...(typeof payload.email_verified === "boolean"
      ? { email_verified: payload.email_verified }
      : {})
  };
}

export async function createSessionFromTokenResponse(
  document: OidcDiscoveryDocument,
  config: AuthConfig,
  tokens: TokenEndpointSuccess,
  expectedNonce: string
): Promise<OidcSessionPayload> {
  if (!tokens.id_token) {
    throw new AuthenticationRejectedError("id_token_invalid");
  }
  const user = await validateIdToken(document, config, tokens.id_token, expectedNonce);
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = typeof tokens.expires_in === "number" && tokens.expires_in > 0
    ? Math.min(tokens.expires_in, 900)
    : 900;
  return {
    user,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: now + expiresIn,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
    createdAt: now,
    lastActivityAt: now
  };
}

export async function beginLoginTransaction(
  config: AuthConfig,
  returnTo: string
): Promise<{
  authorizeUrl: string;
  transaction: {
    state: string;
    nonce: string;
    codeVerifier: string;
    returnTo: string;
    createdAt: number;
  };
}> {
  const document = await loadDiscovery(config);
  const state = generateState();
  const nonce = generateNonce();
  const { verifier, challenge } = await generatePkcePair();
  const authorizeUrl = buildAuthorizeUrl(document, config, {
    returnTo,
    state,
    nonce,
    codeChallenge: challenge
  });
  return {
    authorizeUrl,
    transaction: {
      state,
      nonce,
      codeVerifier: verifier,
      returnTo,
      createdAt: Math.floor(Date.now() / 1000)
    }
  };
}
