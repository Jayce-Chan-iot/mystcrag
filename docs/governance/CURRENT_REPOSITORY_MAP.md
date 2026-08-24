# Current Repository Map

**Observed product baseline:** local `main` commit `1a34c16`, audited on 2026-08-24<br>
**Governance candidate:** `7649f59` plus TASK-AUDIT-001 documentation; not integrated into `main`
**Scope:** tracked repository plus current branch/worktree metadata
**Method:** workspace manifests, import boundaries, route registrations, Prisma schema, tests, asset references, Git branches, and worktrees

This is the current-state map after combining the original UI with the knowledge system and database. Historical reports are evidence only and may describe an older baseline.

## Repository profile

- pnpm 11 + Turborepo monorepo; 16 workspace projects including the root.
- 4 deployable applications, 11 shared packages, root architecture/lifecycle tests, and operational scripts.
- Current tracked footprint after TASK-REPO-001: `apps/` 297 files, `packages/` 300 files, `scripts/` 27 files, `tests/` 3 files, and `docs/` 106 files before TASK-AUDIT-001 output.
- Module-local tests: approximately 28 application tests and 66 package tests, plus root architecture and Tarot lifecycle tests.
- Generated or build directories (`.next`, `dist`, Prisma generated client) are ignored and are not sources of truth.

## Topology

```text
apps/frontend ───────┬─> packages/design-contract
                     ├─> packages/bracelet-engine
                     ├─> packages/three-engine ─> packages/bracelet-engine
                     └─> packages/ui

apps/backend ────────┬─> packages/design-contract
                     ├─> packages/database
                     ├─> packages/ai-agent
                     ├─> packages/context-resolver ─> packages/tarot-engine
                     ├─> packages/design-engine
                     ├─> packages/knowledge-core
                     └─> packages/tarot-engine

apps/knowledge-worker ─> database + design-contract + knowledge-core + knowledge-ingestion
apps/mcp-server ───────> context-resolver + database + design-contract + design-engine + knowledge-core

knowledge-core ────────> database + design-contract + design-engine + knowledge-ingestion
knowledge-ingestion ───> database + design-contract
ai-agent ──────────────> design-contract
design-engine ─────────> design-contract
database ──────────────> design-contract + tarot-engine
```

Applications do not import other applications. The public design contract remains framework-independent. The `knowledge-core -> database` dependency means Knowledge Core currently combines domain behavior with persistence-aware application behavior; it is accepted current state, not a target layering endorsement.

## Application map

| Application | Current responsibility | Runtime status | Main dependencies |
| --- | --- | --- | --- |
| `apps/frontend` | Next.js UI: home, AI questionnaire/results, DIY editor, library, personal gallery, profile, Tarot, knowledge admin | Production MVP | Bracelet, Design Contract, Three, UI |
| `apps/backend` | Fastify APIs, auth boundary, design/recommendation orchestration, pricing/inventory/order, Tarot and knowledge admin | Production MVP; commercial auth is development-grade | AI, Context, DB, Contract, Design, Knowledge, Tarot |
| `apps/knowledge-worker` | Knowledge collection/review/maintenance job entry point | Active operational worker | DB, Contract, Knowledge Core/Ingestion |
| `apps/mcp-server` | MCP tools for knowledge retrieval and design operations | Active integration service | Context, DB, Contract, Design, Knowledge |

## Package map

| Package | Responsibility | Current lifecycle |
| --- | --- | --- |
| `design-contract` | DesignV1, API DTOs, public/internal projections, order, knowledge, recommendation and Tarot public schemas | Canonical |
| `database` | Prisma schema/client, migrations, repositories, mappers, transaction boundaries | Canonical persistence |
| `bracelet-engine` | UI/DOM/Three-independent fit, geometry, layout and hit-testing | Canonical geometry |
| `three-engine` | DesignV1-to-scene adapter, runtime scene descriptor, R3F renderer and interactions | Implemented, not mounted in production DIY |
| `design-engine` | Deterministic allocation, generation, rule evaluation, scoring and validation | Canonical deterministic engine |
| `ai-agent` | Provider-independent recommendation agents, provider adapters and candidate conversion | Active; contains explicit compatibility surface |
| `context-resolver` | Questionnaire/Tarot context normalization and merge | Active |
| `tarot-engine` | 78-card catalog, spreads, deterministic draw state, design signals | Active; repeats some public enum schemas |
| `knowledge-core` | Retrieval, rule compilation, review, console, evaluation and fixtures | Active |
| `knowledge-ingestion` | Fetch, extract, rate-limit, security and ingestion pipeline | Active |
| `ui` | Shared presentational primitives | Active but currently only exports `Surface` |

## Frontend route families

| Route family | Entry points | State |
| --- | --- | --- |
| Home | `/` | Active original UI |
| AI design | `/ai-design`, `/design/[id]` | Active |
| DIY | `/diy`, `/diy/[id]` | Active 2D editor |
| Discovery | `/crystal-library`, `/gallery`, `/profile` | Active |
| Tarot | `/tarot`, `/tarot/setup`, `/tarot/draw/[sessionId]`, `/tarot/result/[sessionId]` | Active behind feature configuration |
| Knowledge admin | `/admin/knowledge`, login, review, sources, runs, graph, atlas and atlas detail | Active when admin API key is configured |

## Backend API families

- Design: generate, update, price, save, delete, clone, publish, list designs and fetch design.
- Recommendation: recommend, evaluate, optimize, trace and catalog/material suggestions.
- Orders: create immutable order from a design and list orders.
- Tarot: session creation, selection, reveal, recommendation and result lifecycle.
- Knowledge admin: overview, graph, coverage, source stats, atlas, runs, review queue, conflicts, review pipeline, rules, versions and source policy.

The `user`, `crystal`, `community`, and `order` module descriptors are registered, but most business behavior is composed through design routes or direct repository/application services rather than dedicated module routes.

## Persistence map

The Prisma schema owns 21 models:

- Identity/catalog: `User`, `Crystal`, `DesignTemplate`, `MaterialProduct`, `AccessoryProduct`, `InventorySnapshot`, `PricingRule`.
- Design/commerce: `Design`, `DesignRevision`, `DesignDecisionTrace`, `DesignPublication`, `Order`, `OrderDesignSnapshot`.
- Knowledge: `KnowledgeSource`, `KnowledgeDocument`, `KnowledgeRule`, `KnowledgeCollectionRun`, `KnowledgeVersion`, `KnowledgeUsageEvent`.
- Tarot: `TarotSession`, `TarotDesignRecommendation`.

`DesignTemplate` currently has no production repository/service consumer. Design-template provenance is represented as strings in generated designs, so the model is classified dormant pending TASK-DB-001.

## Repository evidence and concurrent state

- No open GitHub pull requests were present at audit time.
- Local `main` was 22 commits ahead of `origin/main`; publishing remains a separate owner action.
- The governance candidate is two commits ahead of local `main`; therefore `main` does not yet contain the task registry, canonical registry, or expanded root governance rules.
- Most historical branches are merged but retained. Six old branches are unmerged and require provenance review.
- Three non-root worktrees are live; multiple `/private/tmp` worktree registrations are prunable but untouched.
- Pre-existing user changes in `apps/frontend/next-env.d.ts`, `docs/audit/`, and `docs/progress/` are explicitly outside TASK-GOV-001.

## Known current-state pressure points

- Three large orchestration files concentrate change risk: design API (1,284 lines), recommendation service (1,127), Tarot service (941); DIY editor is 1,275 lines.
- The production DIY page deliberately renders `FlatBraceletEditor`; the tested 3D preview wrapper is not mounted.
- Public contract duplication exists around Tarot enums and AI candidate naming.
- Compatibility, mock, placeholder, and QA evidence paths are not consistently labeled or isolated.
- Tracked QA screenshots and outputs are spread across at least ten locations. See `DUPLICATE_CODE_AUDIT.md` for evidence and disposition.
