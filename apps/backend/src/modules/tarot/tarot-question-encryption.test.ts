import assert from "node:assert/strict";
import test from "node:test";

import {
  AesGcmTarotQuestionEncryption,
  createTarotQuestionEncryptionFromEnvironment
} from "./tarot-question-encryption.js";

const key = Buffer.alloc(32, 7);
const encodedKey = key.toString("base64");

test("AES-256-GCM question encryption uses a strict randomized authenticated envelope", async () => {
  const encryption = new AesGcmTarotQuestionEncryption(key);
  const question = "A private Tarot question 私密问题";
  const first = await encryption.encrypt(question);
  const second = await encryption.encrypt(question);

  assert.notEqual(second, first);
  assert.equal(first.includes(question), false);
  const envelope = JSON.parse(first) as {
    version: string;
    algorithm: string;
    questionId: string;
    nonce: string;
    tag: string;
    ciphertext: string;
  };
  assert.deepEqual(Object.keys(envelope).sort(), [
    "algorithm",
    "ciphertext",
    "nonce",
    "questionId",
    "tag",
    "version"
  ]);
  assert.equal(envelope.version, "tarot-question-v2");
  assert.equal(envelope.algorithm, "AES-256-GCM");
  assert.equal(Buffer.from(envelope.nonce, "base64url").length, 12);
  assert.equal(Buffer.from(envelope.tag, "base64url").length, 16);
  assert.equal(Buffer.from(envelope.questionId, "base64url").length, 32);
  assert.equal(envelope.questionId, JSON.parse(second).questionId);
  assert.equal(envelope.questionId.includes(question), false);
  assert.ok(Buffer.from(envelope.ciphertext, "base64url").length > 0);
  assert.equal(await encryption.matchesIdentity(question, first), true);
});

test("question encryption environment factory treats the documented empty value as disabled", () => {
  assert.equal(createTarotQuestionEncryptionFromEnvironment({}), undefined);
  assert.equal(createTarotQuestionEncryptionFromEnvironment({
    MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY: ""
  }), undefined);
  assert.equal(createTarotQuestionEncryptionFromEnvironment({
    MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY: "   "
  }), undefined);
});

test("question encryption environment factory rejects every non-empty invalid key", () => {
  for (const invalid of ["not-base64", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64")]) {
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

test("question identity matches the same plaintext without exposing a decrypt API", async () => {
  const encryption = new AesGcmTarotQuestionEncryption(key);
  const envelope = await encryption.encrypt("Should I change careers?");

  assert.equal(await encryption.matchesIdentity("Should I change careers?", envelope), true);
  assert.equal(await encryption.matchesIdentity("Should I move cities?", envelope), false);
  assert.equal(await encryption.matchesIdentity("Should I change careers?", "not-json"), false);
  const nonCanonical = JSON.stringify({
    ...JSON.parse(envelope),
    questionId: `${JSON.parse(envelope).questionId}!`
  });
  assert.equal(await encryption.matchesIdentity("Should I change careers?", nonCanonical), false);
});

test("identity matching authenticates the complete strict envelope and fails closed", async () => {
  const encryption = new AesGcmTarotQuestionEncryption(key);
  const wrongKeyEncryption = new AesGcmTarotQuestionEncryption(Buffer.alloc(32, 11));
  const question = "Should I change careers?";
  const alternateQuestion = "Should I move cities?";
  type EnvelopeFixture = {
    version: string;
    algorithm: string;
    questionId: string;
    nonce: string;
    tag: string;
    ciphertext: string;
  };
  const first = JSON.parse(await encryption.encrypt(question)) as EnvelopeFixture;
  const second = JSON.parse(await encryption.encrypt(alternateQuestion)) as EnvelopeFixture;
  const encode = (envelope: object): string => JSON.stringify(envelope);

  const malformedOrTampered = [
    { ...first, nonce: Buffer.alloc(11).toString("base64url") },
    { ...first, nonce: `${first.nonce}!` },
    { ...first, tag: Buffer.alloc(15).toString("base64url") },
    { ...first, tag: `${first.tag}!` },
    { ...first, ciphertext: "" },
    { ...first, ciphertext: `${first.ciphertext}!` },
    { ...first, ciphertext: second.ciphertext },
    { ...first, questionId: second.questionId },
    { ...first, extra: "not-allowed" },
    { ...first, version: "tarot-question-v1" },
    { ...first, algorithm: "AES-256-CBC" }
  ];

  for (const envelope of malformedOrTampered) {
    assert.equal(
      await encryption.matchesIdentity(question, encode(envelope)),
      false,
      JSON.stringify(envelope)
    );
  }
  assert.equal(await wrongKeyEncryption.matchesIdentity(question, encode(first)), false);
});
