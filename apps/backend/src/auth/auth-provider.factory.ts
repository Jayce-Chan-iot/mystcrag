import { isIP } from "node:net";

import { OidcAccessTokenVerifier } from "./oidc-access-token-verifier.js";
import type { AccessTokenVerifier } from "./auth-provider.js";
import { OidcDiscoverySource, type OidcDiscoveryTransport } from "./oidc-discovery.js";
import { JwksKeySource, type JwksTransport } from "./jwks-key-source.js";
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
const DEFAULT_AUTHING_HOST_SUFFIXES = [".authing.cn"];

function looksLikeIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateOrReservedHostname(hostname: string): boolean {
  const bare = (hostname.endsWith(".") ? hostname.slice(0, -1) : hostname).toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost")) return true;
  if (bare.endsWith(".local") || bare.endsWith(".internal")) return true;
  if (looksLikeIpv4(bare)) {
    const a = Number(bare.split(".")[0]);
    const b = Number(bare.split(".")[1]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  if (bare.includes(":")) return true;
  return false;
}

const ALLOWLIST_HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Strict MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST parser (parity with frontend AuthConfig).
 * Entries are additive bare DNS hostnames with at least one dot. Rejects scheme/path/
 * port/wildcard/credentials/IP/loopback/.local/.internal/single-label TLD values.
 * Empty comma tokens are skipped on both sides.
 */
export function parseIssuerHostAllowlist(environment: AuthEnvironment): string[] {
  const raw = environment.MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST?.trim();
  if (!raw) return [];
  const hosts: string[] = [];
  for (const entry of raw.split(",")) {
    const host = entry.trim().toLowerCase();
    if (host.length === 0) continue;
    if (
      host.includes("://") ||
      host.includes("/") ||
      host.includes(":") ||
      host.includes("@") ||
      host.includes("*") ||
      host.includes("..") ||
      isPrivateOrReservedHostname(host) ||
      looksLikeIpv4(host)
    ) {
      throw new Error(
        "MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST entries must be bare multi-label DNS hostnames without scheme/path/port/wildcard/credentials/IP"
      );
    }
    if (!ALLOWLIST_HOSTNAME_PATTERN.test(host)) {
      throw new Error(
        `MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST entry is not a valid hostname: ${host}`
      );
    }
    hosts.push(host);
  }
  return hosts;
}

/**
 * Allowlist is additive to the default *.authing.cn trust.
 * A non-empty custom allowlist must not drop default Authing trust.
 */
function isTrustedAuthingHost(hostname: string, allowlist: readonly string[]): boolean {
  if (isPrivateOrReservedHostname(hostname)) return false;
  const lower = hostname.toLowerCase();
  if (DEFAULT_AUTHING_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }
  return allowlist.some((entry) => lower === entry || lower.endsWith(`.${entry}`));
}

function requireCanonicalOidcIssuer(environment: AuthEnvironment): string {
  const raw = requireConfiguration(environment, "MYSTCRAG_AUTH_ISSUER");
  // The configured issuer is the exact JWT `iss` authority. Never rewrite slashes.

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
  if (!isTrustedAuthingHost(bareHostname, parseIssuerHostAllowlist(environment))) {
    throw invalidIssuer(
      "the issuer host must be a trusted Authing domain (*.authing.cn) or listed in MYSTCRAG_AUTH_ISSUER_HOST_ALLOWLIST"
    );
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
  return raw;
}

/**
 * Builds a discovery-backed OIDC verifier. JWKS URI comes from the discovery
 * document (`jwks_uri`); the factory never concatenates an Auth0-style
 * `{issuer}.well-known/jwks.json` path as the sole authority.
 */
export type OidcVerifierSeam = {
  readonly discoveryTransport?: OidcDiscoveryTransport;
  readonly jwksTransport?: JwksTransport;
};

function createOidcVerifier(
  environment: AuthEnvironment,
  seam?: OidcVerifierSeam
): AccessTokenVerifier {
  const issuer = requireCanonicalOidcIssuer(environment);
  const audience = requireConfiguration(environment, "MYSTCRAG_AUTH_AUDIENCE");
  const discovery = new OidcDiscoverySource({
    issuer,
    hostAllowlist: parseIssuerHostAllowlist(environment),
    ...(seam?.discoveryTransport ? { transport: seam.discoveryTransport } : {})
  });
  let keySource: JwksKeySource | null = null;
  return new OidcAccessTokenVerifier({
    issuer,
    audience,
    keySource: {
      async getJwks(kid?: string) {
        if (keySource === null) {
          const jwksUri = await discovery.getJwksUri();
          keySource = new JwksKeySource({
            url: jwksUri,
            ...(seam?.jwksTransport ? { transport: seam.jwksTransport } : {})
          });
        }
        return keySource.getJwks(kid);
      }
    }
  });
}

export function createAccessTokenVerifierFromEnvironment(
  environment: AuthEnvironment = process.env,
  seam?: OidcVerifierSeam
): AccessTokenVerifier {
  const providerName = environment.MYSTCRAG_AUTH_PROVIDER?.trim();
  if (!providerName) {
    throw new Error("Authentication provider is not configured.");
  }
  if (providerName === "authing") {
    return createOidcVerifier(environment, seam);
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
