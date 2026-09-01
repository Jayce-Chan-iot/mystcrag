/**
 * Scenario G — Configuration / security negatives.
 *
 * Fail-closed proofs that no misconfiguration can weaken the auth posture:
 *   G1  a production Backend with NO auth configuration refuses to start (exit ≠ 0)
 *   G2  a production Backend (and Frontend) with the signed-test provider refuses to run
 *   G3  an HTTP app origin is rejected: non-loopback HTTP in test, and any HTTP/loopback
 *       in production — the Frontend answers a stable 500, never a fake session
 *   G4  wildcard / localhost / IP-literal production issuers are rejected at Backend
 *       startup (exit ≠ 0 with the exact validation message)
 *   G5  a callback URL or logout URL that does not match the app origin is rejected
 *   G6  a weak session secret is rejected
 *   G7  a JWKS outage fails CLOSED: rotated-key tokens are never accepted while the
 *       key set is unreachable, the session is preserved, and the same session recovers
 *       once the outage ends (respecting the bounded negative cache)
 *   G8  no run artifact (logs, run-state, test output) contains the client secret,
 *       session secret, admin token, access/refresh/ID token, session cookie value,
 *       or the raw user profile
 *
 * Negative Backends exit before binding any port (config validation runs before the
 * HTTP listener). Negative Frontends reuse the production build on the reserved
 * negative port; frontend configuration is validated per request, so rejection is a
 * stable 500 with no Set-Cookie and no provider redirect — never a fake anonymous
 * session.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { bffClient, type ApiResponse } from "../helpers/api";
import { loginAsUser, syntheticUser } from "../helpers/login";
import { rotateProviderKey, setProviderOutage } from "../helpers/provider-admin";
import { requireSecret, runDirectory, stackState } from "../helpers/run-state";
import { decryptSessionCookie } from "../helpers/sdk-cookies";
import { waitForAccessTokenExpiry } from "../helpers/timing";
import { spawnBackendWithEnv, spawnFrontendWithEnv, SYNTHETIC_AUDIENCE } from "../fixtures/stack";
import { SYNTHETIC_ISSUER } from "../fixtures/ports";

function errorEnvelopeOf(response: ApiResponse): { code?: string; message?: string } {
  const parsed = JSON.parse(response.body) as { error?: { code?: string; message?: string } };
  return parsed.error ?? {};
}

/** Fetches a negative Frontend endpoint from the worker; redirects are never followed. */
async function fetchNegativeFrontend(url: string): Promise<Response> {
  return fetch(url, { redirect: "manual", headers: { accept: "application/json" } });
}

type NegativeFrontendProbe = {
  sessionStatus: number;
  sessionCode: string | undefined;
  loginStatus: number;
  loginLocation: string | null;
  setCookies: string[];
};

async function probeNegativeFrontend(url: string): Promise<NegativeFrontendProbe> {
  const session = await fetchNegativeFrontend(`${url}/auth/session`);
  const sessionBody = await session.text();
  let sessionCode: string | undefined;
  try {
    sessionCode = (JSON.parse(sessionBody) as { error?: { code?: string } }).error?.code;
  } catch {
    sessionCode = undefined;
  }

  const login = await fetchNegativeFrontend(`${url}/auth/login`);

  return {
    sessionStatus: session.status,
    sessionCode,
    loginStatus: login.status,
    loginLocation: login.headers.get("location"),
    setCookies: [
      ...session.headers.getSetCookie(),
      ...login.headers.getSetCookie()
    ]
  };
}

function expectRejectedConfig(probe: NegativeFrontendProbe, label: string): void {
  expect(probe.sessionStatus, `${label}: /auth/session must fail closed with 500`).toBe(500);
  expect(probe.sessionCode, `${label}: the envelope must be INTERNAL_ERROR`).toBe("INTERNAL_ERROR");
  expect(probe.loginStatus, `${label}: /auth/login must fail closed with 500, never redirect`).toBe(500);
  expect(probe.loginLocation, `${label}: no provider redirect may be started`).toBeNull();
  expect(probe.setCookies, `${label}: a rejected config must not touch any cookie`).toHaveLength(0);
}

test.describe("G. configuration / security negatives", () => {
  test("G1 a production Backend with no auth configuration refuses to start", async () => {
    const missing = await spawnBackendWithEnv({ NODE_ENV: "production" }, "g1-missing-config");
    const outcome = await missing.waitForExit(20_000);

    expect(outcome.code, "startup must fail with a non-zero exit code").not.toBe(0);
    expect(outcome.stderr, "the exact configuration guard must be the failure reason").toContain(
      "Authentication provider is not configured"
    );
  });

  test("G2 the signed-test provider is refused in production on both runtimes", async () => {
    // Backend: the provider factory rejects signed-test before the listener binds.
    const backend = await spawnBackendWithEnv(
      {
        NODE_ENV: "production",
        MYSTCRAG_AUTH_PROVIDER: "signed-test",
        MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "true",
        MYSTCRAG_AUTH_SIGNING_SECRET: "a".repeat(64),
        MYSTCRAG_AUTH_ISSUER: SYNTHETIC_ISSUER,
        MYSTCRAG_AUTH_AUDIENCE: SYNTHETIC_AUDIENCE
      },
      "g2-signed-test-production"
    );
    const outcome = await backend.waitForExit(20_000);
    expect(outcome.code, "a production signed-test Backend must exit").not.toBe(0);
    expect(outcome.stderr).toContain("Signed test authentication is disabled");

    // Frontend: otherwise-valid production configuration is still rejected when the
    // provider is signed-test.
    const frontend = await spawnFrontendWithEnv(
      {
        NODE_ENV: "production",
        MYSTCRAG_APP_ORIGIN: "https://negative.auth006.internal",
        MYSTCRAG_AUTH_CALLBACK_URL: "https://negative.auth006.internal/auth/callback",
        MYSTCRAG_AUTH_LOGOUT_URL: "https://negative.auth006.internal/",
        MYSTCRAG_BACKEND_ORIGIN: "https://backend.auth006.internal",
        MYSTCRAG_AUTH_CLIENT_SECRET: requireSecret("AUTH006_CLIENT_SECRET"),
        MYSTCRAG_AUTH_SESSION_SECRET: requireSecret("AUTH006_SESSION_SECRET"),
        MYSTCRAG_AUTH_PROVIDER: "signed-test"
      },
      "g2-signed-test-production"
    );
    try {
      const probe = await probeNegativeFrontend(frontend.url);
      expectRejectedConfig(probe, "production signed-test frontend");
    } finally {
      await frontend.stop();
    }
  });

  test("G3 an HTTP app origin is rejected (non-loopback in test; any HTTP in production)", async () => {
    // test environment: HTTP is legal ONLY for loopback origins.
    const nonLoopback = await spawnFrontendWithEnv(
      {
        MYSTCRAG_APP_ORIGIN: "http://negative.auth006.internal",
        MYSTCRAG_AUTH_CALLBACK_URL: "http://negative.auth006.internal/auth/callback",
        MYSTCRAG_AUTH_LOGOUT_URL: "http://negative.auth006.internal/",
        MYSTCRAG_AUTH_CLIENT_SECRET: requireSecret("AUTH006_CLIENT_SECRET"),
        MYSTCRAG_AUTH_SESSION_SECRET: requireSecret("AUTH006_SESSION_SECRET")
      },
      "g3-http-non-loopback"
    );
    try {
      const probe = await probeNegativeFrontend(nonLoopback.url);
      expectRejectedConfig(probe, "test-env non-loopback HTTP origin");
    } finally {
      await nonLoopback.stop();
    }

    // production environment: HTTP is never legal, and loopback origins are rejected too.
    const productionHttp = await spawnFrontendWithEnv(
      {
        NODE_ENV: "production",
        MYSTCRAG_AUTH_CLIENT_SECRET: requireSecret("AUTH006_CLIENT_SECRET"),
        MYSTCRAG_AUTH_SESSION_SECRET: requireSecret("AUTH006_SESSION_SECRET")
      },
      "g3-production-http"
    );
    try {
      const probe = await probeNegativeFrontend(productionHttp.url);
      expectRejectedConfig(probe, "production HTTP loopback origin");
    } finally {
      await productionHttp.stop();
    }
  });

  test("G4 wildcard, localhost and IP-literal production issuers are rejected at Backend startup", async () => {
    const cases: Array<{ label: string; issuer: string; message: string }> = [
      { label: "g4-wildcard-issuer", issuer: "https://*.auth006.internal/", message: "wildcard hostnames are not accepted" },
      { label: "g4-localhost-issuer", issuer: "https://localhost/", message: "loopback hosts are not accepted" },
      { label: "g4-ip-literal-issuer", issuer: "https://127.0.0.1/", message: "must be a DNS hostname, not an IP literal" }
    ];

    for (const testCase of cases) {
      const spawned = await spawnBackendWithEnv(
        {
          NODE_ENV: "production",
          MYSTCRAG_AUTH_PROVIDER: "auth0",
          MYSTCRAG_AUTH_ISSUER: testCase.issuer,
          MYSTCRAG_AUTH_AUDIENCE: SYNTHETIC_AUDIENCE
        },
        testCase.label
      );
      const outcome = await spawned.waitForExit(20_000);
      expect(outcome.code, `${testCase.issuer} must fail startup`).not.toBe(0);
      expect(outcome.stderr, `${testCase.issuer} must be rejected by the exact issuer guard`).toContain(
        testCase.message
      );
    }
  });

  test("G5 a callback or logout URL that does not match the app origin is rejected", async () => {
    const state = await stackState();

    const callbackMismatch = await spawnFrontendWithEnv(
      {
        MYSTCRAG_AUTH_CALLBACK_URL: `${state.urls.frontend}/auth/callback`,
        MYSTCRAG_AUTH_CLIENT_SECRET: requireSecret("AUTH006_CLIENT_SECRET"),
        MYSTCRAG_AUTH_SESSION_SECRET: requireSecret("AUTH006_SESSION_SECRET")
      },
      "g5-callback-mismatch"
    );
    try {
      const probe = await probeNegativeFrontend(callbackMismatch.url);
      expectRejectedConfig(probe, "cross-origin callback URL");
    } finally {
      await callbackMismatch.stop();
    }

    const logoutMismatch = await spawnFrontendWithEnv(
      {
        MYSTCRAG_AUTH_LOGOUT_URL: "https://elsewhere.auth006.internal/",
        MYSTCRAG_AUTH_CLIENT_SECRET: requireSecret("AUTH006_CLIENT_SECRET"),
        MYSTCRAG_AUTH_SESSION_SECRET: requireSecret("AUTH006_SESSION_SECRET")
      },
      "g5-logout-mismatch"
    );
    try {
      const probe = await probeNegativeFrontend(logoutMismatch.url);
      expectRejectedConfig(probe, "cross-origin logout URL");
    } finally {
      await logoutMismatch.stop();
    }
  });

  test("G6 a weak session secret is rejected", async () => {
    const weakSecret = await spawnFrontendWithEnv(
      {
        MYSTCRAG_AUTH_CLIENT_SECRET: requireSecret("AUTH006_CLIENT_SECRET"),
        MYSTCRAG_AUTH_SESSION_SECRET: "auth006-weak-secret"
      },
      "g6-weak-session-secret"
    );
    try {
      const probe = await probeNegativeFrontend(weakSecret.url);
      expectRejectedConfig(probe, "weak session secret");
    } finally {
      await weakSecret.stop();
    }
  });

  test("G7 a JWKS outage fails closed and the same session recovers afterwards", async ({ page }) => {
    const api = bffClient(page);
    await loginAsUser(page, syntheticUser("auth006-g7", "郭七"));

    // Baseline: the protected call works before anything is disturbed.
    const baseline = await api.listDesigns();
    expect(baseline.status, `baseline protected call must succeed: ${baseline.body}`).toBe(200);

    // Rotate the signing key, then take the JWKS endpoint down. Renewal keeps working
    // (only JWKS is out), so the BFF hands the Backend a token signed by the NEW key —
    // which the Backend can only verify by refreshing the key set. Failing that
    // refresh must fail CLOSED: 5xx, never a silent accept.
    await rotateProviderKey();
    try {
      await setProviderOutage("jwks");
      await waitForAccessTokenExpiry();

      const duringOutage = await api.listDesigns();
      expect(duringOutage.status, "an unreachable key set must never yield a 200").toBe(500);
      expect(errorEnvelopeOf(duringOutage).code).toBe("INTERNAL_ERROR");

      const session = await api.session();
      expect(
        (JSON.parse(session.body) as { authenticated: boolean }).authenticated,
        "a JWKS outage is infrastructure: the decrypted session must be preserved"
      ).toBe(true);

      // Outage ends. The Backend's bounded negative cache (30s) may keep rejecting
      // refresh attempts for a while — fail closed throughout — and then recover with
      // the SAME session, without any re-login.
      await setProviderOutage("off");
      const deadline = Date.now() + 50_000;
      let recovered = false;
      while (Date.now() < deadline) {
        const attempt = await api.listDesigns();
        if (attempt.status === 200) {
          recovered = true;
          break;
        }
        expect(attempt.status, "during recovery the call must stay fail-closed 5xx").toBe(500);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      expect(recovered, "the same session must recover after the JWKS outage ends").toBe(true);

      const after = await api.session();
      expect((JSON.parse(after.body) as { authenticated: boolean }).authenticated).toBe(true);
    } finally {
      await setProviderOutage("off");
    }
  });

  test("G8 no run artifact contains secret, token, cookie or raw profile material", async ({ page }) => {
    const user = syntheticUser("auth006-g8", "郭八");
    const cookie = await loginAsUser(page, user);
    const payload = await decryptSessionCookie(cookie.value);
    expect(payload, "the scan needs a real live session to source token material").not.toBeNull();

    const forbidden: Array<{ label: string; value: string }> = [
      { label: "client secret", value: requireSecret("AUTH006_CLIENT_SECRET") },
      { label: "session secret", value: requireSecret("AUTH006_SESSION_SECRET") },
      { label: "provider admin token", value: requireSecret("AUTH006_ADMIN_TOKEN") },
      { label: "access token", value: payload!.tokenSet.accessToken ?? "" },
      { label: "refresh token", value: payload!.tokenSet.refreshToken ?? "" },
      { label: "ID token", value: payload!.tokenSet.idToken ?? "" },
      { label: "session cookie value", value: cookie.value },
      { label: "raw profile email", value: user.email ?? "" },
      { label: "raw profile sub", value: user.sub }
    ].filter((entry) => entry.value.length >= 12);

    async function collectFiles(directory: string): Promise<string[]> {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        // Playwright's own staging directory (.playwright-artifacts-*) holds the
        // uncompressed trace fragments DURING the run; the tool itself deletes it
        // when it packs trace.zip. It is not a retained artifact of this run.
        if (entry.name.startsWith(".")) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await collectFiles(full)));
        } else if (entry.isFile()) {
          // Playwright trace archives are deflate-compressed ZIP containers: scanning
          // the raw bytes would be meaningless. Their credential-bearing headers are
          // redacted and then VERIFIED (decompressed scan) by the global teardown —
          // the same guarantee this test enforces for every readable artifact.
          if (entry.name === "trace.zip") continue;
          files.push(full);
        }
      }
      return files;
    }

    const directory = runDirectory();
    const files = await collectFiles(directory);
    expect(files.length, "the run directory must contain the generated run artifacts").toBeGreaterThan(0);

    for (const file of files) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      for (const secret of forbidden) {
        expect(
          content,
          `${path.relative(directory, file)} must not contain the ${secret.label}`
        ).not.toContain(secret.value);
      }
    }
  });
});
