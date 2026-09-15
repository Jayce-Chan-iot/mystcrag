# Authing OIDC Migration Design

**Status:** PRODUCT OWNER APPROVED for implementation
**Date:** 2026-09-15
**Task:** TASK-AUTH-011
**Related feature:** FEAT-018 Authentication and user identity
**Supersedes provider selection in:** `docs/AUTH_SESSION_CONTRACT.md` (Auth0 → Authing)

## 1. Decision

Production identity provider changes from Auth0 to **Authing** (China user pool first) using standard OIDC Authorization Code + PKCE (S256). The Next.js BFF remains the only browser session authority. `signed-test` stays as an explicit development/test-only provider. A future overseas Authing user pool reuses the same OIDC code path by changing issuer/client configuration only.

The product owner approved this migration on 2026-09-15. Ordinary technical choices are frozen in this design; live Authing tenant smoke remains operationally gated and must be reported as BLOCKED without credentials.

## 2. Non-negotiable security invariants (unchanged)

- Browser never receives Access Token, Refresh Token, or ID Token.
- No token in `localStorage`, `sessionStorage`, `NEXT_PUBLIC_*`, HTML/RSC payload, URL, or logs.
- Session cookie: authenticated-encrypted, HttpOnly, host-only; production name `__Host-mystcrag_session`; Secure when origin is HTTPS; SameSite=Lax; Path=/; no Domain.
- Idle 8 hours, absolute 7 days; Access Token target lifetime ≤ 15 minutes.
- `returnTo` is a same-origin relative path only.
- `POST /auth/logout` requires exact Origin; clears local cookies first; then 303 to discovery `end_session_endpoint`.
- `GET /auth/logout` returns 405.
- `(issuer, subject)` remains the sole external identity key; email/phone are profile hints only; no silent cross-pool merge.
- Prisma schema is unchanged and provider-neutral.

## 3. Provider selection

| Value | Allowed environments | Role |
| --- | --- | --- |
| `authing` | production, staging, development | Production OIDC provider (Authing Regular Web App) |
| `signed-test` | development/test only, with `MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true` | Local launcher / desktop identity |

`auth0` is removed as a runtime provider. Production startup fails closed if provider is missing or unsupported. There is no dual production stack.

## 4. Environment contract (no new implicit `AUTHING_*` names)

All existing server-only variables are reused:

| Variable | Authing meaning |
| --- | --- |
| `MYSTCRAG_AUTH_PROVIDER` | `authing` in production/staging |
| `MYSTCRAG_AUTH_ISSUER` | Exact Authing OIDC issuer, e.g. `https://<pool-domain>/oidc` (path `/oidc` allowed; trailing slash optional after normalization) |
| `MYSTCRAG_AUTH_AUDIENCE` | Exact API audience registered in Authing |
| `MYSTCRAG_AUTH_CLIENT_ID` | Authing application client id |
| `MYSTCRAG_AUTH_CLIENT_SECRET` | Authing application client secret (secret manager only) |
| `MYSTCRAG_AUTH_CALLBACK_URL` | `${MYSTCRAG_APP_ORIGIN}/auth/callback` |
| `MYSTCRAG_AUTH_LOGOUT_URL` | Same-origin post-logout URL |
| `MYSTCRAG_AUTH_SESSION_SECRET` | 32 random bytes as 64 hex chars; JWE key material |

`.env.example` documents Authing exact URL shape and keeps signed-test guidance. It contains no real credentials.

### Issuer validation (Authing)

HTTPS DNS host only. Reject credentials, query, fragment, wildcard, IP literal, localhost. Path may be `/` or `/oidc` (with or without trailing slash). Discovery document is always `{issuer}/.well-known/openid-configuration` after slash normalization. Backend never concatenates Auth0-style `{issuer}.well-known/jwks.json` as the sole authority; `jwks_uri` comes from discovery.

## 5. Architecture

```text
Browser
  -> opaque HttpOnly encrypted session cookie
  -> Next.js BFF (custom OIDC client + jose JWE session store)
  -> Authorization Code + PKCE (S256) against Authing discovery endpoints
  -> short-lived Access Token in server-to-server Authorization header
  -> Fastify OidcAccessTokenVerifier (jose RS256 + discovery jwks_uri)
  -> ExternalIdentity(issuer, subject) -> User.id
```

### 5.1 Frontend OIDC BFF

Replaces `@auth0/nextjs-auth0` entirely.

| Module | Responsibility |
| --- | --- |
| `oidc-discovery.ts` | Cache discovery document (authorize, token, jwks_uri, end_session_endpoint) |
| `oidc-session-crypto.ts` | HKDF from session secret; CompactEncrypt/Decrypt JWE (A256GCM) |
| `oidc-session-store.ts` | Read/write/roll encrypted session cookie; chunk large cookies; idle/absolute expiry |
| `oidc-transaction.ts` | Single-use encrypted transaction cookie binding state+nonce+PKCE verifier+returnTo |
| `oidc-client.ts` | Build authorize URL; exchange code; refresh access token; build end_session URL |
| `oidc-server.ts` | Replaces `auth0-server.ts` public helpers used by routes/proxy |

Login/callback/session/logout/BFF keep their existing HTTP contracts and DI shapes where practical. Cookie names remain `__Host-mystcrag_session` / `mystcrag_session` and `__txn_{state}`.

### 5.2 Backend verifier

Rename Auth0-specific verifier to OIDC verifier. Factory accepts `authing` (and rejects `auth0`). JWKS URL comes from discovery `jwks_uri`. Same RS256, issuer/audience/expiry, ≤60s clock skew, JWKS cache/timeout/rotation/fail-closed semantics. Never validates Access Token with client secret.

## 6. Rejected alternatives

| Option | Why rejected |
| --- | --- |
| `@authing/nextjs` `0.1.2` | Peer `next ^12.0.9` only; incompatible with Next 16 |
| Authing Guard / browser SDK | Browser token/localStorage model violates session contract |
| Keep Auth0 SDK + Authing domain | Dual vendor runtime, Auth0-specific claim/route coupling |
| openid-client as sole stack | Rejected as a direct runtime dependency; discovery/authorize/token/end_session use fetch + jose |

**Dependency decision:** pin `jose@6.2.10` only. Do not add `openid-client`. Token endpoint uses Authing `client_secret_post`. Issuer is compared exactly. Discovery endpoints must share the issuer origin on a trusted Authing host.

## 7. Acceptance matrix (code-level)

1. Production provider gate accepts only `authing`; rejects `auth0`, empty, unknown.
2. Signed-test gate remains development/test + explicit opt-in only.
3. Issuer accepts Authing `/oidc` form; rejects HTTP/loopback/wildcard/credentials/query/hash/IP.
4. Discovery supplies `jwks_uri` and `end_session_endpoint`.
5. Verifier matrix: non-RS256, wrong issuer/audience, expired, future nbf, unknown kid, JWKS outage/timeout/rotation.
6. Login: state/nonce/PKCE/exact callback/validated returnTo.
7. Callback: success, provider denial, invalid_grant, state/nonce replay, network classification 401 vs 500.
8. Cookie flags, idle/absolute/rolling, refresh failure clears session.
9. `/auth/session` never leaks tokens.
10. Logout GET 405; POST Origin; clear cookies; 303 end_session.
11. BFF attaches Bearer only server-side.
12. Desktop signed-test path unchanged in behavior.
13. Dual issuer same subject isolates actors.
14. Concurrent first login provisions one mapping.
15. Secret scan clean; no Auth0 direct dependency remains.

## 8. Live tenant evidence

Without authorized Authing tenant credentials this task delivers code + synthetic OIDC tests only. Live fields are recorded in `docs/qa/AUTHING_CONSUMER_ACCESS_ACCEPTANCE.md` as `VERIFIED` / `NOT_EXECUTED` / `BLOCKED` and must not be fabricated.

## 9. Out of scope

- Prisma schema/migrations
- Admin bead-import `admin/admin` path
- Business UI/DIY/assets/knowledge/community
- Auth0 tenant deletion
- Push/merge/deploy
