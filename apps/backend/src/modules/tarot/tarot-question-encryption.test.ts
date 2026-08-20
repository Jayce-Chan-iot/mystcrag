import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import test from "node:test";

import {
  AesGcmTarotQuestionEncryption,
  createTarotQuestionEncryptionFromEnvironment
} from "./tarot-question-encryption.js";

const key = Buffer.alloc(32, 7);
const encodedKey = key.toString("base64");

test("AES-256-GCM question encryption uses a random nonce and contains no plaintext", async () => {
  const encryption = new AesGcmTarotQuestionEncryption(key);
  const question = "A private Tarot question 私密问题";
  const first = await encryption.encrypt(question);
  const second = await encryption.encrypt(question);

  assert.notEqual(second, first);
  assert.equal(first.includes(question), false);
  const envelope = JSON.parse(first) as {
    version: string;
    algorithm: string;
    nonce: string;
    tag: string;
    ciphertext: string;
  };
  assert.deepEqual(Object.keys(envelope).sort(), [
    "algorithm",
    "ciphertext",
    "nonce",
    "tag",
    "version"
  ]);
  assert.equal(envelope.version, "tarot-question-v1");
  assert.equal(envelope.algorithm, "AES-256-GCM");
  assert.equal(Buffer.from(envelope.nonce, "base64url").length, 12);
  assert.equal(Buffer.from(envelope.tag, "base64url").length, 16);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.nonce, "base64url")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
  assert.equal(plaintext, question);
});

test("question encryption environment factory is absent by default and rejects every invalid key", () => {
  assert.equal(createTarotQuestionEncryptionFromEnvironment({}), undefined);
  for (const invalid of ["", "not-base64", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64")]) {
    assert.throws(
      () => createTarotQuestionEncryptionFromEnvironment({
        MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY: invalid
      }),
      /32-byte.*base64/i
    );
  }
  assert.ok(createTarotQuestionEncryptionFromEnvironment({
    MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY: encodedKey
  }));
});
