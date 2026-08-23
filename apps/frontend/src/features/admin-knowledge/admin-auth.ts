import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Knowledge Console access control (task book Track B security): the admin
 * key lives only in server env, the browser proves knowledge of it once via
 * the login form, and the resulting httpOnly cookie never exposes the key to
 * client JS. Every console page and server action re-verifies the cookie
 * against the configured key before touching the Admin API.
 */

const COOKIE_NAME = "mystcrag_knowledge_admin";
/** Mirrors the Backend minimum so a short key fails closed on both sides. */
const MIN_KEY_LENGTH = 16;
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export function resolveKnowledgeAdminKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.MYSTCRAG_KNOWLEDGE_ADMIN_KEY ?? env.KNOWLEDGE_ADMIN_API_KEY;
  return typeof key === "string" && key.length >= MIN_KEY_LENGTH ? key : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function isConsoleConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return resolveKnowledgeAdminKey(env) !== null;
}

/** Timing-safe compare on fixed-length digests; never reveals key length. */
export function verifyAdminKey(candidate: string, env: Record<string, string | undefined> = process.env): boolean {
  const key = resolveKnowledgeAdminKey(env);
  if (key === null || candidate.length < MIN_KEY_LENGTH) {
    return false;
  }
  return timingSafeEqual(digest(candidate), digest(key));
}

function sessionTokenFor(key: string): string {
  return digest(key).toString("hex");
}

function isValidSessionToken(token: string, key: string): boolean {
  const expected = Buffer.from(sessionTokenFor(key), "hex");
  if (token.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(token), expected);
}

export async function isAdminAuthenticated(
  env: Record<string, string | undefined> = process.env
): Promise<boolean> {
  const key = resolveKnowledgeAdminKey(env);
  if (key === null) {
    return false;
  }
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return token !== undefined && isValidSessionToken(token, key);
}

export async function createAdminSession(env: Record<string, string | undefined> = process.env): Promise<void> {
  const key = resolveKnowledgeAdminKey(env);
  if (key === null) {
    throw new Error("The knowledge console is not configured on this deployment.");
  }
  const store = await cookies();
  store.set(COOKIE_NAME, sessionTokenFor(key), {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    path: "/admin/knowledge",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
