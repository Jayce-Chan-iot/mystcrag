/**
 * Control-plane client for the synthetic OIDC provider.
 *
 * The provider runs in-process inside the Playwright launcher; specs (workers) steer
 * it through the token-protected HTTP admin plane. This is the ONLY way tests touch
 * provider state — the OIDC surface itself is always exercised through the real
 * frontend/backend code paths.
 */

import { stackState, requireSecret } from "./run-state";

export type SyntheticUser = {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
};

async function adminFetch(pathName: string, body?: unknown, method: "POST" | "GET" = "POST"): Promise<unknown> {
  const state = await stackState();
  const token = requireSecret("AUTH006_ADMIN_TOKEN");
  const response = await fetch(`${state.urls.providerAdmin}${pathName}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.status !== 204 && response.status !== 200) {
    throw new Error(`Provider admin ${pathName} failed with ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** Selects the identity the provider will authenticate on the NEXT /authorize request. */
export function setNextUser(user: SyntheticUser): Promise<unknown> {
  return adminFetch("/admin/next-user", user);
}

/**
 * Simulates provider failures. Modes: off | all | authorize | token | jwks | discovery.
 * "token" answers 500 on the token endpoint (outage that must NOT clear sessions).
 */
export function setProviderOutage(mode: "off" | "all" | "authorize" | "token" | "jwks" | "discovery"): Promise<unknown> {
  return adminFetch("/admin/outage", { mode });
}

/** Rotates the RS256 signing key; previously issued access tokens keep the old kid. */
export function rotateProviderKey(): Promise<unknown> {
  return adminFetch("/admin/rotate-key");
}

/** Marks refresh tokens as revoked (next refresh gets invalid_grant). */
export function revokeRefreshTokens(sub?: string): Promise<unknown> {
  return adminFetch("/admin/revoke-refresh-tokens", sub === undefined ? {} : { sub });
}

export function resetProvider(): Promise<unknown> {
  return adminFetch("/admin/reset");
}
