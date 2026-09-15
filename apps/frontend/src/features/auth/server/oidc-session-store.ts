/**
 * Encrypted Cookie Session store for the Authing OIDC BFF.
 *
 * Cookie rules (AUTH_SESSION_CONTRACT):
 * - HttpOnly, host-only, Path=/, SameSite=Lax
 * - production/staging name `__Host-mystcrag_session`; development/test `mystcrag_session`
 * - Secure when app origin is HTTPS
 * - idle 8h, absolute 7d; idle activity is inside the authenticated JWE payload
 * - Access/Refresh/ID tokens live only inside the server-encrypted payload
 *
 * Chunk protocol (explicit, bounded):
 * - Single cookie when compact JWE fits in CHUNK_SIZE.
 * - Otherwise `{name}__meta={count}` + `{name}__0`..`{name}__{count-1}`.
 * - Count is required, continuous, and bounded; missing/extra/forged counts reject.
 * - Writes clear leftover legal session cookie names that are no longer used.
 */

import type { NextRequest } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { decryptJsonPayload, encryptJsonPayload } from "./oidc-session-crypto";

export const SESSION_IDLE_SECONDS = 28_800;
export const SESSION_ABSOLUTE_SECONDS = 604_800;
const CHUNK_SIZE = 3_500;
const MAX_CHUNKS = 8;
const MAX_SESSION_BYTES = CHUNK_SIZE * MAX_CHUNKS;

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
  /** epoch seconds of latest accepted same-origin activity (authenticated idle base) */
  readonly lastActivityAt: number;
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
  return `${base}__${index}`;
}

function metaName(base: string): string {
  return `${base}__meta`;
}

function readCookieValue(request: NextRequest, name: string): string | undefined {
  return request.cookies.get(name)?.value;
}

function parseMetaCount(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^[1-9]\d{0,2}$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS) return null;
  return n;
}

function collectSessionCompact(request: NextRequest, sessionName: string): string | null {
  const metaCount = parseMetaCount(readCookieValue(request, metaName(sessionName)));
  if (metaCount !== null) {
    const parts: string[] = [];
    for (let index = 0; index < metaCount; index += 1) {
      const piece = readCookieValue(request, chunkName(sessionName, index));
      if (piece === undefined || piece.length === 0) return null;
      parts.push(piece);
    }
    // Reject unexpected extra numbered chunks that would indicate a forged/shrunk set.
    for (let index = metaCount; index < MAX_CHUNKS; index += 1) {
      if (readCookieValue(request, chunkName(sessionName, index)) !== undefined) {
        return null;
      }
    }
    const joined = parts.join("");
    if (joined.length === 0 || joined.length > MAX_SESSION_BYTES) return null;
    // Single-chunk must not use meta path.
    return joined;
  }

  const main = readCookieValue(request, sessionName);
  if (main === undefined || main.length === 0) return null;
  // If numbered chunks exist without valid meta, the set is inconsistent.
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    if (readCookieValue(request, chunkName(sessionName, index)) !== undefined) {
      return null;
    }
  }
  if (main.length > MAX_SESSION_BYTES) return null;
  return main;
}

export function hasSessionCookie(request: NextRequest, config: AuthConfig): boolean {
  const sessionName = getSessionCookieName(config);
  return (
    readCookieValue(request, sessionName) !== undefined ||
    readCookieValue(request, metaName(sessionName)) !== undefined
  );
}

export function absoluteExpiryEpochSeconds(session: OidcSessionPayload): number {
  return session.createdAt + SESSION_ABSOLUTE_SECONDS;
}

export function isSessionAbsolutelyExpired(session: OidcSessionPayload, nowEpochSeconds: number): boolean {
  return nowEpochSeconds >= absoluteExpiryEpochSeconds(session);
}

export function isSessionIdleExpired(session: OidcSessionPayload, nowEpochSeconds: number): boolean {
  if (typeof session.lastActivityAt !== "number") return true;
  return nowEpochSeconds - session.lastActivityAt >= SESSION_IDLE_SECONDS;
}

export async function readSession(
  request: NextRequest,
  config: AuthConfig
): Promise<OidcSessionPayload | null> {
  const compact = collectSessionCompact(request, getSessionCookieName(config));
  if (!compact) return null;
  const session = await decryptJsonPayload<OidcSessionPayload>(compact, config.authSessionSecret, "session");
  if (!session) return null;
  if (
    typeof session.createdAt !== "number" ||
    typeof session.lastActivityAt !== "number" ||
    typeof session.accessToken !== "string"
  ) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (isSessionAbsolutelyExpired(session, now) || isSessionIdleExpired(session, now)) {
    return null;
  }
  return session;
}

export type WrittenCookie = string;

function listExistingSessionCookieNames(request: NextRequest, sessionName: string): string[] {
  const names: string[] = [];
  const exact = new Set<string>([sessionName, metaName(sessionName)]);
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    exact.add(chunkName(sessionName, index));
  }
  for (const cookie of request.cookies.getAll()) {
    if (exact.has(cookie.name)) {
      names.push(cookie.name);
    }
  }
  return names;
}

export async function buildSessionSetCookies(
  session: OidcSessionPayload,
  config: AuthConfig,
  options: { idleSeconds?: number; request?: NextRequest } = {}
): Promise<WrittenCookie[]> {
  const now = Math.floor(Date.now() / 1000);
  const idleSeconds = Math.min(
    options.idleSeconds ?? SESSION_IDLE_SECONDS,
    Math.max(0, absoluteExpiryEpochSeconds(session) - now)
  );
  const compact = await encryptJsonPayload(session, config.authSessionSecret, "session");
  if (compact.length > MAX_SESSION_BYTES) {
    throw new Error("OIDC session payload exceeds the maximum cookie size");
  }

  const name = getSessionCookieName(config);
  const attrs = sessionCookieAttributes(config, idleSeconds);
  const written: WrittenCookie[] = [];
  const used = new Set<string>();

  if (compact.length <= CHUNK_SIZE) {
    written.push(`${name}=${compact}; ${attrs}`);
    used.add(name);
  } else {
    const count = Math.ceil(compact.length / CHUNK_SIZE);
    if (count > MAX_CHUNKS) {
      throw new Error("OIDC session requires too many cookie chunks");
    }
    written.push(`${metaName(name)}=${count}; ${attrs}`);
    used.add(metaName(name));
    for (let index = 0, offset = 0; index < count; index += 1, offset += CHUNK_SIZE) {
      const piece = compact.slice(offset, offset + CHUNK_SIZE);
      const cookieName = chunkName(name, index);
      written.push(`${cookieName}=${piece}; ${attrs}`);
      used.add(cookieName);
    }
  }

  if (options.request) {
    const clearAttrs = clearCookieAttributes(config);
    for (const existing of listExistingSessionCookieNames(options.request, name)) {
      if (!used.has(existing)) {
        written.push(`${existing}=; ${clearAttrs}`);
      }
    }
  }

  return written;
}

export function buildSessionClearCookies(request: NextRequest, config: AuthConfig): WrittenCookie[] {
  const sessionName = getSessionCookieName(config);
  const names = new Set<string>([sessionName, metaName(sessionName)]);
  for (const cookieName of listExistingSessionCookieNames(request, sessionName)) {
    names.add(cookieName);
  }
  const attrs = clearCookieAttributes(config);
  return Array.from(names).map((name) => `${name}=; ${attrs}`);
}

/**
 * Passive rolling: rewrite authenticated lastActivityAt and a fresh idle window.
 * Never extends absolute expiry.
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
  if (isSessionIdleExpired(session, nowEpochSeconds)) {
    return [];
  }
  const remainingAbsolute = absolute - nowEpochSeconds;
  const idle = Math.min(SESSION_IDLE_SECONDS, remainingAbsolute);
  const updated: OidcSessionPayload = { ...session, lastActivityAt: nowEpochSeconds };
  return buildSessionSetCookies(updated, config, { idleSeconds: idle, request });
}
