# Mystcrag Full UI and Tray Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved jewelry-atelier UI across active frontend routes and add a responsive tray-based 2.5D DIY workbench with selected-bead controls and outside-tray removal.

**Architecture:** Keep all commerce and Design Contract authority unchanged. Add a frontend-only tray preference module and pure tray hit-testing helpers, then compose route UI from shared presentation primitives. Diameter changes reuse the existing server replace operation and bracelet geometry continues to come from `@mystcrag/bracelet-engine`.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS v4, Node test runner, React static rendering tests, Playwright, localStorage, existing Mystcrag API and Bracelet Engine.

**Spec:** `docs/superpowers/specs/2026-08-22-full-ui-tray-workbench-design.md`

## Global Constraints

- Preserve routes, Design Contract DTOs, pricing, inventory, order, auth, and compliance behavior.
- Tray is local presentation metadata only and is never submitted as product or order material.
- Primary bracelet presentation is top-down 2.5D and uses the existing Bracelet Engine layout.
- Mobile acceptance is 390x844; desktop acceptance is 1440x900.
- Every behavior change follows red-green-refactor and `pnpm validate` is required before handoff.

---

### Task 1: Tray preference and hit testing

**Files:**
- Create: `apps/frontend/src/features/design/model/display-tray.ts`
- Create: `apps/frontend/src/features/design/model/display-tray.test.tsx`
- Modify: `docs/UI_DESIGN_SYSTEM.md`
- Modify: `docs/BRACELET_GEOMETRY.md`

**Interfaces:**
- Produces: `DisplayTrayMaterial`, `DISPLAY_TRAY_OPTIONS`, `loadDisplayTray(designId)`, `saveDisplayTray(designId, material)`, and `isPointOutsideTray(point, rect, radiusRatio)`.

- [ ] Write tests with literal expectations for default bone china, per-design storage keys, invalid stored-value fallback, and points inside/on/outside a circular tray.
- [ ] Run the focused model test and confirm failure because the module does not exist.
- [ ] Implement the pure preference and hit-testing module without importing React or business contracts.
- [ ] Run the focused test and confirm pass.
- [ ] Update the two controlling UI/geometry documents with tray and outside-boundary semantics.

### Task 2: Tray stage and outside-tray drag removal

**Files:**
- Create: `apps/frontend/src/features/design/components/display-tray.tsx`
- Modify: `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: Task 1 tray options and hit testing.
- Produces: `DisplayTray` and `FlatBraceletEditor` props `trayMaterial` plus observable `data-display-tray` / `data-outside-tray` states.

- [ ] Add failing component/source tests proving the tray renders, the centered delete target is gone, and outside-tray release invokes the removal branch while over-tray off-ring release does not.
- [ ] Run the focused frontend test and confirm the intended failures.
- [ ] Implement the physical tray surface and replace delete-zone logic with tray-boundary drag feedback for pointer and native drag paths.
- [ ] Preserve ring-slot reorder, keyboard removal, component identity, and unchanged drag appearance.
- [ ] Run the focused frontend test and confirm pass.

### Task 3: Current beads, diameter controls, and product types

**Files:**
- Create: `apps/frontend/src/features/design/components/current-bead-strip.tsx`
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: current `PublicDesignV1`, `CatalogMaterialProduct[]`, selected `componentId`, and existing `createReplaceRequest` flow.
- Produces: selection callbacks and a diameter replacement callback keyed by catalog material ID.

- [ ] Add failing tests for the three product types, honest empty states, exact current-bead selection, and same-material diameter choices.
- [ ] Run the focused frontend test and confirm failure for the missing UI.
- [ ] Implement the current-bead strip and diameter options, preserving `componentId` through the existing replace operation.
- [ ] Add `水晶 / 天然石 / 配饰` product-type navigation and scoped empty states without fake catalog data.
- [ ] Run the focused frontend test and confirm pass.

### Task 4: Responsive jewelry-atelier route styling

**Files:**
- Modify: `apps/frontend/app/globals.css`
- Modify: `apps/frontend/app/layout.tsx`
- Modify: `apps/frontend/app/page.tsx`
- Modify: `apps/frontend/components/page-scaffold.tsx`
- Modify: `apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx`
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot.module.css`
- Modify: `apps/frontend/src/features/tarot/components/tarot-setup.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-draw.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-result.tsx`
- Modify: affected frontend tests beside each feature.

**Interfaces:**
- Consumes: the approved full-site design spec and existing route behavior.
- Produces: one coherent responsive visual system for all active routes and shared states.

- [ ] Add or update failing structural tests for one-line navigation, three equal home entries, questionnaire composition, three-option result visibility, two-row Tarot fan, mobile proportional markers, and responsive DIY regions.
- [ ] Run affected frontend and Tarot tests and confirm the new assertions fail.
- [ ] Apply the approved tokens, typography, containment, spacing, controls, and route compositions without changing API behavior.
- [ ] Add explicit 390x844 and short-desktop layout rules; remove scaled/overstretched fixed-canvas assumptions.
- [ ] Run affected frontend and Tarot tests and confirm pass.

### Task 5: Export, persistence, and reload behavior

**Files:**
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: Task 1 local display preference and current export implementation.
- Produces: export using the visible tray and reload restoration for the same design on the same browser.

- [ ] Add failing tests proving tray selection is loaded per design, saved locally, excluded from update/order requests, and reflected by the export target.
- [ ] Run the focused frontend test and confirm failure.
- [ ] Wire tray selection into editor state, save/reload, and export without adding it to Design Contract operations.
- [ ] Run the focused test and confirm pass.

### Task 6: Browser acceptance and desktop launcher

**Files:**
- Modify or create: `tests/e2e/full-ui-tray-workbench.spec.ts`
- Modify only if verification exposes a defect: `/Users/chenyanyan/Desktop/玄矶系统.command`
- Store artifacts: `output/playwright/full-ui-tray-workbench/`

**Interfaces:**
- Consumes: the completed frontend and real local backend flow.
- Produces: repeatable desktop/mobile acceptance evidence and a verified launcher.

- [ ] Run focused unit/component suites, lint, typecheck, and build.
- [ ] Start the real database, backend, and frontend with the desktop launcher.
- [ ] Run Playwright at 1440x900 and 390x844 through home, AI, Tarot, and DIY, including every tray, add, diameter change, reorder, outside-tray delete, save, export, completion, and reload.
- [ ] Inspect console, network failures, horizontal overflow, clipped cards/catalog, touch targets, and visible next actions; save validated screenshots.
- [ ] Run `/Users/chenyanyan/Desktop/玄矶系统.command --self-check`, `--status`, and a real HTTP health check; stop and restart once to prove repeatability.
- [ ] Run `pnpm validate` and record the final zero-failure output.
