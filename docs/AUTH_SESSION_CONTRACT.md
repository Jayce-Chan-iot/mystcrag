# Mystcrag Identity and Session Contract

**Feature:** FEAT-018 Production Identity & Session

**Task:** TASK-AUTH-001

**Decision date:** 2026-08-25
**State:** `CONTRACT_FROZEN_IMPLEMENTATION_PENDING`

This document is the controlling production identity and browser-session contract. TASK-AUTH-001 freezes behavior only. AUTH-002 may select and pin dependencies and environment templates; AUTH-003 through AUTH-005 implement persistence, Backend verification, and the Next.js session boundary; AUTH-006 establishes security/E2E gates; only AUTH-007 may issue final Feature acceptance.

## 1. Approved architecture

- Identity provider: Auth0, using OIDC/OAuth 2.0 Authorization Code Flow with PKCE (`S256`).
- Environments: development, staging, and production use separate Auth0 Applications/Clients. Each has exact callback, logout, and web-origin allowlists. Wildcard callback/origin entries are forbidden.
- Browser topology:

```text
Browser
  -> opaque HttpOnly session cookie
  -> Next.js Server/BFF
  -> short-lived Access Token in Authorization header
  -> Fastify AuthProvider
  -> ExternalIdentity (issuer, subject)
  -> internal User.id
  -> actor-scoped repositories
```

- The Next.js Server/BFF is a confidential OIDC client and the browser's sole session authority. The browser never receives an Access Token or Refresh Token.
- Fastify remains the resource-server verification boundary. It validates signature, exact issuer, required audience, expiry, and permitted clock skew before identity mapping.
- Auth0-specific types, SDK sessions, claim objects, and identifiers stay behind provider adapters. They must not enter business Domain types, Database Repository interfaces, or the public Design Contract.
- The existing Knowledge Admin Cookie/key path is independent operator authentication. It must not be reused for customer identity or customer sessions.

## 2. Provider-neutral identity

The provider adapter projects only this semantic value:

```ts
type VerifiedIdentity = {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: readonly string[];
  readonly expiresAtEpochSeconds: number;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly displayName?: string;
};
```

Rules:

- `issuer`, `subject`, every audience entry, and optional strings are non-empty normalized strings. `expiresAtEpochSeconds` is a positive integer.
- The sole immutable external identity key is `(issuer, subject)`. `subject` alone is not globally unique.
- `email`, `emailVerified`, and `displayName` are mutable profile hints. They are neither authentication nor authorization keys.
- Internal `User.id` remains the business `actorId`. A provider subject must never be copied into or treated as `User.id`.
- No silent merge, lookup, provisioning, or account linking is allowed by email, including when `emailVerified=true`.
- Account linking is a separate future, explicit, re-authenticated, auditable task. AUTH-001 through AUTH-007 do not implement it.
- Business services and actor-scoped repositories consume internal `User.id`, never Auth0 SDK values or provider subjects.

## 3. External identity persistence contract

AUTH-003 will add the persistence implementation; AUTH-001 does not modify Prisma.

`ExternalIdentity` semantics:

| Field | Rule |
| --- | --- |
| `id` | Internal opaque primary key; not a provider subject |
| `issuer` | Exact normalized token issuer |
| `subject` | Exact normalized provider subject |
| `userId` | Required restrictive foreign key to internal `User.id` |
| profile hints | Optional mutable `email`, `emailVerified`, `displayName`; never authorization authority |
| timestamps | Server-generated creation/update audit metadata |

Required constraints and behavior:

- Unique `(issuer, subject)`; one `ExternalIdentity` maps to exactly one `User`.
- The same `subject` under two issuers is two distinct external identities and must not collide.
- Find-or-provision is one transaction with database uniqueness as the concurrency authority. Twenty simultaneous first-login attempts yield exactly one mapping and one new `User`; losers reread the winning mapping.
- An existing mapping always returns the same internal `User.id`. Email/display-name changes may update permitted hints but cannot change `actorId`.
- A unique-key race, transaction retry, or replay must not create orphan Users.
- Access Tokens, Refresh Tokens, authorization codes, PKCE verifiers, session secrets, and raw provider profiles are never stored in `ExternalIdentity` or business tables.
- A conflicting attempt to remap an existing `(issuer, subject)` fails closed and emits an audited security event; it never overwrites the mapping.

## 4. Browser session contract

### 4.1 Cookie

| Property | Contract |
| --- | --- |
| Staging/production name | `__Host-mystcrag_session` |
| Development/test name | `mystcrag_session` (prevents a non-Secure cookie from impersonating the production `__Host-` cookie) |
| Value | Auth0 Next.js SDK authenticated-encrypted Cookie Session artifact. It may contain server-encrypted session/token material but never plaintext Token or Claim |
| `HttpOnly` | Always true |
| `Secure` | Always true in production and staging; development may be false only for loopback HTTP |
| `SameSite` | `Lax` |
| `Path` | `/` |
| `Domain` | Omitted; host-only cookie. Required by the `__Host-` prefix |
| Idle expiry | 8 hours since the latest accepted same-origin session use |
| Absolute expiry | 7 days since authentication; rolling use never extends it |

The Auth0 Next.js SDK encrypted Cookie Session is the only FEAT-018 session mode. No Redis, Session database, persistent `SessionStore`, or `AuthSession` Prisma model is authorized. Authentication success issues a fresh encrypted cookie. Rolling-session handling reissues the encrypted cookie as accepted activity advances the idle expiry, but never extends absolute expiry. Browser JavaScript cannot read the `HttpOnly` cookie or recover any encrypted Token or Claim.

### 4.2 Token custody and lifetime

- Authorization codes and PKCE verifiers are available only to the server-side SDK transaction handling. Access Tokens, Refresh Tokens, ID Tokens, and session claims are available only after authenticated server-side decryption of the Cookie Session; the browser receives ciphertext but never plaintext credentials or claims.
- They are forbidden in `localStorage`, `sessionStorage`, IndexedDB, React/client state, HTML, RSC/client payloads, URLs, logs, telemetry, error messages, client bundles, and every `NEXT_PUBLIC_*` value.
- Existing non-authentication browser storage for design drafts, options, display settings, favorites, or completed-order presentation is outside this task and remains untouched.
- The BFF sends a short-lived audience-specific Access Token to Fastify only in the server-to-server `Authorization: Bearer` header. Production target lifetime is at most 15 minutes and must be enforced in the Auth0 API configuration by AUTH-002/004.
- If the encrypted Cookie Session contains a Refresh Token, rotation and reuse detection are mandatory. Reuse, renewal rejection, or grant revocation clears the current browser Cookie Session and requires interactive login.
- Auth0-side provider/admin grant revocation becomes effective at the next renewal attempt or when the current self-contained Access Token expires, whichever occurs first. The 15-minute Access Token maximum bounds this window.

### 4.3 Expiry, revocation, and logout

- Idle or absolute expiry: BFF invalidates the session, clears the cookie, returns unauthenticated session state, and never refreshes beyond absolute expiry.
- Provider/admin grant revocation: the current browser Cookie Session is rejected and cleared when renewal reports revocation, or after the current Access Token reaches its at-most-15-minute expiry. This scope makes no promise of earlier cross-browser invalidation.
- Refresh/grant renewal failure clears the current browser Cookie Session and requires interactive login. It is not retried in a loop.
- Active logout is idempotent and immediately expires the current browser's Cookie Session even if Auth0 is unavailable, then initiates the configured Auth0/OIDC logout. Failure to clear the upstream SSO session cannot resurrect the cleared local cookie.
- Session-secret rotation is a controlled forced logout for existing Cookie Sessions: deploy the new secret, reject cookies that cannot be decrypted by it, clear them on response, and require interactive login. FEAT-018 does not require a multi-key session store or cross-secret overlap.

### 4.4 CSRF, origin, transaction, redirect, and cache controls

- `POST /auth/logout` and every cookie-authenticated state-changing BFF route require exact `Origin` equality with `MYSTCRAG_APP_ORIGIN`. Missing or mismatched Origin fails closed. Fetch Metadata may add defense in depth but does not replace Origin validation.
- Login uses the SDK's authenticated-encrypted, HttpOnly transaction cookie to bind high-entropy, single-use, short-lived `state`, OIDC `nonce`, PKCE `code_verifier`, exact callback URI, and validated `returnTo`. PKCE uses `S256` only.
- Callback consumes the transaction once. Missing, expired, replayed, or mismatched state/nonce/verifier fails before a session is created.
- `returnTo` accepts only a same-origin relative path beginning with exactly one `/`. It rejects schemes, authority-relative `//`, backslashes, control characters, encoded authority/scheme bypasses, and any absolute URL. Invalid values fall back to `/`; they are never reflected to Auth0.
- Every auth endpoint response and every response carrying session/user state uses `Cache-Control: no-store`; redirects also use `Pragma: no-cache`. Shared/CDN caches must not store `Set-Cookie` or authenticated BFF responses.

## 5. HTTP endpoint contract

All error responses reuse the existing envelope:

```json
{"error":{"code":"UNAUTHORIZED","message":"Authentication is required.","requestId":"..."}}
```

No second auth-specific envelope is authorized. Public messages are generic; detailed causes are structured redacted logs only.

### `GET /auth/login`

- Input: optional query `returnTo`; no body; existing session cookie may be present.
- Success: `302 Found` to the Auth0 `/authorize` endpoint with `response_type=code`, exact client/callback/audience, OIDC scopes, unique `state`/`nonce`, and PKCE `S256` challenge.
- Cookie change: creates only a short-lived, authenticated-encrypted HttpOnly transaction cookie; it does not create the application session cookie.
- `returnTo`: normalized by section 4.4 and stored inside the authenticated-encrypted transaction cookie bound to opaque state.
- Cache: `no-store`, `Pragma: no-cache`.
- Stable failures: invalid user `returnTo` falls back to `/`; unavailable/misconfigured provider returns HTTP `500` with the existing `INTERNAL_ERROR` envelope and creates no transaction/session.

### `GET /auth/callback`

- Input: provider query `code` and `state`, or provider `error`; no caller-supplied redirect authority is accepted.
- Success: validate/consume state, exchange code with the bound PKCE verifier, validate ID-token issuer/audience/signature/expiry/nonce, derive provider-neutral identity, establish/rotate the BFF session, then `303 See Other` to the stored relative `returnTo` (default `/`).
- Cookie change: deletes transaction cookie; sets the session cookie using section 4.1.
- Cache: `no-store`, `Pragma: no-cache`.
- Stable failures: invalid/replayed state, nonce, PKCE, code, or provider-declared denial returns `401 UNAUTHORIZED` in the existing envelope, clears transaction material, creates no session, and must not redirect to untrusted input. Provider/token/JWKS dependency outage returns HTTP `500` with `INTERNAL_ERROR`; a safe same-origin error page may render the generic envelope semantics without claims or tokens.

### `POST /auth/logout`

- Input: no body; valid session is optional; exact same-origin `Origin` is required.
- Success: after local invalidation and cookie deletion, return `303 See Other` to the server-constructed Auth0 logout endpoint using only the configured client id and exact allowlisted `MYSTCRAG_AUTH_LOGOUT_URL`. No ID/Access/Refresh Token is placed in the URL. Auth0 then returns the browser to that configured same-origin URL.
- Cookie change: expire transaction and session cookies with identical name/path/security attributes.
- Cache: `no-store`, `Pragma: no-cache`.
- Stable failures: missing/mismatched Origin returns `403 FORBIDDEN` and does not disclose session presence. Repeated logout remains an idempotent `303` sequence. Auth0 outage or failed upstream navigation does not undo local logout and is recorded as a redacted operational warning when observable.

### `GET /auth/session`

- Input: session cookie only; no token/header identity accepted.
- Authenticated success: `200 OK`:

```json
{
  "authenticated": true,
  "user": {"displayName": "optional", "email": "optional", "emailVerified": true},
  "idleExpiresAt": "RFC3339 timestamp",
  "absoluteExpiresAt": "RFC3339 timestamp"
}
```

- Unauthenticated, expired, or revoked success: `200 OK` with `{"authenticated":false}`. Expired/revoked cookies are cleared. No provider subject, issuer, audience, token, internal `User.id`, session id, or authorization detail is returned.
- Cache: `no-store`; never varies through a shared cache.
- Stable dependency failure: an unavailable required SDK/session runtime dependency returns HTTP `500` with `INTERNAL_ERROR`. A malformed or authentication-tag-invalid cookie is treated as unauthenticated and expired; a transient provider/JWKS outage does not clear a successfully decrypted Cookie Session.

## 6. Protected API behavior

| Condition | Fastify/BFF behavior | HTTP result | Cookie behavior |
| --- | --- | --- | --- |
| Missing credential/session | Do not call repository | `401 UNAUTHORIZED` | BFF may clear malformed cookie |
| Expired Access Token | Reject before mapping | `401 UNAUTHORIZED` | BFF attempts at most one server-side renewal; on failure clears session |
| Provider/admin grant revoked | Continue only until the next renewal or current Access Token expiry, bounded by 15 minutes; then do not forward or provision | `401 UNAUTHORIZED` when revocation is observed | Clear current browser cookie when observed |
| Invalid signature | Reject before mapping | `401 UNAUTHORIZED` | Invalidate session; never retry as anonymous |
| Wrong issuer | Reject before mapping | `401 UNAUTHORIZED` | Invalidate session |
| Wrong audience | Reject before mapping | `401 UNAUTHORIZED` | Invalidate session |
| Invalid state/nonce/PKCE | Create no session or mapping | `401 UNAUTHORIZED` | Clear transaction material only |
| Provider/JWKS unavailable with no usable cached key | Fail closed; do not classify token as forged | HTTP `500` + `INTERNAL_ERROR` | Preserve a successfully decrypted Cookie Session for later retry; do not forward |
| Verified actor accesses another actor's resource | Keep missing/other-owner indistinguishable | `403 FORBIDDEN` | Unchanged |

The envelope remains `{ error: { code, message, fieldErrors?, requestId } }`. `UNAUTHORIZED` messages never distinguish expiry, signature, issuer, audience, or revocation. `FORBIDDEN` never confirms whether another user's resource exists.

## 7. Environment contract

All variables are server-only and must not use `NEXT_PUBLIC_`.

| Variable | Meaning and validation |
| --- | --- |
| `MYSTCRAG_APP_ORIGIN` | One absolute application origin; HTTPS outside loopback; no path/query/fragment; canonical source for same-origin checks and redirects |
| `MYSTCRAG_AUTH_PROVIDER` | Exact production value `auth0`; `signed-test` allowed only in development/test with the existing explicit opt-in |
| `MYSTCRAG_AUTH_ISSUER` | Exact HTTPS issuer including required trailing-slash semantics; one issuer per environment |
| `MYSTCRAG_AUTH_AUDIENCE` | Exact custom Fastify API identifier; non-empty |
| `MYSTCRAG_AUTH_CLIENT_ID` | Environment-specific Auth0 Regular Web Application client id |
| `MYSTCRAG_AUTH_CLIENT_SECRET` | Environment-specific confidential client secret; secret manager only |
| `MYSTCRAG_AUTH_CALLBACK_URL` | Exact absolute `${MYSTCRAG_APP_ORIGIN}/auth/callback`; must equal the environment Application allowlist entry |
| `MYSTCRAG_AUTH_LOGOUT_URL` | Exact absolute allowed post-logout URL for the environment, normally `MYSTCRAG_APP_ORIGIN` |
| `MYSTCRAG_AUTH_SESSION_SECRET` | At least 32 random bytes of entropy in the encoding required by the selected implementation; replacement is a controlled forced logout because FEAT-018 authorizes no previous-key overlap |

JWKS rules: HTTPS only; connect/read timeout 2 seconds each and 5 seconds total; cache successful keys by issuer and `kid` for at most 15 minutes while honoring a shorter provider cache directive; unknown `kid` triggers one bounded refresh; negative results cache at most 30 seconds; stale keys may verify only while their previously cached entry remains within TTL. A fetch failure with no valid cached key fails closed as provider unavailable.

Clock skew: maximum 60 seconds for JWT time validation. It cannot extend BFF idle/absolute session expiry.

Startup is fail closed in staging/production: all variables must exist, origins/issuer/callback/logout must parse and agree, secrets must meet strength requirements, provider must be `auth0`, and loopback/wildcard URLs are forbidden. `SignedTestTokenAuthProvider` remains development/test-only, requires its existing explicit opt-in, and is never a production fallback.

Actual staging and production domains are deployment inputs, not fabricated contract values:

| Input | Owner | Verification | PASS | FAIL |
| --- | --- | --- | --- | --- |
| staging origin/callback/logout/web origin | Product Owner + SOL/Operations before staging deployment | Compare secret-managed values and Auth0 staging Application settings byte-for-byte; execute login/logout smoke | Exact HTTPS entries, no wildcard/localhost, flow passes | Missing/mismatch/wildcard/localhost or redirect failure; deployment blocked |
| production origin/callback/logout/web origin | Product Owner + SOL/Operations before production deployment | Same comparison against the isolated production Application, plus production-start negative test | Exact HTTPS entries, no wildcard/localhost, negative and happy paths pass | Any mismatch or shared non-production client; release blocked |

## 8. Decision table

| # | Initial state | Input/event | Server behavior | Browser behavior | HTTP/status/error | Cookie change | Log requirement | Acceptance result |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | No mapping/session | Valid first login | Verify, atomically provision one User + mapping, create session | Redirect to validated path | callback `303` | Set rotated session | `auth.sign_in`, `identity.provisioned`; ids only | One actor created |
| 2 | No mapping/session | 20 concurrent callbacks for one identity | Unique constraint + retry/reread winner | All resolve to same actor/session family | each accepted callback `303` | Valid rotated cookies | one provision event; races counted | Exactly one mapping and User |
| 3 | Valid returning session | Refresh/navigation | Validate/roll session; renew token server-side if needed | Authenticated view restored | session `200` | Rotate if due | session resume, no claims/token | Same actor restored |
| 4 | Anonymous | Protected navigation | Do not call protected repository; preserve safe relative path | Redirect/prompt login | API `401 UNAUTHORIZED` | None/clear malformed | generic auth missing | No data disclosed |
| 5 | Valid session, expired Access Token | Protected request | One bounded renewal; otherwise invalidate | Continue once or require login | success or `401 UNAUTHORIZED` | rotate on renewal; clear on failure | expiry category only | No expired token accepted |
| 6 | Idle or absolute expiry | Session read/navigation | Invalidate; do not renew past absolute limit | Signed-out state/login | session `200 false`; API `401` | Clear | expiry class and request id | Expiry enforced |
| 7 | Valid Cookie Session; provider/admin grant revoked | Renewal attempt or Access Token reaches 15-minute maximum | Renewal fails or expired token is rejected; do not forward afterward | Signed-out when revocation is observed | `401 UNAUTHORIZED` when observed | Clear current browser cookie | revocation source/category | Effective by next renewal or within 15 minutes |
| 8 | Valid session | Active POST logout | Invalidate locally first; redirect through configured Auth0 logout | Signed-out; safe same-origin destination | `303` | Clear | `auth.logout`, no token | Replay stays safe/idempotent |
| 9 | Valid Cookie Session or callback flow | Auth0/JWKS unavailable | Use only valid cached key; otherwise fail closed | Retry-safe error, no false logout on unproven outage | HTTP `500` + `INTERNAL_ERROR` | Preserve successfully decrypted cookie; no new session | dependency, timeout, issuer alias, request id | No fail-open |
| 10 | Token presented | Wrong issuer | Reject before mapping/repository | Re-authenticate | `401 UNAUTHORIZED` | Invalidate BFF session | `verification_failed:issuer` | Generic public response |
| 11 | Token presented | Wrong audience | Reject before mapping/repository | Re-authenticate | `401 UNAUTHORIZED` | Invalidate | `verification_failed:audience` | Generic public response |
| 12 | Token presented | Bad signature | Reject before mapping/repository | Re-authenticate | `401 UNAUTHORIZED` | Invalidate | `verification_failed:signature`, no JWT | Generic public response |
| 13 | Pending transaction | State/nonce/PKCE mismatch/replay | Consume/clear transaction; create nothing | Safe error page | `401 UNAUTHORIZED` | Clear transaction only | failure class and request id | No session/mapping |
| 14 | Any | Absolute/`//`/encoded redirect attempt | Reject target; use `/` | Remains same-origin | login/callback continues safely | Normal transaction/session only | `open_redirect_rejected` with no raw sensitive query | Cannot leave origin |
| 15 | User B authenticated | B requests A resource id | Owner-scoped lookup; hide existence | Generic forbidden | `403 FORBIDDEN` | Unchanged | actor/resource hashed ids, code | No A data/mutation |
| 16 | Mapping exists for issuer A + subject X | issuer B + subject X login | Treat as distinct key; provision/map separately | B identity gets its own actor | callback `303` | Set B session | separate issuer-keyed provision | No collision |
| 17 | Returning identity | Email/display name changed | Keep User.id; optionally update profile hints | New display data may appear | session `200` | Unchanged/normal rotation | profile update fields, no values | actorId unchanged |
| 18 | Production configuration | `signed-test` selected or auth0 incomplete | Refuse startup; no fallback | Service unavailable, never anonymous/test actor | startup failure | None | configuration names only, no secrets | Production fail closed |

## 9. Logging and privacy

- Structured events: sign-in success/failure, logout, session expiry/revocation/rotation, identity provisioning/race/conflict, verification failure category, provider/JWKS latency/failure, and rejected redirect/origin.
- Logs may contain request id, internal actor id or one-way operational hash where needed, issuer alias (not full untrusted token value), status/error code, key id, and timing. They must never contain cookies, tokens, codes, verifiers, nonce/state values, client secrets, raw provider profiles, or unnecessary email/display name.
- Authentication responses and logs never expose whether an email is registered or linked.

## 10. Implementation-validation probes

These are mandatory pass/fail probes, not open product decisions:

| Probe | Owner/task | PASS condition | FAIL action |
| --- | --- | --- | --- |
| Select exact supported Auth0 Next.js/server and JWT libraries/versions | SOL / AUTH-002 | One supported version per dependency; Node/Next compatibility and licenses verified; no duplicate SDK | Block AUTH-003/005; revise dependency decision, not this topology |
| Preserve public `POST /auth/logout` despite SDK default routes | FRONTEND + SOL / AUTH-002, AUTH-005 | GET cannot mutate/logout; POST enforces Origin and clears local session before upstream logout | Block handoff; implement explicit wrapper/custom route or select compliant supported integration |
| Encrypted Cookie Session and rolling behavior | FRONTEND / AUTH-005 | Captured headers prove name/flags/path/lifetimes; cookie is authenticated ciphertext, rolling activity reissues it without extending absolute expiry, and active logout immediately clears the current browser cookie | Block AUTH-006 |
| Access-token custody | FRONTEND + QA / AUTH-005, AUTH-006 | No token in HTML/RSC/browser storage/URL/client bundles; BFF adds Bearer only server-to-server | Block release |
| Concurrent provisioning | DATABASE / AUTH-003 | Real PostgreSQL 20-way test produces one mapping and one User, no orphan | Block AUTH-004 |
| Fastify verifier/JWKS | BACKEND / AUTH-004 | issuer/audience/signature/expiry/skew/unknown-kid/timeout/rotation matrix matches section 6 | Block AUTH-006 |
| Revocation bound | BACKEND + QA / AUTH-004, AUTH-006 | Active logout immediately clears the current browser cookie; provider/admin grant revocation is effective by next renewal or no later than the 15-minute Access Token expiry | Block release |
| Exact environment allowlists | SOL/Operations / AUTH-002, AUTH-007 | Isolated clients and byte-exact callback/logout/origin entries; no wildcard | Block deployment |

## 11. Auth0 official basis

Accessed 2026-08-25:

- [Authorization Code Flow with PKCE `/authorize`](https://auth0.com/docs/api/authentication/authorization-code-flow-with-pkce/authorize-with-pkce) — `response_type=code`, `state`, PKCE verifier/challenge, and `S256`.
- [OAuth state parameters](https://auth0.com/docs/secure/attack-protection/state-parameters) — unpredictable correlation, callback comparison, CSRF mitigation, and server-side stored return state.
- [Validate ID Tokens](https://auth0.com/docs/secure/tokens/id-tokens/validate-id-tokens) — issuer/audience validation and exact nonce comparison for replay protection.
- [Application settings](https://auth0.com/docs/get-started/applications/application-settings) and [subdomain URL placeholders](https://auth0.com/docs/get-started/applications/wildcards-for-subdomains) — callback/logout/web-origin allowlists and production wildcard warning.
- [Validate Access Tokens](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens) — standard JWT checks, audience validation, and 401 on validation failure.
- [Get Access Tokens](https://auth0.com/docs/secure/tokens/access-tokens/get-access-tokens) — issuer depends on the authorization domain and custom API access-token lifetime is configurable.
- [Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation) — rotation, bounded overlap, automatic reuse detection, and absolute token lifetime.
- [Auth0 logout endpoint](https://auth0.com/docs/api/authentication/logout/auth-0-logout) — allowlisted `returnTo` and client-specific logout behavior.
- [Auth0 Next.js quickstart](https://auth0.com/docs/quickstart/webapp/nextjs) and [official `nextjs-auth0` repository](https://github.com/auth0/nextjs-auth0) — Regular Web Application/BFF routes, server-side Cookie Session access, HttpOnly cookies, and current default route behavior. Exact package version remains AUTH-002's dependency decision.
- [BFF pattern](https://auth0.com/blog/the-backend-for-frontend-pattern-bff/) — backend token custody, API proxying, Secure/HttpOnly cookie, and CSRF responsibility.

## 12. Frozen state

`CONTRACT_FROZEN_IMPLEMENTATION_PENDING`

This is not Feature acceptance. AUTH-002 through AUTH-007 remain unstarted by this task, and only AUTH-007 may record the final acceptance result.
