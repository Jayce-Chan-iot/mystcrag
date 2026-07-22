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
