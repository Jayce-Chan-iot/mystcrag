import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  isAssetAdminAuthenticated,
  isAssetAdminConfigured,
  type AssetAdminCookieOptions,
  type AssetAdminCookieStore,
  type AssetAdminEnv
} from "./admin-auth";
import { requireAssetAdminAccess } from "./page-guard";

/**
 * The only module that binds the Next request context (cookies + redirect) to
 * the pure auth boundary, so pages, server actions and the proxy route all
 * re-verify the very same cookie on every request.
 */
export async function assetAdminCookieStore(): Promise<AssetAdminCookieStore> {
  const store = await cookies();
  return {
    get(name) {
      const cookie = store.get(name);
      return cookie === undefined ? undefined : { name: cookie.name, value: cookie.value };
    },
    set(name: string, value: string, options: AssetAdminCookieOptions) {
      store.set(name, value, options);
    },
    delete(name: string) {
      store.delete(name);
    }
  };
}

export async function isBeadImportConsoleConfigured(env: AssetAdminEnv = process.env): Promise<boolean> {
  return isAssetAdminConfigured(env);
}

export async function isBeadImportConsoleAuthenticated(env: AssetAdminEnv = process.env): Promise<boolean> {
  if (!isAssetAdminConfigured(env)) {
    return false;
  }
  return isAssetAdminAuthenticated(await assetAdminCookieStore(), env);
}

/** Page-level guard: unconfigured or unauthenticated visitors are redirected. */
export async function requireBeadImportConsoleAccess(env: AssetAdminEnv = process.env): Promise<void> {
  requireAssetAdminAccess({ store: await assetAdminCookieStore(), env, redirect });
}
