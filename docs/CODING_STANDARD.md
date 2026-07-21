# Mystcrag Coding Standard

## General

Use clean, modular, maintainable architecture.

Prefer: - readability - scalability - reusable components

## Frontend

Technology: - Next.js - React - TypeScript

Rules: - Functional components - Hooks separated by responsibility - UI
components reusable - Responsive design required

## Backend

Technology: - Node.js - Prisma - PostgreSQL

Rules: - API validation required - Business logic separated from
controllers - Database operations isolated

## AI Modules

AI logic must be independent.

Do not mix: - UI code - database code - AI prompts

## Naming

Use English naming for: - files - variables - functions

Use descriptive names.

Example:

generateBraceletDesign()

not:

gen()

## Monorepo rules

- Use pnpm workspace dependencies and import packages by `@mystcrag/*` name.
- Applications may import packages; packages must not import from `apps`.
- Keep unit tests beside their module. Put cross-workspace and end-to-end tests in `tests`.
- Use strict TypeScript. Avoid `any`; model untrusted values as `unknown` and validate at runtime boundaries.
- Do not commit generated output, local environment files, or credentials.
- Run `pnpm validate` before handing work to another Agent.

## Design contract boundaries

- Import `DesignV1`, `PublicDesignV1`, design enums, and API DTOs from `@mystcrag/design-contract`; do not redeclare them in consumers.
- Treat provider output, HTTP input, and HTTP output as untrusted and validate them at their boundary.
- Only server code may import `@mystcrag/design-contract/internal`. Frontend code must not import database or commercial-cost types.
- Use `componentId` for UI and scene identity. `positionIndex` expresses main-ring order and is not a stable identity.
- Format money through currency metadata. CNY uses fen while TWD V1 values use whole-dollar minor units; do not divide every currency by 100.
- Keep deprecated grouped types and their adapters in named legacy compatibility paths. New feature code must not import them.
- Three Engine runtime descriptors must be plain data and must not leak Three.js objects into shared contracts or API DTOs.

## Persistence boundaries

- Backend services depend on repository APIs; only `@mystcrag/database` may import the generated Prisma client.
- Repositories return domain DTOs, never generated Prisma rows, `JsonValue`, `Decimal`, or `bigint`.
- Validate Design Contract JSON on both write and read. Treat read validation failure as data-integrity failure, not client validation failure.
- Store money as PostgreSQL BIGINT minor units and convert through checked mapper functions. Public/domain money remains a non-negative JavaScript safe-integer number.
- Current-design changes and revision inserts must share a transaction and use an expected-revision condition. Never update or delete a revision or order snapshot.
- Keep foreign-key deletion actions explicit. Use soft deletion/status fields for designs, publications, and referenced products.
