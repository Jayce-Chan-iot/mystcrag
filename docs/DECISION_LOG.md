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
