import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { readFileSync } from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import { ASSET_ADMIN_COOKIE_NAME, assetAdminSessionToken } from "./admin-auth";
import { handleBeadImportProxyRequest } from "./proxy";

const ADMIN_KEY = "asset-admin-key-0123456789abcdef";
const BACKEND_ORIGIN = "http://127.0.0.1:4100";
const ENV = {
  MYSTCRAG_ASSET_ADMIN_KEY: ADMIN_KEY,
  MYSTCRAG_BACKEND_ORIGIN: BACKEND_ORIGIN,
  NODE_ENV: "test"
};

function sessionCookie(): string {
  const token = assetAdminSessionToken(ENV);
  assert.ok(token !== null);
  return `${ASSET_ADMIN_COOKIE_NAME}=${token}`;
}

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function makeRequest(
  path: string,
  init: RequestInit & { cookieHeader?: string; duplex?: "half" } = {}
): NextRequest {
  const { cookieHeader, duplex, signal, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  const requestInit: NextRequestInit = { ...rest, headers };
  if (duplex !== undefined) {
    requestInit.duplex = duplex;
  }
  if (signal) {
    requestInit.signal = signal;
  }
  return new NextRequest(`http://localhost:3000${path}`, requestInit);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

type FetchCall = {
  url: string;
  method: string;
  headers: Headers;
  bodyKind: "stream" | "other" | "none";
  bodyBytes: Uint8Array | null;
};

type BackendStub = {
  status?: number;
  headers?: Record<string, string>;
  body?: Uint8Array | string | null;
};

function makeFetcher(backend: BackendStub = {}): {
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    const body = init.body;
    let bodyKind: FetchCall["bodyKind"] = "none";
    let bodyBytes: Uint8Array | null = null;
    if (body instanceof ReadableStream) {
      bodyKind = "stream";
      const chunks: Uint8Array[] = [];
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          chunks.push(new Uint8Array(value));
        }
      }
      bodyBytes = concatBytes(chunks);
    } else if (body !== null && body !== undefined) {
      bodyKind = "other";
      bodyBytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
    }
    calls.push({ url, method: init.method ?? "GET", headers, bodyKind, bodyBytes });
    const responseBody = backend.body ?? null;
    return new Response(
      responseBody instanceof Uint8Array ? new Uint8Array(responseBody) : responseBody,
      { status: backend.status ?? 200, headers: backend.headers }
    );
  };
  return { fetcher, calls };
}

async function envelopeOf(response: Response): Promise<{ code: string; message: string; requestId: string }> {
  const parsed: unknown = await response.json();
  assert.ok(typeof parsed === "object" && parsed !== null, "proxy errors must be JSON objects");
  const error = (parsed as { error?: unknown }).error;
  assert.ok(typeof error === "object" && error !== null, "proxy errors must use the error envelope");
  const { code, message, requestId } = error as Record<string, unknown>;
  assert.equal(typeof code, "string");
  assert.equal(typeof message, "string");
  assert.equal(typeof requestId, "string");
  return { code: String(code), message: String(message), requestId: String(requestId) };
}

function headerNames(headers: Headers): string[] {
  return [...headers.keys()].sort();
}

test("an unauthenticated browser never reaches the Backend", async () => {
  for (const cookieHeader of [
    undefined,
    "",
    `${ASSET_ADMIN_COOKIE_NAME}=not-the-token`,
    `${ASSET_ADMIN_COOKIE_NAME}=${"0".repeat(64)}`,
    "mystcrag_knowledge_admin=anything",
    "session=auth0-user-session"
  ]) {
    const { fetcher, calls } = makeFetcher();
    const response = await handleBeadImportProxyRequest(
      makeRequest("/api/admin/bead-import/sessions", { cookieHeader }),
      ["sessions"],
      { env: ENV, fetcher }
    );
    assert.equal(response.status, 401);
    const envelope = await envelopeOf(response);
    assert.equal(envelope.code, "UNAUTHORIZED");
    assert.ok(!envelope.message.includes(ADMIN_KEY));
    assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
    assert.equal(calls.length, 0);
  }
});

test("an unconfigured deployment fails closed with zero Backend calls", async () => {
  const { fetcher, calls } = makeFetcher();
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions", { cookieHeader: sessionCookie() }),
    ["sessions"],
    { env: { MYSTCRAG_BACKEND_ORIGIN: BACKEND_ORIGIN }, fetcher }
  );
  assert.equal(response.status, 401);
  assert.equal((await envelopeOf(response)).code, "UNAUTHORIZED");
  assert.equal(calls.length, 0);
});

test("a rotated admin key invalidates the presented session cookie", async () => {
  const { fetcher, calls } = makeFetcher();
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions", { cookieHeader: sessionCookie() }),
    ["sessions"],
    { env: { ...ENV, MYSTCRAG_ASSET_ADMIN_KEY: `${ADMIN_KEY}-rotated` }, fetcher }
  );
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("GET is forwarded to the fixed Backend prefix with only the server-side admin key", async () => {
  const { fetcher, calls } = makeFetcher({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessions: [], nextCursor: null })
  });
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions?state=AWAITING_NAMES&limit=20", {
      method: "GET",
      cookieHeader: sessionCookie(),
      headers: {
        authorization: "Bearer user-token",
        "x-admin-key": "attacker-supplied-key",
        "x-forwarded-for": "203.0.113.9",
        accept: "application/json"
      }
    }),
    ["sessions"],
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.url, `${BACKEND_ORIGIN}/api/admin/bead-import/sessions?state=AWAITING_NAMES&limit=20`);
  assert.equal(call.method, "GET");
  assert.deepEqual(headerNames(call.headers), ["x-admin-key"]);
  assert.equal(call.headers.get("x-admin-key"), ADMIN_KEY);
  assert.equal(call.bodyKind, "none");
  assert.equal(call.bodyBytes, null);
  assert.equal(await response.text(), JSON.stringify({ sessions: [], nextCursor: null }));
});

test("the default Backend origin is used when the environment does not override it", async () => {
  const { fetcher, calls } = makeFetcher();
  await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions", { cookieHeader: sessionCookie() }),
    ["sessions"],
    { env: { MYSTCRAG_ASSET_ADMIN_KEY: ADMIN_KEY }, fetcher }
  );
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.url, "http://127.0.0.1:4000/api/admin/bead-import/sessions");
});

test("a trailing slash on the Backend origin never produces a double slash", async () => {
  const { fetcher, calls } = makeFetcher();
  await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions", { cookieHeader: sessionCookie() }),
    ["sessions"],
    { env: { ...ENV, MYSTCRAG_BACKEND_ORIGIN: `${BACKEND_ORIGIN}/` }, fetcher }
  );
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.url, `${BACKEND_ORIGIN}/api/admin/bead-import/sessions`);
});

test("repeated query parameters survive the hop in order", async () => {
  const { fetcher, calls } = makeFetcher();
  await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions?limit=5&state=A&state=B&cursor=abc%2Fdef", {
      cookieHeader: sessionCookie()
    }),
    ["sessions"],
    { env: ENV, fetcher }
  );
  const call = calls[0];
  assert.ok(call !== undefined);
  const forwarded = new URL(call.url).searchParams;
  assert.deepEqual(forwarded.getAll("state"), ["A", "B"]);
  assert.equal(forwarded.get("limit"), "5");
  assert.equal(forwarded.get("cursor"), "abc/def");
});

test("POST keeps the JSON content type and forwards the body bytes untouched", async () => {
  const payload = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x22, 0x69, 0x22, 0x3a, 0xff, 0x00, 0x7d]);
  const { fetcher, calls } = makeFetcher({ status: 201, headers: { "content-type": "application/json" }, body: "{}" });
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions", {
      method: "POST",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        }
      })
    }),
    ["sessions"],
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 201);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.method, "POST");
  assert.equal(call.url, `${BACKEND_ORIGIN}/api/admin/bead-import/sessions`);
  assert.deepEqual(headerNames(call.headers), ["content-type", "x-admin-key"]);
  assert.equal(call.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(call.bodyKind, "stream");
  assert.deepEqual(call.bodyBytes, payload);
});

test("PATCH is forwarded with its JSON body", async () => {
  const body = new TextEncoder().encode(JSON.stringify({ expectedRevision: 3, nameCn: "白水晶" }));
  const { fetcher, calls } = makeFetcher();
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/crystal-drafts/draft-1", {
      method: "PATCH",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        }
      })
    }),
    ["crystal-drafts", "draft-1"],
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 200);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.method, "PATCH");
  assert.equal(call.url, `${BACKEND_ORIGIN}/api/admin/bead-import/crystal-drafts/draft-1`);
  assert.deepEqual(call.bodyBytes, body);
});

test("PUT forwards the browser body as a stream with the declared Content-Length intact", async () => {
  const chunks = [
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    concatBytes([new Uint8Array(64 * 1024).fill(0x41), new Uint8Array([0x00, 0xff])]),
    new Uint8Array([0xff, 0xd9])
  ];
  const payload = concatBytes(chunks);
  const { fetcher, calls } = makeFetcher({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: "file-1", uploadStatus: "UPLOADING" })
  });

  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions/s-1/files/file-1/content", {
      method: "PUT",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(payload.byteLength),
        "x-content-sha256": "a".repeat(64)
      },
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        }
      })
    }),
    ["sessions", "s-1", "files", "file-1", "content"],
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 200);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.method, "PUT");
  assert.equal(call.url, `${BACKEND_ORIGIN}/api/admin/bead-import/sessions/s-1/files/file-1/content`);
  assert.equal(call.bodyKind, "stream", "the upload body must never be buffered into memory");
  assert.deepEqual(call.bodyBytes, payload);
  assert.equal(call.headers.get("content-length"), String(payload.byteLength));
  assert.equal(call.headers.get("content-type"), "image/jpeg");
  assert.equal(call.headers.get("x-content-sha256"), "a".repeat(64));
  assert.deepEqual(headerNames(call.headers), [
    "content-length",
    "content-type",
    "x-admin-key",
    "x-content-sha256"
  ]);
});

test("PUT without a declared digest never invents one", async () => {
  const { fetcher, calls } = makeFetcher();
  await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions/s-1/files/file-1/content", {
      method: "PUT",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: { "content-type": "image/png", "content-length": "4" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        }
      })
    }),
    ["sessions", "s-1", "files", "file-1", "content"],
    { env: ENV, fetcher }
  );
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.headers.get("x-content-sha256"), null);
  assert.deepEqual(headerNames(call.headers), ["content-length", "content-type", "x-admin-key"]);
});

test("a GET request cannot smuggle a Content-Length to the Backend", async () => {
  const { fetcher, calls } = makeFetcher();
  await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions", {
      method: "GET",
      cookieHeader: sessionCookie(),
      headers: { "content-length": "17", "content-type": "application/json" }
    }),
    ["sessions"],
    { env: ENV, fetcher }
  );
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.deepEqual(headerNames(call.headers), ["x-admin-key"]);
  assert.equal(call.bodyKind, "none");
});

test("unsafe proxy paths are rejected before any Backend call", async () => {
  const unsafePaths: string[][] = [
    [],
    [""],
    ["."],
    [".."],
    ["sessions", ".."],
    ["..", "sessions"],
    ["sessions", "..%2F..%2Fadmin"],
    ["https:", "", "evil.example", "sessions"],
    ["sessions\\"],
    ["sessions\\..\\admin"],
    ["sessions\u0000"],
    ["sessions\n"],
    ["sessions/"],
    ["a b"],
    ["sessions?x=1"],
    ["sessions#fragment"],
    ["%2e%2e"],
    ["groups", ":sessionId"]
  ];
  for (const path of unsafePaths) {
    const { fetcher, calls } = makeFetcher();
    const response = await handleBeadImportProxyRequest(
      makeRequest("/api/admin/bead-import/sessions", { cookieHeader: sessionCookie() }),
      path,
      { env: ENV, fetcher }
    );
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(path)}`);
    const envelope = await envelopeOf(response);
    assert.equal(envelope.code, "VALIDATION_ERROR", `expected VALIDATION_ERROR for ${JSON.stringify(path)}`);
    assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
    assert.ok(!envelope.message.includes(ADMIN_KEY));
    assert.equal(calls.length, 0, `expected no Backend call for ${JSON.stringify(path)}`);
  }
});

test("unsupported methods are refused without contacting the Backend", async () => {
  for (const method of ["DELETE", "HEAD", "OPTIONS"]) {
    const { fetcher, calls } = makeFetcher();
    const response = await handleBeadImportProxyRequest(
      makeRequest("/api/admin/bead-import/sessions", { method, cookieHeader: sessionCookie() }),
      ["sessions"],
      { env: ENV, fetcher }
    );
    assert.equal(response.status, 400, `expected 400 for ${method}`);
    assert.equal((await envelopeOf(response)).code, "VALIDATION_ERROR");
    assert.equal(calls.length, 0);
  }
});

test("a non-http Backend origin is refused instead of being fetched", async () => {
  for (const origin of ["file:///etc/passwd", "ftp://127.0.0.1", "not a url"]) {
    const { fetcher, calls } = makeFetcher();
    const response = await handleBeadImportProxyRequest(
      makeRequest("/api/admin/bead-import/sessions", { cookieHeader: sessionCookie() }),
      ["sessions"],
      { env: { ...ENV, MYSTCRAG_BACKEND_ORIGIN: origin }, fetcher }
    );
    assert.equal(response.status, 500);
    const envelope = await envelopeOf(response);
    assert.equal(envelope.code, "INTERNAL_ERROR");
    assert.ok(!envelope.message.includes(origin));
    assert.equal(calls.length, 0);
  }
});

test("Backend error envelopes pass through with their status and without proxy secrets", async () => {
  const backendBody = JSON.stringify({
    error: {
      code: "CONFLICT",
      message: "The group revision moved on; reload the session before retrying.",
      assetCode: "INVENTORY_VERSION_CONFLICT",
      retryable: true,
      recoveryAction: "REFRESH_SESSION",
      requestId: "backend-request-1"
    }
  });
  const { fetcher } = makeFetcher({ status: 409, headers: { "content-type": "application/json" }, body: backendBody });
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/groups/g-1", {
      method: "PATCH",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"));
          controller.close();
        }
      })
    }),
    ["groups", "g-1"],
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("content-type"), "application/json");
  const text = await response.text();
  assert.equal(text, backendBody);
  assert.ok(!text.includes(ADMIN_KEY));
  assert.ok(!text.includes(BACKEND_ORIGIN));
});

test("binary Backend responses stay streamed and expose only safe headers", async () => {
  const binary = concatBytes([new Uint8Array([0x89, 0x50, 0x4e, 0x47]), new Uint8Array(2048).fill(0x1f)]);
  const { fetcher, calls } = makeFetcher({
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(binary.byteLength),
      etag: '"v1"',
      "cache-control": "public, max-age=31536000, immutable",
      "set-cookie": "backend_session=leak",
      "x-archive-path": "/var/mystcrag/archive/secret.jpg",
      server: "Fastify",
      "x-powered-by": "backend"
    },
    body: binary
  });

  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions/s-1", { cookieHeader: sessionCookie() }),
    ["sessions", "s-1"],
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 200);
  assert.equal(headerNames(response.headers).join(","), "cache-control,content-length,content-type,etag");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("etag"), '"v1"');
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-archive-path"), null);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), binary);
  assert.equal(calls.length, 1);
});

test("a Backend transport failure becomes a safe INTERNAL_ERROR envelope", async () => {
  const fetcher = async () => {
    throw new TypeError(`fetch failed for ${BACKEND_ORIGIN}/api/admin/bead-import/sessions`);
  };
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions", { cookieHeader: sessionCookie() }),
    ["sessions"],
    { env: ENV, fetcher }
  );
  assert.equal(response.status, 500);
  const envelope = await envelopeOf(response);
  assert.equal(envelope.code, "INTERNAL_ERROR");
  assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
  assert.ok(!envelope.message.includes(ADMIN_KEY));
  assert.ok(!envelope.message.includes("fetch failed"));
});

test("every proxy error envelope satisfies the frozen transport contract", async () => {
  const { AssetTransportErrorEnvelopeSchema } = await import("@mystcrag/design-contract");
  const { fetcher } = makeFetcher();
  const response = await handleBeadImportProxyRequest(
    makeRequest("/api/admin/bead-import/sessions"),
    ["sessions"],
    { env: ENV, fetcher }
  );
  const parsed: unknown = await response.json();
  const result = AssetTransportErrorEnvelopeSchema.safeParse(parsed);
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));
});

test("the proxy module never buffers a request or response body", () => {
  const source = readFileSync(join(__dirname, "proxy.ts"), "utf8");
  for (const forbidden of [".arrayBuffer()", ".text()", ".json()", ".blob()", ".formData()"]) {
    assert.ok(!source.includes(forbidden), `proxy.ts must not call ${forbidden}`);
  }
  assert.ok(source.includes("duplex"), "streaming a body through fetch requires duplex: half");
  assert.ok(!source.includes("MYSTCRAG_ASSET_ADMIN_KEY"));
  assert.ok(!source.includes("ASSET_ADMIN_API_KEY"));
});

const MAX_MANIFEST_FILE_BYTES = 256 * 1024 * 1024;
/** Above the framework's 10 MiB clone default, well below the 256 MiB limit. */
const LARGE_UPLOAD_BYTES = 12 * 1024 * 1024;
const UPLOAD_PATH_SEGMENTS = ["sessions", "s-1", "files", "f-1", "content"];
const UPLOAD_URL_PATH = `/api/admin/bead-import/${UPLOAD_PATH_SEGMENTS.join("/")}`;

function generatedUpload(totalBytes: number, chunkBytes = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const take = Math.min(chunkBytes, totalBytes - sent);
      sent += take;
      controller.enqueue(new Uint8Array(take).fill(0x5a));
    }
  });
}

test("a 12 MiB upload streams through the handler with every byte intact", async () => {
  const { fetcher, calls } = makeFetcher({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: "f-1", uploadStatus: "UPLOADING" })
  });
  const response = await handleBeadImportProxyRequest(
    makeRequest(UPLOAD_URL_PATH, {
      method: "PUT",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: {
        "content-type": "image/x-sony-arw",
        "content-length": String(LARGE_UPLOAD_BYTES),
        "x-content-sha256": "e".repeat(64)
      },
      body: generatedUpload(LARGE_UPLOAD_BYTES)
    }),
    UPLOAD_PATH_SEGMENTS,
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 200);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.method, "PUT");
  assert.equal(call.bodyKind, "stream", "a large upload must stay a stream, never a buffer");
  assert.ok(call.bodyBytes !== null);
  assert.equal(call.bodyBytes.byteLength, LARGE_UPLOAD_BYTES, "every byte must survive the handler");
});

test("a declared Content-Length above the manifest limit is refused before any Backend call", async () => {
  const { fetcher, calls } = makeFetcher({
    status: 200,
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  const response = await handleBeadImportProxyRequest(
    makeRequest(UPLOAD_URL_PATH, {
      method: "PUT",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: {
        "content-type": "image/x-sony-arw",
        "content-length": String(MAX_MANIFEST_FILE_BYTES + 1),
        "x-content-sha256": "d".repeat(64)
      },
      // Lazy stream: the refusal must happen before a single chunk is pulled.
      body: generatedUpload(MAX_MANIFEST_FILE_BYTES + 1)
    }),
    UPLOAD_PATH_SEGMENTS,
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 413);
  const envelope = await envelopeOf(response);
  assert.equal(envelope.code, "PAYLOAD_TOO_LARGE");
  assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
  assert.ok(!envelope.message.includes(ADMIN_KEY));
  assert.equal(calls.length, 0, "an oversize upload must never reach the Backend");
});

test("an invalid declared Content-Length is refused before any Backend call", async () => {
  for (const declared of ["", " ", "abc", "-1", "12.5", "1e3", "+12", "007", "007 ", `${10 ** 16}`]) {
    const { fetcher, calls } = makeFetcher();
    const response = await handleBeadImportProxyRequest(
      makeRequest(UPLOAD_URL_PATH, {
        method: "PUT",
        cookieHeader: sessionCookie(),
        duplex: "half",
        headers: { "content-type": "application/octet-stream", "content-length": declared },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            controller.close();
          }
        })
      }),
      UPLOAD_PATH_SEGMENTS,
      { env: ENV, fetcher }
    );
    assert.equal(response.status, 400, `expected 400 for content-length ${JSON.stringify(declared)}`);
    const envelope = await envelopeOf(response);
    assert.equal(envelope.code, "VALIDATION_ERROR", `expected VALIDATION_ERROR for ${JSON.stringify(declared)}`);
    assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
    assert.equal(calls.length, 0, `expected zero Backend calls for ${JSON.stringify(declared)}`);
  }
});

test("a body larger than its declared Content-Length is cut off mid-flight", async () => {
  const declaredBytes = 4;
  const smuggledBytes = 8;
  let forwardedBytes = 0;
  const fetcher = async (_url: string, init: RequestInit): Promise<Response> => {
    const body = init.body as ReadableStream<Uint8Array>;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      forwardedBytes += value.byteLength;
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  const response = await handleBeadImportProxyRequest(
    makeRequest(UPLOAD_URL_PATH, {
      method: "PUT",
      cookieHeader: sessionCookie(),
      duplex: "half",
      headers: { "content-type": "application/octet-stream", "content-length": String(declaredBytes) },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(declaredBytes).fill(0x11));
          controller.enqueue(new Uint8Array(smuggledBytes).fill(0x22));
          controller.close();
        }
      })
    }),
    UPLOAD_PATH_SEGMENTS,
    { env: ENV, fetcher }
  );

  assert.equal(response.status, 500);
  const envelope = await envelopeOf(response);
  assert.equal(envelope.code, "INTERNAL_ERROR");
  assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
  assert.ok(!envelope.message.includes(ADMIN_KEY));
  assert.ok(
    forwardedBytes <= declaredBytes,
    `bytes beyond the declared Content-Length must never be forwarded (forwarded ${forwardedBytes})`
  );
});

test("a client abort terminates the upstream request and propagates cancellation", async () => {
  const controller = new AbortController();
  let upstreamCancelledReason: unknown = undefined;
  let upstreamCancelSeen = false;
  const uploadBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4096).fill(0x42));
      // Deliberately left open: the stream must be cancelled, not drained.
    },
    cancel(reason) {
      upstreamCancelSeen = true;
      upstreamCancelledReason = reason;
    }
  });

  let fetcherEntered!: () => void;
  const entered = new Promise<void>((resolveEntered) => {
    fetcherEntered = resolveEntered;
  });
  let seenSignal: AbortSignal | null | undefined;
  let seenBody: unknown = null;
  const fetcher = (_url: string, init: RequestInit & { duplex?: "half" }): Promise<Response> => {
    seenSignal = init.signal;
    seenBody = init.body;
    fetcherEntered();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (!(signal instanceof AbortSignal)) {
        reject(new TypeError("the proxy must forward the client AbortSignal to the Backend fetch"));
        return;
      }
      if (signal.aborted) {
        reject(new DOMException("This operation was aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("This operation was aborted", "AbortError")),
        { once: true }
      );
    });
  };

  const pending = handleBeadImportProxyRequest(
    makeRequest(UPLOAD_URL_PATH, {
      method: "PUT",
      cookieHeader: sessionCookie(),
      duplex: "half",
      signal: controller.signal,
      headers: { "content-type": "application/octet-stream", "content-length": "4096" },
      body: uploadBody
    }),
    UPLOAD_PATH_SEGMENTS,
    { env: ENV, fetcher }
  );

  await entered;
  assert.ok(seenSignal instanceof AbortSignal, "the client AbortSignal must reach the Backend fetch");
  assert.ok(seenBody instanceof ReadableStream, "the PUT body must be forwarded as a stream");

  // A client disconnect cancels the forwarded stream; that cancellation must
  // propagate back to the original request body.
  await (seenBody as ReadableStream<Uint8Array>).cancel(new Error("client disconnected"));
  assert.ok(upstreamCancelSeen, "a cancelled client body must cancel the upstream body");
  assert.ok(upstreamCancelledReason instanceof Error);

  // The forwarded signal is a follower of the client signal (Request wraps
  // init.signal), so aborting the client must abort it too.
  controller.abort();
  assert.equal(seenSignal.aborted, true, "aborting the client signal must reach the forwarded signal");
  const response = await pending;
  assert.equal(response.status, 500);
  const envelope = await envelopeOf(response);
  assert.equal(envelope.code, "INTERNAL_ERROR");
  assert.ok(!envelope.message.includes(BACKEND_ORIGIN));
  assert.ok(!envelope.message.includes(ADMIN_KEY));
  assert.ok(upstreamCancelSeen, "a cancelled client body must cancel the upstream body");
});

// ---------------------------------------------------------------------------
// Real-server integration: proves the framework-level 10 MiB body-clone
// truncation through `next dev`, the proxy network boundary and the actual
// route handler, using only program-generated byte chunks.
// ---------------------------------------------------------------------------

const FRONTEND_ROOT = resolve(__dirname, "..", "..", "..");

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const probe = net.createServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      assert.ok(typeof address === "object" && address !== null);
      probe.close(() => resolvePort(address.port));
    });
  });
}

function waitForHttpServer(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveReady, rejectReady) => {
    const attempt = () => {
      const probe = http.get({ host: "127.0.0.1", port, path: "/api/admin/bead-import/sessions" }, (res) => {
        res.resume();
        res.on("end", () => resolveReady());
      });
      probe.setTimeout(15_000, () => probe.destroy(new Error("probe timeout")));
      probe.on("error", () => {
        if (Date.now() > deadline) {
          rejectReady(new Error("The Next dev server did not become reachable in time."));
          return;
        }
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}

function stopProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit();
      return;
    }
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolveExit();
    });
    child.kill("SIGTERM");
  });
}

function putUpload(
  port: number,
  requestPath: string,
  headers: Record<string, string>,
  totalBytes: number,
  chunkBytes = 64 * 1024
): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = http.request(
      { host: "127.0.0.1", port, path: requestPath, method: "PUT", headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolveResponse({ status: res.statusCode, body }));
      }
    );
    request.on("error", rejectResponse);
    const chunk = Buffer.alloc(chunkBytes, 0x5a);
    let sent = 0;
    const writeNext = () => {
      while (sent < totalBytes) {
        const take = Math.min(chunkBytes, totalBytes - sent);
        sent += take;
        if (!request.write(take === chunkBytes ? chunk : chunk.subarray(0, take))) {
          request.once("drain", writeNext);
          return;
        }
      }
      request.end();
    };
    writeNext();
  });
}

test("a 12 MiB upload streams intact through the real Next proxy route", { timeout: 240_000 }, async () => {
  let receivedBytes = 0;
  let receivedFirstByte = -1;
  let receivedLastByte = -1;
  const backend = http.createServer((req, res) => {
    req.on("data", (chunk: Buffer) => {
      if (chunk.length > 0) {
        if (receivedBytes === 0) {
          receivedFirstByte = chunk[0] ?? -1;
        }
        receivedLastByte = chunk[chunk.length - 1] ?? -1;
      }
      receivedBytes += chunk.length;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ receivedBytes }));
    });
  });
  let backendPort = 0;
  await new Promise<void>((resolveListen) =>
    backend.listen(0, "127.0.0.1", () => {
      const address = backend.address();
      assert.ok(typeof address === "object" && address !== null);
      backendPort = address.port;
      resolveListen();
    })
  );

  const devPort = await findFreePort();
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    // `next dev` runs in development mode; pin the value so a test-run
    // NODE_ENV never leaks into the spawned server.
    NODE_ENV: "development",
    MYSTCRAG_ASSET_ADMIN_KEY: ADMIN_KEY,
    MYSTCRAG_BACKEND_ORIGIN: `http://127.0.0.1:${backendPort}`
  };
  const devServer = spawn(
    process.execPath,
    [join(FRONTEND_ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(devPort)],
    { cwd: FRONTEND_ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"] }
  );
  const devLogs: string[] = [];
  devServer.stdout.on("data", (chunk) => devLogs.push(String(chunk)));
  devServer.stderr.on("data", (chunk) => devLogs.push(String(chunk)));
  const devLogTail = () => devLogs.join("").slice(-4000);

  try {
    await waitForHttpServer(devPort, 90_000);

    const response = await putUpload(
      devPort,
      "/api/admin/bead-import/sessions/it-s1/files/it-f1/content",
      {
        cookie: sessionCookie(),
        "content-type": "image/x-sony-arw",
        "content-length": String(LARGE_UPLOAD_BYTES),
        "x-content-sha256": "c".repeat(64)
      },
      LARGE_UPLOAD_BYTES
    );

    assert.equal(response.status, 200, `expected 200 through the real route; dev server logs:\n${devLogTail()}`);
    const parsed = JSON.parse(response.body) as { receivedBytes: number };
    assert.equal(
      parsed.receivedBytes,
      LARGE_UPLOAD_BYTES,
      `the Backend must receive every byte; dev server logs:\n${devLogTail()}`
    );
    assert.equal(receivedFirstByte, 0x5a);
    assert.equal(receivedLastByte, 0x5a);
  } finally {
    await stopProcess(devServer);
    await new Promise<void>((resolveClosed) => backend.close(() => resolveClosed()));
  }
});
