# Mystcrag Repository Governance

Start with `README.md`, this file, and `docs/INDEX.md`. Read only the controlling documents routed for the module and task you are changing; historical reports are evidence, not current specifications. Repository-wide governance is defined by `docs/governance/` and active work is registered in `docs/tasks/TASK_REGISTRY.md`.

## Mandatory task protocol

No implementation starts without a registered task. Every task has exactly one task ID, one owner, one branch, and one writable path set.

1. Register or claim the task in `docs/tasks/TASK_REGISTRY.md`.
2. Confirm dependencies, allowed paths, forbidden paths, and acceptance criteria.
3. Use a dedicated branch named `task/<task-id>-<slug>` and a dedicated agent worktree when work runs concurrently.
4. Mark the task `IN_PROGRESS` before changing owned files. A task may have only one `IN_PROGRESS` owner.
5. Update controlling contracts and documents in the same change as architecture, API, database, AI, Bracelet Engine, or 3D contract changes.
6. Run narrow checks while developing and the required handoff checks before marking `DONE`.

Task statuses are `BACKLOG`, `READY`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `DONE`, and `CANCELLED`. Branch and worktree presence do not establish ownership; the task registry does.

## Lock and overlap rules

- A path is locked when an `IN_PROGRESS` task lists it in `Writable paths`.
- Do not edit another task's locked path. Split the task or wait for the owner.
- Shared contracts, Prisma schema, root configuration, and governance files require an explicit task whose writable paths name the exact files.
- Generated files follow their generator. Do not hand-edit generated Prisma clients, build output, coverage, `.next`, or `dist`.
- Preserve unrelated local modifications and untracked files. Never clean, reset, prune, or delete them as part of another task.
- Cross-module work must be contract-first: the contract-owning task lands before dependent consumer tasks unless one explicitly registered integration task owns all affected paths.

## Ownership

- Frontend Agent: `apps/frontend`, `packages/ui`
- Bracelet Engine Agent: `packages/bracelet-engine` and `docs/BRACELET_GEOMETRY.md`
- Backend Agent: `apps/backend`
- Database work: `packages/database` and `docs/DATABASE_SCHEMA.md`
- AI Agent: `packages/ai-agent` and `docs/AI_AGENT_SPEC.md`
- 3D Agent: `packages/three-engine` and `docs/THREE_ENGINE_SPEC.md`
- QA Agent: `tests` and module-local tests

The authoritative ownership table, including Knowledge, Tarot, Context Resolver, Design Engine, assets, integration, and governance, is `docs/governance/MODULE_OWNERS.md`. Where this summary differs, that table controls.

## Canonical and lifecycle rules

- Use `docs/governance/CANONICAL_COMPONENTS.md` before creating a schema, renderer, service, state store, or asset pipeline.
- Register a feature and its production entry point in `docs/governance/FEATURE_REGISTRY.md`.
- New alternatives must be labeled `EXPERIMENTAL` and must not silently replace a production path.
- Compatibility code must be labeled `LEGACY`, have an owner, and have a retirement task or a documented reason to retain it.
- Suspected duplicate or unused code is evidence only until its cleanup task proves reachability, adds regression coverage, and receives owner review. Phase 0 governance never deletes it.
- Runtime assets belong under an application `public/` tree. QA evidence and generated reports belong in documented evidence locations and must not be duplicated across root folders.

Do not change product positioning, delete documented modules, or introduce medical, guaranteed-effect, or deterministic-fortune claims. Keep changes within the assigned module. Update the corresponding document before or with architecture, database, API, AI-contract, Bracelet Engine, or 3D-contract changes.

Run the narrowest relevant check while developing and `pnpm validate` before handoff. Documentation-only governance tasks must at minimum run the repository architecture tests, validate internal document paths, and inspect the final diff; run `pnpm validate` when the workspace is able to do so. Use Conventional Commits; the initialization commit is the documented exception requested by the project owner.
