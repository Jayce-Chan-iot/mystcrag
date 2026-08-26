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
  readonly authProvider: "auth0" | "signed-test";
  readonly authIssuer: string;
  readonly authAudience: string;
  readonly authClientId: string;
  readonly authClientSecret: string;
  readonly authCallbackUrl: string;
  readonly authLogoutUrl: string;
  readonly authSessionSecret: string;
  readonly backendOrigin: string;
  readonly enableSignedTestAuth: boolean;
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
 * Validates an Auth0 issuer URL.
 * Must be canonical https://dns-host/ form with trailing slash.
 * No path, query, fragment, credentials, wildcard, or IP literals.
 */
function isValidAuthIssuer(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (!url.host) return false;
    if (url.username || url.password) return false;
    if (url.pathname !== "/") return false;
    if (url.search) return false;
    if (url.hash) return false;
    if (WILDCARD_PATTERN.test(url.host)) return false;
    if (IP_LITERAL_PATTERN.test(url.hostname)) return false;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return false;
    // Must end with trailing slash (canonical form)
    if (!value.endsWith("/")) return false;
    return true;
  } catch {
    return false;
  }
}

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
  } else if (authProvider !== "auth0" && authProvider !== "signed-test") {
    errors.push("MYSTCRAG_AUTH_PROVIDER must be 'auth0' or 'signed-test'");
  } else if (authProvider === "signed-test" && isProduction) {
    errors.push("MYSTCRAG_AUTH_PROVIDER='signed-test' is not allowed in production/staging");
  } else if (authProvider === "signed-test" && !enableSignedTestAuth) {
    errors.push("MYSTCRAG_AUTH_PROVIDER='signed-test' requires MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true");
  }

  // Validate authIssuer
  if (!authIssuer) {
    errors.push("MYSTCRAG_AUTH_ISSUER is required");
  } else if (authProvider === "auth0" && !isValidAuthIssuer(authIssuer)) {
    errors.push("MYSTCRAG_AUTH_ISSUER must be canonical https://dns-host/ with trailing slash, no path/query/fragment/credentials/wildcard/IP");
  }

  // Validate authAudience
  if (!authAudience) {
    errors.push("MYSTCRAG_AUTH_AUDIENCE is required");
  }

  // Validate authClientId and authClientSecret for auth0
  if (authProvider === "auth0") {
    if (!authClientId) {
      errors.push("MYSTCRAG_AUTH_CLIENT_ID is required for auth0 provider");
    }
    if (!authClientSecret) {
      errors.push("MYSTCRAG_AUTH_CLIENT_SECRET is required for auth0 provider");
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
    authProvider: authProvider as "auth0" | "signed-test",
    authIssuer,
    authAudience,
    authClientId,
    authClientSecret,
    authCallbackUrl,
    authLogoutUrl,
    authSessionSecret,
    backendOrigin,
    enableSignedTestAuth
  };
}
