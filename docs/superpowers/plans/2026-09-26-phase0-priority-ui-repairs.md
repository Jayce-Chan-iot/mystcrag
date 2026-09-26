# Phase 0 Priority UI Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the trust-breaking dead controls, false retry behavior, fit ambiguity, desktop DIY clipping, and small-target accessibility defects before any visual redesign begins.

**Architecture:** Keep all server-authoritative design, pricing, inventory, revision, and Bracelet Engine behavior unchanged. Make the frontend expose truthful actions and one derived `BraceletFit` presentation model, then simplify the desktop workbench without forking its editing state.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, Node test runner, `@mystcrag/bracelet-engine`.

**Spec:** `docs/superpowers/specs/2026-09-26-star-oracle-crystal-design.md`

## Global Constraints

- Complete this plan before the oracle integration or full visual redesign plans.
- Do not change `DesignV1`, APIs, Prisma, pricing, inventory, revision, order, or Bracelet Engine contracts.
- Preserve the direct 2.5D editor as the production DIY route; 3D remains experimental.
- Never show a control without a real action, an explicit disabled explanation, or a valid destination.
- Keep mobile targets at least 44 px and key body text at least 12 px; important explanatory text should be 14 px or larger.
- Preserve unrelated user changes, especially `apps/frontend/next-env.d.ts` and untracked local directories.
- `BASE-004` is already frozen and integrated on `main`; every implementation branch must start from the latest integrated `main`, never from the superseded planning branch. Before implementation, register a dedicated task with exact writable paths and confirm no `IN_PROGRESS` lock overlaps.
- Every commit step stages only the exact paths in that task's `Files` list. Directory-wide staging is forbidden unless the whole directory is explicitly a task-owned `Create` path.

## Review Focus

- Tarot disabled: homepage and navigation must contain no Tarot promise and the remaining cards must fill the row; Task 1 owns this test.
- A notice action whose label says retry must invoke the failed operation, not merely dismiss the notice; Task 2 owns this test.
- Fit copy must never label target inner circumference as wrist circumference or invent a diameter range; Task 3 owns this test.
- At 1440×560 and 1024×768 the DIY completion action must remain reachable while side rails scroll internally; Task 4 owns this test.
- Keyboard and touch users must reach every remaining control with visible focus and a target of at least 44 px; Task 5 owns this test.

---

### Task 1: Truthful homepage and navigation capability model

**Governance task:** `TASK-FE-P0-001`, branch `task/fe-p0-001-truthful-home-navigation`

**Files:**
- Modify: `apps/frontend/app/page.tsx`
- Modify: `apps/frontend/app/navigation.ts`
- Modify: `apps/frontend/app/layout.tsx`
- Modify: `apps/frontend/components/mobile-bottom-nav.tsx`
- Create: `apps/frontend/src/features/navigation/navigation-capabilities.test.tsx`

**Interfaces:**
- Produces: `getCreationPaths({ tarotEnabled, oracleEnabled })` and `getHeroCapabilityLabel({ tarotEnabled, oracleEnabled })` as pure exported functions from `apps/frontend/app/page.tsx`.
- Produces: `getMainNavigation({ tarotEnabled, oracleEnabled })` with no hash-only destination.
- Consumes later: the oracle plan adds the enabled oracle route to these capability inputs without changing their shape.

- [ ] **Step 1: Write the failing capability tests**

Assert that Tarot-disabled output excludes `tarot`, excludes “塔罗” from the Hero label, contains no `/#inspiration`, and returns exactly the available creation paths. Assert that the card container exposes `data-creation-count` for the CSS grid.

- [ ] **Step 2: Run the tests and confirm the current hard-coded Hero/hash behavior fails**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/navigation/navigation-capabilities.test.tsx`

Expected: FAIL because the Hero text always names Tarot and the main/mobile navigation still link to `/#inspiration`.

- [ ] **Step 3: Implement the pure capability model and render from it**

Change `getMainNavigation` to accept one object, remove the dead inspiration hash link, and make the Hero capability line derive from enabled entries. Set `data-creation-count={creationPaths.length}` and make the layout consume that count rather than assuming three columns.

- [ ] **Step 4: Run focused frontend tests**

Run: `pnpm --filter @mystcrag/frontend test`

Expected: PASS, including existing Tarot navigation assertions updated to the truthful list.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/app/page.tsx apps/frontend/app/navigation.ts apps/frontend/app/layout.tsx apps/frontend/components/mobile-bottom-nav.tsx apps/frontend/src/features/navigation/navigation-capabilities.test.tsx
git commit -m "fix(frontend): make home capabilities truthful"
```

### Task 2: Explicit notice action semantics

**Governance task:** `TASK-FE-P0-002`, branch `task/fe-p0-002-notice-actions`

**Files:**
- Modify: `apps/frontend/src/components/flow-notice.tsx`
- Modify: `apps/frontend/src/lib/api/frontend-api-error.ts`
- Create: `apps/frontend/src/components/flow-notice.test.tsx`
- Modify: `apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx`
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/library/components/crystal-library-page.tsx`
- Modify: `apps/frontend/src/features/gallery/components/gallery-page.tsx`
- Modify: `apps/frontend/src/features/profile/components/profile-page.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Produces: `NoticeAction = { kind: "button"; label: string; onAction(): void } | { kind: "link"; label: string; href: string }`.
- Produces: `FlowNoticeProps = { code: FrontendErrorCode; action?: NoticeAction; onDismissAuthRequired?: () => void; compact?: boolean }`.
- Removes: inferred `actionHref` and ambiguous `onAction` whose visible label came from unrelated global copy.
- Preserves: `UNAUTHORIZED` always renders the existing canonical `AuthRequiredDialog`, ignores business `action`, and uses only `onDismissAuthRequired` for pure dismissal; do not alter Authing/desktop-recovery behavior.

- [ ] **Step 1: Write failing tests for link, retry, and informational notices**

Render three notices and assert: a button uses the supplied label and handler, a link uses the supplied href, and no action renders when none is supplied. Add a caller test proving DIY `NETWORK_ERROR` calls `loadDesign` while a dismiss-only inventory advisory is labeled “知道了”, never “重新生成方案”. Preserve the existing Auth regression that dismissing `UNAUTHORIZED` never invokes a business retry and a later 401 remounts the dialog.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/components/flow-notice.test.tsx src/features/auth/browser/flow-notice-auth-dismiss.test.tsx src/features/design/frontend-ai-flow.test.tsx`

Expected: FAIL because `FlowNotice` currently derives labels/hrefs from the error code and several callers only clear state.

- [ ] **Step 3: Implement the discriminated action prop**

Keep `ERROR_PRESENTATION` limited to title, message, and tone. Each caller must supply the action that it can actually perform; omit actions for passive advisories. Do not change the Backend error envelope.

- [ ] **Step 4: Verify all frontend callers and tests**

Run: `pnpm --filter @mystcrag/frontend test && pnpm --filter @mystcrag/frontend typecheck`

Expected: PASS with no `onAction=` use remaining on `FlowNotice`.

- [ ] **Step 5: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage whole component or feature directories.
git commit -m "fix(frontend): bind notices to real recovery actions"
```

### Task 3: One authoritative wear-fit presentation

**Governance task:** `TASK-FE-P0-003`, branch `task/fe-p0-003-wear-fit-summary`

**Files:**
- Modify: `apps/frontend/src/features/design/model/bracelet-fit.ts`
- Modify: `apps/frontend/src/features/design/model/bracelet-fit.test.tsx`
- Create: `apps/frontend/src/features/design/components/wear-fit-summary.tsx`
- Create: `apps/frontend/src/features/design/components/wear-fit-summary.test.tsx`
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`
- Modify: `apps/frontend/src/features/design/components/index.ts`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Produces: `BraceletFit` fields `assembledMaterialPathMm`, `elasticAllowanceMm`, `estimatedBraceletFitMm`, `targetInnerCircumferenceMm`, `userWristCircumferenceMm`, `deltaFromTargetMm`, `status`, `message`, and `canComplete`.
- Produces: `WearFitSummary({ fit, compact? })`, the only user-facing component allowed to label these measurements.
- Consumes: `evaluateBraceletFit` from `@mystcrag/bracelet-engine`; do not reimplement its delta or status math.
- Preserves compatibility fields `circumferenceMm` and `circumferenceCmLabel` until every tracked consumer in this task is migrated; the final source search must prove no unowned consumer is broken.
- Reuses `MIN_BRACELET_CIRCUMFERENCE_MM` / `MAX_BRACELET_CIRCUMFERENCE_MM` from this existing frontend model for Oracle setup validation later; Oracle UI must not redeclare `130`/`200` constants.

- [ ] **Step 1: Write failing model and component tests**

Use a fixture with wrist `155`, target inner circumference `160`, assembled material path `158`, and allowance `5`. Assert the model preserves all four concepts and reports `deltaFromTargetMm === -2`. Assert rendered labels are “腕围”, “目标内周长”, “当前材料路径”, “结构余量”, and “距目标”, and that no “推荐成品内径 5.0–5.2 cm” string exists.

- [ ] **Step 2: Run tests and verify missing fields/mislabeling fail**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/bracelet-fit.test.tsx src/features/design/components/wear-fit-summary.test.tsx`

Expected: FAIL because the frontend model drops the engine delta/allowance and the editor labels target circumference as wrist.

- [ ] **Step 3: Implement the derived presentation model and shared component**

Return the engine result fields without renaming their meaning. Format millimetres to centimetres only in the component, retain the raw values, and keep all advisory states non-blocking.

- [ ] **Step 4: Replace desktop and mobile fit copy with `WearFitSummary`**

Remove the invented diameter range and every duplicate fit label in `DiyEditor` and `FlatBraceletEditor`. Keep measurement guidance as a collapsible secondary action.

- [ ] **Step 5: Run the design frontend suite**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/**/*.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage the whole design feature directory.
git commit -m "fix(frontend): unify bracelet wear fit guidance"
```

### Task 4: Simplify and harden the desktop DIY workbench

**Governance task:** `TASK-FE-P0-004`, branch `task/fe-p0-004-diy-workbench-density`

**Files:**
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/app/atelier.css`
- Modify: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: `NoticeAction` from Task 2 and `WearFitSummary` from Task 3.
- Preserves: all existing `designApi` calls, `componentId`, operation history, tray preference, pricing, save, export, and order behavior.
- Produces: one desktop material browser; the duplicate bottom “常用水晶” shelf is removed.
- Binds “搭配推荐” to the existing `loadSuggestions` function, which calls `designApi.suggestMaterials`; no new suggestion state or handler is authorized.

- [ ] **Step 1: Write failing structural tests**

Assert that desktop markup contains one catalog product collection, no inactive `<button>` for “历史方案” or “我的收藏”, a real suggestion action calling the existing suggestion handler, links to `/profile?tab=designs` and `/profile?tab=favorites`, and a right rail with `overflow-y-auto` plus a sticky completion footer.

- [ ] **Step 2: Run the tests and confirm current duplicate/dead controls fail**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/atelier-ui-contract.test.tsx src/features/design/frontend-ai-flow.test.tsx`

Expected: FAIL on the dead tool buttons, duplicate catalog shelf, and non-scrolling action rail.

- [ ] **Step 3: Restructure the desktop grid without changing editor state**

Remove the bottom catalog row, let the stage occupy the centre height, keep the left rail as the only catalog, make “搭配推荐” invoke the existing selected-bead suggestion flow, and turn history/favourites into real profile links. Give the right inspector internal scrolling and keep price/completion sticky at its bottom.

- [ ] **Step 4: Move notices out of the stage control collision zone**

Render transient notices in a dedicated workbench status region that does not cover the tray toggle, tray picker, selected bead, or completion action. `aria-live` announces text once.

- [ ] **Step 5: Add short-viewport CSS assertions**

In the contract test, assert the CSS contains a `@media (min-width: 1024px) and (max-height: 640px)` rule, internal rail scrolling, and no application-wide `zoom` or transform scaling.

- [ ] **Step 6: Run frontend tests, lint, and build**

Run: `pnpm --filter @mystcrag/frontend test && pnpm --filter @mystcrag/frontend lint && pnpm --filter @mystcrag/frontend build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/design/components/diy-editor.tsx apps/frontend/src/features/design/atelier-ui-contract.test.tsx apps/frontend/src/features/design/frontend-ai-flow.test.tsx apps/frontend/app/atelier.css
git commit -m "fix(frontend): reduce diy workbench overload"
```

### Task 5: Accessibility floor and Phase 0 browser gate

**Governance task:** `TASK-QA-P0-001`, branch `task/qa-p0-001-frontend-accessibility-gate`

**Files:**
- Modify: `apps/frontend/app/globals.css`
- Modify: `apps/frontend/app/atelier.css`
- Create: `apps/frontend/src/features/design/accessibility-contract.test.tsx`
- Modify: `docs/INTERACTION_TEST_PLAN.md`
- Modify: `docs/UI_DESIGN_SYSTEM.md`
- Create: `docs/progress/2026-09-26_PHASE0_UI_REPAIR_REPORT.md`

**Interfaces:**
- Consumes: repaired pages from Tasks 1–4.
- Produces: a documented browser matrix and evidence report required before the next plan begins.

- [ ] **Step 1: Write the failing accessibility contract test**

Assert that main navigation, mobile navigation, notice actions, catalog filters, tray controls, and completion controls use at least `min-h-11`/44 px; critical text does not use the known `0.55rem`–`0.68rem` classes; reduced-motion rules remain present; focus-visible is not removed.

- [ ] **Step 2: Run the test and record current failures**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/accessibility-contract.test.tsx`

Expected: FAIL on current sub-12 px labels and undersized controls.

- [ ] **Step 3: Apply the typography and hit-target floor**

Raise important labels and controls without changing the approved structural layout. Decorative English overlines may remain 11 px only when duplicated by a readable heading and never used as the sole label.

- [ ] **Step 4: Run desktop and mobile browser checks**

Check `/`, `/ai-design`, `/diy/[fixture-id]`, `/crystal-library`, `/gallery`, `/profile`, and the disabled-Tarot configuration at `390×844`, `768×1024`, `1024×768`, `1440×560`, and `1440×900`. Verify keyboard-only completion and capture only the canonical before/after evidence defined by `docs/governance/QA_EVIDENCE_RETENTION.md`.

- [ ] **Step 5: Update controlling docs and the Phase 0 report**

Record each P0 issue, evidence path, pass/fail result, and any intentionally deferred visual change. Do not claim the star-platform redesign is complete.

- [ ] **Step 6: Run the full gate**

Run: `pnpm validate`

Expected: all lint, typecheck, tests, and builds pass.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/app/globals.css apps/frontend/app/atelier.css apps/frontend/src/features/design/accessibility-contract.test.tsx docs/INTERACTION_TEST_PLAN.md docs/UI_DESIGN_SYSTEM.md docs/progress/2026-09-26_PHASE0_UI_REPAIR_REPORT.md
git commit -m "test(frontend): gate phase zero usability repairs"
```

## Completion Gate

This plan is complete only when all five registered tasks are reviewed, browser evidence confirms the seven Phase 0 defects are fixed, and the integrated commit passes `pnpm validate`. Only then may the oracle integration plan move from `BACKLOG` to `READY`.
