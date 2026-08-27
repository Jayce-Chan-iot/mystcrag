/**
 * Session cookie cryptography with EXACT production parity.
 *
 * The AUTH-006 suite must simulate idle-expired and absolute-expired sessions
 * without touching production code. The Auth0 Next.js SDK stores the session as a
 * JWE (dir + A256GCM, key = HKDF-SHA256(session secret, info "JWE CEK")) whose `exp`
 * claim is the effective session expiry, and whose payload carries
 * `internal.createdAt` (the absolute-expiry anchor). Reusing the SDK's own
 * encrypt/decrypt — loaded by absolute path from the pinned 4.27.0 install —
 * guarantees byte-level compatibility instead of a reimplementation.
 *
 * Nothing here reads or writes production files: it only transforms cookie values
 * the test already legitimately holds.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { requireSecret } from "./run-state";

const REPO_ROOT = path.resolve(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "..", "..");
const SDK_COOKIES_PATH = path.join(
  REPO_ROOT,
  "apps",
  "frontend",
  "node_modules",
  "@auth0",
  "nextjs-auth0",
  "dist",
  "server",
  "cookies.js"
);

export const SESSION_COOKIE_NAME = "mystcrag_session";

type SdkCookies = {
  encrypt(payload: unknown, secret: string, expiration: number): Promise<string>;
  decrypt(cookieValue: string, secret: string): Promise<{
    payload: SdkSessionPayload;
    protectedHeader: Record<string, unknown>;
  } | null>;
};

let cached: SdkCookies | null = null;

function sdkCookies(): SdkCookies {
  if (cached) return cached;
  const require = createRequire(path.join(REPO_ROOT, "package.json"));
  cached = require(SDK_COOKIES_PATH) as SdkCookies;
  return cached;
}

export type SdkSessionPayload = {
  user: {
    sub?: string;
    name?: string;
    email?: string;
    email_verified?: boolean;
    [key: string]: unknown;
  };
  tokenSet: {
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    scope?: string;
    expiresAt?: number;
    [key: string]: unknown;
  };
  internal: {
    sid: string;
    createdAt: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function sessionSecret(): string {
  return requireSecret("AUTH006_SESSION_SECRET");
}

/** Decrypts a session cookie value into the SDK session payload (null when invalid). */
export async function decryptSessionCookie(cookieValue: string): Promise<SdkSessionPayload | null> {
  const result = await sdkCookies().decrypt(cookieValue, sessionSecret());
  return result ? result.payload : null;
}

export type ForgeOptions = {
  /** Overrides internal.createdAt (seconds since epoch) — the absolute-expiry anchor. */
  createdAt?: number;
  /** JWE `exp` (seconds since epoch). Defaults to now + 1h (a decryptable cookie). */
  expiresAt?: number;
  /**
   * Replaces tokenSet.accessToken. Used to hand the BFF a session the SDK happily
   * decrypts while the Backend observes an unusable token (proves the Backend-401
   * session-clearing path without touching production code).
   */
  accessToken?: string;
  /** Overrides tokenSet.expiresAt so the SDK does (not) attempt a refresh. */
  tokenExpiresAt?: number;
};

/**
 * Re-encrypts a session payload with controlled expiry anchors. Used to prove the
 * SDK/BFF rolling behaviour against idle and absolute expiry WITHOUT waiting real
 * hours: the forged cookie is byte-identical in format to a genuine one.
 */
export async function forgeSessionCookie(cookieValue: string, options: ForgeOptions): Promise<string> {
  const payload = await decryptSessionCookie(cookieValue);
  if (!payload) {
    throw new Error("Cannot forge: the captured session cookie did not decrypt");
  }
  const modified: SdkSessionPayload = {
    ...payload,
    internal: {
      ...payload.internal,
      ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt })
    },
    tokenSet: {
      ...payload.tokenSet,
      ...(options.accessToken === undefined ? {} : { accessToken: options.accessToken }),
      ...(options.tokenExpiresAt === undefined ? {} : { expiresAt: options.tokenExpiresAt })
    }
  };
  const expiresAt = options.expiresAt ?? Math.floor(Date.now() / 1000) + 3600;
  return sdkCookies().encrypt(modified, sessionSecret(), expiresAt);
}
