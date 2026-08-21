import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import type { TarotQuestionEncryptionPort } from "./tarot.types.js";

const KEY_ENV_NAME = "MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY";
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const QUESTION_ID_LENGTH = 32;
const ENVELOPE_VERSION = "tarot-question-v2";
const ENVELOPE_ALGORITHM = "AES-256-GCM";
const KEY_DERIVATION_DOMAIN = "mystcrag:tarot-question-key-derivation:v2\0";
const QUESTION_ID_DOMAIN = "mystcrag:tarot-question-identity:v2\0";

type QuestionEnvelope = {
  readonly version: typeof ENVELOPE_VERSION;
  readonly algorithm: typeof ENVELOPE_ALGORITHM;
  readonly questionId: string;
  readonly nonce: string;
  readonly tag: string;
  readonly ciphertext: string;
};

const deriveSubkey = (masterKey: Buffer, purpose: "encryption" | "identity"): Buffer =>
  createHmac("sha256", masterKey)
    .update(KEY_DERIVATION_DOMAIN, "utf8")
    .update(purpose, "utf8")
    .digest();

const keyedQuestionId = (key: Buffer, question: string): Buffer =>
  createHmac("sha256", key)
    .update(QUESTION_ID_DOMAIN, "utf8")
    .update(question, "utf8")
    .digest();

const associatedData = (questionId: string): Buffer => Buffer.from(JSON.stringify({
  version: ENVELOPE_VERSION,
  algorithm: ENVELOPE_ALGORITHM,
  questionId
}), "utf8");

function decodeCanonicalBase64Url(value: unknown, expectedLength?: number): Buffer | undefined {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    decoded.toString("base64url") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    return undefined;
  }
  return decoded;
}

function parseEnvelope(value: string): {
  readonly envelope: QuestionEnvelope;
  readonly questionId: Buffer;
  readonly nonce: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
} | undefined {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ["algorithm", "ciphertext", "nonce", "questionId", "tag", "version"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    return undefined;
  }
  if (record.version !== ENVELOPE_VERSION || record.algorithm !== ENVELOPE_ALGORITHM) {
    return undefined;
  }
  const questionId = decodeCanonicalBase64Url(record.questionId, QUESTION_ID_LENGTH);
  const nonce = decodeCanonicalBase64Url(record.nonce, NONCE_LENGTH);
  const tag = decodeCanonicalBase64Url(record.tag, TAG_LENGTH);
  const ciphertext = decodeCanonicalBase64Url(record.ciphertext);
  if (!questionId || !nonce || !tag || !ciphertext) return undefined;
  return {
    envelope: record as QuestionEnvelope,
    questionId,
    nonce,
    tag,
    ciphertext
  };
}

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
  private readonly encryptionKey: Buffer;
  private readonly identityKey: Buffer;

  constructor(key: Uint8Array) {
    if (key.byteLength !== KEY_LENGTH) {
      throw new Error("Tarot question encryption requires a 32-byte key.");
    }
    const masterKey = Buffer.from(key);
    this.encryptionKey = deriveSubkey(masterKey, "encryption");
    this.identityKey = deriveSubkey(masterKey, "identity");
  }

  async encrypt(question: string): Promise<string> {
    if (question.length === 0) {
      throw new Error("Tarot question encryption requires non-empty plaintext.");
    }
    const nonce = randomBytes(NONCE_LENGTH);
    const questionId = keyedQuestionId(this.identityKey, question).toString("base64url");
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    cipher.setAAD(associatedData(questionId));
    const ciphertext = Buffer.concat([
      cipher.update(question, "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      version: ENVELOPE_VERSION,
      algorithm: ENVELOPE_ALGORITHM,
      questionId,
      nonce: nonce.toString("base64url"),
      tag: tag.toString("base64url"),
      ciphertext: ciphertext.toString("base64url")
    });
  }

  async matchesIdentity(question: string, ciphertext: string): Promise<boolean> {
    if (question.length === 0) return false;
    try {
      const parsed = parseEnvelope(ciphertext);
      if (!parsed) return false;
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, parsed.nonce);
      decipher.setAAD(associatedData(parsed.envelope.questionId));
      decipher.setAuthTag(parsed.tag);
      const plaintext = Buffer.concat([
        decipher.update(parsed.ciphertext),
        decipher.final()
      ]).toString("utf8");
      const plaintextIdentity = keyedQuestionId(this.identityKey, plaintext);
      const requestedIdentity = keyedQuestionId(this.identityKey, question);
      const authenticatedIdentityMatches = timingSafeEqual(parsed.questionId, plaintextIdentity);
      const requestedIdentityMatches = timingSafeEqual(parsed.questionId, requestedIdentity);
      return authenticatedIdentityMatches && requestedIdentityMatches;
    } catch {
      return false;
    }
  }
}

export function createTarotQuestionEncryptionFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): TarotQuestionEncryptionPort | undefined {
  const configured = environment[KEY_ENV_NAME];
  if (configured === undefined || configured.trim().length === 0) return undefined;
  return new AesGcmTarotQuestionEncryption(decodeKey(configured));
}
