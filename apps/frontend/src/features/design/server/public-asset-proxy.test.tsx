import assert from "node:assert/strict";
import test from "node:test";

import { handlePublicAssetRequest, type PublicAssetFetcher } from "./public-asset-proxy";

const HEX = "c".repeat(64);
const APPROVED_KEY = `approved:${HEX}`;
const BACKEND_ORIGIN = "http://127.0.0.1:4000";

function streamingResponse(headers: Record<string, string>, status = 200): Response {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new TextEncoder().encode(`chunk-${pulls}`));
      if (pulls >= 3) {
        controller.close();
      }
    }
  });
  const response = new Response(body, { status, headers });
  return response;
}

function makeHarness(overrides: {
  backend?: PublicAssetFetcher | null;
  response?: Response;
  env?: Record<string, string | undefined>;
} = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const backend: PublicAssetFetcher =
    overrides.backend === null
      ? async () => {
          throw new Error("the proxy must not reach the backend for this request");
        }
      : (overrides.backend ??
        (async (url, init) => {
          calls.push({ url, init });
          return (
            overrides.response ??
            streamingResponse({
              "Content-Type": "image/webp",
              "Content-Length": "12",
              ETag: `"${"c".repeat(64)}"`,
              "Cache-Control": "public, max-age=31536000, immutable",
              "Set-Cookie": "session=secret",
              "X-Internal-Trace": "backend-node-1"
            })
          );
        }));
  // "env in overrides" keeps an explicit undefined from becoming the fixture:
  // a missing env is exactly the fail-closed case under test.
  const env = "env" in overrides ? overrides.env : { MYSTCRAG_BACKEND_ORIGIN: BACKEND_ORIGIN };
  return {
    calls,
    handle: (assetKeyParam: string) => handlePublicAssetRequest({ assetKeyParam, env, fetcher: backend })
  };
}

test("a strictly valid approved key is forwarded once to the backend asset route", async () => {
  const harness = makeHarness();
  const response = await harness.handle(APPROVED_KEY);

  assert.equal(response.status, 200);
  assert.deepEqual(
    harness.calls.map((call) => call.url),
    [`${BACKEND_ORIGIN}/api/assets/${encodeURIComponent(APPROVED_KEY)}`],
    "exactly one upstream request with the encoded key"
  );
  assert.equal(await response.text(), "chunk-1chunk-2chunk-3", "the body streams through");
});

test("the proxy forwards only the allowlisted delivery headers", async () => {
  const harness = makeHarness();
  const response = await harness.handle(APPROVED_KEY);

  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("etag"), `"${"c".repeat(64)}"`);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("set-cookie"), null, "no cookie may pass through");
  assert.equal(response.headers.get("x-internal-trace"), null, "internal headers are dropped");
});

test("the proxy sends no credentials and forwards no request headers", async () => {
  const harness = makeHarness();
  await harness.handle(APPROVED_KEY);
  const init = harness.calls[0]?.init;
  assert.ok(init !== undefined);
  const headers = new Headers(init.headers);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("x-admin-key"), null);
});

test("malformed keys are rejected locally with zero upstream requests", async () => {
  const harness = makeHarness();
  const malformed = [
    "",
    "approved:",
    "approved:/../../etc/passwd",
    "approved:%2e%2e%2fraw",
    `approved:${"A".repeat(64)}`,
    `approved:${"a".repeat(63)}`,
    `approved:${"a".repeat(65)}`,
    `approved:${"g".repeat(64)}`,
    "imports/session-1/raw/x.jpg",
    "approved:<script>",
    `${APPROVED_KEY}/..`,
    `  ${APPROVED_KEY}  `
  ];
  for (const key of malformed) {
    const response = await harness.handle(key);
    assert.equal(response.status, 400, `key ${key} must be rejected locally`);
    assert.deepEqual(harness.calls, [], `key ${key} must never reach the backend`);
    const body = await response.text();
    assert.ok(
      key === "" || !body.includes(key),
      "the rejection must not echo the rejected key"
    );
  }
});

test("an unknown or unpublished asset forwards the backend 404 without echoing detail", async () => {
  const harness = makeHarness({
    response: new Response(JSON.stringify({ error: { message: "internal path /var/archive/x" } }), {
      status: 404,
      headers: { "content-type": "application/json" }
    })
  });
  const response = await harness.handle(APPROVED_KEY);
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.ok(!body.includes("/var/archive"), "upstream error detail must be redacted");
});

test("a backend outage fails safely without leaking the origin", async () => {
  const harness = makeHarness({ backend: null });
  const response = await harness.handle(APPROVED_KEY);
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.ok(!body.includes(BACKEND_ORIGIN));
  assert.ok(!body.includes("transient"));
});

test("missing configuration fails closed with zero upstream requests", async () => {
  // The recording fetcher would answer 200 to any attempted origin, so a call
  // recorded here would fail the assertion — proving no request was made.
  for (const env of [undefined, {}]) {
    const harness = makeHarness({ env });
    const response = await harness.handle(APPROVED_KEY);
    assert.equal(response.status, 502, `env ${JSON.stringify(env)} must fail closed`);
    assert.deepEqual(
      harness.calls,
      [],
      `env ${JSON.stringify(env)} must never reach any upstream listener`
    );
    const body = await response.text();
    assert.ok(!body.includes("127.0.0.1"));
  }

  for (const origin of ["", "   ", "ftp://bad", "not-a-url"]) {
    const harness = makeHarness({ env: { MYSTCRAG_BACKEND_ORIGIN: origin } });
    const response = await harness.handle(APPROVED_KEY);
    assert.equal(response.status, 502, `origin "${origin}" must fail closed`);
    assert.deepEqual(harness.calls, [], `origin "${origin}" must never reach any upstream listener`);
  }
});

test("only a pure http(s) origin is accepted; credentials, paths, queries and fragments fail closed", async () => {
  const impure = [
    "http://user:pass@127.0.0.1:4000",
    "https://user@127.0.0.1:4000",
    "http://127.0.0.1:4000/base",
    "http://127.0.0.1:4000/base/",
    "http://127.0.0.1:4000?x=1",
    "http://127.0.0.1:4000#frag",
    "http://127.0.0.1:4000/api/other"
  ];
  for (const origin of impure) {
    const harness = makeHarness({ env: { MYSTCRAG_BACKEND_ORIGIN: origin } });
    const response = await harness.handle(APPROVED_KEY);
    assert.equal(response.status, 502, `origin "${origin}" must be rejected`);
    assert.deepEqual(harness.calls, [], `origin "${origin}" must never receive a request`);
  }
});

test("origin spellings that URL parsing would silently normalize fail closed", async () => {
  // new URL ignores leading/trailing whitespace, strips TAB/CR/LF anywhere,
  // normalizes away empty ?/#, backslashes and dot segments — so the RAW text
  // must be byte-identical to the canonical origin (with at most one trailing
  // slash) or the proxy refuses, because such spellings can change what the
  // joined fetch URL actually targets.
  const bypass = [
    ` ${BACKEND_ORIGIN}`,
    `${BACKEND_ORIGIN} `,
    `\t${BACKEND_ORIGIN}`,
    `${BACKEND_ORIGIN}\t`,
    `\r${BACKEND_ORIGIN}`,
    `\n${BACKEND_ORIGIN}`,
    "ht\ttp://127.0.0.1:4000",
    `${BACKEND_ORIGIN}?`,
    `${BACKEND_ORIGIN}#`,
    "http:\\/\\/127.0.0.1:4000",
    `${BACKEND_ORIGIN}\\`,
    `${BACKEND_ORIGIN}/.`,
    `${BACKEND_ORIGIN}/..`,
    `${BACKEND_ORIGIN}/./`,
    `${BACKEND_ORIGIN}/../`,
    `${BACKEND_ORIGIN}/%2e`,
    `${BACKEND_ORIGIN}/%2e%2e`,
    `${BACKEND_ORIGIN}?#`,
    "http://127.0.0.1:80"
  ];
  for (const origin of bypass) {
    const harness = makeHarness({ env: { MYSTCRAG_BACKEND_ORIGIN: origin } });
    const response = await harness.handle(APPROVED_KEY);
    assert.equal(response.status, 502, `origin ${JSON.stringify(origin)} must be refused`);
    assert.deepEqual(
      harness.calls,
      [],
      `origin ${JSON.stringify(origin)} must never receive a request`
    );
  }
});

test("a valid origin with a trailing slash is normalized and requested exactly once", async () => {
  const harness = makeHarness({ env: { MYSTCRAG_BACKEND_ORIGIN: `${BACKEND_ORIGIN}/` } });
  const response = await harness.handle(APPROVED_KEY);
  assert.equal(response.status, 200);
  assert.deepEqual(
    harness.calls.map((call) => call.url),
    [`${BACKEND_ORIGIN}/api/assets/${encodeURIComponent(APPROVED_KEY)}`],
    "the normalized origin joins exactly the approved-key asset path"
  );
});

test("the proxy core never mentions admin surfaces or storage roots", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(join(__dirname, "./public-asset-proxy.ts"), "utf8");
  for (const forbidden of ["x-admin-key", "archiveKey", "storageKey", "MYSTCRAG_ASSET_ARCHIVE_ROOT", "document.cookie"]) {
    assert.ok(!source.includes(forbidden), `the public proxy must not mention ${forbidden}`);
  }
});
