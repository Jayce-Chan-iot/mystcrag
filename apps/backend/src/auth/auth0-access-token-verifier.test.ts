import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { CredentialRejectedError, ProviderUnavailableError } from "./auth-errors.js";
import { Auth0AccessTokenVerifier } from "./auth0-access-token-verifier.js";
import { JwksKeySource, type JwksTransport } from "./jwks-key-source.js";

const ISSUER = "https://mystcrag-tenant.auth0.example.com/";
const AUDIENCE = "https://api.mystcrag.example.com";
const JWKS_URL = "https://mystcrag-tenant.auth0.example.com/.well-known/jwks.json";

type KeyMaterial = {
  kid: string;
  publicJwk: Record<string, unknown>;
  mint: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string>;
};

async function keyMaterialFor(kid: string): Promise<KeyMaterial> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, use: "sig", alg: "RS256" };
  return {
    kid,
    publicJwk,
    mint: (claims, header = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid, typ: "JWT", ...header })
        .sign(privateKey)
  };
}

let keyA: KeyMaterial;
let keyB: KeyMaterial;

test.before(async () => {
  keyA = await keyMaterialFor("auth0-key-a");
  keyB = await keyMaterialFor("auth0-key-b");
});

type Harness = {
  verifier: Auth0AccessTokenVerifier;
  transport: JwksTransport;
  calls: () => number;
  respondWith: (kids: readonly KeyMaterial[], cacheControl?: string) => void;
  failWith: () => void;
  advanceMs: (ms: number) => void;
};

async function createHarness(options: { kids?: readonly KeyMaterial[] } = {}): Promise<Harness> {
  let nowMs = 1_700_000_000_000;
  let callCount = 0;
  let mode: { kind: "serve"; kids: readonly KeyMaterial[]; cacheControl: string | null } | {
    kind: "fail";
  } = { kind: "serve", kids: options.kids ?? [keyA], cacheControl: null };

  const transport: JwksTransport = async () => {
    callCount += 1;
    const current = mode;
    if (current.kind === "fail") throw new Error("provider outage");
    return {
      status: 200,
      cacheControl: current.cacheControl,
      json: async () => ({ keys: current.kids.map((key) => key.publicJwk) })
    };
  };

  const keySource = new JwksKeySource({
    url: JWKS_URL,
    transport,
    now: () => nowMs
  });
  const verifier = new Auth0AccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keySource,
    now: () => new Date(nowMs)
  });

  return {
    verifier,
    transport,
    calls: () => callCount,
    respondWith(kids, cacheControl) {
      mode = { kind: "serve", kids, cacheControl: cacheControl ?? null };
    },
    failWith() {
      mode = { kind: "fail" };
    },
    advanceMs(ms) {
      nowMs += ms;
    }
  };
}

async function validToken(overrides: Record<string, unknown> = {}, key = keyA) {
  return key.mint({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "auth0|6f1c8f2e9b3d47a1",
    exp: Math.floor(1_700_000_000_000 / 1000) + 900,
    email: "ada@mystcrag.example.com",
    email_verified: true,
    name: "Ada Lovelace",
    ...overrides
  });
}

function rejectionReason(error: unknown): string {
  assert.ok(error instanceof CredentialRejectedError, `expected credential rejection: ${error}`);
  return error.reason;
}

test("a valid auth0 access token verifies and projects provider-neutral claims", async () => {
  const harness = await createHarness();
  const token = await validToken();

  const claims = await harness.verifier.verifyAccessToken(token);

  assert.equal(claims.subject, "auth0|6f1c8f2e9b3d47a1");
  assert.equal(claims.issuer, ISSUER);
  assert.deepEqual(claims.audience, [AUDIENCE]);
  assert.equal(claims.expiresAtEpochSeconds, Math.floor(1_700_000_000_000 / 1000) + 900);
  assert.equal(claims.email, "ada@mystcrag.example.com");
  assert.equal(claims.emailVerified, true);
  assert.equal(claims.displayName, "Ada Lovelace");
});

test("profile hints are omitted when the token does not carry them", async () => {
  const harness = await createHarness();
  const token = await validToken({ email: undefined, email_verified: undefined, name: undefined });

  const claims = await harness.verifier.verifyAccessToken(token);

  assert.equal(claims.email, undefined);
  assert.equal(claims.emailVerified, undefined);
  assert.equal(claims.displayName, undefined);
});

test("an expired token is rejected", async () => {
  const harness = await createHarness();
  const expiredAt = Math.floor(1_700_000_000_000 / 1000) - 120;
  const token = await validToken({ exp: expiredAt });

  await assert.rejects(
    harness.verifier.verifyAccessToken(token),
    (error: unknown) => rejectionReason(error) === "expired"
  );
});

test("expiry within the 60 second clock skew is accepted", async () => {
  const harness = await createHarness();
  const slightlyExpired = Math.floor(1_700_000_000_000 / 1000) - 30;
  const token = await validToken({ exp: slightlyExpired });

  const claims = await harness.verifier.verifyAccessToken(token);

  assert.equal(claims.expiresAtEpochSeconds, slightlyExpired);
});

test("a token without an exp claim is rejected", async () => {
  const harness = await createHarness();
  const token = await validToken({ exp: undefined });

  await assert.rejects(
    harness.verifier.verifyAccessToken(token),
    (error: unknown) => rejectionReason(error) === "expired"
  );
});

test("a wrong issuer is rejected", async () => {
  const harness = await createHarness();
  const token = await validToken({ iss: "https://attacker.example.com/" });

  await assert.rejects(
    harness.verifier.verifyAccessToken(token),
    (error: unknown) => rejectionReason(error) === "issuer"
  );
});

test("a wrong audience is rejected", async () => {
  const harness = await createHarness();
  const token = await validToken({ aud: "https://other-api.example.com" });

  await assert.rejects(
    harness.verifier.verifyAccessToken(token),
    (error: unknown) => rejectionReason(error) === "audience"
  );
});

test("a bad signature is rejected", async () => {
  const harness = await createHarness({ kids: [keyA, keyB] });
  const forged = await keyB.mint(
    {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: "auth0|attacker",
      exp: Math.floor(1_700_000_000_000 / 1000) + 900
    },
    { kid: keyA.kid }
  );

  await assert.rejects(
    harness.verifier.verifyAccessToken(forged),
    (error: unknown) => rejectionReason(error) === "signature"
  );
});

test("a missing or empty subject is rejected", async () => {
  const harness = await createHarness();
  const missing = await validToken({ sub: undefined });
  const empty = await validToken({ sub: "   " });

  await assert.rejects(
    harness.verifier.verifyAccessToken(missing),
    (error: unknown) => rejectionReason(error) === "subject"
  );
  await assert.rejects(
    harness.verifier.verifyAccessToken(empty),
    (error: unknown) => rejectionReason(error) === "subject"
  );
});

test("a token without a kid or with a foreign algorithm is rejected as malformed", async () => {
  const harness = await createHarness();
  const signedWithoutKid = await new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "auth0|6f1c8f2e9b3d47a1",
    exp: Math.floor(1_700_000_000_000 / 1000) + 900
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .sign((await generateKeyPair("RS256", { extractable: true })).privateKey);

  await assert.rejects(
    harness.verifier.verifyAccessToken("not-a-jwt"),
    (error: unknown) => rejectionReason(error) === "malformed"
  );
  await assert.rejects(
    harness.verifier.verifyAccessToken(signedWithoutKid),
    (error: unknown) => rejectionReason(error) === "malformed"
  );
});

test("an unknown kid triggers exactly one bounded refresh and then rejects", async () => {
  const harness = await createHarness({ kids: [keyA] });
  const token = await validToken({}, keyB);

  await assert.rejects(
    harness.verifier.verifyAccessToken(token),
    (error: unknown) => rejectionReason(error) === "unknown_key"
  );

  assert.equal(harness.calls(), 1, "the unknown kid must trigger one refresh attempt");
});

test("key rotation is picked up after a refresh", async () => {
  const harness = await createHarness({ kids: [keyA] });
  await harness.verifier.verifyAccessToken(await validToken());
  harness.respondWith([keyA, keyB]);
  const rotated = await validToken({}, keyB);

  const claims = await harness.verifier.verifyAccessToken(rotated);

  assert.equal(claims.subject, "auth0|6f1c8f2e9b3d47a1");
  assert.equal(harness.calls(), 2, "the rotated key requires a single refresh");
});

test("a cached key verifies without another JWKS request", async () => {
  const harness = await createHarness();
  const token = await validToken();

  await harness.verifier.verifyAccessToken(token);
  await harness.verifier.verifyAccessToken(token);

  assert.equal(harness.calls(), 1);
});

test("cache expiry triggers a fresh JWKS request", async () => {
  const harness = await createHarness();
  const token = await validToken();

  await harness.verifier.verifyAccessToken(token);
  harness.advanceMs(901_000);
  await harness.verifier.verifyAccessToken(token);

  assert.equal(harness.calls(), 2);
});

test("jwks unavailability with a valid cached key still verifies", async () => {
  const harness = await createHarness();
  const token = await validToken();

  await harness.verifier.verifyAccessToken(token);
  harness.failWith();
  harness.advanceMs(1_000);

  const claims = await harness.verifier.verifyAccessToken(token);

  assert.equal(claims.subject, "auth0|6f1c8f2e9b3d47a1");
  assert.equal(harness.calls(), 1);
});

test("jwks unavailability without a valid cached key fails as provider unavailable", async () => {
  const harness = await createHarness();
  harness.failWith();
  const token = await validToken();

  await assert.rejects(
    harness.verifier.verifyAccessToken(token),
    ProviderUnavailableError
  );

  await assert.rejects(
    harness.verifier.verifyAccessToken(token),
    ProviderUnavailableError
  );

  assert.equal(harness.calls(), 1, "the negative cache suppresses an immediate retry");
});

test("a jwks request timeout fails closed", async () => {
  let nowMs = 1_700_000_000_000;
  const hangingTransport: JwksTransport = () =>
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error("too late")), 5_000);
    });
  const keySource = new JwksKeySource({
    url: JWKS_URL,
    transport: hangingTransport,
    now: () => nowMs,
    requestTimeoutMs: 50
  });
  const verifier = new Auth0AccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keySource,
    now: () => new Date(nowMs)
  });
  const token = await validToken();

  await assert.rejects(verifier.verifyAccessToken(token), ProviderUnavailableError);
});
