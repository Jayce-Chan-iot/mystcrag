# Security And Privacy

## Principles

Protect user data.

## Requirements

-   Encrypt sensitive data
-   Do not store unnecessary personal information
-   Separate user identity and design preference data
-   Validate all API input

## AI Privacy

User conversations should not be exposed publicly.

Community sharing requires user permission.

## Persistence controls

- Every repository write requires an explicit `actorId`; current test identity injection is not a substitute for authentication.
- Owner identity is never accepted from request JSON. Repository ownership filters and optimistic revision checks are applied together.
- `unitCostMinor`, supplier data, and internal margins remain server-only. Community projections clear production notes and never expose costs.
- Design Contract JSON is validated before storage and after retrieval. Raw Prisma JSON and database errors do not cross repository boundaries.
- Revisions and order snapshots are immutable at both repository and PostgreSQL-trigger layers. Orders cannot be physically deleted.
- Logs must record identifiers, versions, and structured error codes, not full design/order snapshots. Birth dates, birth times, private conversations, hidden reasoning, and unnecessary personalization data do not belong in snapshots.
- Tarot questions remain in memory only by default and are never copied into logs, public DTOs, provider metadata, or recommendation provenance. Explicit opt-in storage requires a valid 32-byte base64 environment key. A domain-separated HMAC key-derivation step produces distinct AES-256-GCM encryption and HMAC-SHA-256 identity subkeys from that master. The strict v2 envelope contains only its fixed version/algorithm identifiers, keyed question identity, fresh random 96-bit nonce, 128-bit authentication tag, and non-empty ciphertext; version, algorithm, and question identity are authenticated as AES-GCM associated data. Identity matching first parses canonical base64url fields and exact lengths, rejects unknown fields and legacy versions, authenticates and internally decrypts the ciphertext, then constant-time compares the stored identity with identities recomputed from both authenticated plaintext and the requested question. It exposes no decrypt API, plaintext, or public unsalted hash. Concurrent same-question retries retain the first authenticated envelope; different-question retries conflict, and question storage cannot be added after an immutable no-save recommendation. Missing or invalid encryption configuration, malformed or swapped envelopes, and wrong keys fail closed; plaintext and reversible ad-hoc encodings are forbidden.

## Production identity and browser session

[AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md) is authoritative and is currently `IMPLEMENTATION_COMPLETE_ACCEPTANCE_PENDING`.

- Auth0 uses OIDC Authorization Code + PKCE (`S256`) through the Next.js Server/BFF. Development, staging, and production have isolated clients and exact callback/logout/web-origin allowlists; wildcard callbacks are forbidden.
- The sole FEAT-018 session mode is the Auth0 Next.js SDK authenticated-encrypted, host-only HttpOnly Cookie Session: production `__Host-mystcrag_session`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`. It may contain encrypted session/token material but never plaintext Token or Claim. Idle expiry is 8 hours and absolute expiry is 7 days; rolling activity may reissue the encrypted cookie but never extends absolute expiry. No Redis, persistent `SessionStore`, session database, or `AuthSession` Prisma model is authorized.
- Tokens, codes, verifiers, transaction values, and session secrets are forbidden in browser storage, client state, HTML/RSC payloads, URLs, client bundles, logs, telemetry, public configuration, and every `NEXT_PUBLIC_*` value.
- Login binds single-use state, nonce, PKCE verifier, exact callback, and a validated same-origin relative `returnTo`. Callback mismatch/replay creates no session. `POST /auth/logout` and all cookie-authenticated mutations require exact Origin validation.
- Fastify validates signature, exact issuer, audience, expiry, and no more than 60 seconds clock skew before `(issuer, subject)` mapping. Verification failure is generic `401`; owner mismatch remains generic `403`; provider/JWKS/session dependency outage uses HTTP `500` with the existing `INTERNAL_ERROR` envelope and never treats a session as anonymous. Active logout immediately clears the current browser cookie; provider/admin grant revocation is effective by the next renewal or within the 15-minute Access Token bound.
- Logs use redacted structured categories and request ids. Cookies, JWTs, codes, verifier/state/nonce values, client secrets, and raw provider profiles are never logged.
- The Knowledge Admin key/cookie path is independent operator authentication and cannot be reused for customer sessions.
- `SignedTestTokenAuthProvider` and the frontend `signed-test` mode require explicit development/test opt-in and are rejected in production/staging. The legacy empty `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN` template name has no production source consumer and cannot authenticate browser requests.
