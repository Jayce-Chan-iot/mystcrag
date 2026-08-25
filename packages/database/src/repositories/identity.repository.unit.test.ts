import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError } from "../errors/persistence-errors.js";
import {
  ExternalIdentityRepository,
  normalizeFindOrProvisionInput
} from "./identity.repository.js";

const untouchableClient = new Proxy(
  {},
  {
    get() {
      throw new Error("database client must not be touched during input validation");
    }
  }
) as never;

const repository = new ExternalIdentityRepository(untouchableClient);

const VALID_ISSUER = "https://mystcrag.auth0-app.example.com/";
const VALID_SUBJECT = "auth0|6f1c8f2e9b3d47a1";

async function expectValidationError(input: unknown, field: string): Promise<void> {
  await assert.rejects(
    repository.findOrProvisionExternalIdentity(input as never),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, new RegExp(`\\b${field}\\b`));
      return true;
    }
  );
}

test("issuer and subject are normalized deterministically", () => {
  const normalized = normalizeFindOrProvisionInput({
    issuer: `  ${VALID_ISSUER}  `,
    subject: `\t${VALID_SUBJECT}\n`
  });
  assert.equal(normalized.issuer, VALID_ISSUER);
  assert.equal(normalized.subject, VALID_SUBJECT);
});

test("profile hints normalize email casing and trim display names", () => {
  const normalized = normalizeFindOrProvisionInput({
    issuer: VALID_ISSUER,
    subject: VALID_SUBJECT,
    email: "  Ada.Example@Mystcrag.TEST ",
    displayName: "  Ada  "
  });
  assert.equal(normalized.email, "ada.example@mystcrag.test");
  assert.equal(normalized.displayName, "Ada");
});

test("empty or whitespace issuer is rejected before database access", async () => {
  for (const issuer of ["", "   ", "\t\n"]) {
    await expectValidationError({ issuer, subject: VALID_SUBJECT }, "issuer");
  }
});

test("empty or whitespace subject is rejected before database access", async () => {
  for (const subject of ["", "   "]) {
    await expectValidationError({ issuer: VALID_ISSUER, subject }, "subject");
  }
});

test("oversized issuer, subject, email, and displayName are rejected", async () => {
  await expectValidationError({ issuer: "x".repeat(513), subject: VALID_SUBJECT }, "issuer");
  await expectValidationError({ issuer: VALID_ISSUER, subject: "x".repeat(513) }, "subject");
  await expectValidationError(
    {
      issuer: VALID_ISSUER,
      subject: VALID_SUBJECT,
      email: `${"x".repeat(320)}@example.test`
    },
    "email"
  );
  await expectValidationError(
    { issuer: VALID_ISSUER, subject: VALID_SUBJECT, displayName: "x".repeat(201) },
    "displayName"
  );
});

test("control characters in identity keys are rejected", async () => {
  await expectValidationError({ issuer: `${VALID_ISSUER}\u0000`, subject: VALID_SUBJECT }, "issuer");
  await expectValidationError({ issuer: VALID_ISSUER, subject: `${VALID_SUBJECT}\u0007` }, "subject");
});

test("malformed profile hints are rejected deterministically", async () => {
  await expectValidationError(
    { issuer: VALID_ISSUER, subject: VALID_SUBJECT, email: "" },
    "email"
  );
  await expectValidationError(
    { issuer: VALID_ISSUER, subject: VALID_SUBJECT, email: "not-an-address" },
    "email"
  );
  await expectValidationError(
    { issuer: VALID_ISSUER, subject: VALID_SUBJECT, displayName: "   " },
    "displayName"
  );
  assert.throws(
    () =>
      normalizeFindOrProvisionInput({
        issuer: VALID_ISSUER,
        subject: VALID_SUBJECT,
        emailVerified: "yes" as never
      }),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, /emailVerified/);
      return true;
    }
  );
});
