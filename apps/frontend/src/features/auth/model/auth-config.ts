/**
 * Validates and resolves MYSTCRAG_* authentication configuration.
 *
 * Contract:
 * - All variables are server-only and must not use NEXT_PUBLIC_.
 * - No implicit AUTH0_* / APP_BASE_URL fallbacks.
 * - Production/staging: fail closed if any required variable is missing or invalid.
 * - Development/test: loopback HTTP and signed-test are permitted with explicit opt-in.
 */

export type AuthEnvironment = "production" | "staging" | "development" | "test";

export type AuthConfig = {
  readonly appOrigin: string;
  /**
   * Reliable environment classification resolved once from NODE_ENV. Cookie NAME is
   * derived exclusively from this field (never from the URL protocol), while the
   * cookie Secure flag is derived exclusively from the app origin protocol.
   */
  readonly environment: AuthEnvironment;
  readonly authProvider: "authing" | "signed-test";
  readonly authIssuer: string;
  readonly authAudience: string;
  readonly authClientId: string;
  readonly authClientSecret: string;
  readonly authCallbackUrl: string;
  readonly authLogoutUrl: string;
  readonly authSessionSecret: string;
  readonly backendOrigin: string;
  readonly enableSignedTestAuth: boolean;
  /**
   * Server-only desktop development identity (see spec 2026-09-12). Reachable only
   * when the full fail-closed matrix below holds; never projected to browser state.
   */
  readonly desktopAutoAuth: boolean;
  readonly desktopAccessToken: string;
};

export type AuthConfigError = {
  readonly code: "INVALID_CONFIG";
  readonly message: string;
  readonly fields: readonly string[];
};

const HEX_64_PATTERN = /^[0-9a-f]{64}$/i;
const WILDCARD_PATTERN = /\*/;
const IP_LITERAL_PATTERN = /^\[.*\]$|^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isValidHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.host &&
      !url.username &&
      !url.password &&
      !url.pathname.includes("@") &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function hasCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.host) &&
      !url.pathname.includes("@") && url.pathname === "/" &&
      !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * Validates an Authing-compatible OIDC issuer URL.
 * HTTPS DNS host only. Path may be `/` or `/oidc` (trailing slash optional).
 * No query, fragment, credentials, wildcard, or IP literals.
 */
function isValidAuthIssuer(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (!url.host) return false;
    if (url.username || url.password) return false;
    if (url.search) return false;
    if (url.hash) return false;
    if (WILDCARD_PATTERN.test(url.host)) return false;
    if (IP_LITERAL_PATTERN.test(url.hostname)) return false;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return false;
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (path !== "/" && path !== "/oidc") return false;
    return true;
  } catch {
    return false;
  }
}

// Issuer is stored exactly as configured — never mutate trailing slashes.

// Use Record<string, string | undefined> to accept any env-like object
// without the strict NODE_ENV union type from NodeJS.ProcessEnv.
type EnvLike = Record<string, string | undefined>;

export function resolveAuthConfig(env: EnvLike = process.env as EnvLike): AuthConfig {
  const errors: string[] = [];

  const appOrigin = env.MYSTCRAG_APP_ORIGIN?.trim() ?? "";
  const authProvider = env.MYSTCRAG_AUTH_PROVIDER?.trim() ?? "";
  const authIssuer = env.MYSTCRAG_AUTH_ISSUER?.trim() ?? "";
  const authAudience = env.MYSTCRAG_AUTH_AUDIENCE?.trim() ?? "";
  const authClientId = env.MYSTCRAG_AUTH_CLIENT_ID?.trim() ?? "";
  const authClientSecret = env.MYSTCRAG_AUTH_CLIENT_SECRET?.trim() ?? "";
  const authCallbackUrl = env.MYSTCRAG_AUTH_CALLBACK_URL?.trim() ?? "";
  const authLogoutUrl = env.MYSTCRAG_AUTH_LOGOUT_URL?.trim() ?? "";
  const authSessionSecret = env.MYSTCRAG_AUTH_SESSION_SECRET?.trim() ?? "";
  const backendOrigin = env.MYSTCRAG_BACKEND_ORIGIN?.replace(/\/$/, "") ?? "";
  const enableSignedTestAuth = env.MYSTCRAG_ENABLE_SIGNED_TEST_AUTH === "true";
  const desktopAutoAuth = env.MYSTCRAG_DESKTOP_AUTO_AUTH === "true";
  const desktopAccessToken = env.MYSTCRAG_DESKTOP_ACCESS_TOKEN?.trim() ?? "";

  const nodeEnv: string = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production" || nodeEnv === "staging";
  const environment: AuthEnvironment =
    nodeEnv === "production" ? "production"
    : nodeEnv === "staging" ? "staging"
    : nodeEnv === "test" ? "test"
    : "development";

  // Validate appOrigin
  if (!appOrigin) {
    errors.push("MYSTCRAG_APP_ORIGIN is required");
  } else if (!isValidHttpOrigin(appOrigin)) {
    errors.push("MYSTCRAG_APP_ORIGIN must be an absolute origin without path/query/fragment/credentials");
  } else if (isProduction && !isHttpsOrigin(appOrigin)) {
    errors.push("MYSTCRAG_APP_ORIGIN must be HTTPS in production/staging");
  } else if (isProduction && isLoopbackOrigin(appOrigin)) {
    errors.push("MYSTCRAG_APP_ORIGIN cannot be loopback in production/staging");
  } else if (!isProduction && !isHttpsOrigin(appOrigin) && !isLoopbackOrigin(appOrigin)) {
    errors.push("MYSTCRAG_APP_ORIGIN HTTP is only allowed for loopback in development/test");
  }

  // Validate authProvider
  if (!authProvider) {
    errors.push("MYSTCRAG_AUTH_PROVIDER is required");
  } else if (authProvider === "auth0") {
    errors.push("MYSTCRAG_AUTH_PROVIDER='auth0' was removed; use 'authing' for production OIDC");
  } else if (authProvider !== "authing" && authProvider !== "signed-test") {
    errors.push("MYSTCRAG_AUTH_PROVIDER must be 'authing' or 'signed-test'");
  } else if (authProvider === "signed-test" && isProduction) {
    errors.push("MYSTCRAG_AUTH_PROVIDER='signed-test' is not allowed in production/staging");
  } else if (authProvider === "signed-test" && !enableSignedTestAuth) {
    errors.push("MYSTCRAG_AUTH_PROVIDER='signed-test' requires MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true");
  }

  // Validate authIssuer
  if (!authIssuer) {
    errors.push("MYSTCRAG_AUTH_ISSUER is required");
  } else if (authProvider === "authing" && !isValidAuthIssuer(authIssuer)) {
    errors.push("MYSTCRAG_AUTH_ISSUER must be HTTPS OIDC issuer with path '/' or '/oidc', no query/fragment/credentials/wildcard/IP/loopback");
  }

  // Validate authAudience
  if (!authAudience) {
    errors.push("MYSTCRAG_AUTH_AUDIENCE is required");
  }

  // Validate authClientId and authClientSecret for authing
  if (authProvider === "authing") {
    if (!authClientId) {
      errors.push("MYSTCRAG_AUTH_CLIENT_ID is required for authing provider");
    }
    if (!authClientSecret) {
      errors.push("MYSTCRAG_AUTH_CLIENT_SECRET is required for authing provider");
    }
  }

  // Validate authCallbackUrl — must exactly equal ${appOrigin}/auth/callback
  if (!authCallbackUrl) {
    errors.push("MYSTCRAG_AUTH_CALLBACK_URL is required");
  } else if (appOrigin && authCallbackUrl !== `${appOrigin}/auth/callback`) {
    errors.push("MYSTCRAG_AUTH_CALLBACK_URL must exactly equal MYSTCRAG_APP_ORIGIN + '/auth/callback'");
  }

  // Validate authLogoutUrl — must be same-origin approved post-logout URL without credentials
  if (!authLogoutUrl) {
    errors.push("MYSTCRAG_AUTH_LOGOUT_URL is required");
  } else if (hasCredentials(authLogoutUrl)) {
    errors.push("MYSTCRAG_AUTH_LOGOUT_URL must not contain username/password credentials");
  } else if (appOrigin) {
    try {
      const logoutUrl = new URL(authLogoutUrl);
      const appUrl = new URL(appOrigin);
      if (logoutUrl.origin !== appUrl.origin) {
        errors.push("MYSTCRAG_AUTH_LOGOUT_URL must be same-origin as MYSTCRAG_APP_ORIGIN");
      }
    } catch {
      errors.push("MYSTCRAG_AUTH_LOGOUT_URL must be a valid URL");
    }
  }

  // Validate authSessionSecret
  if (!authSessionSecret) {
    errors.push("MYSTCRAG_AUTH_SESSION_SECRET is required");
  } else if (!HEX_64_PATTERN.test(authSessionSecret)) {
    errors.push("MYSTCRAG_AUTH_SESSION_SECRET must be exactly 64 hexadecimal characters (32 random bytes)");
  }

  // Validate backendOrigin — must be explicitly configured, no fallbacks
  if (!backendOrigin) {
    errors.push("MYSTCRAG_BACKEND_ORIGIN is required");
  } else if (!isValidHttpOrigin(backendOrigin)) {
    errors.push("MYSTCRAG_BACKEND_ORIGIN must be a valid absolute origin without credentials");
  } else if (isProduction && !isHttpsOrigin(backendOrigin)) {
    errors.push("MYSTCRAG_BACKEND_ORIGIN must be HTTPS in production/staging");
  } else if (isProduction && isLoopbackOrigin(backendOrigin)) {
    errors.push("MYSTCRAG_BACKEND_ORIGIN cannot be loopback in production/staging");
  } else if (!isProduction && !isHttpsOrigin(backendOrigin) && !isLoopbackOrigin(backendOrigin)) {
    errors.push("MYSTCRAG_BACKEND_ORIGIN HTTP is only allowed for loopback in development/test");
  }

  // Desktop auto-auth is a fail-closed, development-only convenience identity. It is
  // never a second production session or a fixed-user fallback: every condition must
  // hold or startup rejects the configuration (never a silent downgrade).
  if (desktopAutoAuth) {
    // The desktop convenience identity must only ever face an EXACT `development`
    // env: check the raw env.NODE_ENV (never the derived `environment` fallback,
    // which folds missing/empty/unknown values into development). Any other value —
    // missing, empty, test, staging, production or unexpected — rejects startup.
    if (env.NODE_ENV !== "development") {
      errors.push("MYSTCRAG_DESKTOP_AUTO_AUTH requires NODE_ENV=development");
    }
    if (authProvider !== "signed-test") {
      errors.push("MYSTCRAG_DESKTOP_AUTO_AUTH requires MYSTCRAG_AUTH_PROVIDER='signed-test'");
    } else if (!enableSignedTestAuth) {
      errors.push("MYSTCRAG_DESKTOP_AUTO_AUTH requires MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true");
    }
    if (appOrigin && !isLoopbackOrigin(appOrigin)) {
      errors.push("MYSTCRAG_DESKTOP_AUTO_AUTH requires loopback MYSTCRAG_APP_ORIGIN");
    }
    if (backendOrigin && !isLoopbackOrigin(backendOrigin)) {
      errors.push("MYSTCRAG_DESKTOP_AUTO_AUTH requires loopback MYSTCRAG_BACKEND_ORIGIN");
    }
    if (!desktopAccessToken) {
      errors.push("MYSTCRAG_DESKTOP_ACCESS_TOKEN is required when MYSTCRAG_DESKTOP_AUTO_AUTH=true");
    }
  }

  if (errors.length > 0) {
    const error: AuthConfigError = {
      code: "INVALID_CONFIG",
      message: `Authentication configuration validation failed: ${errors.join("; ")}`,
      fields: errors
    };
    throw error;
  }

  return {
    appOrigin,
    environment,
    authProvider: authProvider as "authing" | "signed-test",
    authIssuer,
    authAudience,
    authClientId,
    authClientSecret,
    authCallbackUrl,
    authLogoutUrl,
    authSessionSecret,
    backendOrigin,
    enableSignedTestAuth,
    // The desktop Token is only surfaced when desktop mode is active; otherwise it is
    // dropped so no inactive-path consumer can ever hold it.
    desktopAutoAuth,
    desktopAccessToken: desktopAutoAuth ? desktopAccessToken : ""
  };
}
