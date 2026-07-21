# Technical Architecture

## Repository

Mystcrag is a pnpm and Turborepo monorepo. Applications may depend on shared packages, but shared packages must not import application code.

```text
apps/
  frontend/        Next.js + React + TypeScript
  backend/         Node.js + Fastify + TypeScript
packages/
  ui/              shared presentation primitives
  ai-agent/        provider-independent agent contracts
  three-engine/    React Three Fiber + Three.js domain contracts
  database/        PostgreSQL + Prisma schema and migrations
```

## Boundaries

- Frontend communicates with backend APIs; it does not access PostgreSQL directly.
- Backend coordinates domain modules and owns request validation, authorization, and persistence access.
- AI modules remain independent from UI, database, and LLM provider implementations.
- The 3D engine consumes structured bracelet configuration and must not depend on prompt output text.
- Database changes are introduced through Prisma migrations after schema review.

The initialization phase contains contracts and scaffolds only. Runtime AI providers, full 3D rendering, authentication, and commerce workflows are deferred.
