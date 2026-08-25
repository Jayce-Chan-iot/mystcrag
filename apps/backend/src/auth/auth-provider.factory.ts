import { isIP } from "node:net";

import { Auth0AccessTokenVerifier } from "./auth0-access-token-verifier.js";
import type { AccessTokenVerifier } from "./auth-provider.js";
import { JwksKeySource } from "./jwks-key-source.js";
import { SignedTestTokenAuthProvider } from "./signed-test-auth-provider.js";

export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function requireConfiguration(environment: AuthEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Authentication configuration ${name} is required.`);
  return value;
}

function isIpv4Loopback(host: string): boolean {
  return isIP(host) === 4 && host.split(".")[0] === "127";
}

function isIpv6Loopback(host: string): boolean {
  if (isIP(host) !== 6) return false;
  const lower = host.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("::ffff:")) {
    const tail = lower.slice("::ffff:".length);
    if (isIP(tail) === 4) return isIpv4Loopback(tail);
    const groups = tail.split(":");
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0]!, 16);
      const low = Number.parseInt(groups[1]!, 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return ((high << 16) | low) >>> 24 === 127;
      }
    }
  }
  return false;
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "localhost.") return true;
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return isIpv4Loopback(bare) || isIpv6Loopback(bare);
}

function requireCanonicalAuth0Issuer(environment: AuthEnvironment): string {
  const raw = requireConfiguration(environment, "MYSTCRAG_AUTH_ISSUER");
  const invalid = (detail: string): Error =>
    new Error(
      `MYSTCRAG_AUTH_ISSUER must be the exact canonical HTTPS issuer URL (for example https://tenant.auth0.com/): ${detail}.`
    );

  if (!/^https:\/\/[^\s]+\/$/.test(raw)) {
    throw invalid("it must be an HTTPS URL with a trailing slash and no whitespace");
  }
  let issuer: URL;
  try {
    issuer = new URL(raw);
  } catch {
    throw invalid("it must be a parseable URL");
  }
  if (issuer.protocol !== "https:") {
    throw invalid("only the https scheme is allowed");
  }
  if (issuer.hostname.length === 0) {
    throw invalid("a hostname is required");
  }
  if (isLoopbackHost(issuer.hostname)) {
    throw invalid("loopback hosts are not accepted as Auth0 issuers");
  }
  if (issuer.username !== "" || issuer.password !== "") {
    throw invalid("credentials in the issuer URL are not allowed");
  }
  if (issuer.search !== "") {
    throw invalid("query strings are not allowed");
  }
  if (issuer.hash !== "") {
    throw invalid("fragments are not allowed");
  }
  if (issuer.pathname !== "/") {
    throw invalid("paths are not allowed");
  }
  return raw;
}

function createAuth0Verifier(environment: AuthEnvironment): AccessTokenVerifier {
  const issuer = requireCanonicalAuth0Issuer(environment);
  const audience = requireConfiguration(environment, "MYSTCRAG_AUTH_AUDIENCE");
  const jwksUrl = `${issuer}.well-known/jwks.json`;
  return new Auth0AccessTokenVerifier({
    issuer,
    audience,
    keySource: new JwksKeySource({ url: jwksUrl })
  });
}

export function createAccessTokenVerifierFromEnvironment(
  environment: AuthEnvironment = process.env
): AccessTokenVerifier {
  const providerName = environment.MYSTCRAG_AUTH_PROVIDER?.trim();
  if (!providerName) {
    throw new Error("Authentication provider is not configured.");
  }
  if (providerName === "auth0") {
    return createAuth0Verifier(environment);
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
