"use server";

import { redirect } from "next/navigation";

import {
  createAssetAdminSession,
  destroyAssetAdminSession,
  isAssetAdminConfigured,
  verifyAssetAdminKey
} from "./admin-auth";
import { assetAdminCookieStore } from "./console-access";
import { runAssetAdminLogin, runAssetAdminLogout } from "./login-flow";

/**
 * Both actions resolve the request cookie store once and then delegate every
 * decision to the tested pure flow, so the server action cannot drift from the
 * verified ordering (unconfigured → invalid → mint session).
 */
export async function loginAction(formData: FormData): Promise<void> {
  const store = await assetAdminCookieStore();
  runAssetAdminLogin(formData, {
    configured: isAssetAdminConfigured(),
    verifyKey: (candidate) => verifyAssetAdminKey(candidate),
    createSession: () => createAssetAdminSession(store),
    destroySession: () => destroyAssetAdminSession(store),
    redirect
  });
}

export async function logoutAction(): Promise<void> {
  const store = await assetAdminCookieStore();
  runAssetAdminLogout({
    destroySession: () => destroyAssetAdminSession(store),
    redirect
  });
}
