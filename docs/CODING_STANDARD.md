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
