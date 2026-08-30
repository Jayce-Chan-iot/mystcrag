# Module Owners

One task has one accountable owner. Reviewers may advise, but they do not share task ownership.

## Owner roles

| Owner ID | Accountable scope | Paths | Required controlling documents |
| --- | --- | --- | --- |
| `SOL` | Repository governance, integration order, cross-module release | root config, `docs/governance`, `docs/tasks`, integration-only tasks | `AGENTS.md`, current/target maps |
| `FRONTEND` | Next.js composition, product UI, frontend API client | `apps/frontend` | UI system, interaction plan, API spec |
| `UI` | Reusable presentation primitives | `packages/ui` | UI design system |
| `BACKEND` | Fastify transport, application orchestration, auth and server policy | `apps/backend` | API spec, security, DesignV1 |
| `DATABASE` | Prisma schema/migrations, persistence mappers and repositories | `packages/database` | database schema, persistence model, security |
| `CONTRACT` | Shared public/internal Zod schemas, DTOs and projections | `packages/design-contract` | DesignV1, API spec |
| `AI` | Recommendation agents, provider adapters and AI candidate conversion | `packages/ai-agent` | AI spec, DesignV1 |
| `DESIGN` | Deterministic allocation, rules, scoring and validation | `packages/design-engine` | AI spec, DesignV1 |
| `DESIGN CORE` | Platform-neutral DIY command, history and reconciliation semantics when an approved task creates that boundary | proposed `packages/diy-session-core` only | DesignV1, Bracelet geometry, API spec, cross-platform audit |
| `CONTEXT` | Questionnaire/Tarot context normalization | `packages/context-resolver` | AI spec, Tarot spec |
| `KNOWLEDGE` | Knowledge retrieval, review, compiler, ingestion and worker | `packages/knowledge-core`, `packages/knowledge-ingestion`, `apps/knowledge-worker` | knowledge system spec |
| `TAROT` | Tarot-private mechanics and backend lifecycle implementation | `packages/tarot-engine`, Tarot-owned backend/frontend paths when assigned | Tarot spec, API spec, security |
| `BRACELET` | Fit, geometry, layout, hit-testing | `packages/bracelet-engine` | Bracelet geometry, DesignV1, Three spec |
| `THREE` | 3D adapter, renderer, runtime quality and resources | `packages/three-engine` | Three spec, Bracelet geometry, DesignV1 |
| `MCP` | MCP transport and tool composition | `apps/mcp-server` | knowledge spec, API/contract docs |
| `QA` | Cross-workspace architecture and lifecycle tests; release evidence policy | `tests`, test strategy tasks | interaction plan, UAT checklist |
| `ASSET` | Product runtime assets and curated visual evidence | `apps/frontend/public`, approved evidence paths | asset manifest, UI system |

## Shared-path approval rules

| Shared concern | Owning task role | Mandatory reviewers/consumers |
| --- | --- | --- |
| DesignV1 or API DTO change | `CONTRACT` | Backend, Frontend, Database; Three/AI as affected |
| Prisma schema/migration | `DATABASE` | Backend and Contract |
| Bracelet geometry contract | `BRACELET` | Frontend and Three |
| DIY editing-session command/history contract | `DESIGN CORE` | Bracelet, Contract, Backend and every platform-shell owner |
| 3D scene contract | `THREE` | Bracelet and Frontend |
| Knowledge rule/review contract | `KNOWLEDGE` | Backend, Database, AI/Design as affected |
| Tarot public contract | `CONTRACT` | Tarot, Backend, Frontend, Database |
| Root scripts/CI/workspace config | `SOL` | QA and affected module owners |
| Production runtime asset change | `ASSET` | Frontend |

## Ownership enforcement

- The active task registry is authoritative; role ownership does not grant permission to edit a path already locked by another `IN_PROGRESS` task.
- A cross-module task is owned by `SOL` only when the user explicitly approves a single integration task. Otherwise split contract producer and consumer work into dependent tasks.
- Generated clients, `.next`, `dist`, screenshots, local databases, and environment files are never valid task-owned source paths.
- When a suspected duplicate crosses owners, the owner of the canonical component owns the decision task; consumer cleanup tasks depend on that decision.
- Platform shells own their storage, navigation, rendering, identity and transport adapters. `DESIGN CORE` may not absorb Web Auth0, DOM/Canvas/WebGL or future WeChat identity/runtime APIs.
