/**
 * Authenticated-encrypted cookie payload helpers (JWE Compact, A256GCM).
 * Key material is derived from MYSTCRAG_AUTH_SESSION_SECRET via HKDF-SHA256.
 * Browser never receives plaintext tokens; ciphertext only.
 */

import {
  CompactEncrypt,
  compactDecrypt
} from "jose";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const INFO_SESSION = TEXT_ENCODER.encode("mystcrag-oidc-session-v1");
const INFO_TRANSACTION = TEXT_ENCODER.encode("mystcrag-oidc-transaction-v1");

async function deriveKey(secretHex: string, info: Uint8Array): Promise<CryptoKey> {
  const secret = Buffer.from(secretHex, "hex");
  const keyMaterial = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: info as BufferSource },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJsonPayload(
  payload: unknown,
  sessionSecretHex: string,
  kind: "session" | "transaction"
): Promise<string> {
  const key = await deriveKey(sessionSecretHex, kind === "session" ? INFO_SESSION : INFO_TRANSACTION);
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(payload));
  return new CompactEncrypt(plaintext)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(key);
}

export async function decryptJsonPayload<T>(
  compact: string,
  sessionSecretHex: string,
  kind: "session" | "transaction"
): Promise<T | null> {
  try {
    const key = await deriveKey(sessionSecretHex, kind === "session" ? INFO_SESSION : INFO_TRANSACTION);
    const { plaintext } = await compactDecrypt(compact, key);
    const parsed: unknown = JSON.parse(TEXT_DECODER.decode(plaintext));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export function generateHighEntropyToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function generateState(): string {
  return generateHighEntropyToken(32);
}

export function generateNonce(): string {
  return generateHighEntropyToken(32);
}

export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateHighEntropyToken(32);
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  return { verifier, challenge };
}

export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(input));
  return Buffer.from(digest).toString("base64url");
}
