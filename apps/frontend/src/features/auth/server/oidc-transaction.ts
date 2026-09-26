/**
 * Single-use encrypted login transaction cookie.
 * Binds state + nonce + PKCE verifier + exact callback + validated returnTo.
 */

import type { NextRequest } from "next/server";
import type { AuthConfig } from "../model/auth-config";
import { decryptJsonPayload, encryptJsonPayload } from "./oidc-session-crypto";
import { isSecureCookie } from "./oidc-session-store";

const TRANSACTION_COOKIE_PREFIX = "__txn_";
const TRANSACTION_TTL_SECONDS = 600;

export type LoginTransactionPayload = {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly createdAt: number;
};

export function transactionCookieName(state: string): string {
  const safeState = state.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return `${TRANSACTION_COOKIE_PREFIX}${safeState}`;
}

function transactionAttributes(config: AuthConfig, maxAgeSeconds: number): string {
  const parts = [`Max-Age=${maxAgeSeconds}`, "Path=/", "SameSite=Lax", "HttpOnly"];
  if (isSecureCookie(config)) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export async function buildTransactionSetCookie(
  payload: LoginTransactionPayload,
  config: AuthConfig
): Promise<string> {
  const compact = await encryptJsonPayload(payload, config.authSessionSecret, "transaction");
  const remaining = Math.max(
    1,
    TRANSACTION_TTL_SECONDS - (Math.floor(Date.now() / 1000) - payload.createdAt)
  );
  return `${transactionCookieName(payload.state)}=${compact}; ${transactionAttributes(config, remaining)}`;
}

export async function readTransaction(
  request: NextRequest,
  config: AuthConfig,
  state: string
): Promise<LoginTransactionPayload | null> {
  const name = transactionCookieName(state);
  const compact = request.cookies.get(name)?.value;
  if (!compact) return null;
  const payload = await decryptJsonPayload<LoginTransactionPayload>(
    compact,
    config.authSessionSecret,
    "transaction"
  );
  if (!payload) return null;
  if (payload.state !== state) return null;
  const age = Math.floor(Date.now() / 1000) - payload.createdAt;
  if (age < 0 || age > TRANSACTION_TTL_SECONDS) return null;
  if (
    typeof payload.nonce !== "string" ||
    typeof payload.codeVerifier !== "string" ||
    typeof payload.returnTo !== "string"
  ) {
    return null;
  }
  return payload;
}

export function buildTransactionClearCookie(
  request: NextRequest,
  config: AuthConfig,
  state?: string
): string[] {
  const names = new Set<string>();
  if (state) {
    names.add(transactionCookieName(state));
  }
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith(TRANSACTION_COOKIE_PREFIX)) {
      names.add(cookie.name);
    }
  }
  const attrs = transactionAttributes(config, 0);
  return Array.from(names).map((name) => `${name}=; ${attrs}`);
}
