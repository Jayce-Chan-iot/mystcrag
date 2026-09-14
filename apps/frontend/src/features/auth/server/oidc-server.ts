/**
 * Authing OIDC BFF server facade (replaces Auth0 Next.js SDK wrapper).
 *
 * Reads only MYSTCRAG_* variables. Session cookies are authenticated-encrypted
 * JWE payloads; rolling never extends absolute expiry; tokens never leave the
 * server.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAuthConfig, type AuthConfig } from "../model/auth-config";
import {
  AuthenticationRejectedError,
  ProviderUnavailableError,
  classifyOidcFailure
} from "./oidc-errors";
import {
  beginLoginTransaction,
  buildEndSessionUrl,
  createSessionFromTokenResponse,
  exchangeAuthorizationCode,
  loadDiscovery,
  refreshAccessToken
} from "./oidc-client";
import {
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  buildSessionClearCookies,
  buildSessionSetCookies,
  getSessionCookieName,
  hasSessionCookie,
  isSecureCookie,
  readSession,
  rollSessionIfNeeded,
  type OidcSessionPayload,
  type OidcSessionUser
} from "./oidc-session-store";
import {
  buildTransactionClearCookie,
  buildTransactionSetCookie,
  readTransaction,
  type LoginTransactionPayload
} from "./oidc-transaction";

export { getSessionCookieName, isSecureCookie };

let cachedConfig: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (!cachedConfig) {
    cachedConfig = resolveAuthConfig();
  }
  return cachedConfig;
}

export function requireAuthingConfig(): AuthConfig {
  const config = getAuthConfig();
  if (config.authProvider !== "authing") {
    throw new Error("OIDC session runtime requires MYSTCRAG_AUTH_PROVIDER='authing'");
  }
  return config;
}

export function generateRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export type SessionUser = {
  displayName?: string;
  email?: string;
  emailVerified?: boolean;
};

export type SessionState = {
  readonly authenticated: boolean;
  readonly user?: SessionUser;
  readonly idleExpiresAt?: string;
  readonly absoluteExpiresAt?: string;
};

export function projectSessionState(
  session: OidcSessionPayload | null | undefined,
  rollingMaxAge?: number | null
): SessionState {
  if (!session) {
    return { authenticated: false };
  }
  const user: SessionUser = {
    ...(session.user.name?.trim() ? { displayName: session.user.name.trim() } : {}),
    ...(session.user.email?.trim() ? { email: session.user.email.trim() } : {}),
    ...(typeof session.user.email_verified === "boolean"
      ? { emailVerified: session.user.email_verified }
      : {})
  };
  const now = Math.floor(Date.now() / 1000);
  const absoluteExpiresAt = new Date((session.createdAt + SESSION_ABSOLUTE_SECONDS) * 1000).toISOString();
  const idleExpiry =
    typeof rollingMaxAge === "number"
      ? now + Math.min(rollingMaxAge, session.createdAt + SESSION_ABSOLUTE_SECONDS - now)
      : Math.min(now + SESSION_IDLE_SECONDS, session.createdAt + SESSION_ABSOLUTE_SECONDS);
  return {
    authenticated: true,
    user,
    idleExpiresAt: new Date(idleExpiry * 1000).toISOString(),
    absoluteExpiresAt
  };
}

export function parseSessionCookieMaxAge(
  setCookies: readonly string[],
  sessionName: string
): number | null {
  for (const setCookie of setCookies) {
    const namePart = setCookie.slice(0, setCookie.indexOf("="));
    if (namePart !== sessionName && !namePart.startsWith(`${sessionName}__`)) continue;
    const match = /;\s*Max-Age=(\d+)/i.exec(setCookie);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Starts interactive login: discovery + PKCE transaction cookie + 302 authorize.
 */
export async function startInteractiveLogin(options: {
  returnTo: string;
  request: NextRequest;
  config?: AuthConfig;
}): Promise<NextResponse> {
  const config = options.config ?? requireAuthingConfig();
  const { authorizeUrl, transaction } = await beginLoginTransaction(config, options.returnTo);
  const setCookie = await buildTransactionSetCookie(transaction, config);
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: authorizeUrl,
      "Set-Cookie": setCookie,
      "Cache-Control": "no-store",
      Pragma: "no-cache"
    }
  });
}

export type CallbackOutcome =
  | { kind: "success"; returnTo: string; setCookies: string[]; session: OidcSessionPayload }
  | { kind: "unauthorized"; setCookies: string[] }
  | { kind: "internal" };

/**
 * Completes the OIDC callback. Never trusts provider error details in responses.
 */
export async function completeOidcCallback(
  request: NextRequest,
  config: AuthConfig
): Promise<CallbackOutcome> {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code");
  const providerError = params.get("error");

  if (!state) {
    return { kind: "unauthorized", setCookies: buildTransactionClearCookie(request, config) };
  }

  const transaction = await readTransaction(request, config, state);
  // Always clear the consumed transaction cookie.
  const clearTxn = buildTransactionClearCookie(request, config, state);

  if (!transaction) {
    return { kind: "unauthorized", setCookies: clearTxn };
  }

  if (providerError) {
    const denial =
      providerError === "access_denied" ||
      providerError === "login_required" ||
      providerError === "interaction_required" ||
      providerError === "consent_required" ||
      providerError === "account_selection_required";
    if (denial) {
      return { kind: "unauthorized", setCookies: clearTxn };
    }
    return { kind: "internal" };
  }

  if (!code) {
    return { kind: "unauthorized", setCookies: clearTxn };
  }

  try {
    const document = await loadDiscovery(config);
    const tokens = await exchangeAuthorizationCode(document, config, {
      code,
      codeVerifier: transaction.codeVerifier
    });
    const session = await createSessionFromTokenResponse(
      document,
      config,
      tokens,
      transaction.nonce
    );
    const sessionCookies = await buildSessionSetCookies(session, config);
    return {
      kind: "success",
      returnTo: transaction.returnTo,
      setCookies: [...clearTxn, ...sessionCookies],
      session
    };
  } catch (error) {
    if (error instanceof AuthenticationRejectedError) {
      return { kind: "unauthorized", setCookies: clearTxn };
    }
    if (error instanceof ProviderUnavailableError) {
      return { kind: "internal" };
    }
    const kind = classifyOidcFailure(error);
    return kind === "unauthorized"
      ? { kind: "unauthorized", setCookies: clearTxn }
      : { kind: "internal" };
  }
}

/**
 * Reads the session and produces rolling Set-Cookie headers when due.
 */
export async function touchSession(request: NextRequest): Promise<string[]> {
  const config = requireAuthingConfig();
  const session = await readSession(request, config);
  if (!session) {
    return [];
  }
  return rollSessionIfNeeded(request, session, config);
}

export async function getSession(
  request: NextRequest
): Promise<OidcSessionPayload | null> {
  const config = requireAuthingConfig();
  return readSession(request, config);
}

/**
 * Resolves a short-lived Access Token for BFF forwarding. Refreshes with the
 * refresh_token grant when the stored token is near expiry. Throws typed errors
 * compatible with the existing BFF classifier.
 */
export async function getAccessToken(
  request: NextRequest
): Promise<{ token: string; setCookies: string[] }> {
  const config = requireAuthingConfig();
  const session = await readSession(request, config);
  if (!session) {
    const error = hasSessionCookie(request, config)
      ? Object.assign(new Error("Session expired"), { code: "session_expired" })
      : Object.assign(new Error("Missing session"), { code: "missing_session" });
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  // Refresh when fewer than 60s remain on the access token.
  if (session.accessTokenExpiresAt - now > 60) {
    return { token: session.accessToken, setCookies: [] };
  }

  if (!session.refreshToken) {
    throw Object.assign(new Error("Missing refresh token"), { code: "missing_refresh_token" });
  }

  try {
    const document = await loadDiscovery(config);
    const tokens = await refreshAccessToken(document, config, session.refreshToken);
    const expiresIn =
      typeof tokens.expires_in === "number" && tokens.expires_in > 0
        ? Math.min(tokens.expires_in, 900)
        : 900;
    const updated: OidcSessionPayload = {
      ...session,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: now + expiresIn,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {})
    };
    const setCookies = await buildSessionSetCookies(updated, config);
    return { token: updated.accessToken, setCookies };
  } catch (error) {
    if (error instanceof AuthenticationRejectedError) {
      const causeCode = error.reason;
      throw Object.assign(new Error("Failed to refresh token"), {
        code: "failed_to_refresh_token",
        cause: { code: causeCode }
      });
    }
    throw Object.assign(new Error("Failed to refresh token"), {
      code: "failed_to_refresh_token",
      cause: { code: "server_error" }
    });
  }
}

export async function buildLogoutRedirect(config: AuthConfig): Promise<string> {
  const document = await loadDiscovery(config);
  return buildEndSessionUrl(document, config);
}

export function clearAllAuthCookies(request: NextRequest, config: AuthConfig): string[] {
  return [
    ...buildSessionClearCookies(request, config),
    ...buildTransactionClearCookie(request, config)
  ];
}

export type { OidcSessionPayload, OidcSessionUser, LoginTransactionPayload };
