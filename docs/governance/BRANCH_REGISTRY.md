# Branch Registry

**Observed:** 2026-08-25
**Open pull requests:** none
**Remote drift:** no push performed; local `main` remains ahead of `origin/main`
**Governance drift:** CLOSED; schema consolidation is integrated and BASE-004 is freezing the candidate
**Phase 0 action:** reviewed local fast-forward integration only; no branch/worktree deletion, pruning, rename or push

Status meanings: `ACTIVE` current task; `PROTECTED` integration baseline; `MERGED_RETAINED` reachable from baseline but retained; `SNAPSHOT` intentional recovery point; `INVESTIGATE_UNMERGED` not reachable from baseline; `LIVE_WORKTREE` attached to a real path; `PRUNABLE_REGISTRATION` Git metadata points to a missing temporary path.

## Active and protected

| Branch | Head | Status | Worktree / action |
| --- | --- | --- | --- |
| `task/baseline-001-governance-integration` | closure handoff descendant of `2d1b5ed` | MERGED_RETAINED | `.worktrees/baseline-001`; TASK-BASELINE-001 done; branch retained, no push |
| `task/audit-001-baseline-planning` | `74fca1f` | MERGED_RETAINED | root workspace; TASK-AUDIT-001 done; user changes remain outside its commit |
| `task/gov-001-repository-governance` | `7649f59` | MERGED_RETAINED | TASK-GOV-001 and TASK-REPO-001 complete; branch retained pending TASK-REPO-002 |
| `task/base-002-tarot-canonical-schema` | `be5646b` | MERGED_RETAINED | BASE-002 done; retained, no push |
| `task/base-003-ai-candidate-concepts` | `8d31f28` | MERGED_RETAINED | BASE-003 done; retained, no push |
| `task/base-004-freeze-baseline` | final freeze commit | ACTIVE | `.worktrees/base-004-freeze-baseline`; validation complete, tag/integration pending this record |
| `main` | `8d31f28` before final documentation-only freeze commit | PROTECTED | P0 code integrated; final tag target is recorded by the annotated tag; publish/sync is separate |

## Combined-product snapshots and integration branches

| Branch | Head | Reachability/status | Notes |
| --- | --- | --- | --- |
| `codex/original-ui-knowledge-integration` | `1a34c16` | MERGED_RETAINED + LIVE_WORKTREE | `.worktrees/tarot-guided-integration`; pre-governance product anchor, no longer same head as main |
| `codex/original-ui-snapshot-20260824` | `270abd9` | SNAPSHOT, merged | Preserve until cleanup task confirms recovery policy |
| `codex/pre-combined-main-20260824` | `9cfe75c` | SNAPSHOT, merged | Pre-combination recovery point |
| `codex/pre-knowledge-merge-20260824` | `a265590` | SNAPSHOT, merged | Pre-knowledge recovery point |
| `codex/pre-main-integration-20260824` | `9df1760` | SNAPSHOT, merged | Historical integration point |
| `codex/pre-original-ui-knowledge-handoff-20260824` | `9cfe75c` | SNAPSHOT, merged | Duplicates another snapshot head |
| `codex/pre-original-ui-snapshot-20260824` | `cfadf2f` | SNAPSHOT, merged | Historical original UI point |
| `codex/tarot-guided-integration` | `cfadf2f` | MERGED_RETAINED | Same head as a snapshot branch |
| `codex/diy-v2-bracelet-engine` | `a265590` | MERGED_RETAINED | Tracks remote; same head as pre-knowledge snapshot |
| `codex/publish-latest-updates` | `1535df8` | MERGED_RETAINED | Tracks remote |

## Historical merged delivery branches

| Branch | Head | Status/worktree |
| --- | --- | --- |
| `backup/qa-rerun-pre-sync` | `8ae159a` | MERGED_RETAINED |
| `chore/phase-3-5-remediation-coordination` | `07fa144` | MERGED_RETAINED |
| `feature/ai-recommendation` | `3a7e1b4` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `feature/backend-design-api` | `9697528` | MERGED_RETAINED |
| `feature/frontend-ai-flow` | `4ec0a8c` | MERGED_RETAINED; LIVE_WORKTREE at sibling project path |
| `feature/three-bracelet-scene` | `f222c97` | MERGED_RETAINED |
| `fix/backend-auth-boundary` | `bed42a5` | MERGED_RETAINED; LIVE_WORKTREE at sibling project path |
| `fix/frontend-three-integration` | `7c77504` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `fix/mvp-browser-integration` | `12ab21f` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `fix/postgres-verification` | `218dcb5` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `fix/product-ux-review` | `4fdafd4` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `fix/qa-backend-production-start` | `66b2a89` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `fix/qa-distinct-recommendations` | `d273040` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `fix/qa-prisma-generate` | `db0cb97` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `review/final-integration` | `e3e107a` | MERGED_RETAINED; PRUNABLE_REGISTRATION |
| `test/mvp-integration-rerun` | `82fa1e4` | MERGED_RETAINED; PRUNABLE_REGISTRATION |

## Unmerged branches requiring provenance review

| Branch | Head | Status | Required evidence before action |
| --- | --- | --- | --- |
| `backup/backend-auth-pre-rebase-acd4df8` | `acd4df8` | INVESTIGATE_UNMERGED | Compare unique commits with merged auth boundary |
| `backup/browser-pre-cleanup` | `1402ab1` | INVESTIGATE_UNMERGED | Compare browser QA evidence/fixes |
| `backup/postgres-pre-cleanup` | `d923f06` | INVESTIGATE_UNMERGED | Compare migrations and verification evidence |
| `backup/three-pre-cleanup` | `210010a` | INVESTIGATE_UNMERGED | Compare 3D contracts/renderer changes |
| `chore/phase-3-parallel-workflow` | `c5166ce` | INVESTIGATE_UNMERGED | Identify governance-only unique commits |
| `test/mvp-integration` | `0bb60a4` | INVESTIGATE_UNMERGED | Compare with rerun and final QA baseline |

## Detached/prunable metadata

Git also records a detached temporary QA worktree at `/private/tmp/mystcrag-qa-fresh-final` plus the missing temporary paths listed above. They are metadata-cleanup candidates, not permission to run `git worktree prune` during Phase 0.

## Branch policy going forward

- New work uses `task/<task-id>-<slug>` and must match one task registry row.
- `main` is integration-only; no feature work begins directly on it.
- Snapshot/backup branches require an expiry reason and cleanup task.
- Branch deletion requires TASK-REPO-002, unique-commit review, owner confirmation, and confirmation that no live worktree uses it.
- Remote publication, force update, and branch pruning are external-state changes and remain user-authorized actions.
