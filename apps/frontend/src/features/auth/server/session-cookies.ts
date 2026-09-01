/**
 * Cookie cleanup helpers aligned with Auth0 Next.js SDK 4.27.0 real behavior.
 *
 * The SDK stores the session as a main cookie plus `{name}__{index}` chunks when it
 * exceeds ~3500 bytes, and pending login transactions as `__txn_{state}` cookies. In
 * addition it reads LEGACY cookies from v3 (`appSession` main cookie and `appSession.N`
 * legacy chunks — see `LEGACY_COOKIE_NAME` in `dist/server/session/normalize-session.js`
 * and `LEGACY_CHUNK_INDEX_REGEX` in `dist/server/cookies.js`). Legacy chunks use the
 * fixed name `appSession.N`, NOT `{currentSessionName}.N`. Deletion must mirror creation
 * attributes (Path=/, SameSite=Lax, HttpOnly, Secure, host-only) or the browser will not
 * remove the cookie.
 *
 * Rather than guessing a fixed set of cookie names, these helpers inspect the cookies that
 * actually exist on the request and clear exactly those. Unrelated cookies are never
 * touched.
 */

import type { NextRequest } from "next/server";
import { getSessionCookieName, isSecureCookie } from "./auth0-server";
import type { AuthConfig } from "../model/auth-config";

const TRANSACTION_COOKIE_PREFIX = "__txn_";
// SDK 4.27.0 legacy (v3) session cookie name, exported as LEGACY_COOKIE_NAME.
const LEGACY_SESSION_NAME = "appSession";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentChunkPattern(sessionName: string): RegExp {
  return new RegExp(`^${escapeRegExp(sessionName)}__\\d+$`);
}

// Legacy chunk format is `appSession.{index}` (LEGACY_CHUNK_INDEX_REGEX = /\.(\d+)$/).
const LEGACY_CHUNK_PATTERN = /^appSession\.\d+$/;

function isLegacySessionCookie(name: string): boolean {
  return name === LEGACY_SESSION_NAME || LEGACY_CHUNK_PATTERN.test(name);
}

/**
 * Collects the names of SDK-managed cookies present on the request.
 *
 * - The current session main cookie (always, so a stale value is cleared reliably).
 * - Current-format chunks `{name}__{index}`.
 * - SDK legacy `appSession` and legacy chunks `appSession.N` when present.
 * - When `includeTransactions` is true, every `__txn_*` transaction cookie.
 */
export function collectSdkCookieNames(
  request: NextRequest,
  config: AuthConfig,
  includeTransactions: boolean
): string[] {
  const sessionName = getSessionCookieName(config);
  const chunkPattern = currentChunkPattern(sessionName);

  const names = new Set<string>();
  names.add(sessionName);

  for (const cookie of request.cookies.getAll()) {
    if (chunkPattern.test(cookie.name)) {
      names.add(cookie.name);
    } else if (isLegacySessionCookie(cookie.name)) {
      names.add(cookie.name);
    } else if (includeTransactions && cookie.name.startsWith(TRANSACTION_COOKIE_PREFIX)) {
      names.add(cookie.name);
    }
  }

  return Array.from(names);
}

/**
 * Returns true when the request carries the session main cookie, any current chunk, or
 * any SDK legacy session cookie. Used to distinguish "no session" from "present but
 * expired/malformed session cookie", because the SDK returns null for both and does not
 * clear the cookie itself.
 */
export function hasSessionCookie(request: NextRequest, config: AuthConfig): boolean {
  const sessionName = getSessionCookieName(config);
  const chunkPattern = currentChunkPattern(sessionName);
  for (const cookie of request.cookies.getAll()) {
    if (
      cookie.name === sessionName ||
      chunkPattern.test(cookie.name) ||
      isLegacySessionCookie(cookie.name)
    ) {
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
  return collectSdkCookieNames(request, config, includeTransactions).map(
    (name) => `${name}=; ${buildClearAttributes(config)}`
  );
}

function buildClearAttributes(config: AuthConfig): string {
  const secure = isSecureCookie(config);
  const attributes = ["Max-Age=0", "Path=/", "SameSite=Lax", "HttpOnly"];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

/**
 * Builds Set-Cookie header strings that clear ONLY the `__txn_*` transaction cookies
 * actually present on the request. Session cookies are never touched — a failed login
 * attempt must not invalidate an existing session.
 */
export function buildClearTransactionCookieHeaders(
  request: NextRequest,
  config: AuthConfig
): string[] {
  const suffix = buildClearAttributes(config);
  return request.cookies
    .getAll()
    .filter((cookie) => cookie.name.startsWith(TRANSACTION_COOKIE_PREFIX))
    .map((cookie) => `${cookie.name}=; ${suffix}`);
}
