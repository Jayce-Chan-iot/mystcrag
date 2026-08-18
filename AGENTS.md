# Mystcrag Agent Instructions

Start with `README.md`, this file, and `docs/INDEX.md`. Read only the controlling documents routed for the module and task you are changing; historical reports are evidence, not current specifications.

## Ownership

- Frontend Agent: `apps/frontend`, `packages/ui`
- Bracelet Engine Agent: `packages/bracelet-engine` and `docs/BRACELET_GEOMETRY.md`
- Backend Agent: `apps/backend`
- Database work: `packages/database` and `docs/DATABASE_SCHEMA.md`
- AI Agent: `packages/ai-agent` and `docs/AI_AGENT_SPEC.md`
- 3D Agent: `packages/three-engine` and `docs/THREE_ENGINE_SPEC.md`
- QA Agent: `tests` and module-local tests

Do not change product positioning, delete documented modules, or introduce medical, guaranteed-effect, or deterministic-fortune claims. Keep changes within the assigned module. Update the corresponding document before or with architecture, database, API, AI-contract, Bracelet Engine, or 3D-contract changes.

Run the narrowest relevant check while developing and `pnpm validate` before handoff. Use Conventional Commits; the initialization commit is the documented exception requested by the project owner.
