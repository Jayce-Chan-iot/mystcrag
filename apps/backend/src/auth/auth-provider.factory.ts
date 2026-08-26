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
  if (issuer.hostname.includes("*")) {
    throw invalid("wildcard hostnames are not accepted as Auth0 issuers");
  }
  const bareHostname =
    issuer.hostname.startsWith("[") && issuer.hostname.endsWith("]")
      ? issuer.hostname.slice(1, -1)
      : issuer.hostname;
  if (isIP(bareHostname) !== 0) {
    throw invalid("the issuer host must be a DNS hostname, not an IP literal");
  }
  if (bareHostname === "localhost" || bareHostname === "localhost.") {
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
