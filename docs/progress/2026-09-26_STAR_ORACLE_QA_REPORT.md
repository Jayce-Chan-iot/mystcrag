# Star Oracle (玄圭星台) Release QA Report

- **Task:** `TASK-ORACLE-QA-001`
- **Owner:** DeepSeek-V4.1-Flash under Codex QA supervision
- **Branch:** `task/oracle-qa-001-release-gate`
- **Base:** integrated `main` `9ff93ad`, now `main` `eef033f` (`docs(tasks): accept oracle frontend release blockers`) merged in as `79414bd`
- **Worktree:** `.worktrees/oracle-qa-001-release-gate`
- **Status:** `BLOCKED` — resumed 2026-09-30 after `TASK-ORACLE-FE-003` reached `DONE` on `main` `eef033f` and was merged here (`79414bd`). The first blocker is closed: the duplicate `OracleLineValue` declaration is gone and the architecture suite is now honestly **23/23 GREEN** (§2). The second blocker, **ORACLE-005, is still a stable FAIL**: a fresh browser re-run of the original `Promise.all` and ~30 ms double-activation patterns still creates two sessions, because FE-003's in-flight guard is released on the successful settle before the navigation commits (§4).
- **Feature:** FEAT-027 Star Oracle cast and guided design

This report registers the integrated Star Oracle feature, records the evidence
for the new cross-workspace architecture assertions, and captures the full
acceptance matrix, database gate, and repository gate results. Counts below are
the actual observed values. **This QA is not a pass and is not a release gate.**
Codex rejected candidate `ef00017`; `TASK-ORACLE-FE-003` then closed the first
blocker on `main` and is merged here, so the architecture suite is green, but
**ORACLE-005 remains a blocking FAIL** (see §4). The failing acceptance row and
the environment-limited rows are reported as such and are not restated as passes.

## 0. Resumed re-verification (2026-09-30)

A minimal incremental re-verification was run on the existing branch/worktree
after `TASK-ORACLE-FE-003` `DONE` was merged from `main` `eef033f`. Commands and
observed values:

| Step | Command | Result |
| --- | --- | --- |
| Merge | `git merge main` → `79414bd` | clean merge; only this task's `TASK_REGISTRY.md` row conflicted and both the FE-003 `DONE` row and the QA row were kept |
| Architecture | `node tests/architecture.test.mjs` | **23 tests / 23 pass / 0 fail** (previously 22/23) |
| Oracle focused | `tsx --test` over the six Oracle `*.test.tsx` | **64 tests / 64 pass / 0 fail** |
| `oracle-setup-client` only | `tsx --test src/features/oracle/oracle-setup-client.test.tsx` | **4 tests / 4 pass / 0 fail** |
| ORACLE-005 postfix | `node output/playwright/task-oracle-qa-001/oracle-005-postfix.mjs` | **FAIL — 6 runs, 4 violated the exactly-one contract** (§4) |
| ORACLE-005 diagnostic | `node output/playwright/task-oracle-qa-001/oracle-005-diagnose.mjs` | **FAIL — 3/3 runs issued 2 create POSTs** (§4) |
| Full validation | `pnpm validate` | exit 0; turbo 18/18 tasks |
| Document paths | `node output/playwright/task-oracle-qa-001/check-doc-paths.mjs` | 10 documents, 6 relative links, **0 broken** |
| Diff hygiene | `git diff --check` | clean |

The frontend-only dependency means the Backend/Database are unchanged, so the
previously completed fresh isolated PostgreSQL 16 migrations + Oracle suite
**7/7** gate (§6) is **retained and was not re-run** this round.

The QA re-run confirms the architecture blocker is resolved but that **ORACLE-005
is not**: the FE-003 unit test that was supposed to cover the ~30 ms case keeps the
create promise *pending* across the second activation, whereas the real browser
settles the create (~15–30 ms) before the second click, releasing the guard. The
task therefore stays `BLOCKED`.

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
- That out-of-scope edit was later made legitimately by `TASK-ORACLE-FE-003` inside its own
  approved paths and landed on `main` `eef033f`; this branch merged it (`79414bd`), so the
  duplicate `OracleLineValue` declaration is gone and the architecture suite is now honestly
  **GREEN at 23/23** on this branch (§2). The assertion itself was **not** weakened.
- No runtime behaviour, schema, migration, data, manifest, lockfile, or Auth contract
  change is retained by this task. (The `oracle-lines.tsx` and `oracle-setup-client.tsx`
  changes now present on this branch arrive only through the reviewed `main` merge and are
  the accepted `TASK-ORACLE-FE-003` dependency, not QA-authored runtime.)
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

**Current branch state (honest GREEN, 2026-09-30)** — `TASK-ORACLE-FE-003` fixed the
duplicate declaration legitimately inside its own approved paths and landed it on `main`
`eef033f`; this branch merged it as `79414bd`, so the real duplicate `OracleLineValue` is
gone and the suite passes on the single-authority assertion:

```
node tests/architecture.test.mjs
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

Log: `output/playwright/task-oracle-qa-001/oracle-architecture-POSTFIX.log`

This GREEN is the correct gate result for the QA branch and closes the first Frontend
dependency. The assertion was not weakened to reach it.

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

### ORACLE-005 detail (the single failing row — re-verified 2026-09-30, still FAIL)

Pre-fix characterisation (2026-09-29, `oracle-doubleclick-timing-result.json`): the race
was window-dependent (`Promise.all` → 2, mouse +30ms → 2, others → 1) and was root-caused
to `OracleSetupClient` building a **new** `createOracleSetupSubmitter` inside every
`submit()` call, so the `inFlight` guard was per-call and could not span two activations.

`TASK-ORACLE-FE-003` replaced that with one submitter held in `useState`, but the re-run on
the merged branch shows the **same acceptance failure persists**:

```
node output/playwright/task-oracle-qa-001/oracle-005-postfix.mjs
PASS parallel posts=1 navigations=1
FAIL parallel posts=2 statuses=[200,200] navigations=1
PASS parallel posts=1 navigations=1
FAIL mouse30  posts=2 statuses=[200,200] navigations=1
FAIL mouse30  posts=2 statuses=[200,200] navigations=1
FAIL mouse30  posts=2 statuses=[200,200] navigations=1
RESULT FAIL — 6 runs, 4 runs violated the exactly-one contract
```

Evidence: `oracle-005-postfix-result.json` (`parallel [1,2,1]`, `mouse30 [2,2,2]`; every
run navigated exactly once, so the duplicate is a silently-created second session, not a
second navigation). The original pre-fix evidence (`oracle-doubleclick-*.mjs`,
`oracle-doubleclick-timing-result.json`) is retained untouched.

An instrumented re-run (`oracle-005-diagnose.mjs`, 3/3 iterations) isolates the mechanism:

| Observation (per run) | Value |
| --- | --- |
| Button `disabled` ~10 ms after click 1 | `true` (`正在启卦…`) |
| Button `disabled` ~30 ms after click 1 | **`false`** (`启卦`) |
| URL at ~30 ms | still `/oracle` (navigation not yet committed) |
| create POSTs for the two activations | **2**, both `200` |

**Root cause (post-FE-003):** `createOracleSetupSubmitter`
(`apps/frontend/src/features/oracle/components/oracle-setup.tsx`) releases its `inFlight`
guard with `.finally(...)`, i.e. on **success as well as failure**. `navigate()` is
`router.push(path)`, which returns synchronously and does not wait for the route to
commit, so the guard — and React's `isSubmitting`/`disabled` — are cleared as soon as the
create request settles (~15–30 ms on localhost) while the page is still the mounted
`/oracle` screen. A second activation inside that window starts a fresh create and the
backend persists a second session. The FE-003 unit test does not catch this because its
harness keeps the create promise **pending** across the second activation (it only resolves
when `finish()` is called afterwards), which is the opposite of the real ~30 ms timing.

This remains a genuine frontend defect and the **blocking** Completion Gate failure.
Because the fix is runtime source outside this task's writable scope, this QA cannot pass:
a follow-up Frontend task must hold the guard until the navigation commits (release
`inFlight` only on rejection, for the retry path) and must add coverage that lets the
create settle **before** the second activation — proving `Promise.all` and ~30 ms double
activation each issue exactly one POST, one session and one navigation.

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

**Retained, not re-run this round (2026-09-30).** The only change merged since this gate is
the frontend `TASK-ORACLE-FE-003` fix; the Backend, database schema and migrations are
byte-for-byte unchanged, so the fresh isolated PostgreSQL gate above still holds and was
**not** re-executed. This report does not claim a second database run.

## 7. Repository gates

| Gate | Command | Result |
| --- | --- | --- |
| Architecture (2026-09-30) | `node tests/architecture.test.mjs` | **23 pass, 0 fail** on the merged branch (first blocker closed; see §2) |
| Oracle focused (2026-09-30) | `tsx --test` over the six Oracle `*.test.tsx` | 64 tests, 64 pass, 0 fail |
| Full validation (2026-09-30) | `pnpm validate` | exit 0; turbo 18/18 tasks |
| Document paths (2026-09-30) | `node output/playwright/task-oracle-qa-001/check-doc-paths.mjs` | 10 documents, 6 relative links, 0 broken |
| Diff hygiene (2026-09-30) | `git diff --check` | clean |
| Full validation (2026-09-29, superseded) | `pnpm validate` | exit 0 on the rejected candidate `ef00017`; aggregated 1276 tests, 1264 pass, 12 skipped, 0 fail |
| Frontend full suite (2026-09-29) | `tsx --test` over all 86 `src/**/*.test.tsx` | 1156 tests, 1155 pass, 1 fail (see below) |

Logs: `oracle-validate.log`, `oracle-frontend-full-tests.log`,
`oracle-architecture-POSTFIX.log`, `oracle-doc-path-check-POSTFIX.log`.

The one frontend failure is
`src/features/admin-bead-import/proxy.test.tsx` → "a 12 MiB upload streams intact through
the real Next proxy route", failing with "The Next dev server did not become reachable in
time." That test spawns its own Next dev server, which the running acceptance dev server
blocked; it is unrelated to Oracle and is an environment limitation of running the suite
concurrently with a live dev server.

## 8. Known limitations and non-goals

1. **ORACLE-005** (above) is a real, stable frontend race and a **blocking** Completion
   Gate failure that **survived** the `TASK-ORACLE-FE-003` fix. The re-run on the merged
   branch still creates two sessions for the original `Promise.all` and ~30 ms patterns; the
   guard is released on the successful settle before navigation commits. The fix is out of
   this task's writable scope and must be done by a follow-up Frontend task. This QA stays
   `BLOCKED` until it is fixed.
2. Candidate `ef00017` was rejected by Codex because it edited out-of-scope runtime source
   (`oracle-lines.tsx`). That same fix later landed legitimately through
   `TASK-ORACLE-FE-003` on `main` `eef033f` and is merged here (`79414bd`), so the
   architecture suite is now honestly GREEN at 23/23; the assertion was not weakened.
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
- `oracle-architecture-POSTFIX.log` — fresh 23/23 on the merged branch
- `oracle-doubleclick-timing-result.json` — ORACLE-005 pre-fix characterisation (retained)
- `oracle-005-postfix.mjs`, `oracle-005-postfix.log`, `oracle-005-postfix-result.json` —
  ORACLE-005 post-fix acceptance (6 runs: `parallel [1,2,1]`, `mouse30 [2,2,2]`)
- `oracle-005-diagnose.mjs`, `oracle-005-diagnose-result.json` — post-fix mechanism probe
  (button re-enabled by ~30 ms, 2 create POSTs, both `200`)
- `oracle-focused-POSTFIX.log`, `oracle-doc-path-check-POSTFIX.log` — focused/gate logs
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