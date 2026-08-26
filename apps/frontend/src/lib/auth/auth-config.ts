/**
 * Validates and resolves MYSTCRAG_* authentication configuration.
 *
 * Contract: all variables are server-only and must not use NEXT_PUBLIC_.
 * Production/staging: fail closed if any required variable is missing or invalid.
 * Development/test: loopback HTTP and signed-test are permitted with explicit opt-in.
 */

export type AuthConfig = {
  readonly appOrigin: string;
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

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.host &&
      !url.pathname.includes("@")
    );
  } catch {
    return false;
  }
}

function isValidHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.host &&
      !url.pathname.includes("@") &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
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
  const backendOrigin = (env.MYSTCRAG_BACKEND_ORIGIN ?? env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
  const enableSignedTestAuth = env.MYSTCRAG_ENABLE_SIGNED_TEST_AUTH === "true";

  const nodeEnv: string = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production" || nodeEnv === "staging";

  // Validate appOrigin
  if (!appOrigin) {
    errors.push("MYSTCRAG_APP_ORIGIN is required");
  } else if (!isValidHttpOrigin(appOrigin)) {
    errors.push("MYSTCRAG_APP_ORIGIN must be an absolute origin without path/query/fragment");
  } else if (isProduction && isLoopbackOrigin(appOrigin)) {
    errors.push("MYSTCRAG_APP_ORIGIN cannot be loopback in production/staging");
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
  } else if (authProvider === "auth0") {
    try {
      const url = new URL(authIssuer);
      if (url.protocol !== "https:" || !url.host || url.pathname.includes("@")) {
        errors.push("MYSTCRAG_AUTH_ISSUER must be a valid HTTPS URL for auth0 provider");
      }
    } catch {
      errors.push("MYSTCRAG_AUTH_ISSUER must be a valid HTTPS URL for auth0 provider");
    }
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

  // Validate authCallbackUrl
  if (!authCallbackUrl) {
    errors.push("MYSTCRAG_AUTH_CALLBACK_URL is required");
  } else {
    const isLoopback = isLoopbackOrigin(authCallbackUrl);
    const isValidUrl = isValidHttpUrl(authCallbackUrl);
    
    if (!isValidUrl) {
      errors.push("MYSTCRAG_AUTH_CALLBACK_URL must be a valid URL");
    } else if (isProduction && isLoopback) {
      errors.push("MYSTCRAG_AUTH_CALLBACK_URL cannot be loopback in production/staging");
    }
  }

  // Validate authLogoutUrl
  if (!authLogoutUrl) {
    errors.push("MYSTCRAG_AUTH_LOGOUT_URL is required");
  } else {
    const isLoopback = isLoopbackOrigin(authLogoutUrl);
    const isValidUrl = isValidHttpUrl(authLogoutUrl);
    
    if (!isValidUrl) {
      errors.push("MYSTCRAG_AUTH_LOGOUT_URL must be a valid URL");
    } else if (isProduction && isLoopback) {
      errors.push("MYSTCRAG_AUTH_LOGOUT_URL cannot be loopback in production/staging");
    }
  }

  // Validate authSessionSecret
  if (!authSessionSecret) {
    errors.push("MYSTCRAG_AUTH_SESSION_SECRET is required");
  } else if (!HEX_64_PATTERN.test(authSessionSecret)) {
    errors.push("MYSTCRAG_AUTH_SESSION_SECRET must be exactly 64 hexadecimal characters (32 random bytes)");
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
