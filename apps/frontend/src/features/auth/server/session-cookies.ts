/**
 * Cookie cleanup helpers aligned with Auth0 Next.js SDK 4.27.0 real behavior.
 *
 * The SDK stores the session as a main cookie plus `__{index}` chunks when it exceeds
 * ~3500 bytes, and pending login transactions as `__txn_{state}` cookies. Deletion must
 * mirror creation attributes (Path=/, SameSite=Lax, HttpOnly, Secure, host-only) or the
 * browser will not remove the cookie.
 *
 * Rather than guessing a fixed set of cookie names, these helpers inspect the cookies that
 * actually exist on the request and clear exactly those.
 */

import type { NextRequest } from "next/server";
import { getSessionCookieName, isSecureCookie } from "./auth0-server";
import type { AuthConfig } from "../model/auth-config";

const TRANSACTION_COOKIE_PREFIX = "__txn_";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collects the names of SDK-managed cookies present on the request.
 *
 * - The main session cookie.
 * - Current-format chunks `{name}__{index}` and legacy-format chunks `{name}.{index}`.
 * - When `includeTransactions` is true, every `__txn_*` transaction cookie.
 */
export function collectSdkCookieNames(
  request: NextRequest,
  config: AuthConfig,
  includeTransactions: boolean
): string[] {
  const sessionName = getSessionCookieName(config);
  const chunkPattern = new RegExp(`^${escapeRegExp(sessionName)}(__|\\.)\\d+$`);

  const names = new Set<string>();
  names.add(sessionName);

  for (const cookie of request.cookies.getAll()) {
    if (chunkPattern.test(cookie.name)) {
      names.add(cookie.name);
    } else if (includeTransactions && cookie.name.startsWith(TRANSACTION_COOKIE_PREFIX)) {
      names.add(cookie.name);
    }
  }

  return Array.from(names);
}

/**
 * Returns true when the request carries the session main cookie or any of its chunks.
 * Used to distinguish "no session" from "present but expired/malformed session cookie",
 * because the SDK returns null for both and does not clear the cookie itself.
 */
export function hasSessionCookie(request: NextRequest, config: AuthConfig): boolean {
  const sessionName = getSessionCookieName(config);
  const chunkPattern = new RegExp(`^${escapeRegExp(sessionName)}(__|\\.)\\d+$`);
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name === sessionName || chunkPattern.test(cookie.name)) {
      return true;
    }
  }
  return false;
}

/**
 * Builds Set-Cookie header strings that clear the collected SDK cookies. Deletion
 * attributes mirror creation attributes so the browser removes them reliably.
 */
export function buildClearCookieHeaders(
  request: NextRequest,
  config: AuthConfig,
  includeTransactions: boolean
): string[] {
  const secure = isSecureCookie(config);
  const attributes = ["Max-Age=0", "Path=/", "SameSite=Lax", "HttpOnly"];
  if (secure) {
    attributes.push("Secure");
  }
  const suffix = attributes.join("; ");

  return collectSdkCookieNames(request, config, includeTransactions).map(
    (name) => `${name}=; ${suffix}`
  );
}
