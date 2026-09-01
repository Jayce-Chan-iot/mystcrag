/**
 * Auth0 Next.js SDK wrapper with explicit MYSTCRAG_* configuration.
 *
 * Contract: reads only MYSTCRAG_* variables, passes them explicitly to SDK options,
 * and does not rely on implicit AUTH0_* or APP_BASE_URL aliases.
 * Initializes the SDK with authenticated-encrypted, HttpOnly, host-only Cookie Session
 * with rolling: true, inactivityDuration: 28800, absoluteDuration: 604800.
 *
 * Cookie Secure flag is derived from the verified app origin protocol (HTTPS → Secure,
 * in any environment) while the cookie NAME is derived from the resolved environment
 * classification (production/staging → `__Host-mystcrag_session`; development/test →
 * `mystcrag_session`). The two decisions are independent: a development HTTPS origin
 * uses `mystcrag_session; Secure`. Deletion attributes always mirror creation attributes.
 *
 * The `onCallback` hook returns a real 303 See Other on success and, on failure, a
 * sentinel response carrying the typed SDK error code in a private header so the
 * callback route can classify 401 (auth) vs 500 (infra) without trusting URL params.
 */

import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthConfig, type AuthConfig } from "../model/auth-config";

/**
 * Private response header used to carry the typed SDK callback error classification from
 * the `onCallback` hook to the callback route. Format: `{sdkCode}|{causeCode}` where
 * causeCode is the wrapped OAuth2 provider code (may be empty). The callback route
 * always strips it before the response leaves the server.
 */
export const CALLBACK_ERROR_HEADER = "x-mystcrag-callback-error";

let auth0Client: Auth0Client | null = null;
let cachedConfig: AuthConfig | null = null;

/**
 * Session/transaction cookies are Secure whenever the verified app origin is HTTPS.
 * Secure=false is only reachable for development/test loopback HTTP, which is the
 * only case config validation permits a non-HTTPS app origin.
 */
export function isSecureCookie(config: AuthConfig): boolean {
  try {
    return new URL(config.appOrigin).protocol === "https:";
  } catch {
    return true; // fail closed
  }
}

/**
 * Session cookie NAME, chosen by environment classification only — never by protocol.
 *
 * - production/staging → `__Host-mystcrag_session` (the `__Host-` prefix requires
 *   Secure + Path=/ + no Domain, all of which production/staging always satisfy).
 * - development/test → `mystcrag_session`, even when the dev origin happens to be
 *   HTTPS (in which case the cookie still carries the Secure flag).
 */
export function getSessionCookieName(config: AuthConfig): string {
  return config.environment === "production" || config.environment === "staging"
    ? "__Host-mystcrag_session"
    : "mystcrag_session";
}

export function getAuth0Client(): Auth0Client {
  if (auth0Client) {
    return auth0Client;
  }

  const config = resolveAuthConfig();
  cachedConfig = config;

  if (config.authProvider !== "auth0") {
    throw new Error("Auth0 SDK is only available when MYSTCRAG_AUTH_PROVIDER='auth0'");
  }

  // Extract domain from issuer (e.g., "https://mystcrag.auth0.com/" -> "mystcrag.auth0.com")
  const issuerUrl = new URL(config.authIssuer);
  const domain = issuerUrl.host;
  const secure = isSecureCookie(config);

  auth0Client = new Auth0Client({
    // Explicit configuration from MYSTCRAG_* variables
    domain,
    clientId: config.authClientId,
    clientSecret: config.authClientSecret,
    appBaseUrl: config.appOrigin,
    secret: config.authSessionSecret,

    // Authorization parameters — OIDC Authorization Code + PKCE S256
    authorizationParameters: {
      audience: config.authAudience,
      scope: "openid profile email",
      response_type: "code"
    },

    // Session configuration
    session: {
      rolling: true,
      inactivityDuration: 28800, // 8 hours in seconds
      absoluteDuration: 604800,  // 7 days in seconds
      cookie: {
        name: getSessionCookieName(config),
        sameSite: "lax",
        path: "/",
        secure
        // Domain intentionally omitted for host-only cookie
        // HttpOnly is always true (SDK default, not exposed in SessionCookieOptions)
      }
    },

    // Disable browser-reachable token/profile/connection endpoints entirely.
    enableAccessTokenEndpoint: false,
    enableConnectAccountEndpoint: false,

    /**
     * Callback hook:
     * - success → real 303 See Other to the validated same-origin returnTo.
     * - failure → sentinel response carrying the typed SDK error code so the route
     *   can classify it. The SDK still appends the transaction-cleanup Set-Cookie
     *   after this returns, so transaction material is cleared on every path.
     */
    onCallback: async (error, ctx) => {
      if (error) {
        const code = typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "callback_error";
        // Preserve the wrapped OAuth2 cause code (e.g. the provider code behind
        // authorization_error / authorization_code_grant_error) so the callback route
        // can classify 401 vs 500 without trusting URL parameters.
        const cause = (error as { cause?: { code?: unknown } })?.cause;
        const causeCode = typeof cause?.code === "string" ? cause.code : "";
        return new NextResponse(null, {
          status: 500,
          headers: { [CALLBACK_ERROR_HEADER]: `${code}|${causeCode}` }
        });
      }
      const appBaseUrl = ctx.appBaseUrl;
      if (!appBaseUrl) {
        throw new Error("appBaseUrl could not be resolved for the callback redirect.");
      }
      const target = new URL(ctx.returnTo || "/", appBaseUrl).toString();
      return new NextResponse(null, { status: 303, headers: { Location: target } });
    },

    // Route lockdown: callback is the only public SDK route. Every other SDK route is
    // pointed at an unreachable path; proxy.ts additionally fail-closes /auth/** with an
    // allowlist, so these are defense-in-depth only.
    routes: {
      login: "/auth/__sdk_login",
      callback: "/auth/callback",
      logout: "/auth/__sdk_logout",
      profile: "/auth/__sdk_profile",
      accessToken: "/auth/__sdk_access_token",
      backChannelLogout: "/auth/__sdk_bcl",
      connectAccount: "/auth/__sdk_connect",
      mfaAuthenticators: "/auth/__sdk_mfa_authenticators",
      mfaChallenge: "/auth/__sdk_mfa_challenge",
      mfaAssociate: "/auth/__sdk_mfa_associate",
      mfaVerify: "/auth/__sdk_mfa_verify",
      passwordlessStart: "/auth/__sdk_passwordless_start",
      passwordlessVerify: "/auth/__sdk_passwordless_verify",
      passwordlessDbOtpChallenge: "/auth/__sdk_passwordless_db_challenge",
      passwordlessDbGetToken: "/auth/__sdk_passwordless_db_token",
      passkeyRegister: "/auth/__sdk_passkey_register",
      passkeyChallenge: "/auth/__sdk_passkey_challenge",
      passkeyGetToken: "/auth/__sdk_passkey_token",
      passkeyEnrollmentChallenge: "/auth/__sdk_passkey_enroll_challenge",
      passkeyEnrollmentVerify: "/auth/__sdk_passkey_enroll_verify"
    }
  });

  return auth0Client;
}

export function getAuthConfig(): AuthConfig {
  if (!cachedConfig) {
    cachedConfig = resolveAuthConfig();
  }
  return cachedConfig;
}

/**
 * Triggers the SDK's real passive session rolling for a request by routing it through
 * the SDK middleware default case (the pathname matches no SDK route). The SDK then:
 *
 *   if (sessionStore.isRolling && await sessionStore.shouldRollSession(req)) {
 *     const { error, session } = await getSessionWithDomainCheck(req.cookies);
 *     if (!error && session) await sessionStore.set(req.cookies, res.cookies, session);
 *   }
 *
 * `sessionStore.set` rewrites the session cookie with
 * `maxAge = min(now + inactivityDuration, createdAt + absoluteDuration) - now`, so the
 * 8h idle rolling can never extend the 7d absolute expiry. Missing/invalid sessions are
 * not rolled (the SDK only writes when it decrypted a valid session).
 *
 * Returns the Set-Cookie header strings produced by the rolling write (possibly empty
 * when nothing needed rotation). Throws on SDK failure — callers MUST fail closed.
 */
export async function touchSession(request: NextRequest): Promise<string[]> {
  const response = await getAuth0Client().middleware(request);
  return response.headers.getSetCookie?.() ?? [];
}

/**
 * Extracts the Max-Age actually written by an SDK rolling Set-Cookie for the session
 * cookie (main name or `{name}__0` chunk). Used to make the projected idleExpiresAt
 * match the real cookie expiry instead of a fabricated now+8h. Returns null when the
 * rolling response carried no session cookie (e.g. nothing to roll).
 */
export function parseSessionCookieMaxAge(setCookies: readonly string[], sessionName: string): number | null {
  for (const setCookie of setCookies) {
    const namePart = setCookie.slice(0, setCookie.indexOf("="));
    if (namePart !== sessionName && !namePart.startsWith(`${sessionName}__`)) continue;
    const match = /;\s*Max-Age=(\d+)/i.exec(setCookie);
    if (match) return Number(match[1]);
  }
  return null;
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

/**
 * Projects internal SDK session to safe public session state.
 * Never exposes: issuer, subject/sub, audience, tokens, internal User.id,
 * session id, SDK raw claims/profile, or authorization details.
 *
 * `rollingMaxAge` (when provided) is the Max-Age actually written by the SDK rolling
 * response for this request; idleExpiresAt must equal that real cookie expiry. The
 * fallback mirrors the SDK's own `calculateMaxAge(createdAt)` formula:
 * `min(now + inactivityDuration, createdAt + absoluteDuration)`.
 */
export function projectSessionState(
  session: SessionData | null | undefined,
  rollingMaxAge?: number | null
): SessionState {
  if (!session) {
    return { authenticated: false };
  }

  // Build user object using spread to avoid readonly assignment issues
  const user: SessionUser = {
    ...(session.user.name?.trim() ? { displayName: session.user.name.trim() } : {}),
    ...(session.user.email?.trim() ? { email: session.user.email.trim() } : {}),
    ...(typeof session.user.email_verified === "boolean" ? { emailVerified: session.user.email_verified } : {})
  };

  // Calculate expiry timestamps from real session data
  const now = Math.floor(Date.now() / 1000);
  const createdAt = session.internal.createdAt;
  const absoluteExpiresAt = new Date((createdAt + 604800) * 1000).toISOString();

  // idleExpiresAt: prefer the Max-Age really written by the rolling response; otherwise
  // replicate the SDK formula (which itself caps at the absolute ceiling).
  const idleExpiry = typeof rollingMaxAge === "number"
    ? now + Math.min(rollingMaxAge, createdAt + 604800 - now)
    : Math.min(now + 28800, createdAt + 604800);
  const idleExpiresAt = new Date(idleExpiry * 1000).toISOString();

  return {
    authenticated: true,
    user,
    idleExpiresAt,
    absoluteExpiresAt
  };
}

/**
 * Generates a stable request ID for error envelopes.
 * Uses crypto.randomUUID when available, falls back to timestamp-based ID.
 */
export function generateRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
