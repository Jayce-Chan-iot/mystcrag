import type { AssetAdminLoginMode } from "./admin-auth";
import { ASSET_ADMIN_LOGIN_PATH, ASSET_ADMIN_NOT_CONFIGURED_PATH, type ConsoleRedirect } from "./page-guard";

export const ASSET_ADMIN_CONSOLE_HOME = "/admin/bead-import";
export const ASSET_ADMIN_INVALID_KEY_PATH = `${ASSET_ADMIN_LOGIN_PATH}?error=invalid`;

export type AssetAdminLoginDeps = {
  configured: boolean;
  mode: AssetAdminLoginMode;
  verifyKey: (candidate: string) => boolean;
  verifyLocalCredentials: (username: string, password: string) => boolean;
  createSession: () => void;
  destroySession: () => void;
  redirect: ConsoleRedirect;
};

export type AssetAdminLogoutDeps = Pick<AssetAdminLoginDeps, "destroySession" | "redirect">;

function readSubmittedKey(formData: FormData): string | null {
  const value = formData.get("key");
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readSubmittedCredential(formData: FormData, name: "username" | "password"): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Login decision flow, kept free of Next runtime imports so the ordering is
 * provable: an unconfigured deployment is reported before any key is checked,
 * no session is minted unless verification succeeds, and the submitted key is
 * never reflected into a redirect target.
 */
export function runAssetAdminLogin(formData: FormData, deps: AssetAdminLoginDeps): never {
  if (!deps.configured) {
    deps.redirect(ASSET_ADMIN_NOT_CONFIGURED_PATH);
  }
  const valid = deps.mode === "LOCAL_CREDENTIALS"
    ? (() => {
        const username = readSubmittedCredential(formData, "username");
        const password = readSubmittedCredential(formData, "password");
        return username !== null && password !== null && deps.verifyLocalCredentials(username, password);
      })()
    : (() => {
        const key = readSubmittedKey(formData);
        return key !== null && deps.verifyKey(key);
      })();
  if (!valid) {
    deps.redirect(ASSET_ADMIN_INVALID_KEY_PATH);
  }
  deps.createSession();
  deps.redirect(ASSET_ADMIN_CONSOLE_HOME);
}

export function runAssetAdminLogout(deps: AssetAdminLogoutDeps): never {
  deps.destroySession();
  deps.redirect(ASSET_ADMIN_LOGIN_PATH);
}
