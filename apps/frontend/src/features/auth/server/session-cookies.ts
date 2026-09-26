/**
 * Cookie cleanup helpers for the Authing OIDC BFF session/transaction cookies.
 * Deletion attributes mirror creation attributes (Path=/, SameSite=Lax, HttpOnly,
 * Secure when origin is HTTPS, host-only).
 */

import type { NextRequest } from "next/server";
import { getSessionCookieName, isSecureCookie } from "./oidc-server";
import type { AuthConfig } from "../model/auth-config";

const TRANSACTION_COOKIE_PREFIX = "__txn_";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentChunkPattern(sessionName: string): RegExp {
  return new RegExp(`^${escapeRegExp(sessionName)}__\\d+$`);
}

/**
 * Collects the names of OIDC session cookies present on the request.
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
    } else if (includeTransactions && cookie.name.startsWith(TRANSACTION_COOKIE_PREFIX)) {
      names.add(cookie.name);
    }
  }

  return Array.from(names);
}

export function hasSessionCookie(request: NextRequest, config: AuthConfig): boolean {
  const sessionName = getSessionCookieName(config);
  const chunkPattern = currentChunkPattern(sessionName);
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name === sessionName || chunkPattern.test(cookie.name)) {
      return true;
    }
  }
  return false;
}

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
