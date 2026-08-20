import { createCipheriv, randomBytes } from "node:crypto";

import type { TarotQuestionEncryptionPort } from "./tarot.types.js";

const KEY_ENV_NAME = "MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY";
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;

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
    return JSON.stringify({
      version: "tarot-question-v1",
      algorithm: "AES-256-GCM",
      nonce: nonce.toString("base64url"),
      tag: tag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url")
    });
  }
}

export function createTarotQuestionEncryptionFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): TarotQuestionEncryptionPort | undefined {
  const configured = environment[KEY_ENV_NAME];
  if (configured === undefined) return undefined;
  return new AesGcmTarotQuestionEncryption(decodeKey(configured));
}
