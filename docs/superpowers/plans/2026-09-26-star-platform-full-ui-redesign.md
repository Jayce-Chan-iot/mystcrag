# Star Platform Full UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved “玄圭星台” visual language to every major customer-facing page without changing the trusted product loop or turning the interface into decorative mysticism.

**Architecture:** Establish one semantic token and shared-component foundation, then migrate page families in isolated batches: acquisition/guided flows, DIY, content/account, and system states. Route behavior and API state remain inside existing feature components; shared UI owns only presentation primitives, and each page-family stylesheet is scoped by `data-star-surface`.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, CSS custom properties, `@mystcrag/ui`, Next Image, existing frontend Node tests and browser QA scripts.

**Spec:** `docs/superpowers/specs/2026-09-26-star-oracle-crystal-design.md`

## Global Constraints

- Tasks 2–6 start only after the Phase 0 plan and Star Oracle integration plan pass their completion gates. Task 1 (`TASK-ASSET-STAR-001`) is an explicit exception: after `TASK-ORACLE-PLAN-002` is approved it may run in parallel because its registered asset/model/manifest paths do not overlap Phase 0 or Oracle runtime paths.
- Redesign every listed customer-facing route, but change no API, database, `DesignV1`, price, stock, Bracelet Engine, save, revision, or order behavior.
- Visual palette: obsidian/ink-indigo base, warm xuan paper, aged brass, amethyst, and moon silver.
- Motifs: Song star maps, armillary instruments, jade discs, engraved scales, black lacquer; no neon, glassmorphism, particle storms, fake magic, or cheap gold gradients.
- Body text remains readable; important copy is at least 14 px, supporting copy at least 12 px, and mobile controls at least 44 px.
- Motion uses transform/opacity, usually 160–360 ms; the Oracle ritual remains at most 4 seconds and reduced motion is mandatory.
- Assets must live under `apps/frontend/public/**`, carry provenance, and never be copied from unlicensed sites or reference screenshots.
- Knowledge admin receives only base tokens and state-component alignment; it does not receive the immersive narrative layout.
- 3D stays experimental and must not enter primary route bundles as a side effect of this redesign.
- Each page-family task must be registered with exact paths and preserve unrelated local changes.
- Every commit step stages only the exact paths in that task's `Files` list. Directory-wide staging is forbidden unless the whole directory is explicitly a task-owned `Create` path.

## Review Focus

- Dark surfaces around photographic crystals must preserve material color and inclusions rather than tinting the product imagery; Tasks 1, 3, 4, and 5 own this check.
- All capability-driven two-card (Oracle and Tarot disabled), three-card (exactly one enabled), and four-card (both enabled) homepage states must remain balanced at 1440×560 and stack without horizontal overflow at 320 px; Task 3 owns this test.
- Dynamic, error, loading, empty, disabled-feature, and no-results states must all look intentional and keep a real next action; Tasks 3–6 own these tests.
- A user with reduced motion, keyboard only, or 200% text zoom must complete AI, Oracle, Tarot, DIY, library, gallery, and profile paths; Task 6 owns the final gate.
- Old atelier selectors/tokens must not silently override the new system or leave a mixed light/dark page; Tasks 2 and 6 own the cleanup test.

---

### Task 1: Produce licensed Star Platform visual assets

**Governance task:** `TASK-ASSET-STAR-001`, branch `task/asset-star-001-visual-kit`

**Files:**
- Create: `apps/frontend/public/star-platform/hero-observatory.webp`
- Create: `apps/frontend/public/star-platform/entry-ai.webp`
- Create: `apps/frontend/public/star-platform/entry-oracle.webp`
- Create: `apps/frontend/public/star-platform/entry-diy.webp`
- Create: `apps/frontend/public/star-platform/entry-tarot.webp`
- Create: `apps/frontend/public/star-platform/xuan-paper-grain.webp`
- Create: `apps/frontend/public/star-platform/engraved-star-map.webp`
- Create: `apps/frontend/public/star-platform/UPSTREAM_SOURCE.md`
- Modify: `docs/UI_REFERENCE_AND_ASSET_MANIFEST.md`
- Create: `docs/progress/2026-09-26_STAR_ASSET_REVIEW.md`
- Create: `apps/frontend/src/features/design/model/star-assets.ts`
- Create: `apps/frontend/src/features/design/model/star-assets.test.tsx`

**Interfaces:**
- Produces: `STAR_PLATFORM_ASSETS`, a typed map of stable public URLs, intrinsic aspect ratios, dominant surface, and Chinese alt intent.
- Consumes: the approved visual direction in the spec, not any third-party site's HTML/CSS/assets.
- Asset rule: imagery contains no embedded words, logos, glyph-like pseudo-text, medical symbols, or fortune promises.

- [ ] **Step 1: Write the failing asset manifest test**

Assert all seven WebP files and the provenance document exist, every image is WebP, the hero is at least 1920×1080, cards are at least 1200×900, and every asset key has a non-empty alt intent or is explicitly decorative. Automated tests do not claim to detect text or symbol content inside pixels.

- [ ] **Step 2: Run the test and confirm assets are absent**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/star-assets.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Generate and curate the raster set**

Use the `imagegen` skill with the approved obsidian/xuan-paper/aged-brass/amethyst direction. Generate clean source imagery without UI chrome or text, inspect every output at original resolution, reject illegible jewelry, malformed beads, neon lighting,伪汉字/符箓式乱纹, Western-occult symbols, medical symbols, or fortune/efficacy implications, then export optimized WebP assets.

- [ ] **Step 4: Record full provenance**

In both manifests record generation date, tool/model, prompt summary, local transformations, intended route, license/ownership status, and SHA-256. The asset review report records one canonical contact sheet, original-resolution inspection result, explicit rejection checklist, and reviewer/date under `docs/governance/QA_EVIDENCE_RETENTION.md`. Do not commit transient source renders or duplicate QA captures.

- [ ] **Step 5: Run asset tests and image-size inspection**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/star-assets.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/public/star-platform apps/frontend/src/features/design/model/star-assets.ts apps/frontend/src/features/design/model/star-assets.test.tsx docs/UI_REFERENCE_AND_ASSET_MANIFEST.md docs/progress/2026-09-26_STAR_ASSET_REVIEW.md
git commit -m "feat(assets): add star platform visual kit"
```

### Task 2: Establish semantic tokens, shared primitives, and responsive shell

**Governance task:** `TASK-UI-STAR-001`, branch `task/ui-star-001-foundation`

**Files:**
- Create: `apps/frontend/app/styles/star-tokens.css`
- Create: `apps/frontend/app/styles/star-shell.css`
- Create: `apps/frontend/app/styles/star-components.css`
- Create: `apps/frontend/app/styles/star-acquisition.css`
- Create: `apps/frontend/app/styles/star-workbench.css`
- Create: `apps/frontend/app/styles/star-content.css`
- Modify: `apps/frontend/app/globals.css`
- Modify: `apps/frontend/app/atelier.css`
- Modify: `apps/frontend/app/layout.tsx`
- Modify: `apps/frontend/app/navigation.ts`
- Modify: `apps/frontend/components/mobile-bottom-nav.tsx`
- Modify: `apps/frontend/components/page-scaffold.tsx`
- Create: `packages/ui/src/star-surface.tsx`
- Create: `packages/ui/src/instrument-button.tsx`
- Create: `packages/ui/src/constellation-divider.tsx`
- Create: `packages/ui/src/status-panel.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/ui/tests/star-primitives.test.tsx`
- Create: `apps/frontend/src/features/design/star-shell-contract.test.tsx`
- Modify: `docs/governance/FEATURE_REGISTRY.md`
- Modify: `docs/governance/CANONICAL_COMPONENTS.md`

**Interfaces:**
- Produces semantic CSS variables: `--star-canvas`, `--star-ink`, `--star-paper`, `--star-paper-muted`, `--star-brass`, `--star-amethyst`, `--star-moon`, `--star-line`, `--star-danger`, `--star-warning`, `--star-success`, spacing/radius/shadow/motion tokens.
- Produces: `StarSurface({ tone: "ink" | "paper" | "lacquer" })`, `InstrumentButton({ variant: "primary" | "secondary" | "quiet" })`, `ConstellationDivider`, and `StatusPanel`.
- Primitive gate: `ConstellationDivider` and every decorative vector use only documented star-map, armillary, jade-disc, and instrument geometry; no embedded pseudo-text, talisman strokes, Western-occult symbols, medical symbols, or efficacy motifs. Visual QA records the same reject decision used for raster assets.
- Produces: route surfaces declare `data-star-surface`; decoration is `aria-hidden` and `pointer-events: none`.
- Preserves: route-specific composition and all feature state outside `packages/ui`.
- Updates: `@mystcrag/ui` test script to `tsx --test tests/*.test.tsx` and adds `tsx` as a development dependency so the new TSX tests cannot pass with zero discovery.
- Registers: the six exact `apps/frontend/app/styles/star-*.css` entry files and their load order in the feature/canonical registries.

- [ ] **Step 1: Write failing token and primitive tests**

Assert required tokens exist once, primary/secondary button variants render semantic elements, status roles are preserved, decoration is hidden, 44 px minimum targets are encoded, no primitive contains product copy or route imports, and the package test command discovers the TSX suite through `tsx`.

- [ ] **Step 2: Run tests and verify missing foundation fails**

Run: `pnpm --filter @mystcrag/ui exec tsx --test tests/star-primitives.test.tsx && pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/star-shell-contract.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement tokens and primitives**

Keep legacy token aliases mapped to the new semantic tokens during migration so unchanged admin and intermediate pages remain readable. These aliases are owned by `TASK-UI-STAR-001` and retained because knowledge admin is deliberately token-only in this scope; removing them requires a separately registered admin redesign rather than silent cleanup. Update the UI package test script/devDependency before running the red test, and register the exact style entry files in the governance docs. Do not use global `zoom`, body transforms, or decorative overlays that intercept input.

- [ ] **Step 4: Rebuild header, footer, and mobile navigation shell**

Use the same capability model from Phase 0/Oracle, a compact brass-line navigation treatment, visible focus, safe-area padding, and a mobile layout that keeps labels readable. Do not add a hamburger if the bottom navigation already covers the same destinations.

- [ ] **Step 5: Import all scoped page-family styles and quarantine legacy rules**

New styles load after legacy `atelier.css`. Prefix every new route rule with `data-star-surface`; mark legacy blocks with migration comments so Task 6 can prove no customer route depends on them.

- [ ] **Step 6: Run UI/frontend tests and builds**

Run: `pnpm --filter @mystcrag/ui test && pnpm --filter @mystcrag/ui typecheck && pnpm --filter @mystcrag/frontend test && pnpm --filter @mystcrag/frontend build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage whole UI, styles, or components directories.
git commit -m "feat(ui): establish star platform design foundation"
```

### Task 3: Redesign homepage and guided creation flows

**Governance task:** `TASK-FE-STAR-001`, branch `task/fe-star-001-guided-flows`

**Files:**
- Modify: `apps/frontend/app/page.tsx`
- Modify: `apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx`
- Modify: `apps/frontend/src/features/questionnaire/components/wrist-measurement-guide.tsx`
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Modify: `apps/frontend/src/features/design/components/design-summary.tsx`
- Modify: `apps/frontend/src/features/design/components/compliance-notice.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-setup.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-draw.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-fan.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-slots.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-result.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-recommendation-card.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot.module.css`
- Modify: `apps/frontend/src/features/oracle/components/oracle-setup.tsx`
- Modify: `apps/frontend/src/features/oracle/components/oracle-reveal.tsx`
- Modify: `apps/frontend/src/features/oracle/components/oracle-lines.tsx`
- Modify: `apps/frontend/src/features/oracle/components/oracle-result.tsx`
- Modify: `apps/frontend/src/features/oracle/oracle.module.css`
- Modify: `apps/frontend/app/styles/star-acquisition.css`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot-setup.test.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot-draw.test.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot-result.test.tsx`
- Modify: `apps/frontend/src/features/oracle/oracle-setup.test.tsx`
- Modify: `apps/frontend/src/features/oracle/oracle-result.test.tsx`

**Interfaces:**
- Consumes: `STAR_PLATFORM_ASSETS`, shared primitives/tokens, and existing feature coordinators without altering their state machines.
- Produces: responsive 2/3/4-card homepage grids from `data-creation-count`.
- Produces: consistent setup → ritual/progress → three-result visual grammar across AI, Oracle, and enabled Tarot while preserving their different semantics.

- [ ] **Step 1: Extend failing visual contract tests**

Assert every route root has the correct `data-star-surface`, homepage cards use typed star assets, all two-card/three-card/four-card capability combinations fit the desktop grid, disabled capabilities leave no gap or stale promise, sticky result actions remain reachable, Oracle refresh/re-render does not invoke create or consume entropy, and Oracle/Tarot meanings retain their disclaimers.

- [ ] **Step 2: Run focused suites and confirm legacy markup fails**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/frontend-ai-flow.test.tsx src/features/tarot/*.test.tsx src/features/oracle/*.test.tsx`

Expected: FAIL on missing star surfaces/assets and new structural contracts.

- [ ] **Step 3: Redesign the homepage**

Use the observatory hero, restrained star-map linework, clear action hierarchy, and capability-driven cards. Keep the full card as one semantic link and preserve exact feature destinations.

- [ ] **Step 4: Redesign AI questionnaire and result comparison**

Keep one question per view, visible progress/navigation, photographic measurement help, three comparable design candidates, selected state, authoritative price, and sticky “进入 DIY 调整”.

- [ ] **Step 5: Redesign Oracle and Tarot flows**

Oracle remains the fastest flow; do not add ceremonial steps. Tarot keeps its established draw state and privacy behavior. Use instrument/constellation motifs without making cards or hexagrams unreadable.

- [ ] **Step 6: Run focused tests, lint, and build**

Run: `pnpm --filter @mystcrag/frontend test && pnpm --filter @mystcrag/frontend lint && pnpm --filter @mystcrag/frontend build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage whole feature directories.
git commit -m "feat(frontend): redesign guided creation flows"
```

### Task 4: Redesign the 2.5D DIY workbench

**Governance task:** `TASK-FE-STAR-002`, branch `task/fe-star-002-diy-workbench`

**Files:**
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`
- Modify: `apps/frontend/src/features/design/components/display-tray.tsx`
- Modify: `apps/frontend/src/features/design/components/crystal-bead-image.tsx`
- Modify: `apps/frontend/src/features/design/components/design-component-list.tsx`
- Modify: `apps/frontend/src/features/design/components/price-summary.tsx`
- Modify: `apps/frontend/src/features/design/components/wear-fit-summary.tsx`
- Modify: `apps/frontend/app/styles/star-workbench.css`
- Modify: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`
- Modify: `apps/frontend/src/features/design/model/display-tray.test.tsx`
- Modify: `apps/frontend/src/features/design/model/visual-assets.test.tsx`

**Interfaces:**
- Consumes: Phase 0's single catalog, sticky action rail, truthful suggestions/links, and fit summary.
- Preserves: all direct manipulation, keyboard move/delete, history, tray local preference, export, price, inventory, save, and completion behavior.
- Produces: dark-lacquer instrument frame around an untinted neutral tray; crystal images remain photographic and color-accurate.

- [ ] **Step 1: Write failing workbench visual contracts**

Assert star workbench root, one catalog, neutral tray surface, no CSS color/filter applied to bead images, internal scroll rails, sticky completion, 44 px controls, selected-bead identity, and short-viewport rules.

- [ ] **Step 2: Run design tests and confirm missing star contracts fail**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/atelier-ui-contract.test.tsx src/features/design/model/display-tray.test.tsx src/features/design/model/visual-assets.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Apply the instrument-frame layout**

Use lacquer/brass on rails and controls, xuan-paper/linen on information surfaces, and the existing photographic trays at the editing centre. Do not reduce the preview or CTA below the Phase 0 short-viewport gate.

- [ ] **Step 4: Preserve interaction feedback and material fidelity**

Selected, dragging, updating, low-stock, conflict, and order-complete states must be visible without tinting or rectangular shadows on beads. Keep animated feedback to transform/opacity and support reduced motion.

- [ ] **Step 5: Run design suite and frontend build**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/**/*.test.tsx && pnpm --filter @mystcrag/frontend build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage the whole design feature directory.
git commit -m "feat(frontend): redesign the crystal workbench"
```

### Task 5: Redesign library, gallery, design detail, and profile

**Governance task:** `TASK-FE-STAR-003`, branch `task/fe-star-003-content-account-pages`

**Files:**
- Modify: `apps/frontend/src/features/library/components/crystal-library-page.tsx`
- Modify: `apps/frontend/src/features/library/model/library-model.ts`
- Modify: `apps/frontend/src/features/library/model/library-model.test.ts`
- Modify: `apps/frontend/src/features/gallery/components/gallery-page.tsx`
- Modify: `apps/frontend/src/features/gallery/model/gallery-model.ts`
- Modify: `apps/frontend/src/features/gallery/model/gallery-model.test.ts`
- Modify: `apps/frontend/app/design/[id]/page.tsx`
- Modify: `apps/frontend/src/features/profile/components/profile-page.tsx`
- Modify: `apps/frontend/src/features/profile/model/profile-model.ts`
- Modify: `apps/frontend/src/features/profile/model/profile-model.test.ts`
- Modify: `apps/frontend/app/styles/star-content.css`
- Create: `apps/frontend/src/features/design/star-content-contract.test.tsx`

**Interfaces:**
- Consumes: shared shell/primitives and unchanged model/API functions.
- Produces: one content-page grammar: star-map header, paper index/filter surface, photographic item grid, private/public state marks, and clear primary action.
- Preserves: library sellability, gallery consent/remix, design ownership/revision, profile designs/favourites/orders, and existing query-tab deep links.

- [ ] **Step 1: Write failing content-page contracts**

Assert every route root has `data-star-surface`, filters have persistent labels, zero-stock items are truthful, private/public status is not color-only, profile query tabs resolve, cards preserve photographic images, and no page renders the placeholder `PageScaffold` message.

- [ ] **Step 2: Run focused tests and confirm legacy/placeholder behavior fails**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/library/**/*.test.ts src/features/gallery/**/*.test.ts src/features/profile/**/*.test.ts src/features/design/star-content-contract.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Redesign library and gallery**

Use dense but readable index/filter controls, neutral photo fields, and explicit empty/no-result recovery. Preserve all existing sort/filter/publish/remix behavior.

- [ ] **Step 4: Redesign design detail and profile**

Make design identity, price, fit, privacy, save/revision, and order state easier to scan. Keep `/profile?tab=designs` and `/profile?tab=favorites` compatible with Phase 0 workbench links.

- [ ] **Step 5: Run page-family tests and frontend build**

Run: `pnpm --filter @mystcrag/frontend test && pnpm --filter @mystcrag/frontend build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
# Stage only the exact paths in this task's Files list; do not stage whole feature or route directories.
git commit -m "feat(frontend): redesign content and account pages"
```

### Task 6: Unify system states, remove legacy visual drift, and run full visual QA

**Governance task:** `TASK-QA-STAR-001`, branch `task/qa-star-001-full-visual-gate`

**Files:**
- Modify: `apps/frontend/src/components/flow-notice.tsx`
- Modify: `apps/frontend/components/page-scaffold.tsx`
- Modify: `apps/frontend/src/features/auth/browser/auth-required-dialog.tsx`
- Modify: `apps/frontend/src/features/auth/browser/flow-notice-auth-dismiss.test.tsx`
- Modify: `apps/frontend/app/not-found.tsx`
- Create: `apps/frontend/app/loading.tsx`
- Create: `apps/frontend/app/error.tsx`
- Modify: `apps/frontend/app/globals.css`
- Modify: `apps/frontend/app/atelier.css`
- Modify: `apps/frontend/app/styles/star-components.css`
- Create: `apps/frontend/src/features/design/star-system-states.test.tsx`
- Create: `scripts/ui-qa/capture_star_platform.py`
- Modify: `docs/UI_DESIGN_SYSTEM.md`
- Modify: `docs/INTERACTION_TEST_PLAN.md`
- Modify: `apps/frontend/design-qa.md`
- Create: `docs/progress/2026-09-26_STAR_PLATFORM_UI_QA_REPORT.md`

**Interfaces:**
- Consumes: every migrated route from Tasks 2–5.
- Produces: canonical loading/error/empty/offline/404 presentation and a repeatable screenshot/interaction matrix.
- Restyles: the existing canonical provider-neutral `AuthRequiredDialog`; ordinary mode keeps the real Authing OIDC `/auth/login?returnTo=...` entry and desktop mode keeps launcher recovery. It must not create a second session-required component or alter the frozen Auth contract.
- Removes: customer-route dependencies on legacy atelier colors/layout selectors; admin-compatible token aliases remain until its own redesign task exists.

- [ ] **Step 1: Write failing system-state and legacy-drift tests**

Assert loading, error, empty, 404, and offline panels use shared primitives, expose one real next action, preserve focus/roles, and include no placeholder skeleton copy. Assert all customer routes use `data-star-surface` and no longer require legacy `.home-reference-*`/atelier page selectors.

- [ ] **Step 2: Run tests and confirm missing route states/legacy dependencies fail**

Run: `pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/star-system-states.test.tsx src/features/design/star-shell-contract.test.tsx src/features/design/star-content-contract.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement canonical states and remove migrated legacy CSS**

Keep errors recoverable, distinguish retry from navigation/dismissal, and preserve the last confirmed design on network failure. Remove only selectors proven unused by source search and route tests.

- [ ] **Step 4: Add the repeatable visual capture script**

Capture `/`, `/ai-design`, Oracle setup/result, enabled Tarot setup/draw/result, `/diy/[fixture-id]`, `/crystal-library`, `/gallery`, `/design/[fixture-id]`, `/profile`, loading/error/empty/404 at `390×844`, `768×1024`, `1024×768`, `1440×560`, and `1440×900`. Write evidence only to the canonical QA location from the retention policy.

- [ ] **Step 5: Run accessibility and interaction QA**

At minimum verify keyboard-only navigation and completion, 200% zoom, reduced motion, AA contrast, 44 px mobile targets, no horizontal overflow at 320 px, no CTA clipping, no overlay interception, and no runtime error overlay.

- [ ] **Step 6: Update design/interaction controls and QA report**

Record route-by-route status, screenshots, remaining deviations, and why admin is token-only. Update the design system from temporary initialization colors to the approved semantic Star Platform tokens.

- [ ] **Step 7: Run the full repository gate**

Run: `pnpm validate`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/components/flow-notice.tsx apps/frontend/components/page-scaffold.tsx apps/frontend/src/features/auth/browser/auth-required-dialog.tsx apps/frontend/src/features/auth/browser/flow-notice-auth-dismiss.test.tsx apps/frontend/app/not-found.tsx apps/frontend/app/loading.tsx apps/frontend/app/error.tsx apps/frontend/app/globals.css apps/frontend/app/atelier.css apps/frontend/app/styles/star-components.css apps/frontend/src/features/design/star-system-states.test.tsx apps/frontend/design-qa.md scripts/ui-qa/capture_star_platform.py docs/UI_DESIGN_SYSTEM.md docs/INTERACTION_TEST_PLAN.md docs/progress/2026-09-26_STAR_PLATFORM_UI_QA_REPORT.md
git commit -m "test(frontend): complete star platform visual gate"
```

## Completion Gate

The redesign is complete only when all six governance tasks are integrated, every customer route in the spec passes the viewport/accessibility matrix, no Phase 0 regression returns, product imagery remains faithful, the Oracle flow is still one tap and under its motion budget, controlling docs match production, and `pnpm validate` passes on the integrated candidate.
