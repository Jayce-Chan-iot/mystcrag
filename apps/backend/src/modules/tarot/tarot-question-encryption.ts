import {
  createCipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import type { TarotQuestionEncryptionPort } from "./tarot.types.js";

const KEY_ENV_NAME = "MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY";
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const QUESTION_ID_DOMAIN = "mystcrag:tarot-question-identity:v1\0";

const keyedQuestionId = (key: Buffer, question: string): Buffer =>
  createHmac("sha256", key)
    .update(QUESTION_ID_DOMAIN, "utf8")
    .update(question, "utf8")
    .digest();

function decodeKey(value: string): Buffer {
  const encoded = value.trim();
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error(`${KEY_ENV_NAME} must be a 32-byte base64 key.`);
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_LENGTH || key.toString("base64") !== encoded) {
    throw new Error(`${KEY_ENV_NAME} must be a 32-byte base64 key.`);
  }
  return key;
}

export class AesGcmTarotQuestionEncryption implements TarotQuestionEncryptionPort {
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (key.byteLength !== KEY_LENGTH) {
      throw new Error("Tarot question encryption requires a 32-byte key.");
    }
    this.key = Buffer.from(key);
  }

  async encrypt(question: string): Promise<string> {
    if (question.length === 0) {
      throw new Error("Tarot question encryption requires non-empty plaintext.");
    }
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(question, "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    const questionId = keyedQuestionId(this.key, question).toString("base64url");
    return JSON.stringify({
      version: "tarot-question-v2",
      algorithm: "AES-256-GCM",
      questionId,
      nonce: nonce.toString("base64url"),
      tag: tag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url")
    });
  }

  async matchesIdentity(question: string, ciphertext: string): Promise<boolean> {
    if (question.length === 0) return false;
    try {
      const envelope = JSON.parse(ciphertext) as unknown;
      if (
        typeof envelope !== "object" ||
        envelope === null ||
        !("version" in envelope) ||
        envelope.version !== "tarot-question-v2" ||
        !("algorithm" in envelope) ||
        envelope.algorithm !== "AES-256-GCM" ||
        !("questionId" in envelope) ||
        typeof envelope.questionId !== "string"
      ) {
        return false;
      }
      const stored = Buffer.from(envelope.questionId, "base64url");
      const expected = keyedQuestionId(this.key, question);
      return stored.toString("base64url") === envelope.questionId &&
        stored.length === expected.length &&
        timingSafeEqual(stored, expected);
    } catch {
      return false;
    }
  }
}

export function createTarotQuestionEncryptionFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): TarotQuestionEncryptionPort | undefined {
  const configured = environment[KEY_ENV_NAME];
  if (configured === undefined) return undefined;
  return new AesGcmTarotQuestionEncryption(decodeKey(configured));
}
