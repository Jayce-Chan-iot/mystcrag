# Module Owners

One task has one accountable owner. Reviewers may advise, but they do not share task ownership.

## Owner roles

| Owner ID | Accountable scope | Paths | Required controlling documents |
| --- | --- | --- | --- |
| `SOL` | Planning, task registration, review, acceptance recording and archival; no runtime implementation | `docs/governance`, `docs/tasks`, specifications, plans and review/archive records explicitly named by its task | `AGENTS.md`, current/target maps |
| `GLM` | Assigned implementation executor for image processing, visual asset, frontend and resolver tasks | only the exact runtime/test/docs paths granted by its `IN_PROGRESS` task | task specification, UI/asset manifests and affected module contracts |
| `QWEN` | Assigned implementation executor for contract, database, backend and integration/QA tasks | only the exact runtime/test/docs paths granted by its `IN_PROGRESS` task | task specification and affected module contracts |
| `FRONTEND` | Next.js composition, product UI, frontend API client | `apps/frontend` | UI system, interaction plan, API spec |
| `UI` | Reusable presentation primitives | `packages/ui` | UI design system |
| `BACKEND` | Fastify transport, application orchestration, auth and server policy | `apps/backend` | API spec, security, DesignV1 |
| `DATABASE` | Prisma schema/migrations, persistence mappers and repositories | `packages/database` | database schema, persistence model, security |
| `CONTRACT` | Shared public/internal Zod schemas, DTOs and projections | `packages/design-contract` | DesignV1, API spec |
| `AI` | Recommendation agents, provider adapters and AI candidate conversion | `packages/ai-agent` | AI spec, DesignV1 |
| `DESIGN` | Deterministic allocation, rules, scoring and validation | `packages/design-engine` | AI spec, DesignV1 |
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
| 3D scene contract | `THREE` | Bracelet and Frontend |
| Knowledge rule/review contract | `KNOWLEDGE` | Backend, Database, AI/Design as affected |
| Tarot public contract | `CONTRACT` | Tarot, Backend, Frontend, Database |
| Root scripts/CI/workspace config | the registered `GLM` or `QWEN` execution task | SOL and QA |
| Production runtime asset change | `ASSET` | Frontend |

## Ownership enforcement

- The active task registry is authoritative; role ownership does not grant permission to edit a path already locked by another `IN_PROGRESS` task.
- `SOL` must not own or perform runtime implementation. It may plan, register, review, record acceptance and archive completed work. Runtime tasks must name `GLM` or `QWEN` as their single accountable owner.
- `GLM` and `QWEN` are execution owners only when the task registry assigns them an exact branch and writable path set; neither identifier grants standing cross-repository write access.
- Cross-module runtime work must be split into dependency-ordered `GLM`/`QWEN` tasks; `SOL` may own only the corresponding plan, review and archive tasks.
- Generated clients, `.next`, `dist`, screenshots, local databases, and environment files are never valid task-owned source paths.
- When a suspected duplicate crosses owners, the owner of the canonical component owns the decision task; consumer cleanup tasks depend on that decision.
- Platform shells own their storage, navigation, rendering, identity and transport adapters. Any future cross-platform extraction requires a separately approved owner/task after Web interaction evidence; it may not absorb Web Auth0, DOM/Canvas/WebGL or future WeChat identity/runtime APIs.
