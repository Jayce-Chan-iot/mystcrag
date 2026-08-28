/**
 * Time control for AUTH-006 specs.
 *
 * The synthetic provider issues very short-lived access tokens (default 12s) precisely
 * so that token-expiry, refresh, revocation and outage paths can be exercised in real
 * time instead of being mocked. These helpers read the SAME env knob the provider was
 * started with, so waits always match the actual lifetime.
 */

export function accessTokenLifetimeSeconds(): number {
  const raw = process.env.AUTH006_ACCESS_TOKEN_LIFETIME;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
}

/**
 * Waits until any access token issued before this call has certainly expired
 * (lifetime + 2s safety margin), forcing the BFF to refresh on the next request.
 */
export async function waitForAccessTokenExpiry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, accessTokenLifetimeSeconds() * 1000 + 2000));
}
