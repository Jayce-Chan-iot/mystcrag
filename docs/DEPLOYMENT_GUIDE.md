# Deployment Guide

## Environment

Frontend: Next.js

Backend: Node.js

Database: PostgreSQL

## Recommended

-   Docker environment
-   CI/CD pipeline
-   CDN for assets
-   Object storage for images and 3D models

## Production Checklist

-   Environment variables configured
-   Database migration completed
-   API tested
-   Mobile performance checked

## Phase 2C local PostgreSQL

Copy `.env.example` to `.env`, then use:

- `pnpm db:up`: start PostgreSQL 17 and wait for readiness.
- `pnpm db:migrate`: deploy reviewed migrations to `mystcrag`.
- `pnpm db:seed`: idempotently insert the Phase 2C catalog and lifecycle fixtures.
- `TEST_DATABASE_URL=... pnpm db:test`: require a dedicated empty `mystcrag_*test*` database, create it when absent, deploy migrations, and run repository integration tests. It refuses a non-empty database instead of resetting or deleting data.
- `pnpm db:reset`: destructively reset only the configured development database.
- `pnpm db:down`: stop the Compose stack without deleting its volume.

The Compose password is development-only. Production must inject `DATABASE_URL`, run `prisma migrate deploy`, back up PostgreSQL, restrict network access, and use managed secrets. Never run reset or seed commands against production.

## Production identity environment contract

The behavioral authority is [AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md), state `IMPLEMENTATION_COMPLETE_ACCEPTANCE_PENDING`. AUTH-001 froze the contract; AUTH-002 through AUTH-006 and AUTH-008 delivered and verified the integrated runtime.

AUTH-002 freezes these server-only values with no `NEXT_PUBLIC_` aliases: `MYSTCRAG_APP_ORIGIN`, `MYSTCRAG_AUTH_PROVIDER=auth0`, `MYSTCRAG_AUTH_ISSUER`, `MYSTCRAG_AUTH_AUDIENCE`, `MYSTCRAG_AUTH_CLIENT_ID`, `MYSTCRAG_AUTH_CLIENT_SECRET`, `MYSTCRAG_AUTH_CALLBACK_URL`, `MYSTCRAG_AUTH_LOGOUT_URL`, and `MYSTCRAG_AUTH_SESSION_SECRET`. Staging/production startup fails closed when a value is missing, malformed, inconsistent, weak, loopback, or wildcard. `SignedTestTokenAuthProvider` remains explicitly enabled development/test behavior and is never a production fallback.

The integrated AUTH-005 boundary constructs Auth0 SDK `4.27.0` options explicitly from that single naming set: `appBaseUrl` from app origin; validated `domain` from the exact HTTPS issuer; `clientId`, `clientSecret`, and `secret` from their corresponding values; and `authorizationParameters.audience` from the audience. Callback and logout values are exact validation/allowlist inputs, never inferred from an untrusted Host. It does not depend on implicit `AUTH0_*` or `APP_BASE_URL` aliases.

The stateless SDK Cookie Session configuration is rolling with 28,800-second inactivity and 604,800-second absolute limits. Staging/production use `__Host-mystcrag_session`, Secure, HttpOnly, SameSite Lax, Path `/`, and no Domain; loopback development uses `mystcrag_session` and may disable Secure. `MYSTCRAG_AUTH_SESSION_SECRET` is exactly 32 random bytes encoded as 64 hexadecimal characters and is unique per environment. Supplying `sessionStore` is forbidden; no Redis/session database is provisioned. The SDK's network/session boundary is `apps/frontend/proxy.ts` and runs on the frozen security-patched Next.js `16.2.12` baseline; the Proxy bypass and related Next.js High advisories patched in `>=16.2.11` are absent from the resolved tree. The SDK default GET logout is not public: the integrated wrapper preserves `POST /auth/logout`, validates exact Origin, clears the local cookie first, and then initiates the configured upstream logout; GET returns `405` without touching cookies.

Development, staging, and production use distinct Auth0 Applications/Clients. For each deployment, the Product Owner and SOL/Operations must compare the environment origin, callback, logout URL, and web origin byte-for-byte with the corresponding Auth0 Application and execute login/logout smoke tests. Staging and production require HTTPS, exact entries, and no wildcard or localhost. Actual staging/production domain names remain required deployment inputs and are intentionally not invented here; missing or mismatched values block that deployment.

Operational defaults frozen for implementation: Access Token lifetime at most 15 minutes; Auth0 Next.js SDK authenticated-encrypted Cookie Session idle/absolute lifetimes 8 hours/7 days; JWT clock skew at most 60 seconds; JWKS connect/read timeout 2 seconds each and 5 seconds total; successful key cache at most 15 minutes, unknown-key one-refresh limit, negative cache at most 30 seconds. No persistent SessionStore infrastructure is authorized. Session-secret rotation is a controlled forced logout: the new secret rejects old cookies and users authenticate again.

The legacy empty `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN` entry in `.env.example` is inert compatibility documentation only: production source does not read it, setting it cannot authenticate a request, and it must remain unset. Browser clients call only the same-origin BFF; browser JavaScript and client bundles must never receive a production Token.

## Identity/session rollback and recovery

1. Stop new login traffic and preserve the current database and secret-manager state. Do not delete `ExternalIdentity` rows as a routine application rollback.
2. Roll the frontend and Backend deployment back together to the last reviewed FEAT-018-compatible commit. Do not re-enable the former browser Bearer-token path or the signed-test provider in production.
3. If the session secret is suspected exposed, replace `MYSTCRAG_AUTH_SESSION_SECRET` with a new 32-byte value. This deliberately invalidates existing Cookie Sessions; users must authenticate again.
4. Revoke or rotate the affected Auth0 client secret and grants, confirm the Access Token lifetime remains at most 15 minutes, and verify exact callback/logout/web-origin allowlists before reopening traffic.
5. Run production-start negative checks, then login, protected-resource, two-user isolation, and POST logout smoke checks. A mismatch, wildcard, test provider, browser-visible credential, or failed cleanup keeps the deployment blocked.
6. The additive `ExternalIdentity` migration rollback is separately controlled by [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md). It is destructive to provider mappings and is allowed only after its explicit precondition and data-loss approval; normal application rollback retains the table.
