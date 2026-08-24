# Reference-Faithful Visual Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic filtered bead render and oversized layouts with photographic 2.5D assets and responsive screens that faithfully reproduce the two approved reference boards.

**Architecture:** Keep all routes, API contracts, pricing, persistence, and bracelet-engine behavior intact. Introduce a presentation-only asset registry for bead materials and tray surfaces, then update the existing Home, recommendation, Tarot, and DIY components to consume those assets. Visual QA compares the selected references and rendered pages at identical viewport sizes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, project CSS, `next/image`, Node test runner.

**Spec:** `docs/UI_DESIGN_SYSTEM.md`

## Global Constraints

- Preserve existing routes, primary navigation labels, API contracts, authoritative pricing, persistence, and order behavior.
- Use top-down 2.5D photographic assets; do not reintroduce perspective 3D editing.
- Dragged beads retain their exact image, opacity, scale, color, and circular silhouette.
- Mobile layouts are independently composed in CSS viewport coordinates.
- The 130-200 mm wrist range remains advisory and never blocks completion.
- Run focused frontend tests during development and `pnpm validate` before handoff.

---

### Task 1: Asset registry and photographic material mapping

**Files:**
- Create: `apps/frontend/src/features/design/model/visual-assets.ts`
- Create: `apps/frontend/src/features/design/model/visual-assets.test.ts`
- Create: `apps/frontend/public/beads/*.webp`
- Create: `apps/frontend/public/trays/*.webp`
- Create: `apps/frontend/public/home/*.webp`
- Modify: `apps/frontend/src/features/design/components/crystal-bead-image.tsx`
- Modify: `apps/frontend/src/features/design/components/display-tray.tsx`

**Interfaces:**
- Produces: `getBeadVisual(materialKey: string): BeadVisual` and `getTrayVisual(trayId: DisplayTrayId): TrayVisual`.
- Preserves: unknown catalog materials fall back to a neutral clear-quartz asset without CSS hue rotation.

- [ ] Write a failing registry test asserting distinct sources for every seeded material and four tray surfaces.
- [ ] Run the focused test and confirm failure because the registry does not exist.
- [ ] Generate, inspect, convert, and save photographic assets into the project.
- [ ] Implement the registry and update image consumers without CSS color filters.
- [ ] Run the focused registry and component tests until green.

### Task 2: Reference-faithful homepage composition

**Files:**
- Modify: `apps/frontend/app/page.tsx`
- Modify: `apps/frontend/app/atelier.css`
- Modify: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`

**Interfaces:**
- Consumes: project-local Home scene assets.
- Produces: a compact first viewport with one hero and three equally discoverable creation paths.

- [ ] Add failing structural assertions for dedicated Home photography and removal of reused DOM bracelet previews.
- [ ] Run the focused test and verify the expected failure.
- [ ] Recompose the Home page to the approved board without negative section overlap.
- [ ] Add short-height and mobile rules so the primary actions remain visible.
- [ ] Run focused Home UI tests until green.

### Task 3: Recommendation and Tarot visual surfaces

**Files:**
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-draw.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-result.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot.module.css`
- Modify: related component tests.

**Interfaces:**
- Preserves: existing selection, retry, stock advisory, and navigation behavior.
- Produces: three-at-a-glance recommendations and a two-row Tarot fan on constrained widths.

- [ ] Add failing assertions for visible next actions and bounded Tarot rows.
- [ ] Verify the tests fail for the current layout.
- [ ] Implement the reference-aligned layouts with unchanged business behavior.
- [ ] Run Tarot and design-result tests until green.

### Task 4: Desktop and mobile DIY workbench

**Files:**
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`
- Modify: `apps/frontend/src/features/design/components/display-tray.tsx`
- Modify: `apps/frontend/app/atelier.css`
- Modify: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`

**Interfaces:**
- Preserves: add, select, diameter switch, reorder, outside-tray removal, save, export, clear, and completion callbacks.
- Produces: a viewport-bound desktop workbench and independently composed mobile workbench.

- [ ] Add failing assertions for viewport containment, photographic trays, and unmodified drag imagery.
- [ ] Verify the tests fail for the current implementation.
- [ ] Implement the measured three-column layout and mobile catalog composition.
- [ ] Remove visual overflow and square drag feedback.
- [ ] Run focused editor and bracelet-engine consumer tests until green.

### Task 5: Visual QA and launcher acceptance

**Files:**
- Modify: `apps/frontend/design-qa.md`

**Interfaces:**
- Produces: same-state comparison evidence at 1536x1024, 1455x718, and 390x844.

- [ ] Run frontend lint, typecheck, and tests.
- [ ] Start the existing real frontend and backend stack through the desktop launcher.
- [ ] Capture Home, results, Tarot, and DIY at the required viewports in Chrome.
- [ ] Compare reference and implementation together, fix all P0-P2 discrepancies in one bounded pass, and recapture once.
- [ ] Record `final result: passed` only if layout, assets, interactions, console, and overflow checks pass.
- [ ] Run `pnpm validate` and verify the desktop launcher still opens the system.
