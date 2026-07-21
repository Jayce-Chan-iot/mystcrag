# Mystcrag Decision Log

Record cross-module and shared-asset proposals here before implementation. `PROPOSED` and `REJECTED` entries do not authorize code changes. Only `APPROVED` entries reviewed by the Tech Lead authorize the described shared change.

## Decision fields

- Date:
- Proposed by Agent:
- Affected modules:
- Decision:
- Rationale:
- Rejected alternatives:
- Contract impact:
- Database impact:
- API impact:
- Approval status: `PROPOSED | APPROVED | REJECTED | SUPERSEDED`
- Approved by:
- Approval date:
- Implementation branch or commit:

## Decisions

### P3-001 — Establish Phase 3 parallel-development governance

- Date: 2026-07-21
- Proposed by Agent: Tech Lead
- Affected modules: Repository-wide collaboration and integration workflow; no product runtime module
- Decision: Use one role-owned branch per Backend, AI, 3D, Frontend, and QA Agent; enforce directory ownership, prior approval for shared assets, a fixed merge order, handoff evidence, and `pnpm validate` before handoff and after every merge.
- Rationale: Parallel development needs explicit ownership and integration gates to prevent Design Contract drift, cross-module edits, public cost leakage, and unverified merges.
- Rejected alternatives: Direct development on `main`; shared feature branches; Agent-to-Agent branch merges; unlogged shared protocol edits; validating only after all branches are merged.
- Contract impact: None. Design Contract V1 remains `1.0.0` and the single source of design truth.
- Database impact: None. The Phase 2C persistence baseline and invariants remain unchanged.
- API impact: None. Existing shared DTOs and stable error envelope remain unchanged.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-21
- Implementation branch or commit: `chore/phase-3-parallel-workflow`

### DEC-PHASE3-THREE-DEPENDENCY-001 — Add Three.js TypeScript definitions

- Date: 2026-07-21
- Proposed by Agent: 3D Engine Lead
- Affected modules: `packages/three-engine`, `pnpm-lock.yaml`
- Decision: Add `@types/three@^0.180.0` as a development dependency of `@mystcrag/three-engine`. Accept the generated lockfile entries for `@types/three@0.180.0` and its transitive type/example dependencies: `@dimforge/rapier3d-compat@0.12.0`, `@tweenjs/tween.js@23.1.3`, `@types/stats.js@0.17.4`, existing `@types/webxr@0.5.24`, `@webgpu/types@0.1.71`, `fflate@0.8.3`, and `meshoptimizer@0.22.0`.
- Rationale: Phase 3 adds typed React Three Fiber scene code that imports Three.js runtime types. The `three@0.180.0` runtime remains a peer/development dependency, while its matching DefinitelyTyped package is required only to typecheck and build `packages/three-engine`. The manifest change stays inside the 3D-owned package.
- Rejected alternatives: Hand-written ambient declarations would duplicate and weaken upstream types; `skipLibCheck` or untyped imports would reduce strictness; moving the dependency to the root or Frontend manifest would violate module ownership; removing it makes the new scene fail TypeScript validation.
- Shared asset impact: `pnpm-lock.yaml` adds one importer entry and 45 generated lines for the exact dependency closure. The diff contains no removal, upgrade, unrelated importer change, root manifest change, Frontend manifest change, or workspace configuration change. The lockfile must be regenerated with `pnpm install` after rebasing on local `main`; it must not be edited manually.
- Risk: The type package adds install footprint and transitive example/runtime declarations, so lockfile conflicts and package-store size can increase. Runtime bundle impact is expected to be zero because it is a development dependency and no new runtime import is introduced. Version drift is limited by matching Three.js `0.180.x`. `@types/three`, `fflate`, and `meshoptimizer` report MIT licenses; the dependency closure remains subject to the repository's normal license review before distribution. Frontend production build and the full workspace gate must pass after regeneration.
- Contract impact: None. `DesignV1` and the one-way adapter boundary are unchanged.
- Database impact: None.
- API impact: None.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-21
- Implementation branch or commit: `feature/three-bracelet-scene` at pre-rebase commit `61e964b`

---

## New decision template

### P3-NNN — Short decision title

- Date:
- Proposed by Agent:
- Affected modules:
- Decision:
- Rationale:
- Rejected alternatives:
- Contract impact:
- Database impact:
- API impact:
- Approval status: `PROPOSED`
- Approved by:
- Approval date:
- Implementation branch or commit:
