/**
 * Encrypted Cookie Session store for the Authing OIDC BFF.
 *
 * Cookie rules (unchanged from AUTH_SESSION_CONTRACT):
 * - HttpOnly, host-only, Path=/, SameSite=Lax
 * - production/staging name `__Host-mystcrag_session`; development/test `mystcrag_session`
 * - Secure when app origin is HTTPS
 * - idle 8h, absolute 7d; rolling never extends absolute expiry
 * - Access/Refresh/ID tokens live only inside the server-encrypted payload
 */

import type { NextRequest } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { decryptJsonPayload, encryptJsonPayload } from "./oidc-session-crypto";

export const SESSION_IDLE_SECONDS = 28_800;
export const SESSION_ABSOLUTE_SECONDS = 604_800;
const COOKIE_CHUNK_LIMIT = 3_500;

export type OidcSessionUser = {
  readonly name?: string;
  readonly email?: string;
  readonly email_verified?: boolean;
};

export type OidcSessionPayload = {
  readonly user: OidcSessionUser;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: number;
  readonly refreshToken?: string;
  readonly idToken?: string;
  /** epoch seconds when the session was created (absolute expiry base) */
  readonly createdAt: number;
};

export function isSecureCookie(config: AuthConfig): boolean {
  try {
    return new URL(config.appOrigin).protocol === "https:";
  } catch {
    return true;
  }
}

export function getSessionCookieName(config: AuthConfig): string {
  return config.environment === "production" || config.environment === "staging"
    ? "__Host-mystcrag_session"
    : "mystcrag_session";
}

export function sessionCookieAttributes(config: AuthConfig, maxAgeSeconds: number): string {
  const parts = [
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "SameSite=Lax",
    "HttpOnly"
  ];
  if (isSecureCookie(config)) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearCookieAttributes(config: AuthConfig): string {
  return sessionCookieAttributes(config, 0);
}

function chunkName(base: string, index: number): string {
  return index === 0 ? base : `${base}__${index}`;
}

function readCookieValue(request: NextRequest, name: string): string | undefined {
  return request.cookies.get(name)?.value;
}

function collectSessionCompact(request: NextRequest, sessionName: string): string | null {
  const main = readCookieValue(request, sessionName);
  if (main === undefined) return null;
  if (!main.includes(".")) {
    // Single-chunk compact JWE (three base64url segments joined by '.')
    return main.length > 0 ? main : null;
  }
  // Prefer single-chunk when present and non-empty; otherwise reassemble chunks.
  if (main.length > 0 && main.split(".").length >= 5) {
    return main;
  }
  const parts: string[] = [];
  for (let index = 0; ; index += 1) {
    const value = readCookieValue(request, chunkName(sessionName, index));
    if (value === undefined) break;
    parts.push(value);
  }
  return parts.length > 0 ? parts.join("") : null;
}

export function hasSessionCookie(request: NextRequest, config: AuthConfig): boolean {
  const sessionName = getSessionCookieName(config);
  if (readCookieValue(request, sessionName) !== undefined) return true;
  return readCookieValue(request, `${sessionName}__1`) !== undefined;
}

export function absoluteExpiryEpochSeconds(session: OidcSessionPayload): number {
  return session.createdAt + SESSION_ABSOLUTE_SECONDS;
}

export function isSessionAbsolutelyExpired(session: OidcSessionPayload, nowEpochSeconds: number): boolean {
  return nowEpochSeconds >= absoluteExpiryEpochSeconds(session);
}

export async function readSession(
  request: NextRequest,
  config: AuthConfig
): Promise<OidcSessionPayload | null> {
  const compact = collectSessionCompact(request, getSessionCookieName(config));
  if (!compact) return null;
  const session = await decryptJsonPayload<OidcSessionPayload>(compact, config.authSessionSecret, "session");
  if (!session) return null;
  if (typeof session.createdAt !== "number" || typeof session.accessToken !== "string") {
    return null;
  }
  if (isSessionAbsolutelyExpired(session, Math.floor(Date.now() / 1000))) {
    return null;
  }
  return session;
}

export type WrittenCookie = string;

export function buildSessionSetCookies(
  session: OidcSessionPayload,
  config: AuthConfig,
  options: { idleSeconds?: number } = {}
): Promise<WrittenCookie[]> {
  const idleSeconds = Math.min(
    options.idleSeconds ?? SESSION_IDLE_SECONDS,
    Math.max(0, absoluteExpiryEpochSeconds(session) - Math.floor(Date.now() / 1000))
  );
  return encryptJsonPayload(session, config.authSessionSecret, "session").then((compact) => {
    const name = getSessionCookieName(config);
    const attrs = sessionCookieAttributes(config, idleSeconds);
    if (compact.length <= COOKIE_CHUNK_LIMIT) {
      return [`${name}=${compact}; ${attrs}`];
    }
    const chunks: string[] = [];
    for (let offset = 0, index = 0; offset < compact.length; offset += COOKIE_CHUNK_LIMIT, index += 1) {
      const piece = compact.slice(offset, offset + COOKIE_CHUNK_LIMIT);
      chunks.push(`${chunkName(name, index)}=${piece}; ${attrs}`);
    }
    return chunks;
  });
}

export function buildSessionClearCookies(request: NextRequest, config: AuthConfig): WrittenCookie[] {
  const sessionName = getSessionCookieName(config);
  const names = new Set<string>([sessionName]);
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name === sessionName || cookie.name.startsWith(`${sessionName}__`)) {
      names.add(cookie.name);
    }
  }
  const attrs = clearCookieAttributes(config);
  return Array.from(names).map((name) => `${name}=; ${attrs}`);
}

/**
 * Passive rolling: reissue the session cookie with a fresh idle window when the
 * current idle expiry is due. Never extends absolute expiry. Returns cookies only
 * when a write is needed.
 */
export async function rollSessionIfNeeded(
  request: NextRequest,
  session: OidcSessionPayload,
  config: AuthConfig,
  nowEpochSeconds = Math.floor(Date.now() / 1000)
): Promise<WrittenCookie[]> {
  const absolute = absoluteExpiryEpochSeconds(session);
  if (nowEpochSeconds >= absolute) {
    return [];
  }
  const remainingAbsolute = absolute - nowEpochSeconds;
  // Always reissue on accepted use so idle expiry tracks real activity, capped by absolute.
  const idle = Math.min(SESSION_IDLE_SECONDS, remainingAbsolute);
  return buildSessionSetCookies(session, config, { idleSeconds: idle });
}
