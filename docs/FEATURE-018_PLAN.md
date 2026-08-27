# FEAT-018 Plan — Production Identity & Session

**Priority:** P0 for commercial release<br>
**Recommended next Feature:** yes, and the only major Feature selected<br>
**Dispatch state:** AUTH-001 through AUTH-005 integrated; AUTH-006 isolated security/full-loop E2E is ready; AUTH-007 remains the final acceptance gate<br>
**Contract marker:** `IMPLEMENTATION_COMPLETE_ACCEPTANCE_PENDING`

## Objective

Replace the development fixed-token path with a production-verifiable identity and session lifecycle so one real user can safely own designs, revisions, publications, Tarot sessions and orders across browser sessions and devices.

## User story

As a customer, I can sign in, return to the app, access only my saved work and orders, and sign out. Expired or revoked sessions return me to a safe sign-in path without exposing another user's data or losing an unsaved local editing warning.

## Current state

- Backend protected routes accept only verified internal actors through the composed Auth0/JWKS verification and external-identity mapping boundary.
- Provider `(issuer, subject)` identities map idempotently to internal `User.id`; repositories continue applying actor-scoped queries.
- `SignedTestTokenAuthProvider` remains development/test-only and cannot start in production.
- Frontend uses the Auth0 SDK authenticated-encrypted, host-only HttpOnly Cookie Session and same-origin BFF; browser JavaScript receives no production Token.
- Login, callback, session restoration/rolling, exact-Origin POST logout, expiry/renewal handling and accessible desktop/mobile session affordances are implemented.
- AUTH-006 must now prove the integrated stack twice from a clean checkout, including responsive browser flows, expiry/revocation/provider outage, production-start negatives and two-user isolation. Only AUTH-007 may issue final Feature acceptance.

## Gap

Product Owner decisions and all cross-module semantics are now frozen by [AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md): Auth0; isolated environment clients and exact allowlists; Next.js Server/BFF token custody; provider-neutral identity; collision-safe mapping; cookie/session/API/error/environment contracts. Remaining gaps are implementation and validation only:

1. AUTH-002 pins supported dependencies and writes the environment template; actual staging/production domains remain deployment inputs.
2. AUTH-003 implements the additive `ExternalIdentity` mapping and 20-way idempotent provisioning.
3. AUTH-004 implements Auth0/JWKS verification and internal actor composition.
4. AUTH-005 implements the BFF session endpoints and removes production fixed-token use.
5. AUTH-006 proves security, expiry/revocation, responsive flows, and two-user isolation.
6. AUTH-007 performs the only final acceptance review.

## Architecture impact

| Boundary | Intended change |
| --- | --- |
| Domain | Add `VerifiedIdentity` and `AuthenticatedActor` semantics without changing business resource ownership. |
| Backend | Add the approved production verifier and map verified identity to an internal `User.id`; keep route pre-handler composition. |
| Persistence | Store external identity uniqueness without trusting mutable email; provision the internal user idempotently. |
| Frontend | Add server-safe session access and login/logout UX; remove the production fixed-token path. |
| API | Preserve stable error envelopes; define unauthenticated/expired/forbidden behavior and callback/session endpoints only after topology validation. |
| Operations | Add environment validation, secret/key rotation, callback configuration and recovery runbook. |
| QA | Add clean-session, expiry, logout, cross-user isolation and core protected-flow E2E. |

## Canonical components

- Backend `AuthProvider`, `VerifiedAuthClaims`, authentication pre-handler and `actorIdFromVerifiedContext` remain the verification composition boundary.
- Prisma `User` remains the internal account aggregate; business repositories continue accepting internal `actorId`.
- Design Contract remains the shared API/type authority if a cross-application session DTO is required.
- Existing Design, Order, Publication and Tarot repositories remain the resource authorization authority.
- `SignedTestTokenAuthProvider` remains an explicit development/test fixture only.

## Contract first

TASK-AUTH-001 freezes these decisions before implementation:

- **Domain contract:** immutable provider identity key is `(issuer, subject)`; email/display name are optional mutable profile claims and never an authorization key.
- **API contract:** stable semantics for login initiation, callback, session read, logout, `401 UNAUTHORIZED` and any `403 FORBIDDEN`; exact endpoints depend on selected topology.
- **State contract:** `unknown -> unauthenticated | authenticated | expired/error`; only the server/session boundary holds reusable credentials.
- **Persistence contract:** one external identity maps to one internal `User`; concurrent first login is idempotent; mapping changes require an audited linking process.
- **Events:** sign-in success/failure, logout, provisioning and verification failure are structured operational events without token or sensitive-claim logging.
- **Security contract:** issuer/audience/expiry/signature validation, clock-skew limit, key rotation/cache behavior, CSRF/state/nonce/PKCE as applicable, cookie properties as applicable, and fail-closed startup.

The frozen decisions are Auth0 OIDC Authorization Code + PKCE (`S256`), exact environment-specific allowlists, and a Next.js Server/BFF session with a host-only HttpOnly cookie. Exact SDK/package versions are deliberately an AUTH-002 implementation-validation probe, not an unresolved product decision.

## Constraints

- Do not make provider subject equal the internal user id without a documented issuer-scoped mapping.
- Do not store reusable access/refresh tokens in browser storage or `NEXT_PUBLIC_*` variables.
- Do not weaken actor filters in existing repositories or change Design/Order/Tarot ownership semantics.
- Development/test authentication must remain impossible to enable in production.
- No email-based authorization or silent account linking.
- Database/API/security contract changes update their controlling documents in the same task.
- One task owns each shared schema, package manifest, lockfile and CI path at a time.

## Out of scope

- Cart, payment, shipping, tax, refunds and fulfillment.
- Public community feed, social graph or moderation.
- Password storage or a custom identity provider.
- Enterprise SSO, organizations, tenants, white-label branding and role-based administration.
- Broad profile/preferences migration unrelated to minimum account identity.
- DIY refactor, 3D production promotion or unrelated dependency upgrades.

## Feature final acceptance

The Feature may report `FEATURE ACCEPTANCE: PASS` only when all are true:

- **Business flow:** a new user can sign in, is provisioned once, saves a design, returns in a clean browser session, sees only their designs/orders/Tarot data and signs out.
- **Functional:** login, callback/session restoration, logout, expiry and revocation behave according to the frozen contract.
- **Desktop/mobile:** at 1440×900 and 375×812 there is no horizontal scroll; sign-in/out and session-error actions remain visible and keyboard-operable.
- **Regression:** anonymous home/library behavior and authenticated design/recommendation/DIY/order/Tarot flows retain existing behavior.
- **Performance:** session lookup does not add more than the contract budget to p95 protected navigation; verifier key retrieval is bounded and cached per provider guidance.
- **Error handling:** provider unavailable, invalid state/nonce, expired/revoked token and missing user mapping fail closed with no secret/claim leakage.
- **Data persistence:** concurrent first login creates one identity mapping and one user; cross-user repository access is rejected.
- **Build:** install, lint, typecheck, unit/integration tests, production build and PostgreSQL verification pass.
- **E2E:** clean authenticated full-loop and two-user isolation tests pass in CI-compatible isolated runtime output.
- **Operations:** production startup validates required configuration; key rotation/revocation and rollback procedure are documented and exercised in test.

TASK-AUTH-001 records `CONTRACT_FROZEN_IMPLEMENTATION_PENDING`; it is not implementation or Feature acceptance. AUTH-002 through AUTH-007 must proceed serially/parallel only as registered, and only AUTH-007 may record final acceptance.
