# Repository Governance Phase 0 Implementation Plan

**Task:** TASK-GOV-001
**Owner:** SOL
**Branch:** `task/gov-001-repository-governance`
**Date:** 2026-08-24

## Objective

Create an evidence-backed governance layer for the combined original UI, knowledge system, database, Tarot, AI recommendation, Bracelet Engine, and 3D codebase. Mark duplicate, dormant, legacy, placeholder, and unreferenced business code and resources without deleting or refactoring them.

## Writable paths

- `AGENTS.md`
- `docs/INDEX.md`
- `docs/governance/**`
- `docs/tasks/**`
- this implementation plan

## Explicit exclusions

- All runtime code under `apps/**` and `packages/**`
- Prisma schema and migrations
- Existing branches and registered worktrees
- User-owned changes in `apps/frontend/next-env.d.ts`, `docs/audit/**`, and `docs/progress/**`

## Execution

1. Inventory workspaces, imports, routes, database models, tests, scripts, assets, branches, and worktrees.
2. Map current production, partial, dormant, compatibility, and planned features.
3. Assign one accountable owner to every module and shared contract.
4. Identify canonical implementations and classify alternatives.
5. Record duplicate, unused, placeholder, legacy, and resource-hygiene findings with evidence and confidence.
6. Describe the target layout and dependency direction without moving files.
7. Register cleanup tasks with dependencies, writable paths, and measurable acceptance criteria.
8. Score repository health and prioritize P0/P1/P2 risks.
9. Validate internal paths, architecture tests, workspace validation, and the final diff.

## Acceptance criteria

- All ten governance deliverables requested by the owner exist and are linked from `docs/INDEX.md`.
- Every workspace and production route family has a recorded purpose and owner.
- Duplicate and unused findings distinguish confirmed reachability evidence from hypotheses.
- No runtime code, database schema, branch, worktree, or existing uncommitted user file is modified.
- Cleanup work is represented as independent tasks; no cleanup is performed in Phase 0.
