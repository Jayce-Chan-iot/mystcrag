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

The behavioral authority is [AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md), state `CONTRACT_FROZEN_IMPLEMENTATION_PENDING`. TASK-AUTH-001 does not change `.env.example`, dependencies, or runtime configuration.

The later AUTH-002 task must define these server-only values with no `NEXT_PUBLIC_` aliases: `MYSTCRAG_APP_ORIGIN`, `MYSTCRAG_AUTH_PROVIDER=auth0`, `MYSTCRAG_AUTH_ISSUER`, `MYSTCRAG_AUTH_AUDIENCE`, `MYSTCRAG_AUTH_CLIENT_ID`, `MYSTCRAG_AUTH_CLIENT_SECRET`, `MYSTCRAG_AUTH_CALLBACK_URL`, `MYSTCRAG_AUTH_LOGOUT_URL`, and `MYSTCRAG_AUTH_SESSION_SECRET`. Staging/production startup fails closed when a value is missing, malformed, inconsistent, weak, loopback, or wildcard. `SignedTestTokenAuthProvider` remains explicitly enabled development/test behavior and is never a production fallback.

Development, staging, and production use distinct Auth0 Applications/Clients. For each deployment, the Product Owner and SOL/Operations must compare the environment origin, callback, logout URL, and web origin byte-for-byte with the corresponding Auth0 Application and execute login/logout smoke tests. Staging and production require HTTPS, exact entries, and no wildcard or localhost. Actual staging/production domain names remain required deployment inputs and are intentionally not invented here; missing or mismatched values block that deployment.

Operational defaults frozen for implementation: Access Token lifetime at most 15 minutes; Auth0 Next.js SDK authenticated-encrypted Cookie Session idle/absolute lifetimes 8 hours/7 days; JWT clock skew at most 60 seconds; JWKS connect/read timeout 2 seconds each and 5 seconds total; successful key cache at most 15 minutes, unknown-key one-refresh limit, negative cache at most 30 seconds. No persistent SessionStore infrastructure is authorized. Session-secret rotation is a controlled forced logout: the new secret rejects old cookies and users authenticate again.
