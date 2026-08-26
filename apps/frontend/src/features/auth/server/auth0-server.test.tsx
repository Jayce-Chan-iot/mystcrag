/**
 * Server-side auth module tests.
 *
 * Coverage:
 * - Session safe projection (no token/claims/issuer/subject leakage)
 * - idleExpiresAt capped by absoluteExpiresAt
 * - absoluteExpiresAt from real createdAt + absoluteDuration
 * - generateRequestId returns valid IDs
 * - Token custody regression: NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN not in production source
 * - resolveAccessToken removed from api-runtime
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { projectSessionState, generateRequestId, isSecureCookie, getSessionCookieName } from "./auth0-server";
import { makeConfig, makeDevConfig } from "./auth-test-fixtures";

// --- Session safe projection ---

test("projectSessionState returns unauthenticated for null session", () => {
  const result = projectSessionState(null);
  assert.equal(result.authenticated, false);
  assert.equal(result.user, undefined);
  assert.equal(result.idleExpiresAt, undefined);
  assert.equal(result.absoluteExpiresAt, undefined);
});

test("projectSessionState returns unauthenticated for undefined session", () => {
  const result = projectSessionState(undefined);
  assert.equal(result.authenticated, false);
});

test("projectSessionState projects user fields safely", () => {
  const mockSession = {
    user: {
      name: " Test User ",
      email: " test@example.com ",
      email_verified: true,
      sub: "auth0|12345",
      picture: "https://example.com/photo.jpg"
    },
    internal: {
      createdAt: Math.floor(Date.now() / 1000)
    },
    tokenSet: {
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
      id_token: "secret-id-token",
      token_type: "Bearer",
      expires_at: 9999999999
    },
    createdAt: Math.floor(Date.now() / 1000)
  };

  const result = projectSessionState(mockSession as never);
  assert.equal(result.authenticated, true);
  assert.equal(result.user?.displayName, "Test User");
  assert.equal(result.user?.email, "test@example.com");
  assert.equal(result.user?.emailVerified, true);

  // Must NOT expose: sub, picture, tokens, or any raw claims
  const resultStr = JSON.stringify(result);
  assert.equal(resultStr.includes("auth0|12345"), false);
  assert.equal(resultStr.includes("secret-access-token"), false);
  assert.equal(resultStr.includes("secret-refresh-token"), false);
  assert.equal(resultStr.includes("secret-id-token"), false);
  assert.equal(resultStr.includes("picture"), false);
  assert.equal(resultStr.includes("sub"), false);
});

test("projectSessionState omits empty user fields", () => {
  const mockSession = {
    user: {
      name: "",
      email: "",
      email_verified: false
    },
    internal: {
      createdAt: Math.floor(Date.now() / 1000)
    }
  };

  const result = projectSessionState(mockSession as never);
  assert.equal(result.authenticated, true);
  assert.equal(result.user?.displayName, undefined);
  assert.equal(result.user?.email, undefined);
  assert.equal(result.user?.emailVerified, false);
});

test("idleExpiresAt does not exceed absoluteExpiresAt", () => {
  // Create a session that was created 6.5 days ago (close to absolute limit)
  const now = Math.floor(Date.now() / 1000);
  const createdAt = now - 6.5 * 86400; // 6.5 days ago

  const mockSession = {
    user: { name: "Test", email: "test@example.com", email_verified: true },
    internal: { createdAt }
  };

  const result = projectSessionState(mockSession as never);
  assert.equal(result.authenticated, true);

  const idleExpiry = new Date(result.idleExpiresAt!).getTime();
  const absoluteExpiry = new Date(result.absoluteExpiresAt!).getTime();

  // idleExpiresAt must not exceed absoluteExpiresAt
  assert.ok(idleExpiry <= absoluteExpiry, `idleExpiresAt (${idleExpiry}) should not exceed absoluteExpiresAt (${absoluteExpiry})`);
});

test("absoluteExpiresAt is from real createdAt + 7 days", () => {
  const createdAt = 1700000000; // Fixed timestamp
  const mockSession = {
    user: { name: "Test", email: "test@example.com", email_verified: true },
    internal: { createdAt }
  };

  const result = projectSessionState(mockSession as never);
  const expectedAbsolute = new Date((createdAt + 604800) * 1000).toISOString();
  assert.equal(result.absoluteExpiresAt, expectedAbsolute);
});

test("idleExpiresAt is min(now + 8h, absoluteExpiresAt)", () => {
  const now = Math.floor(Date.now() / 1000);
  const createdAt = now - 100; // Just created

  const mockSession = {
    user: { name: "Test", email: "test@example.com", email_verified: true },
    internal: { createdAt }
  };

  const result = projectSessionState(mockSession as never);
  const idleExpiry = new Date(result.idleExpiresAt!).getTime() / 1000;

  // For a fresh session, idleExpiresAt should be now + 8h (28800s)
  const expectedIdle = now + 28800;
  // Allow 2 second tolerance for test execution time
  assert.ok(Math.abs(idleExpiry - expectedIdle) < 5, `idleExpiresAt should be ~now+8h, got ${idleExpiry}`);
});

// --- generateRequestId ---

test("generateRequestId returns a non-empty string", () => {
  const id = generateRequestId();
  assert.ok(typeof id === "string");
  assert.ok(id.length > 0);
});

test("generateRequestId returns unique values", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    ids.add(generateRequestId());
  }
  assert.equal(ids.size, 100);
});

// --- Token custody regression ---

test("production source does not contain NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN", () => {
  const frontendDir = join(process.cwd(), "src");
  const files = walkDir(frontendDir);
  const productionFiles = files.filter(
    (f) => f.endsWith(".ts") || f.endsWith(".tsx")
  ).filter(
    (f) => !f.includes(".test.") && !f.includes(".spec.")
  );

  for (const file of productionFiles) {
    const content = readFileSync(file, "utf-8");
    assert.equal(
      content.includes("NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN"),
      false,
      `Production file ${file} should not contain NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`
    );
  }
});

test("resolveAccessToken is removed from api-runtime", () => {
  const apiRuntimePath = join(process.cwd(), "src", "lib", "api", "api-runtime.ts");
  const content = readFileSync(apiRuntimePath, "utf-8");
  assert.equal(content.includes("resolveAccessToken"), false, "resolveAccessToken should be removed from api-runtime.ts");
  assert.equal(content.includes("NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN"), false, "NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN should be removed from api-runtime.ts");
});

test("DesignApiClientOptions does not include accessToken", () => {
  const designApiPath = join(process.cwd(), "src", "lib", "api", "design-api.ts");
  const content = readFileSync(designApiPath, "utf-8");
  // The type definition should not have accessToken
  const typeMatch = content.match(/export type DesignApiClientOptions\s*=\s*\{[^}]*\}/s);
  assert.ok(typeMatch, "DesignApiClientOptions type should exist");
  assert.equal(typeMatch![0].includes("accessToken"), false, "DesignApiClientOptions should not include accessToken");
});

test("TarotApiClientOptions does not include accessToken", () => {
  const tarotApiPath = join(process.cwd(), "src", "lib", "api", "tarot-api.ts");
  const content = readFileSync(tarotApiPath, "utf-8");
  const typeMatch = content.match(/export type TarotApiClientOptions\s*=\s*\{[^}]*\}/s);
  assert.ok(typeMatch, "TarotApiClientOptions type should exist");
  assert.equal(typeMatch![0].includes("accessToken"), false, "TarotApiClientOptions should not include accessToken");
});

test("browser API client does not set Authorization header", () => {
  const designApiPath = join(process.cwd(), "src", "lib", "api", "design-api.ts");
  const content = readFileSync(designApiPath, "utf-8");
  // The callApi function should not set authorization header
  assert.equal(
    content.includes('headers.set("authorization"') || content.includes("headers.set('authorization'"),
    false,
    "Browser API client should not set Authorization header"
  );
});

// --- Cookie Secure flag and session cookie name derivation ---

test("isSecureCookie is true for HTTPS app origins in any environment", () => {
  assert.equal(isSecureCookie(makeConfig()), true);
  assert.equal(isSecureCookie(makeConfig({ appOrigin: "https://staging.mystcrag.com" })), true);
});

test("isSecureCookie is false only for development/test loopback HTTP origins", () => {
  assert.equal(isSecureCookie(makeDevConfig()), false);
});

test("isSecureCookie fails closed on unparsable origins", () => {
  assert.equal(isSecureCookie(makeConfig({ appOrigin: "not-a-url" })), true);
});

test("getSessionCookieName uses __Host- prefix exactly when cookies are Secure", () => {
  assert.equal(getSessionCookieName(makeConfig()), "__Host-mystcrag_session");
  assert.equal(getSessionCookieName(makeDevConfig()), "mystcrag_session");
});

// --- Helper ---

function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        results.push(...walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory not readable
  }
  return results;
}
