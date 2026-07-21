# Technical Architecture

## Repository

Mystcrag is a pnpm and Turborepo monorepo. Applications may depend on shared packages, but shared packages must not import application code.

```text
apps/
  frontend/        Next.js + React + TypeScript
  backend/         Node.js + Fastify + TypeScript
packages/
  ui/              shared presentation primitives
  design-contract/ versioned Zod design schemas, DTOs, projections, migrations
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
- `@mystcrag/design-contract` is a framework-independent package and the only definition source for versioned design JSON and design API DTOs. It must not depend on React, Next.js, Three.js, Prisma, Fastify, or an LLM provider SDK.
- Public projections and order snapshots never contain commercial cost or supplier data. The internal commercial schema is available only through a server-only package subpath.

Phase 2A adds the independent shared contract without switching existing AI, 3D, Backend, Frontend, or database consumers. Runtime AI providers, full 3D rendering, authentication, product API routes, persistence adapters, and commerce workflows remain deferred.
