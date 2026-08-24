# Original UI and Knowledge System Merge Design

**Date:** 2026-08-24
**Status:** APPROVED IN CHAT
**Target:** Preserve the original Mystcrag product and UI while integrating the knowledge-base, knowledge-console, ingestion, MCP, and database capabilities currently present on `main`.

## 1. Objective

The durable product baseline is the original engineering work in the `codex/tarot-guided-integration` worktree, including its uncommitted frontend, backend, contract, database, documentation, visual assets, and QA work. The knowledge-system line on `main` must be integrated into that baseline without replacing the original product UI.

The completed repository must provide both:

1. The original home, questionnaire, design result, DIY, Tarot, crystal library, gallery, profile, mobile navigation, tray workbench, photographic assets, and fulfillment behavior.
2. The knowledge system: knowledge contracts and taxonomy, PostgreSQL/pgvector persistence, acquisition pipeline, review flow, collection runs, knowledge console, graph visualization, worker, MCP server, deterministic design engine, and knowledge-backed recommendation flow.

No original worktree file or Git history may be discarded. No merge may use `reset --hard`, force checkout, force push, or blanket `ours`/`theirs` conflict resolution.

## 2. Repository Facts

- Original product branch: `codex/tarot-guided-integration` at `a7dfe2f` before snapshotting.
- Knowledge-system branch: `main` at `9cfe75c` when this design was approved.
- Common ancestor: `03e5ad7`.
- Original branch has 2 unique committed changes plus 112 dirty status entries: 67 modified and 45 untracked entries.
- Knowledge-system `main` has 55 unique commits.
- The dirty original work and knowledge-system history overlap in 25 tracked paths, including frontend design flows, backend design/Tarot services, shared contracts, Prisma schema/seed, and controlling documentation.

## 3. Chosen Integration Strategy

Use the original product worktree as the semantic baseline and merge the knowledge-system history into it.

1. Create durable protection references for the original branch, current `main`, and the exact dirty original worktree state.
2. Snapshot every original worktree modification and untracked file in a dedicated Conventional Commit before attempting a merge.
3. Create an integration branch from that snapshot.
4. Merge `main` into the integration branch with a normal history-preserving merge.
5. Resolve conflicts according to the ownership matrix below; every overlapping contract and persistence file receives a semantic merge.
6. Run narrow module checks during resolution and `pnpm validate` before handoff.
7. Only after validation, update local `main` and the desktop launcher to the integrated result.

This direction minimizes loss risk because the original UI contains untracked assets and implementation files that cannot be reconstructed reliably by cherry-picking only committed changes.

## 4. Ownership and Conflict Resolution Matrix

| Area | Authoritative baseline | Merge rule |
| --- | --- | --- |
| Home, global shell, navigation, responsive behavior | Original product worktree | Preserve original layout, visual language, assets, and mobile navigation. Add knowledge entry points without replacing the shell. |
| Questionnaire, design result, DIY editor, tray workbench | Original product worktree | Preserve original interaction and visual implementation. Adapt its API calls and types to the combined contracts. |
| Tarot setup, draw, result, and copy presentation | Original product worktree | Preserve original UI and user flow. Retain knowledge-backed recommendation behavior from `main`. |
| Crystal library, gallery, profile | Original product worktree | Preserve original pages, feature modules, photographic assets, and empty/loading/error states. |
| Knowledge console and graph | Knowledge-system `main` | Retain all admin routes, authentication guard, atlas, review, run, source, chart, and graph functionality. Visually adapt only where required to coexist with the original shell. |
| Knowledge ingestion and review | Knowledge-system `main` | Retain collectors, fetchers, extractors, corroboration, review gates, source registry, coverage reports, and tests. |
| Knowledge worker and MCP server | Knowledge-system `main` | Retain independent app boundaries and existing architecture constraints. |
| Design engine and context resolver | Knowledge-system `main` | Retain deterministic decision authority and unified questionnaire/Tarot contexts. Original UI consumes these through backend APIs. |
| Backend composition | Combined | Register original product routes and knowledge-admin/recommendation routes together. Preserve authentication and stable error envelopes. |
| Design contract | Combined semantic merge | Preserve original fulfillment, catalog, order, and Tarot additions while retaining knowledge, taxonomy, recommendation context, decision rule, trace, and admin API schemas. |
| Prisma schema and migrations | Combined semantic merge | Preserve original fulfillment/product changes and all knowledge tables, embeddings, collection runs, source registry, usage events, and decision traces. Existing migrations remain immutable. New reconciliation migrations are additive only if required. |
| Database repositories and seed | Combined semantic merge | Preserve original product/order behavior and knowledge repositories. Seed data must satisfy both UI/catalog and knowledge requirements. |
| Documentation | Combined | Update controlling documents to describe the combined architecture. Historical reports remain evidence and are not rewritten as specifications. |

## 5. Required Product Result

The integrated frontend keeps the original experience as the public product surface. Knowledge management remains an authenticated administrative surface under `/admin/knowledge` and includes:

- overview;
- atlas and crystal detail;
- review queue;
- source management;
- collection runs;
- knowledge graph.

The original public navigation must not be replaced by the knowledge console navigation. If a knowledge-console entry is added to the product shell, it must be secondary and access-controlled.

The original design and Tarot screens must use the combined backend. Knowledge and the deterministic design engine may alter recommendation data, evidence, and explanations, but must not silently replace the original visual presentation or interaction model.

## 6. Data and API Compatibility

- `DesignV1` remains the canonical persisted and transported design contract.
- Knowledge decision traces remain sidecars and do not contaminate immutable order snapshots with hidden reasoning.
- Pricing, stock, component sequence, and order snapshots remain backend-authoritative.
- Knowledge-backed recommendation endpoints retain Bearer authentication, Zod validation, and stable error envelopes.
- Knowledge administration retains fail-closed admin-key authentication.
- Tarot question storage remains explicit opt-in and encrypted when enabled.
- Existing migrations are never edited after application; reconciliation uses additive migrations.
- Seed execution must be idempotent and retain the catalog records required by the original UI.

## 7. Safety and Recovery

Before integration:

- retain `codex/pre-knowledge-merge-20260824` and `codex/pre-main-integration-20260824`;
- create a protection branch for `a7dfe2f`;
- create a full original-worktree snapshot commit containing all 112 dirty entries;
- record the resulting commit and tree hashes;
- keep the `_副本` repository and its `codex/knowledge-base-snapshot-20260824` branch unchanged.

During integration:

- do not delete the old worktree;
- do not prune untracked assets;
- do not use automated conflict resolution across contract, database, API, or frontend flow files;
- stage resolved files in reviewable groups;
- retain a merge commit so both histories remain visible.

The desktop launcher must not be pointed at the integration branch until validation succeeds. If validation fails, the currently running local `main` remains the runnable fallback.

## 8. Verification Strategy

### 8.1 Structural checks

- All original UI files and asset directories exist after the merge.
- All 15 pnpm workspaces remain present.
- Knowledge console routes and `/admin/knowledge/graph` remain registered.
- Backend registers design, Tarot, order, knowledge-admin, and recommendation modules.
- All original and knowledge migrations remain present.

### 8.2 Narrow checks

- Frontend UI contract, design flow, Tarot, library, gallery, and profile tests.
- Backend design, recommendation, Tarot, knowledge-admin, pricing, inventory, and order tests.
- Design-contract schema and projection tests.
- Database unit and integration tests against PostgreSQL 17 with pgvector.
- Knowledge-core, ingestion, worker, MCP, design-engine, and context-resolver tests.

### 8.3 Full checks

- `pnpm install --frozen-lockfile`
- `pnpm validate`
- database migration and idempotent seed verification
- desktop launcher start, status, restart, and stop/start cycle
- HTTP checks for `/`, representative original product routes, `/health`, and authenticated knowledge-console routing
- browser smoke coverage at desktop and mobile widths for the original UI and knowledge console

## 9. Acceptance Criteria

The merge is accepted only when all of the following are true:

1. The original public UI and its local visual assets are present and visually recognizable.
2. Original questionnaire, AI design, DIY, Tarot, library, gallery, profile, pricing, save, and order flows remain functional.
3. Knowledge acquisition, review, graph, console, worker, MCP, and knowledge-backed recommendation capabilities remain functional.
4. Original fulfillment/database additions and all knowledge/database additions coexist in the Prisma schema and migrations.
5. No original dirty worktree entry is missing from the snapshot history.
6. Full validation and required database/browser checks pass.
7. The desktop launcher starts the validated combined project rather than an obsolete worktree.

## 10. Out of Scope

- Redesigning the original UI.
- Replacing the original visual system with the knowledge console style.
- Rewriting historical migrations.
- Deleting legacy worktrees, backup branches, QA captures, or source assets.
- Publishing or force-pushing to the remote repository without separate authorization.
