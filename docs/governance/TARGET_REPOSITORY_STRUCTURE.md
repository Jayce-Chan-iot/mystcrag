# Target Repository Structure

The target preserves the working monorepo and original UI. It clarifies lifecycle zones and ownership instead of performing a broad folder rewrite.

## Target tree

```text
apps/
  frontend/               # Next.js composition and product UI
  backend/                # Fastify composition and server orchestration
  knowledge-worker/       # asynchronous knowledge jobs
  mcp-server/             # MCP integration boundary
packages/
  design-contract/        # single public/shared schema authority
  database/               # persistence authority
  bracelet-engine/        # geometry authority
  three-engine/           # 3D rendering authority
  design-engine/          # deterministic design rules
  ai-agent/               # AI provider and agent behavior
  context-resolver/       # input normalization
  tarot-engine/           # Tarot-private mechanics; shared DTOs come from design-contract
  knowledge-core/         # knowledge application/domain behavior
  knowledge-ingestion/    # ingestion adapters and pipeline
  ui/                     # genuinely shared presentation primitives
docs/
  governance/             # current map, registries, ownership, health
  tasks/                  # active task registry
  superpowers/specs/      # approved cross-module specifications
  superpowers/plans/      # implementation plans
  ui-references/          # curated canonical UI evidence only
  reports/                # target home for dated historical evidence
tests/                    # cross-workspace architecture/lifecycle checks
scripts/                  # maintained operational and QA entry points
evidence/                 # target single home for reproducible QA artifacts
```

The `reports/` and `evidence/` locations are targets, not directories to create or migrate in Phase 0.

## Lifecycle zones

Every non-trivial implementation must be one of:

- `PRODUCTION`: used by a production composition root or route.
- `COMPLEMENTARY`: intentionally serves a different presentation or boundary.
- `EXPERIMENTAL`: testable but not mounted in production.
- `LEGACY`: compatibility-only, with a retirement decision.
- `FIXTURE/MOCK`: isolated to tests or an explicitly selected demo runtime.
- `GENERATED/EVIDENCE`: not imported as business logic and governed by retention policy.

The lifecycle is recorded in `FEATURE_REGISTRY.md` or `CANONICAL_COMPONENTS.md`; folder naming alone is insufficient.

## Target dependency direction

```text
UI / transports
    ↓
application orchestration
    ↓
domain engines and public contracts
    ↓
ports
    ↓
persistence/providers/infrastructure
```

Rules:

1. `design-contract` imports no consumer or framework.
2. `bracelet-engine`, `design-engine`, and `tarot-engine` remain deterministic and infrastructure-free.
3. Shared public Tarot DTOs and enums come from `design-contract`; Tarot-private draw state remains in `tarot-engine`.
4. Backend adapters may project domain values into local port shapes, but may not create competing public schemas under the same name.
5. Frontend uses backend APIs and public contract projections; it never imports database or internal commercial schemas.
6. 2D and 3D renderers consume the same validated design and geometry semantics.
7. Knowledge ingestion owns external fetching; Knowledge Core owns reviewed retrieval/compilation behavior; database owns persistence.

## Target component decisions

- `FlatBraceletEditor` remains the production DIY renderer until a dedicated integration task changes the product path.
- `BraceletPreview` remains a compact display renderer; it is not a DIY editor duplicate.
- `ThreeBraceletPreview` remains experimental until browser, fallback, performance, selection, export, and visual parity acceptance criteria pass.
- `BraceletSequenceEditor` requires either an explicit product role or retirement.
- Database repository classes are persistence adapters. Thin backend wrappers must add policy/orchestration or be retired after reachability proof.
- QA evidence is curated once. Raw rerun screenshots are ignored or archived outside the product tree.

## Migration sequence

1. Governance baseline and task locks — TASK-GOV-001.
2. Contract collisions — TASK-CONTRACT-001 and TASK-AI-001.
3. Production/experimental renderer decision — TASK-FE-001 and TASK-3D-001.
4. Backend and database dormant-code decisions — TASK-BE-001, TASK-BE-002, TASK-DB-001.
5. Legacy compatibility proof and retirement — TASK-COMPAT-001.
6. Evidence/resource retention and branch/worktree cleanup — TASK-REPO-001, TASK-REPO-002, TASK-ASSET-001.
7. Refresh controlling architecture documents after code cleanup — TASK-DOC-001.

No step authorizes deletion by itself. Each task must prove reachability, preserve behavior with tests, and satisfy its registered acceptance criteria.
