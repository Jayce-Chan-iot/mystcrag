# Full UI Density, Tarot Wrist, and Card Hit Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match the approved Mystcrag UI board at realistic desktop and mobile proportions, make each landing creation card one complete link, and carry a user-selected Tarot wrist circumference into generated bracelet designs.

**Architecture:** Keep the existing route and visual system, adding short-viewport density rules instead of browser `zoom`. Extend the Tarot recommendation request with an optional wrist measurement, retain it in the route-scoped ephemeral draft, validate it in the backend, and use it as the current-session override when generating all three designs.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, shared Zod contracts, Fastify, Node test runner, Chrome UI verification.

**Spec:** `docs/superpowers/specs/2026-08-19-tarot-guided-bracelet-design.md`

## Global Constraints

- Preserve the approved ivory, ink, muted-violet jewelry visual language and supplied photographic assets.
- Do not use CSS `zoom`, transform scaling, or reduce mobile controls below a 44px usable target.
- Tarot and Five Elements remain cultural/design inspiration and never factual prediction or promised efficacy.
- The 13–20 cm wrist range is advisory; valid designs outside the range remain completable.
- Preserve all unrelated user changes in the dirty worktree.

---

### Task 1: Landing card hit area

**Files:**
- Modify: `apps/frontend/app/page.tsx`
- Modify: `apps/frontend/app/atelier.css`
- Test: `apps/frontend/src/features/tarot/tarot-setup.test.tsx`

**Interfaces:**
- Consumes: `CreationPath.href`, `CreationPath.action`
- Produces: one focusable `<a>` wrapping every visible creation-card surface

- [ ] **Step 1: Write the failing test**

Render the enabled landing page and assert that each `data-creation-path` article contains exactly one route link whose content includes both the image and card copy.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mystcrag/frontend test -- tarot-setup.test.tsx`

Expected: FAIL because the current link contains only the circular arrow.

- [ ] **Step 3: Write minimal implementation**

Wrap each card’s image, copy, and arrow inside the route link; keep the circular arrow as a visual affordance and add visible keyboard focus styling.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mystcrag/frontend test -- tarot-setup.test.tsx`

Expected: PASS.

### Task 2: Tarot wrist preference contract

**Files:**
- Modify: `packages/design-contract/src/schemas/tarot.schema.ts`
- Modify: `packages/design-contract/tests/tarot-contract.test.ts`
- Modify: `apps/frontend/src/features/tarot/components/tarot-question-draft-provider.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-setup.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-result.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot-setup.test.tsx`
- Modify: `apps/backend/src/modules/tarot/tarot.service.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.recommendations.integration.test.ts`
- Modify: `docs/API_SPECIFICATION.md`

**Interfaces:**
- Consumes: `wristCircumferenceMm` entered in setup and held in `TarotQuestionDraft`
- Produces: optional `wristCircumferenceMm` on `GenerateTarotRecommendationsRequest`; all generated candidates use that value

- [ ] **Step 1: Write failing contract, frontend, and backend tests**

Assert that 165 mm is accepted by the recommendation request schema, stored with the route draft, sent by the result controller, and applied to every generated design.

- [ ] **Step 2: Run tests to verify they fail for the missing field**

Run: `pnpm --filter @mystcrag/design-contract test && pnpm --filter @mystcrag/frontend test -- tarot-setup.test.tsx tarot-result.test.tsx && pnpm --filter @mystcrag/backend test -- tarot.recommendations.integration.test.ts`

Expected: FAIL because the field is currently rejected or omitted.

- [ ] **Step 3: Implement the contract and flow**

Add an optional integer 130–200 mm field to the request, validate it at the backend boundary, prefer it over saved/default wrist data for this recommendation, store it only in the route-scoped draft, and render a compact setup control with the existing measurement guide.

- [ ] **Step 4: Run focused tests to verify they pass**

Run the same three commands and expect PASS.

### Task 3: Full-route density alignment

**Files:**
- Modify: `apps/frontend/app/atelier.css`
- Modify: `apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx`
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-setup.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-draw.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-result.tsx`
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `docs/UI_DESIGN_SYSTEM.md`

**Interfaces:**
- Consumes: route-level `data-atelier-surface` hooks and approved desktop/mobile reference board
- Produces: viewport-contained primary tasks at 1470×420, 1280×720, 390×844, and 375×667 without global scaling

- [ ] **Step 1: Add a failing UI-contract test for compact route hooks**

Assert that all principal routes expose stable surface and action-bar hooks needed for compact viewport rules.

- [ ] **Step 2: Run the focused UI contract test and observe failure**

Run: `pnpm --filter @mystcrag/frontend test -- atelier-ui-contract.test.tsx`

- [ ] **Step 3: Implement compact layout rules**

Add desktop short-height media rules that reduce section padding, display type, card heights, tray/rail proportions, and dead space while preserving content hierarchy. Keep mobile layouts intrinsically sized and controls at least 44px.

- [ ] **Step 4: Re-run the focused contract test**

Expected: PASS.

### Task 4: Browser and repository verification

**Files:**
- Modify: `apps/frontend/design-qa.md`
- Create: route comparison screenshots under `apps/frontend/`

**Interfaces:**
- Consumes: running local frontend/backend and approved reference images
- Produces: browser-tested routes, comparison evidence, and a passing workspace validation

- [ ] **Step 1: Test the full interaction path in Chrome**

Verify the homepage by clicking card imagery, complete Tarot setup with 16.5 cm, select cards, reveal, generate recommendations, and confirm all three display 16.5 cm.

- [ ] **Step 2: Verify responsive layouts**

Capture homepage, AI questionnaire, AI results, Tarot setup/draw/results, and DIY at the four target viewports. Confirm no horizontal overflow, no clipped primary action, and no unnecessary scroll before the main task.

- [ ] **Step 3: Compare reference and implementation together**

Create side-by-side comparison images and record visible deviations/fixes in `apps/frontend/design-qa.md`.

- [ ] **Step 4: Run final checks**

Run: `pnpm validate`

Run: `/Users/chenyanyan/Desktop/玄矶系统.command --self-check`

Expected: both commands pass.
