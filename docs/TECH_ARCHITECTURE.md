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
- The 3D engine consumes validated `DesignV1` through a one-way pure-data adapter and must not depend on prompt output text.
- Database changes are introduced through Prisma migrations after schema review.
- `@mystcrag/design-contract` is a framework-independent package and the only definition source for versioned design JSON and design API DTOs. It must not depend on React, Next.js, Three.js, Prisma, Fastify, or an LLM provider SDK.
- Public projections and order snapshots never contain commercial cost or supplier data. The internal commercial schema is available only through a server-only package subpath.

## Phase 2B consumer flow

```text
provider unknown -> AI bead-layout candidate validation -> server enrichment -> DesignV1
                                                              |-> backend shared DTO boundary
                                                              |-> frontend PublicDesignV1 views
                                                              `-> Three Engine scene descriptor
```

- AI and Three Engine depend on `@mystcrag/design-contract`; the contract never depends on consumers.
- Backend validates every request and response with shared schemas. Development stubs stop at the service boundary and never fabricate success DTOs.
- Frontend imports only the public contract and API DTOs. Internal commercial schemas and database types are forbidden.
- Legacy grouped types remain in explicit compatibility paths. They are not another source of design truth.
- Root architecture tests enforce these directions and protect the server-only commercial boundary.

Runtime AI providers, full 3D rendering, authentication, persistence adapters, live catalog pricing, and commerce workflows remain deferred. Phase 2B does not change Prisma.

## Phase 2C persistence flow

`@mystcrag/database` now owns the Prisma client lifecycle, domain-safe mappers, repositories, PostgreSQL transaction boundaries, and the baseline migration. Backend domain services depend on repositories and never access Prisma models directly.

```text
authenticated/test actorId -> Backend service -> Repository transaction
                                              |-> Design current row + immutable revision
                                              |-> fixed-revision publication
                                              `-> server price/inventory checks + immutable order snapshot
```

Versioned JSON aggregates remain Design Contract values and are Zod-validated on write and read. Structured columns own identity, ownership, lifecycle, querying, currency, versions, and BIGINT minor-unit money. Phase 2C supplies real persistence services but keeps the Phase 2B HTTP routes in their explicit development-stub mode until authentication and endpoint orchestration are connected.
