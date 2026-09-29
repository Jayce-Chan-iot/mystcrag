# Star Oracle (玄圭星台) Release QA Report

- **Task:** `TASK-ORACLE-QA-001`
- **Owner:** DeepSeek-V4.1-Flash under Codex QA supervision
- **Branch:** `task/oracle-qa-001-release-gate`
- **Base:** integrated `main` `9ff93ad` (`docs(tasks): accept one tap star oracle`)
- **Worktree:** `.worktrees/oracle-qa-001-release-gate`
- **Status:** `BLOCKED` — Codex rejected candidate `ef00017` on 2026-09-29; blocked on two Frontend dependencies (the out-of-scope runtime file is restored and the architecture suite is honestly RED; ORACLE-005 is a stable FAIL)
- **Feature:** FEAT-027 Star Oracle cast and guided design

This report registers the integrated Star Oracle feature, records the evidence
for the new cross-workspace architecture assertions, and captures the full
acceptance matrix, database gate, and repository gate results. Counts below are
the actual observed values. **This QA is not a pass and is not a release gate.**
Codex rejected candidate `ef00017`; the branch is `BLOCKED` on two Frontend
dependencies (see §2 and §4), and the failing acceptance row and the
environment-limited rows are reported as such and are not restated as passes.

## 1. Scope and method

- Writable paths: the nine governing documents listed in the task, the new
  `docs/progress/2026-09-26_STAR_ORACLE_QA_REPORT.md`, `tests/architecture.test.mjs`,
  the ignored evidence directory `output/playwright/task-oracle-qa-001/`, and this
  task's `docs/tasks/TASK_REGISTRY.md` row.
- Candidate `ef00017` (rejected) had edited
  `apps/frontend/src/features/oracle/components/oracle-lines.tsx`, a runtime source file
  that is **not** in this task's writable paths and is explicitly listed as forbidden.
  That edit was out of scope and has been reverted byte-for-byte to `main@9ff93ad`; the
  correction commit restores the file so this branch carries no runtime source change.
  The architecture assertion was **not** weakened to hide the duplicate type.
- The architecture suite is therefore honestly **RED at 22/23** on this branch: the real
  duplicate `OracleLineValue` declaration remains until a separate Frontend task fixes it
  inside its own approved paths.
- No runtime behaviour, schema, migration, data, manifest, lockfile, or Auth contract
  change is retained by this task.
- The main integration worktree was read-only throughout; its user-owned
  `apps/frontend/next-env.d.ts` dev-path modification was never touched.
- The dedicated worktree's build-regenerated `apps/frontend/next-env.d.ts` was
  restored to its committed state after each build (`import "./.next/types/routes.d.ts";`).

## 2. Architecture assertions — RED → GREEN

New cross-workspace assertions added to `tests/architecture.test.mjs`:

- `Design Contract is the only public Oracle schema authority` — each of the 20 public
  Oracle schema identifiers is defined exactly once, in
  `packages/design-contract/src/schemas/oracle.schema.ts`.
- `the Oracle line enum and trigram enum have one authority and one engine mirror` —
  `OracleLineValue` and `OracleTrigram` are declared only by Design Contract and the
  Oracle engine mirror (`packages/oracle-engine/src/types.ts`).
- `the Oracle session and cast DTO family is single-sourced in Design Contract` — the
  18 session/cast DTO types are declared only by Design Contract.
- `database, context and AI production code cannot import the Oracle engine`.
- `frontend cannot import Oracle private persistence or the engine`.
- `the three-coin cast algorithm is implemented only in the Oracle engine`.

**RED** — reproduced with a temporary duplicate declaration
(`apps/frontend/src/features/oracle/red-probe.ts`, `export type OracleLineValue = 6 | 7 | 8 | 9;`):

```
node --test tests/architecture.test.mjs
ℹ tests 23
ℹ pass 22
ℹ fail 1
✖ the Oracle line enum and trigram enum have one authority and one engine mirror
```

Log: `output/playwright/task-oracle-qa-001/oracle-architecture-RED.log`

**Transient GREEN (superseded, not a pass)** — candidate `ef00017` reached 23/23 only by
also editing `oracle-lines.tsx`, which was out of scope and has been reverted. This GREEN
is no longer the branch state:

```
node --test tests/architecture.test.mjs
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

Log: `output/playwright/task-oracle-qa-001/oracle-architecture-GREEN.log`

**Current branch state (honest RED)** — after restoring `oracle-lines.tsx` to
`main@9ff93ad`, the real duplicate `OracleLineValue` is present again and the suite fails
on the single-authority assertion:

```
node --test tests/architecture.test.mjs
ℹ tests 23
ℹ pass 22
ℹ fail 1
✖ the Oracle line enum and trigram enum have one authority and one engine mirror
```

This RED is the correct gate result for the QA branch and is the first Frontend
dependency below. The fix must land in a separate Frontend task inside its own approved
paths and must not weaken the assertion.

## 3. Governance documents updated

| Document | Change |
| --- | --- |
| `docs/governance/FEATURE_REGISTRY.md` | Registers `FEAT-027` with the production entry points (`/oracle`, `/oracle/result/[sessionId]`, the four `/api/oracle/*` routes), canonical implementation, DAG direction, `ACTIVE` status, exact-true flag, request-memory-only question, deterministic catalog-grounded recommendations, and the explicit "no Tarot or 3D dependency" note. |
| `docs/governance/CANONICAL_COMPONENTS.md` | Adds the public Oracle schema authority, the single cast-mechanics authority, and the frozen Oracle schema decision. |
| `docs/governance/MODULE_OWNERS.md` | Adds the `ORACLE` module (`packages/oracle-engine`) and the Oracle public contract ownership row. |
| `docs/UI_DESIGN_SYSTEM.md` | Adds the Star Oracle interaction contract (routes, flag behaviour, non-blocking AI/DIY). |
| `docs/INTERACTION_TEST_PLAN.md` | Adds the Star Oracle acceptance matrix (ORACLE-001 … ORACLE-015). |
| `docs/DEPENDENCY_DECISIONS.md` | Adds `DEC-ORACLE-001` (local workspace engine, no third-party runtime dependency, public-domain three-coin method, MIT/CC-BY-SA references only, no copied modern interpretation text). |
| `docs/DEPLOYMENT_GUIDE.md` | Adds the `MYSTCRAG_ORACLE_ENABLED` flag semantics (exact `"true"`, client-visible aliases ignored, restart required) and the rollback steps. |
| `docs/LOCAL_DEMO_GUIDE.md` | Adds how to enable the Oracle entry locally and the question-privacy note. |
| `docs/INDEX.md` | Links this report and the Star Oracle governance documents. |

Tarot and 3D are **not** recorded as Oracle dependencies anywhere; the Oracle chain is
`ORACLE → CONTRACT/CONTEXT/AI/BACKEND/DATABASE/FRONTEND`.

## 4. Acceptance matrix

Run against the local stack (`http://localhost:3100`, backend `:4100`) with
`MYSTCRAG_ORACLE_ENABLED="true"`. Scripts and logs live in
`output/playwright/task-oracle-qa-001/`.

| Row | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| ORACLE-001 | Flag enabled: `/oracle` entry in navigation | PASS | `browser-report.json` |
| ORACLE-002 | Flag disabled: entry hidden, `/oracle` notice, AI/DIY usable | PASS (deterministic) | `oracle-setup.test.tsx` "disabled oracle flag leaves no homepage slot and no navigation promise", `navigation-capabilities.test.tsx` DISABLED case, `resolveOracleFeatureEnabled` unit tests |
| ORACLE-003 | Enabled setup renders the optional question field | PASS | `browser-report.json` |
| ORACLE-003 | Question not in URL or browser storage | PASS | `browser-report.json`; strengthened by `oracle-privacy-evidence.json` |
| ORACLE-004 | One activation → exactly one create | PASS | `browser-report.json` |
| ORACLE-005 | Double activation → exactly one create | **FAIL** | `browser-report.json`, `oracle-doubleclick-timing-result.json` |
| ORACLE-006 | Moving / no-moving cast rendering | PASS | `browser-report-extra.json` (12 live casts: 8 moving with transformed hexagram, 4 static without) + `oracle-result.test.tsx` deterministic static/moving coverage |
| ORACLE-007 | Refresh restores via GET, draws no new entropy | PASS | `browser-report.json` |
| ORACLE-008 | Recommendation failure retries only recommendations | PASS | `browser-report.json` |
| ORACLE-009 | Price/inventory conflict surfaces explicit notice, no false success | PASS | `browser-report.json` |
| ORACLE-010 | Save failure keeps the user on Oracle; retry continues to DIY | PASS | `browser-report.json` |
| ORACLE-011 | Owner isolation | PASS (deterministic) | backend `oracle.routes.test.ts` "hide cross-owner existence" (403) + DB suite "cross-owner reads are generic…", "operation lookup is owner-scoped…", "redraw lineage requires the same owner" |
| ORACLE-012 | Desktop / 390×844 / 320px: no horizontal overflow | PASS | `browser-report.json` (0px at all three) |
| ORACLE-013 | Keyboard reachability and visible focus | PASS | `browser-report.json` |
| ORACLE-014 | `prefers-reduced-motion: reduce` renders a complete result | PASS | `browser-report.json` |
| ORACLE-015 | 200% zoom proxy (720×450): usable, no overflow | PASS | `browser-report-extra.json` |

### ORACLE-005 detail (the single failing row)

```
✘ ORACLE-005 — fast 30ms double activation created >1 session:
  per-attempt create POST counts = [2, 2, 2]
```

A dedicated timing probe shows the race is window-dependent:

| Dispatch | create POSTs |
| --- | --- |
| `locator.dblclick()` | 1 |
| `Promise.all(two clicks)` | 2 |
| mouse clicks 0ms apart | 1 |
| mouse clicks 30ms apart | 2 |
| mouse clicks 60/100/150/250ms apart | 1 |

**Root cause:** `apps/frontend/app/oracle/oracle-setup-client.tsx` builds a **new**
`createOracleSetupSubmitter` inside every `submit()` call, so the submitter's
`inFlight` guard is per-call and cannot span two activations; React's `isSubmitting`
state (and the button `disabled`) has not flushed inside the ~30ms window, so a second
click reaches the network. This is a genuine frontend defect and is the second blocking
dependency. Because the fix is runtime source outside this task's writable scope, this QA
cannot pass the Completion Gate: a separate Frontend task must fix it inside its own
approved paths (single shared submitter instance, or a synchronous ref-based in-flight
guard) with strict RED/GREEN coverage proving 30 ms and `Promise.all` double activation
each issue exactly one POST.

### ORACLE-002 detail (environment limitation)

The disabled rendering is server-owned and exact-match (`resolveOracleFeatureEnabled(v) => v === "true"`).
A live disabled-server E2E could not be produced in this local environment: Next.js 16
permits only one dev server per directory, the reconstructed-environment dev server hit a
Turbopack `globals.css` PostCSS fault, and the production server returned
`auth.dependency_failed` without the original session environment. The disabled behaviour
is instead proven deterministically by the frontend tests named above, all of which run in
`pnpm validate`.

## 5. Question privacy

A live cast was made with a unique sentinel question
(`QA_SENTINEL_<epoch>_PRIVATE_QUESTION_想问的事`). Evidence: `oracle-privacy-evidence.json`,
`oracle-privacy-probe.json`.

| Surface | Sentinel present |
| --- | --- |
| Create request body | yes (the user's own input, expected) |
| Result URL | no |
| `localStorage` / `sessionStorage` | no |
| Rendered page body | no |
| Backend log | no |
| Frontend log | no |
| Persisted `oracle_sessions` row (`cast_snapshot`, `signal_snapshot`, `interpretation_snapshot`, `selected_design_id`, `recommendation_operation_id`) | no |
| `question` column in `oracle_sessions` | none exists |

Only the client-side motion/design preference boolean is stored. The question never
reaches persistence, logs, the copy service, or the design model.

## 6. Database gate

Fresh isolated PostgreSQL database, all migrations applied, documented Oracle integration
suite executed, database dropped afterwards. Evidence: `oracle-dbgate.log`,
`oracle-dbgate-evidence.json`.

```
database           mystcrag_oracleqa001_dbgate_1790692905 (new)
migrations applied 16 (including 20260926090000_add_oracle_sessions)
suite              packages/database/src/repositories/oracle-session.integration.test.ts
result             tests 7 / pass 7 / fail 0 / skipped 0
cleanup            DROP DATABASE; remaining matches = 0
```

No development or user database was created, dropped, or modified by this gate.

## 7. Repository gates

| Gate | Command | Result |
| --- | --- | --- |
| Architecture | `node --test tests/architecture.test.mjs` | **22 pass, 1 fail** on the corrected branch (the transient 23/23 of `ef00017` is superseded; see §2) |
| Full validation | `pnpm validate` | exit 0 on the rejected candidate `ef00017`; turbo 18/18 tasks (lint, typecheck, test, build); aggregated 1276 tests, 1264 pass, 12 skipped, 0 fail. Superseded: not re-run on the corrected branch, which is now architecture-RED. |
| Frontend full suite | `tsx --test` over all 86 `src/**/*.test.tsx` | 1156 tests, 1155 pass, 1 fail (see below) |
| Diff hygiene | `git diff --check` | clean |

Logs: `oracle-validate.log`, `oracle-frontend-full-tests.log`.

The one frontend failure is
`src/features/admin-bead-import/proxy.test.tsx` → "a 12 MiB upload streams intact through
the real Next proxy route", failing with "The Next dev server did not become reachable in
time." That test spawns its own Next dev server, which the running acceptance dev server
blocked; it is unrelated to Oracle and is an environment limitation of running the suite
concurrently with a live dev server.

## 8. Known limitations and non-goals

1. **ORACLE-005** (above) is a real, stable frontend race and a **blocking** Completion
   Gate failure; the fix is out of this task's writable scope and must be done by a
   follow-up Frontend task. This QA stays `BLOCKED` until it is fixed.
2. Candidate `ef00017` was rejected by Codex because it edited out-of-scope runtime source
   (`oracle-lines.tsx`); that edit is reverted and this branch now contains only
   governance, test, and evidence changes. The architecture suite is consequently RED at
   22/23 until the separate Frontend task lands the import-from-Design-Contract fix.
3. **ORACLE-002** and **ORACLE-011** are verified deterministically rather than through a
   live disabled-server / two-owner browser run, for the environment reasons above.
4. The `pnpm validate` frontend `test` task expands only 6 of the 86 frontend test files
   under turbo (pre-existing repository wiring); the full 1156-test frontend suite was run
   explicitly to close that gap.
5. Oracle non-goals are unchanged and documented: no deterministic-fortune, medical, or
   guaranteed-effect claims; recommendations are deterministic catalog-grounded designs,
   not a network LLM; Tarot and 3D are not dependencies.

## 9. Evidence directory

`output/playwright/task-oracle-qa-001/` (ignored, canonical for this task):

- `browser-report.json`, `browser-report-extra.json` — acceptance results
- `oracle-privacy-evidence.json`, `oracle-privacy-probe.json` — question privacy
- `oracle-dbgate.log`, `oracle-dbgate-evidence.json` — database gate
- `oracle-validate.log`, `oracle-frontend-full-tests.log` — repository gates
- `oracle-architecture-RED.log`, `oracle-architecture-GREEN.log` — RED→GREEN
- `oracle-doubleclick-timing-result.json` — ORACLE-005 characterisation
- `oracle-*.png` — canonical screenshots (setup, result at 1440/390/320, recommendation
  retry, price conflict, save error)

No non-canonical screenshots were added.

## 10. Rollback

`MYSTCRAG_ORACLE_ENABLED` is the only rollout control and is server-owned. Setting it to
anything other than the exact string `"true"` (or removing it) disables the navigation
entry and renders the inline "尚未开放" notice at `/oracle`, while AI design and DIY remain
fully usable. Both Backend and Frontend must be restarted after changing the value.
Client-visible (`NEXT_PUBLIC_`) aliases are intentionally ignored. See
`docs/DEPLOYMENT_GUIDE.md`.