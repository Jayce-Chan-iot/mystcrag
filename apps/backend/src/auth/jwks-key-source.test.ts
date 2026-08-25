import assert from "node:assert/strict";
import test from "node:test";

import { ProviderUnavailableError } from "./auth-errors.js";
import { JwksKeySource, type JwksTransport } from "./jwks-key-source.js";

type JwksResponse = {
  status: number;
  cacheControl?: string | null;
  body?: unknown;
};

function recordingTransport(handler: (call: number) => JwksResponse | Error) {
  let calls = 0;
  const transport: JwksTransport = async () => {
    calls += 1;
    const result = handler(calls);
    if (result instanceof Error) {
      throw result;
    }
    return {
      status: result.status,
      cacheControl: result.cacheControl ?? null,
      json: async () => result.body
    };
  };
  return {
    transport,
    calls: () => calls
  };
}

function keySetFor(kids: readonly string[]) {
  return { keys: kids.map((kid) => ({ kty: "RSA", kid, use: "sig", alg: "RS256" })) };
}

const JWKS_URL = "https://tenant.auth0.example.com/.well-known/jwks.json";

test("jwks key source caches a successful key set within its TTL", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  const first = await source.getJwks("kid-a");
  const second = await source.getJwks("kid-a");

  assert.equal(first.keys.length, 1);
  assert.equal(second.keys.length, 1);
  assert.equal(calls(), 1);
});

test("jwks key source refreshes after the cached entry expires", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs,
    maxCacheMs: 60_000
  });

  await source.getJwks("kid-a");
  nowMs += 61_000;
  await source.getJwks("kid-a");

  assert.equal(calls(), 2);
});

test("jwks key source honors a shorter provider cache directive", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    cacheControl: "public, max-age=60",
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs,
    maxCacheMs: 900_000
  });

  await source.getJwks("kid-a");
  nowMs += 61_000;
  await source.getJwks("kid-a");

  assert.equal(calls(), 2, "a 60s provider directive must override the 15m cap");
});

test("a cached key set stays usable while the provider is unavailable", async () => {
  let nowMs = 1_000_000;
  const responses = [() => ({ status: 200, body: keySetFor(["kid-a"]) })];
  const { transport, calls } = recordingTransport(() => {
    const next = responses.shift();
    if (!next) throw new Error("provider outage");
    return next();
  });
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await source.getJwks("kid-a");
  nowMs += 1_000;
  const cached = await source.getJwks("kid-a");

  assert.equal(cached.keys.length, 1);
  assert.equal(calls(), 1, "a fresh cache hit must not contact the provider");
});

test("jwks unavailability with no valid cache fails closed as provider unavailable", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => new Error("connection refused"));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);
  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);

  assert.equal(calls(), 1, "the negative cache must suppress immediate retries");
});

test("a failed refresh keeps serving an unknown but TTL-fresh kid only after refresh", async () => {
  let nowMs = 1_000_000;
  const responses: Array<() => JwksResponse> = [
    () => ({ status: 200, body: keySetFor(["kid-a"]) })
  ];
  const { transport, calls } = recordingTransport(() => {
    const next = responses.shift();
    if (!next) throw new Error("outage");
    return next();
  });
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await source.getJwks("kid-a");
  nowMs += 1_000;
  await assert.rejects(source.getJwks("kid-b"), ProviderUnavailableError);

  assert.equal(calls(), 2, "an unknown kid triggers exactly one bounded refresh attempt");
});

test("an expired cache cannot serve keys when the refresh fails", async () => {
  let nowMs = 1_000_000;
  const responses: Array<() => JwksResponse> = [
    () => ({ status: 200, body: keySetFor(["kid-a"]) })
  ];
  const { transport } = recordingTransport(() => {
    const next = responses.shift();
    if (!next) throw new Error("outage");
    return next();
  });
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs,
    maxCacheMs: 60_000
  });

  await source.getJwks("kid-a");
  nowMs += 61_000;

  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);
});

test("non-200 and malformed responses are provider unavailability", async () => {
  let nowMs = 1_000_000;
  const responses: Array<() => JwksResponse> = [
    () => ({ status: 503, body: keySetFor(["kid-a"]) }),
    () => ({ status: 200, body: { keys: "not-an-array" } }),
    () => ({ status: 200, body: { keys: [] } })
  ];
  const { transport, calls } = recordingTransport(() => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  });
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs,
    negativeCacheMs: 0
  });

  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);
  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);
  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);

  assert.equal(calls(), 3);
});

test("concurrent refreshes share a single in-flight request", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  const [first, second, third] = await Promise.all([
    source.getJwks("kid-a"),
    source.getJwks("kid-a"),
    source.getJwks("kid-a")
  ]);

  assert.equal(first.keys.length, 1);
  assert.equal(second.keys.length, 1);
  assert.equal(third.keys.length, 1);
  assert.equal(calls(), 1);
});

test("a transport that exceeds the request timeout fails closed", async () => {
  let nowMs = 1_000_000;
  const hangingTransport: JwksTransport = () =>
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error("too late")), 5_000);
    });
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport: hangingTransport,
    now: () => nowMs,
    requestTimeoutMs: 50
  });

  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);
});

test("the default transport rejects a non-HTTPS JWKS URL before any request", async () => {
  const source = new JwksKeySource({
    url: "http://tenant.auth0.example.com/.well-known/jwks.json"
  });

  await assert.rejects(source.getJwks("kid-a"), /HTTPS/);
});

test("the same unknown kid triggers exactly one bounded refresh", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await source.getJwks("kid-a");
  const first = await source.getJwks("kid-unknown");
  const second = await source.getJwks("kid-unknown");

  assert.equal(
    first.keys.some((key) => key.kid === "kid-unknown"),
    false
  );
  assert.equal(
    second.keys.some((key) => key.kid === "kid-unknown"),
    false
  );
  assert.equal(calls(), 2, "initial fetch + one bounded refresh, never a third");
});

test("different unknown kids within the cooldown share the single refresh", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await source.getJwks("kid-a");
  await source.getJwks("kid-unknown-1");
  await source.getJwks("kid-unknown-2");
  await source.getJwks("kid-unknown-3");

  assert.equal(calls(), 2, "random kids must not bypass the global cooldown");
});

test("after the cooldown expires a new kid gets one new bounded refresh", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs,
    negativeCacheMs: 30_000
  });

  await source.getJwks("kid-a");
  await source.getJwks("kid-unknown");
  nowMs += 31_000;
  await source.getJwks("kid-unknown-2");

  assert.equal(calls(), 3, "cooldown expiry allows exactly one new refresh");
});

test("a rotated key is discovered after the cooldown expires", async () => {
  let nowMs = 1_000_000;
  const responses: Array<() => JwksResponse> = [
    () => ({ status: 200, body: keySetFor(["kid-a"]) }),
    () => ({ status: 200, body: keySetFor(["kid-a"]) }),
    () => ({ status: 200, body: keySetFor(["kid-a", "kid-rotated"]) })
  ];
  const { transport, calls } = recordingTransport(() => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  });
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs,
    negativeCacheMs: 30_000
  });

  await source.getJwks("kid-a");
  await source.getJwks("kid-rotated");
  nowMs += 31_000;
  const rotated = await source.getJwks("kid-rotated");

  assert.equal(
    rotated.keys.some((key) => key.kid === "kid-rotated"),
    true,
    "the rotated key must be discoverable after the cooldown window"
  );
  assert.equal(calls(), 3);
});

test("a known cached key keeps verifying during the unknown-kid cooldown", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await source.getJwks("kid-a");
  await source.getJwks("kid-unknown");
  const known = await source.getJwks("kid-a");

  assert.equal(known.keys.some((key) => key.kid === "kid-a"), true);
  assert.equal(calls(), 2);
});

test("concurrent unknown kids do not cause a refresh storm", async () => {
  let nowMs = 1_000_000;
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: keySetFor(["kid-a"])
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await source.getJwks("kid-a");
  const results = await Promise.all([
    source.getJwks("kid-x1"),
    source.getJwks("kid-x2"),
    source.getJwks("kid-x3")
  ]);

  for (const jwks of results) {
    assert.equal(jwks.keys.length, 1);
  }
  assert.equal(calls(), 2, "concurrent unknown kids share one in-flight refresh");
});

test("a duplicate kid in the provider key set is provider unavailability", async () => {
  let nowMs = 1_000_000;
  const duplicated = {
    keys: [
      { kty: "RSA", kid: "kid-a", use: "sig", alg: "RS256" },
      { kty: "RSA", kid: "kid-a", use: "sig", alg: "RS256" }
    ]
  };
  const { transport, calls } = recordingTransport(() => ({
    status: 200,
    body: duplicated
  }));
  const source = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });

  await assert.rejects(source.getJwks("kid-a"), ProviderUnavailableError);

  assert.equal(calls(), 1);
});
