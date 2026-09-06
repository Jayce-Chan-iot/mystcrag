import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET, PATCH, POST, PUT } from "../../../app/admin/bead-import/proxy/[...path]/route";

import {
  ASSET_ADMIN_COOKIE_NAME,
  ASSET_ADMIN_COOKIE_PATH,
  assetAdminSessionToken
} from "./admin-auth";
import { BEAD_IMPORT_BROWSER_PROXY_PREFIX } from "./api-client";
import { ASSET_ADMIN_BACKEND_PREFIX } from "./proxy";

/**
 * The admin session cookie is scoped to `/admin/bead-import`, so a browser
 * request to `/api/admin/bead-import/...` would never carry it (RFC 6265
 * path-match). This route is the cookie-scoped mount of the same proxy handler
 * and these tests pin that the browser-facing prefix really is inside the cookie
 * scope while the handler keeps refusing unauthenticated callers outright.
 */

const ADMIN_KEY = "asset-admin-key-0123456789abcdef";
const BACKEND_ORIGIN = "http://127.0.0.1:4101";
const ENV: Readonly<Record<string, string>> = {
  MYSTCRAG_ASSET_ADMIN_KEY: ADMIN_KEY,
  MYSTCRAG_BACKEND_ORIGIN: BACKEND_ORIGIN,
  NODE_ENV: "test"
};

/** RFC 6265 §5.1.4 path-match, as browsers apply it to a request URI. */
function browserSendsCookie(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) {
    return true;
  }
  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }
  if (cookiePath.endsWith("/")) {
    return true;
  }
  return requestPath.charAt(cookiePath.length) === "/";
}

function sessionCookie(): string {
  const token = assetAdminSessionToken(ENV);
  assert.ok(token !== null);
  return `${ASSET_ADMIN_COOKIE_NAME}=${token}`;
}

function makeRequest(
  path: string,
  init: RequestInit & { cookieHeader?: string; duplex?: "half" } = {}
): NextRequest {
  const { cookieHeader, duplex, signal, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  const requestInit: NonNullable<ConstructorParameters<typeof NextRequest>[1]> = { ...rest, headers };
  if (duplex !== undefined) {
    requestInit.duplex = duplex;
  }
  if (signal) {
    requestInit.signal = signal;
  }
  return new NextRequest(`http://localhost:3000${path}`, requestInit);
}

function withEnv(run: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(ENV)) {
    previous[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

type RecordedCall = { url: string; method: string; headers: Headers };

function withFetcher(
  backend: { status?: number; body?: string } = {}
): { calls: RecordedCall[]; restore(): void } {
  const calls: RecordedCall[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers as HeadersInit | undefined)
    });
    return new Response(backend.body ?? null, {
      status: backend.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  }) as unknown) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = previous;
    }
  };
}

async function envelopeOf(response: Response): Promise<{ code: string; message: string }> {
  const parsed = (await response.json()) as { error?: { code?: string; message?: string } };
  assert.ok(parsed.error !== undefined, "alias errors must use the transport error envelope");
  return { code: String(parsed.error.code), message: String(parsed.error.message) };
}

function headerNames(headers: Headers): string[] {
  return [...headers.keys()].sort();
}

test("the browser proxy prefix is inside the admin session cookie scope", () => {
  assert.equal(ASSET_ADMIN_COOKIE_PATH, "/admin/bead-import");
  assert.equal(BEAD_IMPORT_BROWSER_PROXY_PREFIX, `${ASSET_ADMIN_COOKIE_PATH}/proxy`);
  assert.equal(
    browserSendsCookie(ASSET_ADMIN_COOKIE_PATH, `${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/sessions`),
    true,
    "the alias must receive the session cookie"
  );
  assert.equal(
    browserSendsCookie(ASSET_ADMIN_COOKIE_PATH, `${ASSET_ADMIN_BACKEND_PREFIX}/sessions`),
    false,
    "the api mount is outside the cookie path, which is why the alias exists"
  );
});

test("the alias exports exactly the four allowed methods over one shared handler", () => {
  assert.deepEqual([GET, POST, PATCH, PUT].map((handler) => typeof handler), [
    "function",
    "function",
    "function",
    "function"
  ]);
  assert.equal(GET, POST);
  assert.equal(GET, PATCH);
  assert.equal(GET, PUT);

  const source = readFileSync(
    join(__dirname, "..", "..", "..", "app", "admin", "bead-import", "proxy", "[...path]", "route.ts"),
    "utf8"
  );
  assert.ok(source.includes("handleBeadImportProxyRequest"), "the alias must delegate to the shared proxy");
  assert.ok(!source.includes("x-admin-key"), "the alias must not add its own admin key handling");
  assert.ok(!source.includes("MYSTCRAG_ASSET_ADMIN_KEY"));
  assert.ok(!source.includes("ASSET_ADMIN_API_KEY"));
  assert.ok(!source.includes("MYSTCRAG_BACKEND_ORIGIN"));
  assert.ok(!source.includes(".arrayBuffer()"));
  assert.ok(!source.includes(".text()"));
});

test("an unauthenticated alias request is refused before any Backend call", async () => {
  await withEnv(async () => {
    for (const cookieHeader of [
      undefined,
      "",
      `${ASSET_ADMIN_COOKIE_NAME}=not-the-token`,
      "mystcrag_knowledge_admin=anything",
      "session=auth0-user-session"
    ]) {
      const { calls, restore } = withFetcher();
      try {
        const response = await GET(
          makeRequest(`${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/sessions`, { cookieHeader }),
          { params: Promise.resolve({ path: ["sessions"] }) }
        );
        assert.equal(response.status, 401, `expected 401 for ${JSON.stringify(cookieHeader)}`);
        const envelope = await envelopeOf(response);
        assert.equal(envelope.code, "UNAUTHORIZED");
        assert.ok(!envelope.message.includes(ADMIN_KEY));
        assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
        assert.equal(calls.length, 0);
      } finally {
        restore();
      }
    }
  });
});

test("an authenticated alias GET reaches the fixed Backend prefix with the server held key", async () => {
  await withEnv(async () => {
    const { calls, restore } = withFetcher({
      status: 200,
      body: JSON.stringify({ sessions: [], nextCursor: null })
    });
    try {
      const response = await GET(
        makeRequest(`${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/sessions?state=NEEDS_REVIEW&limit=25`, {
          cookieHeader: sessionCookie(),
          headers: {
            "x-admin-key": "attacker-supplied-key",
            authorization: "Bearer user-token",
            cookie: "ignored"
          }
        }),
        { params: Promise.resolve({ path: ["sessions"] }) }
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), JSON.stringify({ sessions: [], nextCursor: null }));
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call !== undefined);
      assert.equal(call.url, `${BACKEND_ORIGIN}${ASSET_ADMIN_BACKEND_PREFIX}/sessions?state=NEEDS_REVIEW&limit=25`);
      assert.equal(call.method, "GET");
      assert.deepEqual(headerNames(call.headers), ["x-admin-key"]);
      assert.equal(call.headers.get("x-admin-key"), ADMIN_KEY);
    } finally {
      restore();
    }
  });
});

test("an authenticated alias POST forwards its path segments and JSON body", async () => {
  await withEnv(async () => {
    const { calls, restore } = withFetcher({ status: 201, body: "{}" });
    try {
      const response = await POST(
        makeRequest(`${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/groups/group-1/draft`, {
          method: "POST",
          cookieHeader: sessionCookie(),
          duplex: "half",
          headers: { "content-type": "application/json" },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ idempotencyKey: "key-1" })));
              controller.close();
            }
          })
        }),
        { params: Promise.resolve({ path: ["groups", "group-1", "draft"] }) }
      );
      assert.equal(response.status, 201);
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call !== undefined);
      assert.equal(call.url, `${BACKEND_ORIGIN}${ASSET_ADMIN_BACKEND_PREFIX}/groups/group-1/draft`);
      assert.equal(call.method, "POST");
      assert.deepEqual(headerNames(call.headers), ["content-type", "x-admin-key"]);
    } finally {
      restore();
    }
  });
});

test("the alias rejects unsafe path segments exactly like the api mount", async () => {
  await withEnv(async () => {
    const { calls, restore } = withFetcher();
    try {
      const response = await GET(
        makeRequest(`${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/sessions`, { cookieHeader: sessionCookie() }),
        { params: Promise.resolve({ path: ["sessions", "..", "admin"] }) }
      );
      assert.equal(response.status, 400);
      assert.equal((await envelopeOf(response)).code, "VALIDATION_ERROR");
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });
});

test("an unconfigured deployment stays closed on the alias too", async () => {
  const previous = process.env.MYSTCRAG_ASSET_ADMIN_KEY;
  delete process.env.MYSTCRAG_ASSET_ADMIN_KEY;
  const { calls, restore } = withFetcher();
  try {
    const response = await GET(
      makeRequest(`${BEAD_IMPORT_BROWSER_PROXY_PREFIX}/sessions`, { cookieHeader: sessionCookie() }),
      { params: Promise.resolve({ path: ["sessions"] }) }
    );
    assert.equal(response.status, 401);
    assert.equal((await envelopeOf(response)).code, "UNAUTHORIZED");
    assert.equal(calls.length, 0);
  } finally {
    restore();
    if (previous === undefined) {
      delete process.env.MYSTCRAG_ASSET_ADMIN_KEY;
    } else {
      process.env.MYSTCRAG_ASSET_ADMIN_KEY = previous;
    }
  }
});
