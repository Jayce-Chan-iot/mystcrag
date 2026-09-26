import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptJsonPayload,
  encryptJsonPayload,
  generatePkcePair,
  generateState
} from "./oidc-session-crypto";

const SECRET = "b".repeat(64);

test("encrypt/decrypt round-trips JSON payloads", async () => {
  const payload = { hello: "world", n: 1 };
  const compact = await encryptJsonPayload(payload, SECRET, "session");
  assert.ok(compact.includes("."));
  const decoded = await decryptJsonPayload<typeof payload>(compact, SECRET, "session");
  assert.deepEqual(decoded, payload);
});

test("session and transaction ciphertexts are not interchangeable", async () => {
  const compact = await encryptJsonPayload({ a: 1 }, SECRET, "session");
  const decoded = await decryptJsonPayload(compact, SECRET, "transaction");
  assert.equal(decoded, null);
});

test("wrong secret cannot decrypt", async () => {
  const compact = await encryptJsonPayload({ a: 1 }, SECRET, "session");
  const decoded = await decryptJsonPayload(compact, "c".repeat(64), "session");
  assert.equal(decoded, null);
});

test("PKCE pair is S256-shaped and state is high entropy", async () => {
  const { verifier, challenge } = await generatePkcePair();
  assert.ok(verifier.length >= 32);
  assert.ok(challenge.length >= 32);
  assert.notEqual(verifier, challenge);
  assert.notEqual(generateState(), generateState());
});
