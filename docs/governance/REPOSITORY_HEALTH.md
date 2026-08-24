# Repository Health

**Score:** 79 / 100
**Baseline:** combined original UI + knowledge/database at local commit `1a34c16`
**Assessment date:** 2026-08-24

The repository is locally demonstrable and well tested, with clear core package boundaries. Its largest risks are ambiguous lifecycle ownership, contract collisions, development-grade identity, and accumulated evidence/branch artifacts—not loss of the original UI.

## Scorecard

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Architecture boundaries | 17 / 20 | Strong workspace separation and root architecture tests; some application/persistence layering is concentrated |
| Contract consistency | 11 / 15 | DesignV1 and projections are canonical; Tarot enums duplicate and AI candidate naming collides |
| Feature/canonical clarity | 11 / 15 | Production 2D path is clear; dormant sequence/3D paths, wrappers and module shells were unlabeled before this registry |
| Tests and validation | 18 / 20 | Broad module tests, architecture tests and prior PostgreSQL/browser evidence; some status claims in historical reports are stale |
| Repository hygiene | 10 / 15 | TASK-REPO-001 removed 285 duplicate/reproducible evidence files (40.93 MiB) and added retention ignores; stale branch/worktree metadata remains |
| Documentation/governance | 9 / 10 | Extensive controlling specs plus this governance baseline; some older architecture/status docs need refresh |
| Operational/security readiness | 3 / 5 | Repeatable scripts and server-only knowledge admin boundary; production identity/payment/deployment hardening is incomplete |

## P0 — stop-the-line

No P0 was established by static Phase 0 evidence. This does not certify production security or commercial readiness.

## P1 — next cleanup wave

1. Consolidate shared Tarot enum/schema authority without weakening Tarot-private invariants.
2. Resolve the two incompatible `AiDesignCandidateSchema` meanings.
3. Decide the lifecycle of dormant sequence and 3D frontend paths; do not present tested code as production-mounted.
4. Prove and clean uncomposed backend service wrappers and metadata-only module shells.
5. Decide whether the dormant `DesignTemplate` persistence model is adopted or migrated away.
6. Wire or retire the documented empty/loading assets and align export beads with visible photographic assets.
7. Replace development identity with a production auth/session design before commercial release.

## P2 — maintainability and hygiene

- Split oversized orchestration/UI files along tested behavior boundaries.
- Decide the retirement horizon of explicit AI/Three/design migration compatibility surfaces.
- Audit the unattributed root crystal image.
- Refresh stale technical architecture and autonomous-state documents.
- Review and then remove redundant merged branches and prunable worktree registrations.
- Keep new raw browser screenshots and traces ignored; promote only reviewed references into `docs/ui-references/` or a release evidence set.
- Expand `packages/ui` only for genuinely repeated primitives; do not create abstraction for its own sake.

## Strengths to preserve

- The original product UI is mounted and remains the frontend baseline.
- Knowledge and database capabilities are additive packages/services rather than a UI replacement.
- Shared Design Contract and public/internal projection boundaries are architecture-tested.
- Bracelet geometry is isolated from renderer technology.
- Database writes use repositories and immutable revision/order snapshot concepts.
- Tarot avoids deterministic-fortune claims and protects unrevealed card state.
- Knowledge admin is server-key gated and knowledge usage is observable.

## Exit targets

- 80+: all P1 contract/lifecycle findings decided; no unowned production-adjacent code.
- 85+: single evidence policy, branch/worktree registry cleaned, stale controlling docs refreshed.
- 90+: production identity/security/deployment gates verified, plus sustained dependency and reachability checks.

Scores change only with evidence in merged tasks; deleting files alone does not improve the score.
