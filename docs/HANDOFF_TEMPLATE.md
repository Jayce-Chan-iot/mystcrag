# Mystcrag Phase 3 Agent Handoff

Copy this template into the Agent's Phase 3 report or handoff message. Do not omit sections; write `None` when a section has no items.

## Identity

- Agent role:
- Branch name:
- remoteStatus: `NOT_CONFIGURED`
- integrationBaseline: `LOCAL_MAIN`
- Baseline commit:
- Pre-rebase commit:
- Post-rebase commit:
- Final commit:

## Change scope

- Changed files:
- Changed modules:
- New or changed interfaces:
- Shared assets changed:
- Approved decision-log entries:
- Rebase conflict files:
- Conflict owners and resolutions:

## Verification

- Focused checks and results:
- Tests added or updated:
- `pnpm validate` command:
- `pnpm validate` result:
- Validation commit:

## Handoff notes

- Known limitations:
- Unfinished work:
- Cross-module dependencies:
- Merge risks:
- Recommended reviewer focus:

## Agent confirmation

- [ ] I confirmed the assigned branch before development.
- [ ] I changed only my owned module, owned tests, and role report, except for approved shared changes listed above.
- [ ] I recorded and obtained approval for every shared Contract, API, database, architecture, AI-contract, or 3D-contract change before implementation.
- [ ] I verified that no commercial cost, supplier, prompt, hidden reasoning, or private conversation data leaks through public boundaries.
- [ ] I ran `pnpm validate` successfully on the final change.
