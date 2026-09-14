# Authing Consumer Access Acceptance Record (redacted)

**Task:** TASK-AUTH-011
**Branch:** `task/auth-011-authing-oidc-migration`
**Operator:** Xiaomi MiMo (implementation) / Codex review pending
**Date:** 2026-09-15
**Overall status:** CODE_VERIFIED / LIVE_TENANT_BLOCKED

> Fact states:
> - `VERIFIED` — authorized and checked against evidence.
> - `NOT_EXECUTED` — out of scope or gated; not claimed as passed.
> - `BLOCKED` — missing live Authing tenant authorization; not fabricated.

This record contains no client secret, session secret, cookie, token, raw subject, or full authorize URL.

## 1. Code-level verification (VERIFIED)

| Item | Result |
| --- | --- |
| Production provider selector `authing` | VERIFIED |
| `auth0` runtime provider removed (startup rejects) | VERIFIED |
| `signed-test` development/test gate unchanged | VERIFIED |
| Issuer allows Authing `/oidc`; configured string is exact (no slash rewrite) | VERIFIED |
| Issuer rejects HTTP/loopback/wildcard/credentials/query/hash/IP | VERIFIED |
| Discovery supplies `jwks_uri` + `end_session_endpoint` | VERIFIED (synthetic) |
| Backend OIDC RS256 verifier + JWKS cache/outage/rotation | VERIFIED (unit) |
| Frontend encrypted Cookie Session (JWE, HttpOnly, host-only) | VERIFIED (unit) |
| Idle 8h / absolute 7d / rolling cap | VERIFIED (unit) |
| Server-side idle expiry inside authenticated JWE payload | VERIFIED (unit) |
| Explicit bounded session chunk protocol (`__meta` count) | VERIFIED (unit) |
| Token endpoint `client_secret_post` (no Basic) | VERIFIED (unit) |
| Outbound OIDC 5s timeouts | VERIFIED (unit) |
| Callback transaction cleared on 401 and 500 | VERIFIED (unit) |
| Discovery same-origin + trusted Authing host + no redirects | VERIFIED (unit) |
| Exact issuer string (no trailing-slash rewrite) | VERIFIED (unit) |
| `/auth/session` projection excludes tokens | VERIFIED (unit) |
| Logout GET 405 / POST Origin / clear cookies / 303 end_session | VERIFIED (unit) |
| BFF Bearer only server-side | VERIFIED (unit) |
| `@auth0/nextjs-auth0` direct dependency removed | VERIFIED |
| Prisma schema/migrations unchanged | VERIFIED (diff) |

## 2. Live Authing tenant fields (BLOCKED)

No authorized Authing Console, Management API, or redacted export is available in this environment. All live fields are `BLOCKED` and must not be inferred from code:

| Field | Status |
| --- | --- |
| Environment / user pool label | BLOCKED |
| Application name | BLOCKED |
| Exact issuer URL | BLOCKED |
| Client id (last 4 only if recorded later) | BLOCKED |
| API audience | BLOCKED |
| Callback / logout / web origin allowlists | BLOCKED |
| Account+password signup enabled | BLOCKED |
| Email verification on signup (MVP off) | BLOCKED |
| JWT algorithm RS256 | BLOCKED |
| Access Token TTL (target ≤ 15m) | BLOCKED |
| Refresh Token TTL / rotation | BLOCKED |
| SMS / voice / email OTP / passwordless disabled | BLOCKED |

## 3. Real registration / login / logout smoke (NOT_EXECUTED)

- Create test user: `NOT_EXECUTED` (requires explicit user confirmation)
- Submit registration form: `NOT_EXECUTED`
- Login without OTP gate → return to original relative URL: `NOT_EXECUTED`
- POST logout then login again: `NOT_EXECUTED`
- Database first-login provisioning on live Authing identity: `NOT_EXECUTED`
- Delete test user: `NOT_EXECUTED`

Synthetic OIDC tests cover code exchange, denial, replay, and discovery outage classification without creating real accounts.

## 4. Console checklist for operations (do not paste secrets in chat)

When a tenant owner provides access, record only:

1. Environment label
2. Application name
3. Exact issuer (e.g. `https://<pool>.authing.cn/oidc`)
4. Client id last 4 characters
5. API audience identifier (non-secret)
6. Exact callback / logout / web origin entries
7. Account + password registration enabled
8. Email verification on signup = off (MVP only)
9. Passwordless/SMS/OTP connections disabled
10. Token algorithm RS256
11. Access Token TTL minutes (≤ 15)
12. Refresh Token policy
13. Token endpoint authentication method = `client_secret_post` (must match BFF)

Never request or record client secret / session secret in chat.

## 5. Handoff

- Live tenant smoke remains a separate operations task after Codex accepts this code candidate.
- `pnpm validate` baseline failure on missing `apps/backend/src/modules/community` is pre-existing and outside this task.
