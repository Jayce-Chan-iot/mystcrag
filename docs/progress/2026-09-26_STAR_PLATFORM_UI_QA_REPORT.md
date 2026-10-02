# Star Platform Full UI Redesign — Task 6 Visual Gate QA Report

Date: 2026-10-02
Task: `TASK-QA-STAR-001`
Owner: DeepSeek-V4.1-Flash under Codex QA supervision
Branch: `task/qa-star-001-full-visual-gate`
Worktree: `/Users/chenyanyan/.codex/worktrees/qa-star-001-full-visual-gate/玄矶水晶DIY设计网页端`
Plan: `docs/superpowers/plans/2026-09-26-star-platform-full-ui-redesign.md` Task 6

## 1. Composition baseline

The QA candidate is composed from the accepted redesign tasks and adds no
business-logic change:

| Source | Tip | Status |
| --- | --- | --- |
| `task/fe-star-004-design-detail-integration` (composes FE-STAR-001 + FE-STAR-003/004) | `797d69a` | DONE, QA start point |
| `task/fe-star-002-diy-workbench` | `eb765e4` | DONE, merged into the candidate |
| `task/fe-star-005-browser-remediation` (page-family remediation of DEV-1/2/3) | `8272c1f` | DONE, fast-forward merged into the QA candidate on 2026-10-02 |

- Composition commit (HEAD at QA start): `a678264` — `chore(task): combine accepted FE-STAR-002 workbench into QA candidate`.
- Final QA candidate (HEAD after the FE-STAR-005 fast-forward merge): `8272c1f` — `docs(tasks): accept TASK-FE-STAR-005`.
- The only conflicted path while merging FE-STAR-002 was `docs/tasks/TASK_REGISTRY.md`; it was resolved mechanically to keep each FE-STAR task's own DONE acceptance record and to set this task's row. No accepted business code was rewritten, and no non-registry conflict occurred. FE-STAR-005 was a clean fast-forward, so no conflict arose and its accepted DONE row is unchanged.
- `apps/frontend/next-env.d.ts` is a generated file that `next dev`/`next build` rewrite. It is restored to its HEAD content before handoff (SHA-256 `7b550dda9686c16f36a17bf9051d5dbf31e98555b30d114ac49fc49a1e712651`) and is **not** a user-authored change.

## 2. What this task changed

| Path | Change |
| --- | --- |
| `apps/frontend/components/page-scaffold.tsx` | Adds the one `SystemState` / `SystemStatePanel` primitive over the shared `@mystcrag/ui` status panel; removes the `工程骨架已就绪` placeholder copy. |
| `apps/frontend/src/components/flow-notice.tsx` | Inline non-auth notices reuse the same system-state hooks and star tokens instead of a bespoke panel. |
| `apps/frontend/app/loading.tsx` (new) | Route-level `loading` state through `SystemState`. |
| `apps/frontend/app/error.tsx` (new) | Client error boundary through `SystemState` with a recoverable `reset` action (no `router.back`/`location.reload` fake recovery). |
| `apps/frontend/app/not-found.tsx` | 404 delegates to `SystemState` with route-approved copy. |
| `apps/frontend/src/features/auth/browser/auth-required-dialog.tsx` | Appearance/accessibility only: restyled onto star tokens; the real Authing OIDC `/auth/login?returnTo=...` entry and desktop launcher recovery are unchanged. No second session-required component. |
| `apps/frontend/src/features/auth/browser/flow-notice-auth-dismiss.test.tsx` | Covers the restyled notice dismiss/role behaviour. |
| `apps/frontend/app/atelier.css`, `apps/frontend/app/styles/star-components.css` | Star state/notice surface styles; removal of the legacy atelier rules that overrode the workbench toolbar background and the dead `[data-atelier-surface="content-shell"] > div` block. (`apps/frontend/app/globals.css` was in the writable set but needed no edit: the star stylesheet load order it already declares was correct.) |
| `apps/frontend/src/features/design/star-system-states.test.tsx` (new) | The system-state + legacy-drift contract. |
| `scripts/ui-qa/capture_star_platform.py` (new) | Repeatable capture + `--validate` browser matrix. |
| `docs/UI_DESIGN_SYSTEM.md`, `docs/INTERACTION_TEST_PLAN.md`, `apps/frontend/design-qa.md` | Controlling docs updated to production. |

No API, database, `DesignV1`, price, stock, Bracelet Engine, save, revision, order, Auth-contract, or manifest behaviour was changed.

FE-STAR-005's page-family remediation is included by the fast-forward merge above.
It adds surface-aware readable text tokens in the page-family stylesheets, wraps and
shrinks the `/profile` preview row, and keys the gallery list children by stable
`designId`. Those edits change presentation attributes/CSS and page-family render keys
only — no API, design-state, pricing, inventory, route, save, or order behaviour.

## 3. TDD: RED → GREEN

RED (pre-repair state at the QA start point): the focused suite failed because
`app/loading.tsx` and `app/error.tsx` did not exist (`assert.fail("missing file")`),
`page-scaffold.tsx` still shipped the `工程骨架已就绪` placeholder, `FlowNotice`
painted its own panel with a literal colour instead of star tokens, and
`not-found.tsx` hand-rolled its markup instead of delegating to a shared
primitive. The assertions in `star-system-states.test.tsx` target exactly those
pre-repair conditions.

GREEN (after the minimal repair):

```
pnpm --filter @mystcrag/frontend exec tsx --test \
  src/features/design/star-system-states.test.tsx \
  src/features/design/star-shell-contract.test.tsx \
  src/features/design/star-content-contract.test.tsx
# tests 48 | pass 48 | fail 0
```

No business logic was duplicated and no assertion was weakened to reach GREEN.

## 4. Real-browser capture matrix

`scripts/ui-qa/capture_star_platform.py` is idempotent (filenames are derived from
route + viewport, so a repeat run overwrites instead of accumulating). Evidence
lives only in the canonical, git-ignored `output/playwright/task-qa-star-001/`.

Coverage: 17 route-states × 5 viewports (`390×844`, `768×1024`, `1024×768`,
`1440×560`, `1440×900`) = **85 screenshots**.

Final re-verification run on the FE-STAR-005-composed candidate captured
**85/85** screenshots with `not_captured=0` and `overlay_rows=0`
(`capture-run.log`, `capture-summary.json`). The earlier pre-remediation run on
`c3967e4` captured 80/85 and flagged the five `/gallery` rows with the dev error
overlay; the fast-forward merge removes that overlay.

Route-states captured: `home`, `ai-design`, `oracle-setup`, `tarot-setup`,
`diy-workbench` (`/diy/design-diy-private`), `crystal-library`, `gallery`,
`design-detail` (`/design/design-ai-published`), `profile`, `not-found`,
`state-empty`, `state-error`, `state-offline`, `state-loading`, `oracle-result`,
`tarot-draw`, `tarot-result`.

The empty/error/offline states are produced by intercepting the real catalog
request on `/crystal-library`, so the page renders its own recoverable state
through the shared star presentation rather than a fabricated screenshot. The
session-backed routes (`oracle-result`, `tarot-draw`, `tarot-result`) are driven
through their real setup flow.

## 5. Accessibility / interaction validation matrix

```
STAR_QA_BASE_URL=http://localhost:3000 python3 -u scripts/ui-qa/capture_star_platform.py --validate
```

Result of the final re-verification on the FE-STAR-005-composed candidate
(2026-10-02): **73 checks, 73 PASS, 0 FAIL** (`validation-summary.json`,
`validation-run.log`). The initial run on the pre-remediation candidate
(`c3967e4`) was **64 PASS / 9 FAIL** (`64/73`); those nine failures were the
page-family deviations DEV-1/2/3 recorded in §7 and are now closed by
TASK-FE-STAR-005.

Checks performed:

1. `reflow-320:*` — no horizontal scroll at 320 px (9 routes).
2. `zoom-200:*` — no horizontal scroll at 200 % text resize (9 routes).
3. `reduced-motion:*` — the reduced-motion rule exists and no animation iterates forever.
4. `contrast-aa:*` — rendered-pixel text/background contrast against the WCAG AA floor (4.5, or 3.0 for large text).
5. `touch-44:*` — no visible control below 44 px on mobile.
6. `cta-visible:*` — the primary CTA is fully inside the viewport.
7. `overlay-center:*` — no overlay intercepts the page centre.
8. `crystal-not-tinted:*` — crystal/tray imagery carries no colour-mapping filter or non-normal blend mode.
9. `capability-home-cards` — the homepage renders as many creation cards as it declares.
10. `oracle-single-cast` — one activation of 启卦 sends exactly one create request.
11. `no-error-overlay:*` — no runtime error dialog is mounted (detected inside the `nextjs-portal` shadow root).
12. `keyboard-focus:*` — real Tab traversal reaches real controls and every stop shows a visible focus indicator.
13. `keyboard-complete:oracle` — Tab reaches the cast action and Enter completes the cast.

PASS highlights (final run): all 9 routes reflow at 320 px and at 200 % text
resize (`zoom-200:profile` overflowX 0); every `contrast-aa:*` row meets the floor
— home 5.8, ai-design 8.19, oracle-setup 6.18, tarot-setup 5.14, diy-workbench
5.98, crystal-library 5.14, gallery 4.85, design-detail 5.01, profile 5.44;
reduced motion honoured; all 9 routes keyboard-navigable with visible focus
(`noRing` empty everywhere); the Oracle cast completes keyboard-only; 44 px mobile
targets hold; no CTA clipping; no overlay interception and `no-error-overlay:*` =
none on all 9 routes including `/gallery`; crystal imagery untinted (13 library +
86 workbench images); capability switch renders 4/4 cards; one Oracle activation
sends exactly one create POST.

### Automated gate commands

| Command | Result |
| --- | --- |
| `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/star-system-states.test.tsx src/features/design/star-shell-contract.test.tsx src/features/design/star-content-contract.test.tsx` | 48/48 PASS |
| `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/star-browser-remediation.test.tsx` | 9/9 PASS (FE-STAR-005 remediation contract) |
| `pnpm --filter @mystcrag/frontend test` | 6/6 PASS — the configured script's unquoted `src/**/*.test.tsx` is expanded by `sh` as `src/*/*.test.tsx`, so it reaches only the shallow test files |
| `pnpm exec tsx --test "src/**/*.test.tsx"` (frontend root, Node-side glob) | 1272/1272 PASS — the complete frontend suite |
| `pnpm --filter @mystcrag/frontend typecheck` | PASS |
| `pnpm --filter @mystcrag/frontend lint` | PASS |
| `pnpm --filter @mystcrag/frontend build` | PASS (`next build`) |
| `node --test tests/architecture.test.mjs` | 23/23 PASS |
| `pnpm validate` | PASS — 18/18 turbo tasks (lint + typecheck + test + build), exit 0 |
| `git diff --check` | clean |

The full frontend suite is run with the glob quoted so Node expands it. The
configured `pnpm --filter @mystcrag/frontend test` script does not enable
`globstar`, so under `sh` it silently covers only a shallow subset; this is a
pre-existing root-script limitation (`apps/frontend/package.json` is outside this
task's writable set) and is recorded here rather than worked around.

## 6. Route-by-route status

| Route | reflow 320 | zoom 200 | contrast AA | touch 44 | CTA | overlay | keyboard | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (home) | PASS | PASS | PASS 5.8 | PASS | n/a | PASS | PASS | PASS |
| `/ai-design` | PASS | PASS | PASS 8.19 | n/a | n/a | PASS | PASS | PASS |
| `/oracle` (setup) | PASS | PASS | PASS 6.18 | PASS | PASS | PASS | PASS | PASS |
| `/tarot/setup` | PASS | PASS | PASS 5.14 | n/a | PASS | PASS | PASS | PASS |
| `/diy/design-diy-private` | PASS | PASS | PASS 5.98 | n/a | n/a | PASS | PASS | PASS |
| `/crystal-library` | PASS | PASS | PASS 5.14 | PASS | n/a | PASS | PASS | PASS |
| `/gallery` | PASS | PASS | PASS 4.85 | n/a | n/a | PASS | PASS | PASS |
| `/design/design-ai-published` | PASS | PASS | PASS 5.01 | n/a | n/a | PASS | PASS | PASS |
| `/profile` | PASS | PASS (0 px) | PASS 5.44 | n/a | n/a | PASS | PASS | PASS |

Ratios are the worst measured row per route from the final run (the checked
element may be a paragraph or a button); every row meets the 4.5 floor.

System states: `not-found` (`data-star-surface="system-state"`), `state-empty`
(library empty), `state-error` (recoverable 500 notice), `state-offline`
(connection-refused notice) and `state-loading` all captured at every viewport
with no horizontal overflow and no unexpected error overlay. Session routes
`oracle-result`, `tarot-draw`, `tarot-result` captured at every viewport.

## 7. Initial-run deviations DEV-1/2/3 — closed by TASK-FE-STAR-005

The initial run on `c3967e4` recorded nine failures in page-family
components/stylesheets that are **not** in `TASK-QA-STAR-001`'s writable path
set. They were filed here as boundary-clear follow-ups (DEV-1/2/3) rather than
fixed in this change, and are now **closed** by the accepted, independently
reviewed `TASK-FE-STAR-005` remediation that this candidate fast-forwards onto.
The final run on `8272c1f` reproduces 73/73 PASS with each DEV acceptance
criterion met. The original symptom/root-cause records are retained below as
evidence.

### DEV-1 — AA contrast on accent micro-copy (7 routes)

- Symptom: 12 px accent-coloured eyebrow/kicker labels fall below 4.5:1 — e.g. brass `#b08d57` on paper `#f4efe6` = **2.70:1** (verified by hand against the WCAG formula), brass-ink `#7a5c32` on dark lacquer `#252028` = **2.59:1**, and muted `#817c7f` on paper `#fbfaf7` = **3.93:1**.
- Root cause: customer components render `text-[var(--accent)]` (the legacy alias → `--star-brass`) or `--star-brass-ink` as *text* without a surface-aware token, so the accent colour is used on both dark and light surfaces where only one of the two is legible.
- Owning files (outside this task's scope): `src/features/questionnaire/**` (eyebrow `01 · 当下`), `src/features/oracle/**` (`玄圭星台`), `src/features/tarot/components/tarot-setup.tsx:285`, `src/features/design/components/diy-editor.tsx:889` (`--muted`), `src/features/library/components/crystal-library-page.tsx:859,886`, `src/features/gallery/**`, `src/features/design/components/design-results.tsx:379`, and the page-family stylesheets `star-acquisition.css` / `star-content.css` / `star-workbench.css`.
- Why it is not fixed here: the correct repair is a surface-scoped text token in each page-family stylesheet (or its component). Editing those paths would breach this task's writable set; a global `--accent` change is rejected because it would break the currently-passing dark-surface contrast (`home` 5.8:1 → ~3.1:1).
- Repro: `STAR_QA_BASE_URL=http://localhost:3000 python3 scripts/ui-qa/capture_star_platform.py --validate` → the `contrast-aa:*` rows.
- Acceptance: every `contrast-aa:*` row ≥ 4.5 (or ≥ 3.0 for large text).
- Status: **CLOSED** by `TASK-FE-STAR-005`. Final run: ai-design 8.19, oracle-setup 6.18, tarot-setup 5.14, diy-workbench 5.98, crystal-library 5.14, gallery 4.85, design-detail 5.01 — all ≥ 4.5; home stays 5.8.

### DEV-2 — `/profile` horizontal overflow at 200 % text resize (118 px)

- Symptom: `zoom-200:profile` reports `overflowX: 118` at a 1440 px viewport.
- Root cause: the profile design-preview row lays out rem-sized bead thumbnails (`h-9 w-9`, i.e. `2.25rem`) in a `flex items-center gap-1` row; at a 200 % root font size the row exceeds the viewport.
- Owning file (outside scope): `src/features/profile/components/profile-page.tsx`.
- Acceptance: `zoom-200:profile` `overflowX ≤ 1`.
- Status: **CLOSED** by `TASK-FE-STAR-005`. Final run: `zoom-200:profile` overflowX 0, and `reflow-320:profile` still 0.

### DEV-3 — `/gallery` runtime error overlay (React key warning)

- Symptom: `no-error-overlay:gallery` → `nextjs-error-overlay`; the capture records the persistent dev dialog "Console Error — Each child in a list should have a unique \"key\" prop … passed a child from GalleryPage".
- Root cause: `GalleryPage` renders a child list without unique `key` props.
- Owning file (outside scope): `src/features/gallery/components/gallery-page.tsx`.
- Acceptance: `no-error-overlay:gallery = none` and zero console errors on `/gallery`.
- Status: **CLOSED** by `TASK-FE-STAR-005`. Final run: `no-error-overlay:gallery` none; all five gallery rows capture with `overlay=None`.

Follow-up: `TASK-FE-STAR-005` was registered with exactly the files above in its
writable set and the three acceptance criteria above as its gate; Codex accepted
it as `8272c1f` and this candidate fast-forwards onto it.

## 8. Why Knowledge admin is token-only

The plan's global constraints give Knowledge admin only base tokens and
state-component alignment, not the immersive narrative layout. Admin therefore
keeps the legacy `--accent` / `--muted` aliases and the labelled `LEGACY`
`atelier.css` baseline; `star-tokens.css` documents that removing those aliases
requires a separately registered admin redesign task. This task aligns admin
only through shared tokens and the shared system-state components, and removes
only the one proven-dead legacy atelier rule (`content-shell > div`) plus the
workbench-toolbar override that was defeating the star surface.

## 9. Not executed / blocked (recorded honestly, not marked PASS)

- Production-build browser E2E: **not executed**. The browser matrix ran against
  `next dev` (localhost:3000) with the isolated QA database and Backend on :4000,
  using the development-only desktop signed-test identity. A production-build
  browser run against the canonical Authing OIDC session needs live provider
  credentials and is recorded here as a real environment limitation, not a PASS.
  Auth0 is not part of the current stack (`MYSTCRAG_AUTH_PROVIDER='auth0'` is
  explicitly rejected by `auth-config.ts`).
- Live Authing OIDC login for a real end-user session: the capture used the
  documented desktop demo identity plus QA-database fixtures; live provider
  credentials were not available.
- Real-device touch input: mobile targets were verified by measured CSS height,
  not by a physical device.
- Full keyboard completion of *every* flow: keyboard traversal + visible focus is
  verified on all 9 routes and a full keyboard-only completion is verified for
  the Oracle cast; the AI/Tarot/DIY completion journeys are covered by their
  existing component/flow tests rather than re-driven here.

## 10. Evidence and state

- Canonical evidence (git-ignored): `output/playwright/task-qa-star-001/` —
  `screenshots/` (85 PNGs), `capture-summary.json` / `.tsv`, `capture-run.log`,
  `validation-summary.json`, `validation-run.log`.
- Validation summary: 73 checks, **73 PASS, 0 FAIL** on the final
  FE-STAR-005-composed candidate (`8272c1f`); the initial pre-remediation run on
  `c3967e4` was **64 PASS / 9 FAIL** (`64/73`).
- Working tree: only the registered writable paths are modified/added;
  `apps/frontend/next-env.d.ts` is restored to its HEAD content (SHA-256
  `7b550dda9686c16f36a17bf9051d5dbf31e98555b30d114ac49fc49a1e712651`). The
  temporary dev services (frontend :3000, Backend :4000), the temporary desktop
  signed-test identity mapping in the ignored `.env` / `apps/frontend/.env.local`,
  and the isolated QA databases were removed after verification; no temporary
  artifacts remain.
