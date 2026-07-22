# Mystcrag Backend Authentication Boundary Fix Report

## Identity

- Bug: `BUG-P3-005`
- Role: Backend Security Lead
- Branch: `fix/backend-auth-boundary`
- Original candidate: `acd4df836ccdf39bcf4c97108a6f976779990d45`
- Rebase baseline: `f182805c13ef557c3c03b081d244977296ceec18`
- Post-rebase candidate before final amendment: `54c477c3a42eeab857afbb6e7eaedf2bee29880d`
- Required commit title: `fix: enforce verified backend actor context`
- Final commit hash: reported in the Git handoff because a commit cannot contain its own SHA.
- Date: 2026-07-22

## Outcome

The Backend no longer reads `x-actor-id` as an identity source. Protected requests now follow this boundary:

```text
Authorization: Bearer <token>
  -> authentication pre-handler
  -> AuthProvider.verifyAccessToken
  -> verified issuer / audience / expiry / signature claims
  -> request ActorContext
  -> service actorId
```

The request body remains non-authoritative for ownership. The save boundary strips an injected top-level `ownerId`, and strict request schemas continue to reject unsupported ownership fields elsewhere.

## Protected routes

All Design Backend routes are protected, including the seven required owner workflows and the pricing route:

- `POST /api/design/generate`
- `POST /api/design/update`
- `POST /api/design/price`
- `POST /api/design/save`
- `POST /api/design/publish`
- `POST /api/orders/from-design`
- `GET /api/design/:id`
- `GET /api/design/:id/revisions`

`GET /health` and `GET /api/modules` remain public operational endpoints. No public Design read route was introduced, and owner reads do not reuse an anonymous or public context.

## Authentication components

- `AuthProvider` defines the replaceable verification boundary and returns only `VerifiedAuthClaims`.
- The authentication pre-handler accepts only a strict Bearer credential, delegates verification, and writes the verified subject into `ActorContext`.
- Controllers resolve `actorId` only from `ActorContext`; `x-actor-id` has no fallback path.
- `SignedTestTokenAuthProvider` is the V1 development/test adapter. It verifies an HMAC-SHA-256 signature plus exact issuer, required audience, and expiry.
- The environment factory requires `MYSTCRAG_AUTH_PROVIDER=signed-test`, `MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true`, and complete issuer/audience/secret configuration.
- Signed test authentication is rejected outside `test` and `development`, even if its opt-in flag is set.
- Backend startup constructs authentication before connecting to the database. Missing or unsupported production authentication configuration fails startup safely.
- No code path logs a credential or includes token/provider error details in an API response.

## API errors

The Backend-local stable error envelope now includes:

| Code | HTTP status | Meaning |
| --- | ---: | --- |
| `UNAUTHORIZED` | 401 | Bearer credential is missing, malformed, invalid, expired, or fails issuer/audience verification. |
| `FORBIDDEN` | 403 | A verified subject attempts an owner-scoped operation it cannot access. Missing and unowned owner resources use the same generic message to avoid disclosing ownership details. |

Authentication responses contain only the generic message `Authentication is required.` and the request ID. They never echo the token or verifier failure.

## Service, repository, transaction, and database impact

- Service behavior: Business service method signatures remain actor-explicit. The verified subject is now the only route-level source passed as `actorId`.
- Repository behavior: No repository implementation or port changed. Existing owner-scoped repository predicates remain authoritative.
- Transaction boundaries: Unchanged. Authentication and authorization occur before service persistence; generate/update/publish/order transaction semantics remain those documented in the Phase 3 Backend report.
- Database: No Prisma schema, migration, seed, table, index, trigger, or stored data changed.
- Shared DTOs: `packages/design-contract` was not modified. Design, pricing, revision, publication, and order DTOs remain unchanged.
- Shared architecture files: Not modified.

## Test evidence

Backend tests cover:

1. Missing credentials return `UNAUTHORIZED` on every protected route.
2. Invalid credentials return `UNAUTHORIZED` without token disclosure.
3. Expired credentials are rejected.
4. Wrong audience credentials are rejected.
5. Wrong issuer credentials are rejected.
6. A correctly structured token with an invalid signature is rejected.
7. `x-actor-id` alone is rejected and a forged header cannot override a verified subject.
8. Body `ownerId` injection is ignored at save.
9. A valid verified subject can read its own Design and revisions.
10. A verified subject cannot read or publish another owner's Design and receives `FORBIDDEN`.
11. Signed test identity requires explicit test/development enablement.
12. Production rejects signed test identity even when the flag is present.
13. Production without an authentication provider fails safely.

The Backend test command was corrected to quote its recursive glob, ensuring application, authentication, and nested Design tests all run rather than allowing shell expansion to select only one directory.

Focused verification:

- `pnpm --filter @mystcrag/backend test`: 15/15 passed.
- `pnpm --filter @mystcrag/backend build`: passed.
- `pnpm validate`: passed; all 7 workspace lint, typecheck, test, and build tasks succeeded, with 7/7 root architecture tests passing.

## Configuration

Development/test signed-token configuration requires:

```text
NODE_ENV=test|development
MYSTCRAG_AUTH_PROVIDER=signed-test
MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true
MYSTCRAG_AUTH_SIGNING_SECRET=<at least 32 characters>
MYSTCRAG_AUTH_ISSUER=<exact expected issuer>
MYSTCRAG_AUTH_AUDIENCE=<required audience>
```

Production intentionally has no built-in test identity fallback. A production JWT or Session Provider adapter must be supplied before deployment.

## Known limitations and dependencies

- V1 supplies a signed deterministic test/development provider, not a commercial login system.
- A production JWT/JWKS or session adapter is still required. Until then, production startup safely refuses the unsupported/missing configuration.
- Key rotation, revocation, refresh tokens, login UI, rate limiting, and account lifecycle are outside `BUG-P3-005`.
- This change does not create a public Design projection endpoint; such an endpoint requires a separate public authorization design.

## Scope confirmation

Task-owned changes are limited to `apps/backend`, this report, and the explicitly approved `docs/API_SPECIFICATION.md` authentication update under `DEC-P35-AUTH-BOUNDARY-001`. No Frontend, UI, AI Agent, Three Engine, Design Contract, or Database file is part of this fix.

The original candidate was cleanly rebased from `8ae159a` onto post-coordination `main@f182805`; no conflict occurred. Backup ref `backup/backend-auth-pre-rebase-acd4df8` preserves the pre-rebase candidate. The final `main...HEAD` inventory and final commit hash are reported in the Git handoff after the amended commit is created.
