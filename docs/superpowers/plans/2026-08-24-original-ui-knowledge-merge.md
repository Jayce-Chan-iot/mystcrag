# Original UI + Knowledge System Lossless Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one validated local `main` that preserves the original product UI and fulfillment work while adding the copied project's knowledge base, database models, administration UI, workers, MCP service, and AI context pipeline without discarding either history.

**Architecture:** Treat `codex/tarot-guided-integration` plus its current working tree as the original-product baseline, and the root project's `main` as the knowledge-system source. Snapshot the working tree first, merge `main` into a dedicated integration branch, use domain ownership for non-overlapping files, and semantically reconcile shared contracts, Prisma models, backend composition, and frontend API boundaries. Promote only after narrow tests, full validation, database verification, UI smoke tests, and desktop-launcher checks pass.

**Tech Stack:** pnpm workspace, TypeScript, Next.js, React, Fastify, Prisma, PostgreSQL, Vitest, Playwright/browser smoke testing, shell and macOS LaunchAgents.

**Spec:** `docs/superpowers/specs/2026-08-24-original-ui-knowledge-merge-design.md`

## Global Constraints

- Preserve all existing dirty files by committing an exact snapshot before any merge.
- Never use `git reset --hard`, `git checkout -- .`, force-push, or blanket `--ours`/`--theirs` conflict resolution.
- Original product UI owns presentation, navigation, homepage, DIY/Tarot/library/gallery/profile flows, visual assets, and fulfillment behavior.
- The root `main` owns knowledge-core, ingestion, worker, MCP, context resolution, recommendation tracing, and knowledge administration/graph behavior.
- Shared contracts, Prisma schema/seed, backend routing, and frontend API adapters must be a semantic union.
- Existing migrations are immutable; add a reconciliation migration only when the combined schema requires one.
- Keep protection and snapshot branches until the user explicitly approves cleanup.
- Update controlling documentation with any final contract, API, database, or architecture resolution.
- Do not introduce medical claims, guaranteed effects, or deterministic-fortune claims.

---

## Task 1: Protect Both Inputs and Snapshot the Original Product Worktree

**Files:**

- Create: Git refs only
- Commit: every currently modified and untracked file in this worktree, excluding generated/runtime artifacts only if already ignored

- [ ] Record the starting evidence before mutation.

```bash
git branch --show-current
git rev-parse HEAD
git rev-parse main
git status --short > /tmp/mystcrag-original-ui-status-before-merge.txt
git status --short | awk 'BEGIN {m=0;u=0} /^\?\?/ {u++; next} {m++} END {print "tracked=" m, "untracked=" u}'
```

Expected: branch `codex/tarot-guided-integration`, HEAD containing the approved merge spec, with 67 tracked changes and 45 untracked entries at the time this plan was written.

- [ ] Create immutable protection pointers.

```bash
git branch codex/pre-original-ui-snapshot-20260824 HEAD
git branch codex/pre-combined-main-20260824 main
git show-ref --verify refs/heads/codex/pre-original-ui-snapshot-20260824
git show-ref --verify refs/heads/codex/pre-combined-main-20260824
```

- [ ] Create the snapshot branch and stage the exact worktree.

```bash
git switch -c codex/original-ui-snapshot-20260824
git add -A
git diff --cached --check
git diff --cached --name-status
```

- [ ] Compare the staged manifest with `/tmp/mystcrag-original-ui-status-before-merge.txt`; investigate any missing source, asset, migration, documentation, or QA evidence before committing.

- [ ] Commit the original UI/product snapshot.

```bash
git commit -m "feat(frontend): preserve original product UI and fulfillment"
git status --short
git rev-parse HEAD
```

Expected: clean worktree and a recoverable commit containing every intended original-product change.

---

## Task 2: Establish the Integration Branch and Surface Conflicts

**Files:**

- Modify: only files reported by the merge
- Preserve: all original UI assets and all knowledge-system modules

- [ ] Run a pre-merge baseline on the snapshot so failures can be distinguished from merge regressions.

```bash
pnpm --filter @mystcrag/design-contract test
pnpm --filter @mystcrag/database test
pnpm --filter @mystcrag/backend test
pnpm --filter @mystcrag/frontend test
```

Record any pre-existing failure verbatim; do not silently weaken tests.

- [ ] Create the dedicated integration branch from the snapshot.

```bash
git switch -c codex/original-ui-knowledge-integration
git merge --no-ff --no-commit main
git status --short
git diff --name-only --diff-filter=U
```

- [ ] Save the conflict list and verify both domain families are present before resolving anything.

```bash
git diff --name-only --diff-filter=U > /tmp/mystcrag-merge-conflicts.txt
test -f apps/frontend/app/atelier.css
test -d apps/frontend/public/trays
test -d packages/knowledge-core
test -d apps/worker
test -d apps/mcp-server
```

- [ ] Do not commit the merge yet. Resolve and validate one domain group at a time in Tasks 3–6.

---

## Task 3: Reconcile Shared Contracts and the Database as a Semantic Union

**Files:**

- Modify: `packages/design-contract/src/index.ts`
- Modify: `packages/design-contract/src/schemas/catalog.schema.ts`
- Modify: `packages/design-contract/src/schemas/api-dto.schema.ts`
- Modify: `packages/design-contract/src/schemas/order-snapshot.schema.ts`
- Modify: `packages/design-contract/src/schemas/tarot.schema.ts`
- Preserve/Create: `packages/design-contract/src/schemas/order-fulfillment.schema.ts`
- Modify: `packages/design-contract/tests/projection-dto.test.ts`
- Modify: `packages/design-contract/tests/tarot-contract.test.ts`
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `packages/database/prisma/seed.ts`
- Modify: `packages/database/src/repositories/product.repository.ts`
- Modify: `packages/database/src/repositories/persistence.integration.test.ts`
- Modify as needed: repository/mappers affected by the combined schema
- Modify: `docs/DATABASE_SCHEMA.md`
- Modify: `docs/DESIGN_CONTRACT_V1.md`

- [ ] Add or retain contract tests that prove both feature families coexist: original fulfillment/order fields and knowledge/context/recommendation fields must parse and project correctly.

- [ ] Run those tests and confirm they fail for a meaningful missing-union reason before resolving implementation conflicts.

```bash
pnpm --filter @mystcrag/design-contract test
```

- [ ] Resolve contract exports and schemas additively. Preserve backward-compatible field names used by original UI/API consumers; use explicit adapters for unavoidable naming differences.

- [ ] Reconcile Prisma models and relations. Retain original catalog, design, Tarot, order, and fulfillment data plus knowledge models including `KnowledgeSource`, `KnowledgeRule`, `KnowledgeEmbedding`, `KnowledgeVersion`, `SourceRegistryEntry`, `KnowledgeUsageEvent`, `KnowledgeCollectionRun`, and `DesignDecisionTrace`.

- [ ] Reconcile seed logic so product/media/fulfillment fixtures and knowledge fixtures are both idempotent. Do not delete or rename stable seed identifiers without a migration and adapter.

- [ ] Compare migration paths from both inputs. Preserve every historical migration byte-for-byte and add only a new additive reconciliation migration if Prisma reports an actual combined-schema delta.

- [ ] Format, validate, and generate the combined Prisma client.

```bash
pnpm --filter @mystcrag/database exec prisma format
pnpm --filter @mystcrag/database exec prisma validate
pnpm --filter @mystcrag/database exec prisma generate
```

- [ ] Run narrow contract/database checks.

```bash
pnpm --filter @mystcrag/design-contract test
pnpm --filter @mystcrag/design-contract typecheck
pnpm --filter @mystcrag/database test
pnpm --filter @mystcrag/database typecheck
```

- [ ] Stage only the reconciled contract, database, migration, test, and controlling-document files.

```bash
git add packages/design-contract packages/database docs/DATABASE_SCHEMA.md docs/DESIGN_CONTRACT_V1.md
git diff --cached --check
```

---

## Task 4: Reconcile Backend Composition and Recommendation/Tarot Behavior

**Files:**

- Modify: `apps/backend/src/index.ts`
- Modify: `apps/backend/src/modules/design/design-api.service.ts`
- Modify: `apps/backend/src/modules/design/design.controller.ts`
- Modify: `apps/backend/src/modules/design/design.routes.ts`
- Modify: `apps/backend/src/modules/design/design.routes.test.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.service.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.types.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.public-mapper.ts`
- Modify: Tarot tests under `apps/backend/src/modules/tarot/`
- Preserve: knowledge administration, recommendation, trace, and usage-recording modules from `main`
- Modify: `docs/API_SPECIFICATION.md`

- [ ] Add or retain backend tests proving the combined server registers health, design, recommendation, Tarot, catalog, order/fulfillment, and knowledge-admin routes without duplicate prefixes.

- [ ] Add or retain service tests proving original Tarot/design response compatibility while knowledge context, provenance, trace, and usage recording remain available.

- [ ] Run the focused tests and observe meaningful failures before implementation changes.

```bash
pnpm --filter @mystcrag/backend test -- design.routes
pnpm --filter @mystcrag/backend test -- tarot
pnpm --filter @mystcrag/backend test -- pricing
pnpm --filter @mystcrag/backend test -- inventory
pnpm --filter @mystcrag/backend test -- order
```

- [ ] Resolve `apps/backend/src/index.ts` by composing both route families explicitly. Preserve auth/authorization on knowledge administration endpoints.

- [ ] Resolve design and Tarot modules through adapters at boundaries rather than embedding frontend presentation assumptions in backend services.

- [ ] Update the API specification to document the combined surface and compatibility behavior.

- [ ] Run backend verification.

```bash
pnpm --filter @mystcrag/backend test
pnpm --filter @mystcrag/backend typecheck
pnpm --filter @mystcrag/backend build
```

- [ ] Stage the resolved backend and API documentation.

```bash
git add apps/backend docs/API_SPECIFICATION.md
git diff --cached --check
```

---

## Task 5: Preserve the Original UI and Add Knowledge Administration Surfaces

**Files:**

- Preserve original: `apps/frontend/app/page.tsx`
- Preserve original: `apps/frontend/app/layout.tsx`
- Preserve original: `apps/frontend/app/navigation.ts`
- Preserve original: `apps/frontend/app/atelier.css`
- Preserve original: `apps/frontend/components/mobile-bottom-nav.tsx`
- Preserve original: `apps/frontend/src/features/design/`
- Preserve original: `apps/frontend/src/features/tarot/`
- Preserve original: `apps/frontend/src/features/library/`
- Preserve original: `apps/frontend/src/features/gallery/`
- Preserve original: `apps/frontend/src/features/profile/`
- Preserve original: `apps/frontend/public/home/`, `public/trays/`, `public/beads/photographic/`, and related visual assets
- Modify: `apps/frontend/src/lib/api/design-api.ts`
- Modify: `apps/frontend/src/lib/api/design-api.test.tsx`
- Preserve from `main`: knowledge administration pages, knowledge graph UI, and their supporting API clients
- Modify as needed: navigation entries that expose knowledge administration without replacing product navigation

- [ ] Add or retain frontend tests that pin the original homepage/navigation, DIY tray/editor, Tarot, library, gallery, profile, mobile navigation, and visual-asset contracts.

- [ ] Add or retain tests for knowledge list/detail/version/graph administration pages and authorization/error states.

- [ ] Run focused tests before conflict resolution and record the missing behavior.

```bash
pnpm --filter @mystcrag/frontend test -- atelier-ui-contract
pnpm --filter @mystcrag/frontend test -- visual-assets
pnpm --filter @mystcrag/frontend test -- design-api
```

- [ ] Resolve presentation conflicts in favor of the original UI. Adapt `design-api.ts` to the combined backend/contract types while keeping the UI-facing view model stable.

- [ ] Integrate knowledge administration as additional authenticated routes/navigation, not as a replacement shell or homepage.

- [ ] Verify required assets and routes exist.

```bash
test -f apps/frontend/app/atelier.css
test -f apps/frontend/components/mobile-bottom-nav.tsx
test -f apps/frontend/src/features/design/components/display-tray.tsx
test -f apps/frontend/src/features/design/model/display-tray.ts
test -d apps/frontend/public/trays
test -d apps/frontend/public/home
test -d apps/frontend/public/beads/photographic
```

- [ ] Run frontend verification.

```bash
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend build
```

- [ ] Stage the resolved frontend files.

```bash
git add apps/frontend
git diff --cached --check
```

---

## Task 6: Preserve Knowledge Services, Reconcile Architecture Docs, and Complete the Merge

**Files:**

- Preserve from `main`: `packages/knowledge-core/`
- Preserve from `main`: `packages/knowledge-ingestion/` if present
- Preserve from `main`: `apps/worker/`
- Preserve from `main`: `apps/mcp-server/`
- Preserve from `main`: design-engine/context-resolver/recommendation pipeline modules
- Modify: `docs/INDEX.md`
- Modify: controlling knowledge, AI, operations, deployment, and architecture documents affected by the merge

- [ ] Verify the knowledge packages and services remain wired into workspace configuration, scripts, environment examples, and dependency graph.

- [ ] Enumerate the merged workspace set and compare it with both inputs. Confirm all 15 expected workspaces remain present and that none was silently dropped from `pnpm-workspace.yaml` or the lockfile.

- [ ] Run the narrowest checks exposed by each preserved knowledge package/service.

```bash
pnpm --filter @mystcrag/knowledge-core test
pnpm --filter @mystcrag/knowledge-core typecheck
pnpm --filter @mystcrag/worker test
pnpm --filter @mystcrag/worker typecheck
pnpm --filter @mystcrag/mcp-server test
pnpm --filter @mystcrag/mcp-server typecheck
```

If a filter name differs, read that package's `package.json` and run its actual name; do not skip it silently.

- [ ] Reconcile `docs/INDEX.md` and all routed controlling docs so the original product modules and knowledge-system modules are both current and discoverable. Keep historical reports marked as evidence rather than specifications.

- [ ] Confirm every conflict is resolved and no conflict markers remain.

```bash
git diff --name-only --diff-filter=U
rg -n '^(<<<<<<<|=======|>>>>>>>)' --glob '!pnpm-lock.yaml' .
git diff --cached --check
```

Expected: both commands produce no unresolved conflict evidence.

- [ ] Run repository-level structural checks before committing.

```bash
pnpm lint
pnpm typecheck
pnpm test
```

- [ ] Complete the merge commit.

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml docs
git diff --cached --check
git commit -m "merge: combine original UI with knowledge system"
git show --no-patch --format='%H %P %s' HEAD
```

Expected: the merge commit has two parents and the working tree is clean.

---

## Task 7: Verify Migration and Seed Compatibility Against PostgreSQL

**Files:**

- Modify only if a failing test exposes a real defect: `packages/database/prisma/schema.prisma`, migrations, seed, repositories, or tests

- [ ] Start the project database using the repository's documented command and inspect migration state.

```bash
pnpm db:up
pnpm --filter @mystcrag/database exec prisma migrate status
```

- [ ] Apply the normal development migration workflow without dropping the database.

```bash
pnpm db:migrate
```

- [ ] Seed twice to prove idempotency, then run the repository's seed verification.

```bash
pnpm db:seed
pnpm db:seed
pnpm db:verify-seed
```

- [ ] Run database unit and integration tests with the combined schema.

```bash
pnpm --filter @mystcrag/database test
```

- [ ] If fixes were required, update the controlling database document, rerun all commands in this task, and make one focused corrective commit.

```bash
git add packages/database docs/DATABASE_SCHEMA.md
git diff --cached --check
git commit -m "fix(database): reconcile product and knowledge persistence"
```

Skip the corrective commit when no files changed.

---

## Task 8: Run Full Validation and Browser-Level Product/Knowledge Smoke Tests

**Files:**

- Modify only when a failing check identifies a defect
- Add/update tests nearest to any corrected behavior

- [ ] Install exactly from the merged lockfile and run the mandated validation gate.

```bash
pnpm install --frozen-lockfile
pnpm validate
```

- [ ] Start the combined application with the documented local command, then verify service health.

```bash
pnpm dev
curl -fsS http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:3001/health
```

- [ ] In a real browser, smoke-test desktop and mobile widths for the original homepage, DIY editor/tray, AI results, Tarot setup/result, crystal library, gallery, profile, and mobile bottom navigation.

- [ ] In the same build, smoke-test authenticated knowledge list, source detail, versions, graph, collection/run status, and expected unauthorized states.

- [ ] Run the repository's closed-loop and knowledge-evaluation gates if present.

```bash
pnpm closed-loop
pnpm knowledge:eval
```

If script names differ, resolve them from the root and package `package.json` files and record the actual commands.

- [ ] For any defect, first add a reproducing test, make the smallest fix, rerun its narrow check, then rerun `pnpm validate`.

- [ ] Commit only verified corrective work, if any.

```bash
git add -A
git diff --cached --check
git commit -m "fix: complete original UI and knowledge integration"
```

Skip this commit when the tree is clean.

---

## Task 9: Promote the Validated Integration and Verify the Desktop Launcher

**Files:**

- Verify: `/Users/chenyanyan/Desktop/玄矶系统.command`
- Verify: the associated user LaunchAgent plist files
- Modify launcher files only if path/process checks fail

- [ ] Create a final protection pointer before changing local `main`.

```bash
git branch codex/pre-original-ui-knowledge-handoff-20260824 main
git rev-parse codex/original-ui-knowledge-integration
git rev-parse main
```

- [ ] Promote without rewriting history. Because the integration branch merged `main`, prefer a fast-forward.

```bash
git switch main
git merge --ff-only codex/original-ui-knowledge-integration
```

If fast-forward is impossible, stop and inspect ancestry; use an ordinary reviewed merge only when it preserves both lines of history. Never reset `main` to the integration branch.

- [ ] Run the final gate from the root project directory.

```bash
pnpm validate
git status --short
git log --oneline --decorate -8
```

- [ ] Verify the desktop launcher and LaunchAgent syntax.

```bash
bash -n /Users/chenyanyan/Desktop/玄矶系统.command
plutil -lint /Users/chenyanyan/Library/LaunchAgents/*.mystcrag*.plist
```

- [ ] Exercise the desktop script's start, status, restart, stop, and start cycle. After each state transition, check its exit status and user-facing output.

- [ ] After the final start, verify frontend, backend, database, and process working directories all point to `/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端`, not the old worktree.

```bash
curl -fsS http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:3001/health
pgrep -fal 'next|tsx|node' | rg '玄矶水晶DIY设计网页端'
```

- [ ] Keep `codex/original-ui-snapshot-20260824` and all `codex/pre-*` protection branches. Delete the integration branch only after it is fully merged and the user explicitly approves cleanup.

- [ ] Report the final commit IDs, validation commands/results, database migration/seed outcome, browser routes checked, launcher status, and any known pre-existing failures.
