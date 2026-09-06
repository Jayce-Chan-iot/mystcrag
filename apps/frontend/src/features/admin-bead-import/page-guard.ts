import { isAssetAdminAuthenticated, isAssetAdminConfigured, type AssetAdminCookieStore, type AssetAdminEnv } from "./admin-auth";

export const ASSET_ADMIN_LOGIN_PATH = "/admin/bead-import/login";
export const ASSET_ADMIN_NOT_CONFIGURED_PATH = `${ASSET_ADMIN_LOGIN_PATH}?error=not-configured`;

export type ConsoleRedirect = (target: string) => never;

/**
 * Fail-closed gate for every bead import console page, server action and proxy
 * hop: an unconfigured deployment is reported as such, and a missing or stale
 * session is sent to the standalone login page. The redirect target carries no
 * key material and no hint of the configured value.
 */
export function assetAdminAccessTarget(authenticated: boolean, configured: boolean): string | null {
  if (!configured) {
    return ASSET_ADMIN_NOT_CONFIGURED_PATH;
  }
  return authenticated ? null : ASSET_ADMIN_LOGIN_PATH;
}

export function requireAssetAdminAccess(deps: {
  store: AssetAdminCookieStore;
  redirect: ConsoleRedirect;
  env?: AssetAdminEnv;
}): void {
  const env = deps.env ?? process.env;
  const configured = isAssetAdminConfigured(env);
  const authenticated = configured && isAssetAdminAuthenticated(deps.store, env);
  const target = assetAdminAccessTarget(authenticated, configured);
  if (target !== null) {
    deps.redirect(target);
  }
}
