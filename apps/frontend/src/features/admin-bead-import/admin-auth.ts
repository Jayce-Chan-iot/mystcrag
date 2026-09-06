import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bead import console access control. This boundary is deliberately separate
 * from the knowledge console: its own environment key, its own cookie name and
 * its own path scope, so a session minted for one console can never authorize
 * the other. The admin key never leaves the server — the browser proves
 * knowledge of it once, then holds only an irreversible, domain-separated
 * digest. Every page, server action and proxy call re-verifies that digest
 * against the currently configured key, so rotating the key invalidates all
 * outstanding sessions.
 *
 * This module is intentionally free of Next runtime imports so the whole
 * boundary stays unit testable with an injected cookie store.
 */

export const ASSET_ADMIN_COOKIE_NAME = "mystcrag_asset_admin";
export const ASSET_ADMIN_COOKIE_PATH = "/admin/bead-import";
export const ASSET_ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
/** Mirrors the Backend minimum so a short key fails closed on both sides. */
export const MIN_ASSET_ADMIN_KEY_BYTES = 16;

/** Binds the session digest to this console only; never a bare hash of the key. */
const SESSION_TOKEN_CONTEXT = "mystcrag:bead-import-admin-session:v1";

export type AssetAdminEnv = Readonly<Record<string, string | undefined>>;

export type AssetAdminCookieOptions = {
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none";
  secure: boolean;
  path: string;
  maxAge: number;
};

export type AssetAdminCookieStore = {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options: AssetAdminCookieOptions): void;
  delete(name: string): void;
};

export function resolveAssetAdminKey(env: AssetAdminEnv = process.env): string | null {
  // A configured-but-too-short preferred key is a deployment error: fail closed
  // rather than quietly authorizing with the fallback.
  const key = env.MYSTCRAG_ASSET_ADMIN_KEY ?? env.ASSET_ADMIN_API_KEY;
  if (typeof key !== "string" || Buffer.byteLength(key, "utf8") < MIN_ASSET_ADMIN_KEY_BYTES) {
    return null;
  }
  return key;
}

export function isAssetAdminConfigured(env: AssetAdminEnv = process.env): boolean {
  return resolveAssetAdminKey(env) !== null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Timing-safe compare over fixed-length digests; never reveals key length. */
export function verifyAssetAdminKey(candidate: string, env: AssetAdminEnv = process.env): boolean {
  const key = resolveAssetAdminKey(env);
  if (key === null || Buffer.byteLength(candidate, "utf8") < MIN_ASSET_ADMIN_KEY_BYTES) {
    return false;
  }
  return timingSafeEqual(digest(candidate), digest(key));
}

export function assetAdminSessionToken(env: AssetAdminEnv = process.env): string | null {
  const key = resolveAssetAdminKey(env);
  return key === null ? null : digest(`${SESSION_TOKEN_CONTEXT}\n${key}`).toString("hex");
}

export function assetAdminCookieOptions(env: AssetAdminEnv = process.env): AssetAdminCookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: ASSET_ADMIN_COOKIE_PATH,
    maxAge: ASSET_ADMIN_SESSION_MAX_AGE_SECONDS
  };
}

export function readAssetAdminSessionToken(store: AssetAdminCookieStore): string | null {
  return store.get(ASSET_ADMIN_COOKIE_NAME)?.value ?? null;
}

export function isAssetAdminAuthenticated(store: AssetAdminCookieStore, env: AssetAdminEnv = process.env): boolean {
  const token = assetAdminSessionToken(env);
  const presented = readAssetAdminSessionToken(store);
  if (token === null || presented === null) {
    return false;
  }
  const expected = Buffer.from(token, "utf8");
  const actual = Buffer.from(presented, "utf8");
  if (actual.byteLength !== expected.byteLength) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function createAssetAdminSession(store: AssetAdminCookieStore, env: AssetAdminEnv = process.env): void {
  const token = assetAdminSessionToken(env);
  if (token === null) {
    throw new Error("The bead import admin console is not configured on this deployment.");
  }
  store.set(ASSET_ADMIN_COOKIE_NAME, token, assetAdminCookieOptions(env));
}

export function destroyAssetAdminSession(store: AssetAdminCookieStore): void {
  store.delete(ASSET_ADMIN_COOKIE_NAME);
}
