import type { Prisma, PrismaClient } from "../../generated/client/client.js";

import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";

const MAX_ISSUER_LENGTH = 512;
const MAX_SUBJECT_LENGTH = 512;
const MAX_EMAIL_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ExternalIdentityProfileHints = {
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly displayName?: string;
};

export type FindOrProvisionExternalIdentityInput = {
  readonly issuer: string;
  readonly subject: string;
} & ExternalIdentityProfileHints;

export type ExternalIdentityMapping = {
  readonly identityId: string;
  readonly actorId: string;
  readonly created: boolean;
  readonly email: string | null;
  readonly emailVerified: boolean | null;
  readonly displayName: string | null;
};

type ExternalIdentityRow = {
  id: string;
  issuer: string;
  subject: string;
  userId: string;
  email: string | null;
  emailVerified: boolean | null;
  displayName: string | null;
};

type ExternalIdentityDb = PrismaClient | Prisma.TransactionClient;

function invalid(field: string, reason: string): PersistenceError {
  return new PersistenceError(
    "VALIDATION_ERROR",
    `External identity ${field} is invalid: ${reason}`
  );
}

function normalizeKeyPart(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string") throw invalid(field, "a string is required");
  const normalized = value.trim();
  if (normalized.length === 0) throw invalid(field, "it must not be empty");
  if (normalized.length > maxLength) {
    throw invalid(field, `it exceeds ${maxLength} characters`);
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw invalid(field, "control characters are not allowed");
  }
  return normalized;
}

function normalizeEmail(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid("email", "a string is required");
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) throw invalid("email", "it must not be empty");
  if (normalized.length > MAX_EMAIL_LENGTH) {
    throw invalid("email", `it exceeds ${MAX_EMAIL_LENGTH} characters`);
  }
  if (!EMAIL_PATTERN.test(normalized)) throw invalid("email", "it is not a valid address");
  return normalized;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid("displayName", "a string is required");
  const normalized = value.trim();
  if (normalized.length === 0) throw invalid("displayName", "it must not be empty");
  if (normalized.length > MAX_DISPLAY_NAME_LENGTH) {
    throw invalid("displayName", `it exceeds ${MAX_DISPLAY_NAME_LENGTH} characters`);
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw invalid("displayName", "control characters are not allowed");
  }
  return normalized;
}

function normalizeEmailVerified(value: boolean | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw invalid("emailVerified", "a boolean is required");
  return value;
}

export function normalizeFindOrProvisionInput(
  input: FindOrProvisionExternalIdentityInput
): Required<Pick<FindOrProvisionExternalIdentityInput, "issuer" | "subject">> &
  ExternalIdentityProfileHints {
  return {
    issuer: normalizeKeyPart(input.issuer, "issuer", MAX_ISSUER_LENGTH),
    subject: normalizeKeyPart(input.subject, "subject", MAX_SUBJECT_LENGTH),
    email: normalizeEmail(input.email),
    emailVerified: normalizeEmailVerified(input.emailVerified),
    displayName: normalizeDisplayName(input.displayName)
  };
}

function mapRow(row: ExternalIdentityRow, created: boolean): ExternalIdentityMapping {
  return {
    identityId: row.id,
    actorId: row.userId,
    created,
    email: row.email,
    emailVerified: row.emailVerified,
    displayName: row.displayName
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export class ExternalIdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrProvisionExternalIdentity(
    input: FindOrProvisionExternalIdentityInput
  ): Promise<ExternalIdentityMapping> {
    const { issuer, subject, email, emailVerified, displayName } =
      normalizeFindOrProvisionInput(input);

    return this.prisma
      .$transaction(async (tx) => {
        const existing = await tx.externalIdentity.findUnique({
          where: { issuer_subject: { issuer, subject } }
        });
        if (existing) {
          return mapRow(await this.applyProfileHints(tx, existing, { email, emailVerified, displayName }), false);
        }

        const user = await tx.user.create({ data: {} });
        const created = await tx.externalIdentity.create({
          data: {
            issuer,
            subject,
            userId: user.id,
            email: email ?? null,
            emailVerified: emailVerified ?? null,
            displayName: displayName ?? null
          }
        });
        return mapRow(created, true);
      })
      .catch(async (error: unknown) => {
        if (isUniqueConstraintViolation(error)) {
          const winner = await this.prisma.externalIdentity.findUnique({
            where: { issuer_subject: { issuer, subject } }
          });
          if (winner) {
            return mapRow(
              await this.applyProfileHints(this.prisma, winner, { email, emailVerified, displayName }),
              false
            );
          }
        }
        return rethrowPersistenceError(error);
      });
  }

  private async applyProfileHints(
    db: ExternalIdentityDb,
    row: ExternalIdentityRow,
    hints: ExternalIdentityProfileHints
  ): Promise<ExternalIdentityRow> {
    const data: { email?: string; emailVerified?: boolean; displayName?: string } = {};
    if (hints.email !== undefined && hints.email !== row.email) data.email = hints.email;
    if (hints.emailVerified !== undefined && hints.emailVerified !== row.emailVerified) {
      data.emailVerified = hints.emailVerified;
    }
    if (hints.displayName !== undefined && hints.displayName !== row.displayName) {
      data.displayName = hints.displayName;
    }
    if (Object.keys(data).length === 0) return row;
    return db.externalIdentity.update({ where: { id: row.id }, data });
  }
}
