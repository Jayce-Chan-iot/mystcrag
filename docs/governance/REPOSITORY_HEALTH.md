# Repository Health

**Frozen score:** 89 / 100<br>
**Assessment date:** 2026-08-25<br>
**Baseline:** `READY`<br>
**Baseline reference:** annotated tag `baseline/v0.1.0-20260825`

The repository now has a validated P0 baseline: governance is effective, the two shared-schema conflicts are resolved, and the candidate passed workspace, fresh PostgreSQL, build, and isolated authenticated browser checks. Remaining identity/deployment and maintenance work is explicitly registered after the freeze boundary.

## Scorecard

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Architecture | 17 / 20 | Clear monorepo boundaries, independent Bracelet Engine and canonical Design Contract; large application services and dormant paths still concentrate risk. |
| Module ownership | 9 / 10 | All current modules have explicit owners and exact shared-path task locks. |
| Duplicate implementation | 15 / 15 | Public Tarot schemas have one runtime authority; the two formerly ambiguous AI/backend concepts are distinctly named and architecture-tested. |
| Type / contract consistency | 10 / 10 | Canonical Tarot and AI candidate boundaries are integrated; old AI identifiers and duplicate definitions are rejected by tests. |
| Testability | 9 / 10 | Broad unit, architecture, real PostgreSQL, and isolated authenticated browser evidence; browser E2E is not yet a CI gate. |
| Build / CI health | 9 / 10 | Frozen install, lint, typecheck, tests, build, Prisma and PostgreSQL checks pass; CI still lacks browser E2E. |
| Maintainability | 7 / 10 | Four files exceed roughly 900 lines; wrappers, shells and compatibility paths need lifecycle decisions. |
| Agent collaboration safety | 10 / 10 | Governance, exact locks, serial P0 DAG, clean candidate and annotated rollback tag define a reproducible handoff boundary. |
| Documentation | 3 / 5 | Baseline/canonical records are reconciled; known catalog seed and architecture/3D status contradictions remain registered. |
| **Total** | **89 / 100** | Evidence-backed frozen score after BASE-004. |

## Priority summary

- Baseline P0: none.
- FEAT-018 decision gate: identity provider, callback/deployment domain and browser session topology require Human Product Owner decisions before AUTH work.
- P1: production identity/session, browser E2E in CI, current-document reconciliation, dormant/experimental lifecycle decisions and asset/export parity.
- P2: compatibility review, concentration-hotspot splits and branch/worktree metadata cleanup.

## Strengths to preserve

- Original product UI remains mounted; Knowledge/Database additions did not replace it.
- Design revisions and order snapshots have immutable persistence behavior.
- Actor-scoped repositories enforce owner isolation after authentication.
- Bracelet geometry is renderer-independent and shared with Three Engine.
- Mock API and signed-test authentication fail closed in production.
- MVP positioning remains 2.5D-first; experimental 3D is not misclassified as a release blocker.
- Contract authority is enforced by architecture tests, not documentation alone.

## Score interpretation

- 85+: stable baseline with authenticated end-to-end evidence and reconciled controlling baseline contracts.
- 90+: production identity/security/deployment plus commercial order flow must be verified.

The score changes only with integrated evidence, not with planning claims.
