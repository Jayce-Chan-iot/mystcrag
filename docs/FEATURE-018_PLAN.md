# FEAT-018 Plan — Production Identity & Session

**Priority:** P0 for commercial release<br>
**Recommended next Feature:** yes, and the only major Feature selected<br>
**Dispatch state:** blocked by baseline P0 and provider/session-topology decision<br>
**Contract marker:** `CONTRACT_REQUIRES_IMPLEMENTATION_VALIDATION`

## Objective

Replace the development fixed-token path with a production-verifiable identity and session lifecycle so one real user can safely own designs, revisions, publications, Tarot sessions and orders across browser sessions and devices.

## User story

As a customer, I can sign in, return to the app, access only my saved work and orders, and sign out. Expired or revoked sessions return me to a safe sign-in path without exposing another user's data or losing an unsaved local editing warning.

## Current state

- Backend protected routes require a Bearer token through one `AuthProvider` interface.
- Verified subject becomes `actorId`; repositories apply actor-scoped queries.
- `SignedTestTokenAuthProvider` verifies signature, issuer, audience and expiry, and cannot start in production.
- Prisma `User` owns designs, revisions, publications, orders and Tarot sessions.
- Test fixtures pre-create users whose IDs match actor subjects.
- Frontend reads `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`, which is public build-time configuration rather than a user session.
- There is no production provider, login/callback/logout UX, refresh/revocation policy, external-identity mapping or idempotent user provisioning path.

## Gap

1. Product Owner selection of an identity provider, environments, callback/logout domains and account-recovery policy.
2. A provider-neutral verified-identity contract including issuer, subject, audience, expiry and permitted claims.
3. A collision-safe `(issuer, subject) -> User` persistence mapping and idempotent provisioning rule.
4. A browser-safe session topology. Tokens must not be stored in `localStorage`, rendered into client bundles or exposed through `NEXT_PUBLIC_*`.
5. Login, callback/loading/error, authenticated shell and logout behavior on desktop/mobile.
6. Expiry/revocation/error envelopes, operational key rotation and deployment configuration.
7. Automated cross-user isolation and full protected-flow browser verification.

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

TASK-AUTH-001 must freeze these decisions before implementation:

- **Domain contract:** immutable provider identity key is `(issuer, subject)`; email/display name are optional mutable profile claims and never an authorization key.
- **API contract:** stable semantics for login initiation, callback, session read, logout, `401 UNAUTHORIZED` and any `403 FORBIDDEN`; exact endpoints depend on selected topology.
- **State contract:** `unknown -> unauthenticated | authenticated | expired/error`; only the server/session boundary holds reusable credentials.
- **Persistence contract:** one external identity maps to one internal `User`; concurrent first login is idempotent; mapping changes require an audited linking process.
- **Events:** sign-in success/failure, logout, provisioning and verification failure are structured operational events without token or sensitive-claim logging.
- **Security contract:** issuer/audience/expiry/signature validation, clock-skew limit, key rotation/cache behavior, CSRF/state/nonce/PKCE as applicable, cookie properties as applicable, and fail-closed startup.

The selected provider SDK, callback hosting topology and whether the browser uses a backend cookie or a Next server/BFF session cannot be inferred safely from current code or deployment docs. TASK-AUTH-001 must record the decision and validate it against the provider's current implementation before dependency or code tasks begin.

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

Until the baseline and contract gates close, this is an approved planning candidate—not implementation authorization.
