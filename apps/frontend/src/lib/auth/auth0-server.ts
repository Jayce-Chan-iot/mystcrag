/**
 * Auth0 Next.js SDK wrapper with explicit MYSTCRAG_* configuration.
 *
 * Contract: reads only MYSTCRAG_* variables, passes them explicitly to SDK options,
 * and does not rely on implicit AUTH0_* or APP_BASE_URL aliases.
 * Initializes the SDK with authenticated-encrypted, HttpOnly, host-only Cookie Session
 * with rolling: true, inactivityDuration: 28800, absoluteDuration: 604800.
 */

import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { resolveAuthConfig, type AuthConfig } from "./auth-config";

let auth0Client: Auth0Client | null = null;
let cachedConfig: AuthConfig | null = null;

function isProductionLike(): boolean {
  const nodeEnv: string = process.env.NODE_ENV ?? "development";
  return nodeEnv === "production" || nodeEnv === "staging";
}

function getCookieName(): string {
  return isProductionLike() ? "__Host-mystcrag_session" : "mystcrag_session";
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
        name: getCookieName(),
        sameSite: "lax",
        path: "/"
        // Domain intentionally omitted for host-only cookie
        // Secure is auto-detected from appBaseUrl protocol by SDK
        // HttpOnly is always true (SDK default, not exposed)
      }
    },
    
    // Disable access token endpoint (browser should never receive tokens)
    enableAccessTokenEndpoint: false,

    // Route configuration:
    // - callback: real path, handled by proxy.ts → middleware delegation
    // - login/logout: dummy paths (our route handlers at /auth/login, /auth/logout use startInteractiveLogin)
    // - profile/accessToken/backChannelLogout: disabled (not exposed to browser)
    routes: {
      login: "/auth/__sdk_login",
      callback: "/auth/callback",
      logout: "/auth/__sdk_logout",
      profile: "/auth/__sdk_profile",
      accessToken: "/auth/__sdk_access_token",
      backChannelLogout: "/auth/__sdk_bcl"
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

export function projectSessionState(session: SessionData | null | undefined): SessionState {
  if (!session) {
    return { authenticated: false };
  }

  // Build user object using spread to avoid readonly assignment issues
  const user: SessionUser = {
    ...(session.user.name?.trim() ? { displayName: session.user.name.trim() } : {}),
    ...(session.user.email?.trim() ? { email: session.user.email.trim() } : {}),
    ...(typeof session.user.email_verified === "boolean" ? { emailVerified: session.user.email_verified } : {})
  };

  // Calculate expiry timestamps from session internal data
  const now = Math.floor(Date.now() / 1000);
  const createdAt = session.internal.createdAt;
  const idleExpiresAt = new Date((now + 28800) * 1000).toISOString();
  const absoluteExpiresAt = new Date((createdAt + 604800) * 1000).toISOString();

  return {
    authenticated: true,
    user,
    idleExpiresAt,
    absoluteExpiresAt
  };
}
