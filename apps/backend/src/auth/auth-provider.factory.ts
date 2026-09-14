import { isIP } from "node:net";

import { OidcAccessTokenVerifier } from "./oidc-access-token-verifier.js";
import type { AccessTokenVerifier } from "./auth-provider.js";
import { OidcDiscoverySource } from "./oidc-discovery.js";
import { JwksKeySource } from "./jwks-key-source.js";
import { SignedTestTokenAuthProvider } from "./signed-test-auth-provider.js";

export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function requireConfiguration(environment: AuthEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Authentication configuration ${name} is required.`);
  return value;
}

function invalidIssuer(detail: string): Error {
  return new Error(
    `MYSTCRAG_AUTH_ISSUER must be the exact canonical HTTPS OIDC issuer URL (for example https://example.authing.cn/oidc): ${detail}.`
  );
}

/**
 * Validates an Authing-compatible OIDC issuer.
 * HTTPS DNS host only. Path may be `/` or `/oidc` (Authing user-pool OIDC base).
 * Trailing slash is optional. Query, fragment, credentials, wildcard, IP and
 * loopback hosts are rejected.
 */
function requireCanonicalOidcIssuer(environment: AuthEnvironment): string {
  const raw = requireConfiguration(environment, "MYSTCRAG_AUTH_ISSUER");

  if (!/^https:\/\/[^\s]+$/.test(raw)) {
    throw invalidIssuer("it must be an HTTPS URL with no whitespace");
  }
  let issuer: URL;
  try {
    issuer = new URL(raw);
  } catch {
    throw invalidIssuer("it must be a parseable URL");
  }
  if (issuer.protocol !== "https:") {
    throw invalidIssuer("only the https scheme is allowed");
  }
  if (issuer.hostname.length === 0) {
    throw invalidIssuer("a hostname is required");
  }
  if (issuer.hostname.includes("*")) {
    throw invalidIssuer("wildcard hostnames are not accepted as OIDC issuers");
  }
  const bareHostname =
    issuer.hostname.startsWith("[") && issuer.hostname.endsWith("]")
      ? issuer.hostname.slice(1, -1)
      : issuer.hostname;
  if (isIP(bareHostname) !== 0) {
    throw invalidIssuer("the issuer host must be a DNS hostname, not an IP literal");
  }
  if (bareHostname === "localhost" || bareHostname === "localhost.") {
    throw invalidIssuer("loopback hosts are not accepted as OIDC issuers");
  }
  if (issuer.username !== "" || issuer.password !== "") {
    throw invalidIssuer("credentials in the issuer URL are not allowed");
  }
  if (issuer.search !== "") {
    throw invalidIssuer("query strings are not allowed");
  }
  if (issuer.hash !== "") {
    throw invalidIssuer("fragments are not allowed");
  }
  const path = issuer.pathname.replace(/\/$/, "") || "/";
  if (path !== "/" && path !== "/oidc") {
    throw invalidIssuer("the only allowed issuer paths are '/' and '/oidc'");
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/**
 * Builds a discovery-backed OIDC verifier. JWKS URI comes from the discovery
 * document (`jwks_uri`); the factory never concatenates an Auth0-style
 * `{issuer}.well-known/jwks.json` path as the sole authority.
 */
function createOidcVerifier(environment: AuthEnvironment): AccessTokenVerifier {
  const issuer = requireCanonicalOidcIssuer(environment);
  const audience = requireConfiguration(environment, "MYSTCRAG_AUTH_AUDIENCE");
  const discovery = new OidcDiscoverySource({ issuer });
  let keySource: JwksKeySource | null = null;
  return new OidcAccessTokenVerifier({
    issuer,
    audience,
    keySource: {
      async getJwks(kid?: string) {
        if (keySource === null) {
          const jwksUri = await discovery.getJwksUri();
          keySource = new JwksKeySource({ url: jwksUri });
        }
        return keySource.getJwks(kid);
      }
    }
  });
}

export function createAccessTokenVerifierFromEnvironment(
  environment: AuthEnvironment = process.env
): AccessTokenVerifier {
  const providerName = environment.MYSTCRAG_AUTH_PROVIDER?.trim();
  if (!providerName) {
    throw new Error("Authentication provider is not configured.");
  }
  if (providerName === "authing") {
    return createOidcVerifier(environment);
  }
  if (providerName === "auth0") {
    throw new Error(
      "Authentication provider 'auth0' was removed. Set MYSTCRAG_AUTH_PROVIDER to 'authing' for production OIDC or 'signed-test' for local development."
    );
  }
  if (providerName !== "signed-test") {
    throw new Error(`Unsupported authentication provider: ${providerName}`);
  }

  const nodeEnvironment = environment.NODE_ENV;
  const permittedEnvironment = nodeEnvironment === "test" || nodeEnvironment === "development";
  if (!permittedEnvironment || environment.MYSTCRAG_ENABLE_SIGNED_TEST_AUTH !== "true") {
    throw new Error("Signed test authentication is disabled in this environment.");
  }

  return new SignedTestTokenAuthProvider({
    secret: requireConfiguration(environment, "MYSTCRAG_AUTH_SIGNING_SECRET"),
    issuer: requireConfiguration(environment, "MYSTCRAG_AUTH_ISSUER"),
    audience: requireConfiguration(environment, "MYSTCRAG_AUTH_AUDIENCE")
  });
}
