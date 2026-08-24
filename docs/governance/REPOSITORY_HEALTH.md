# Repository Health

**Interim score:** 80 / 100<br>
**Governance integration anchor:** local `main` includes `4e7cdcb`<br>
**Assessment date:** 2026-08-24<br>
**Baseline:** `NOT READY`

The codebase has a credible, tested MVP core and governance is now effective on local `main`. The score remains interim—not a frozen baseline score—because two shared-contract collisions, production identity and a reproducible authenticated browser gate remain open.

## Scorecard

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Architecture | 17 / 20 | Clear monorepo boundaries, independent Bracelet Engine and canonical Design Contract; large application services and dormant paths concentrate risk. |
| Module ownership | 9 / 10 | All current modules have an explicit owner; cross-module integration still depends on governance reaching `main`. |
| Duplicate implementation | 10 / 15 | Renderers are complementary and correctly classified; Tarot public enums and AI candidate naming are unresolved duplicates/collisions. |
| Type / contract consistency | 8 / 10 | `DesignV1` consumer uniqueness is architecture-tested; two cross-module contract conflicts remain. |
| Testability | 8 / 10 | Broad unit, architecture and real PostgreSQL coverage; no automated authenticated browser suite. |
| Build / CI health | 9 / 10 | Install, lint, typecheck, tests, build and PostgreSQL checks pass; CI lacks browser E2E. |
| Maintainability | 7 / 10 | Four files exceed roughly 900 lines; some wrappers, shells and compatibility paths need lifecycle decisions. |
| Agent collaboration safety | 9 / 10 | Governance, exact locks and serial P0 DAG are on local `main`; the final baseline/tag is not frozen. |
| Documentation | 3 / 5 | Controlling docs are extensive; catalog seed counts and architecture/3D status contain known contradictions. |
| **Total** | **80 / 100** | Interim evidence-backed score after governance integration; BASE-004 must calculate the frozen score. |

## Priority summary

P0: implement BASE-002 then BASE-003 serially, then freeze and replay-validate through BASE-004.

P1: production identity/session, reproducible authenticated E2E, current-document reconciliation, and lifecycle decisions for dormant/experimental code.

P2: split concentration hotspots, review branch/worktree metadata, and retire justified compatibility/asset divergence.

## Strengths to preserve

- Original product UI remains mounted; Knowledge/Database additions did not replace it.
- Design revisions and order snapshots have immutable persistence behavior.
- Actor-scoped repositories enforce owner isolation after authentication.
- Bracelet geometry is renderer-independent and shared with Three Engine.
- Mock API and signed-test authentication fail closed in production.
- MVP positioning remains 2.5D-first; experimental 3D is not misclassified as a release blocker.

## Score exit targets

- 80+: governance integrated with frozen schema decisions; still not a baseline until code migration and replay validation pass.
- 85+: authenticated E2E gate and controlling-document reconciliation complete.
- 90+: production identity/security/deployment and commercial order flow verified.

The score changes only with integrated evidence, not with planning claims.
