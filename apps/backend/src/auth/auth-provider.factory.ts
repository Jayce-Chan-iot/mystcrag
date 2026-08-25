import { Auth0AccessTokenVerifier } from "./auth0-access-token-verifier.js";
import type { AuthProvider } from "./auth-provider.js";
import { JwksKeySource } from "./jwks-key-source.js";
import { SignedTestTokenAuthProvider } from "./signed-test-auth-provider.js";

export type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function requireConfiguration(environment: AuthEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Authentication configuration ${name} is required.`);
  return value;
}

function requireHttpsIssuer(environment: AuthEnvironment): string {
  const raw = requireConfiguration(environment, "MYSTCRAG_AUTH_ISSUER");
  let issuer: URL;
  try {
    issuer = new URL(raw);
  } catch {
    throw new Error(`MYSTCRAG_AUTH_ISSUER must be a parseable HTTPS URL: ${raw}`);
  }
  if (issuer.protocol !== "https:") {
    throw new Error(`MYSTCRAG_AUTH_ISSUER must use HTTPS: ${raw}`);
  }
  return issuer.toString();
}

function createAuth0Provider(environment: AuthEnvironment): AuthProvider {
  const issuer = requireHttpsIssuer(environment);
  const audience = requireConfiguration(environment, "MYSTCRAG_AUTH_AUDIENCE");
  const jwksUrl = new URL(".well-known/jwks.json", issuer).toString();
  return new Auth0AccessTokenVerifier({
    issuer,
    audience,
    keySource: new JwksKeySource({ url: jwksUrl })
  });
}

export function createAuthProviderFromEnvironment(
  environment: AuthEnvironment = process.env
): AuthProvider {
  const providerName = environment.MYSTCRAG_AUTH_PROVIDER?.trim();
  if (!providerName) {
    throw new Error("Authentication provider is not configured.");
  }
  if (providerName === "auth0") {
    return createAuth0Provider(environment);
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
