# Tarot Flow and Wrist Advisory Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 78 Tarot choices reachable without clipping, recover recommendation generation from unavailable inventory, add wrist-measurement guidance, and make every bracelet size completable while preserving advisory fit states.

**Architecture:** Keep Tarot card identity and inventory authority on the Backend. The frontend owns only responsive card presentation and recoverable status messaging. Keep bracelet fit classification in `@mystcrag/bracelet-engine`, while the frontend treats `TOO_SMALL` and `TOO_LARGE` as advisory rather than order-blocking.

**Tech Stack:** Next.js, React, TypeScript, Fastify, Prisma, PostgreSQL, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-tarot-guided-bracelet-design.md`

## Global Constraints

- Preserve all 78 server-shuffled displayed positions and canonical slot order.
- Never expose inventory quantities to the browser.
- Keep Tarot, crystal, and measurement language reflective and practical; make no deterministic or medical claims.
- Preserve `componentId`, price, revision, and order authority on the Backend.
- Treat every bracelet size as completable; 130-200mm remains a suggested range only.
- Run focused tests during development and `pnpm validate` before handoff.

---

### Task 1: Responsive two-row Tarot deck

**Files:**
- Modify: `apps/frontend/src/features/tarot/components/tarot-fan.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot.module.css`
- Test: `apps/frontend/src/features/tarot/tarot-draw.test.tsx`

**Interfaces:**
- Consumes: `DISPLAYED_TAROT_POSITIONS`, accepted and pending positions.
- Produces: two groups of 39 positions with unchanged `data-tarot-position` values and input behavior.

- [x] Add a failing render/geometry test proving 78 positions are split into two rows, desktop bounds do not clip, and the mobile deck remains horizontally reachable with touch-sized cards.
- [x] Run the focused frontend test and confirm it fails because row metadata and two-row styles do not exist.
- [x] Implement the two-row fan and responsive CSS without changing selection requests or card appearance.
- [x] Re-run the focused frontend test and confirm it passes.

### Task 2: Inventory-aware Tarot recommendation recovery

**Files:**
- Modify: `packages/database/src/repositories/product.repository.ts`
- Modify: `packages/database/src/repositories/product.repository.unit.test.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.types.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.service.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.service.test.ts`
- Modify: `apps/backend/src/modules/tarot/tarot.recommendations.integration.test.ts`
- Modify: `apps/frontend/src/features/tarot/components/tarot-result.tsx`
- Modify: `apps/frontend/src/features/tarot/tarot-result.test.tsx`
- Modify: `docs/API_SPECIFICATION.md`

**Interfaces:**
- Consumes: latest internal inventory snapshots for active catalog products.
- Produces: internal available quantities for candidate construction; no public DTO change.

- [x] Add a failing repository/service test proving a zero-stock active SKU is not selected and low-stock materials are not repeated beyond current availability.
- [x] Add a failing coordinator test proving `INVENTORY_CHANGED` does not reopen the optional-question form indefinitely.
- [x] Run the focused database, backend, and frontend tests and confirm the expected failures.
- [x] Add internal availability data to the catalog repository and make candidate sequencing availability-aware.
- [x] Read the fresh inventory-aware catalog on every recommendation attempt and return a terminal actionable error only when three valid designs genuinely cannot be produced.
- [x] Keep the draw visible on terminal failure and expose a dedicated retry action rather than the question recovery form.
- [x] Update the API specification and re-run focused tests.

### Task 3: Advisory-only bracelet fit

**Files:**
- Modify: `apps/frontend/src/features/design/model/bracelet-fit.ts`
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`
- Modify: `docs/BRACELET_GEOMETRY.md`
- Modify: `docs/UI_DESIGN_SYSTEM.md`
- Modify: `docs/INTERACTION_TEST_PLAN.md`

**Interfaces:**
- Consumes: engine `TOO_SMALL`, `VALID`, and `TOO_LARGE` classifications.
- Produces: `canComplete: true` for all finite positive assembled sizes plus non-blocking advisory messages outside 130-200mm.

- [x] Change the fit test first so 129mm and 201mm remain classified but both can complete.
- [x] Run the focused frontend test and confirm it fails on the existing hard guardrail.
- [x] Make fit messages advisory and remove size-based disabled/early-return behavior from desktop and mobile completion actions.
- [x] Update controlling docs from completion range to suggested range.
- [x] Re-run focused frontend and bracelet-engine tests.

### Task 4: Wrist measurement image guidance

**Files:**
- Create: `apps/frontend/public/guides/wrist-measurement.webp`
- Modify: `apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: the existing wrist step and 120-220mm questionnaire validation.
- Produces: an inline, accessible measurement illustration and three short instructions; no modal and no persistence change.

- [x] Add a failing render test for the guide image, useful alt text, and measurement instructions.
- [x] Run the focused test and confirm it fails because the guide is absent.
- [x] Generate a restrained Mystcrag-compatible measurement illustration and add it inline to the wrist step.
- [x] Re-run the focused test and inspect desktop/mobile rendering.

### Task 5: End-to-end verification

**Files:**
- Store evidence outside the repository root in the planned Playwright artifact directory.

**Interfaces:**
- Consumes: running frontend at `http://localhost:3000` and Backend at `http://localhost:4000`.
- Produces: verified Tarot-to-DIY and direct-DIY journeys without console, network, overflow, or completion blockers.

- [x] Run focused frontend, backend, database, and bracelet-engine test suites.
- [x] Run the Tarot setup, 78-card selection, reveal, recommendation, scheme selection, and DIY entry journey at 390x844 and 1440x900.
- [x] Run direct DIY completion with a design below 130mm and above 200mm, confirming advisory text and successful completion.
- [x] Check console warnings, failed network requests, overflow, keyboard access, and touch targets.
- [x] Run the Impeccable detector once over changed UI targets.
- [x] Run `pnpm validate` and record the final result.
