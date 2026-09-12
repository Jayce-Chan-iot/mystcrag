# DIY Loose-Bead Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default rim-hugging bracelet view with a performant loose-bead tray, dual-source launch/collision feedback, canonical connected mode, and a simplified read-only size inspector.

**Architecture:** A pure feature-local circle solver owns presentation-only particle coordinates keyed by `componentId`; a React stage adapter drives it through one bounded `requestAnimationFrame` loop and writes transforms through refs. `FlatBraceletEditor` remains the production renderer and delegates loose mode to the new stage while connected mode continues to use Bracelet Engine geometry. `DiyEditor` remains the business-operation owner and supplies launch intents without changing Design JSON.

**Tech Stack:** TypeScript, React 19, Next.js 16, CSS transforms, Pointer Events, Node test runner through `tsx`, existing `@mystcrag/bracelet-engine`; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-12-diy-loose-bead-physics-visual-redesign.md`

## Global Constraints

- Register `TASK-FE-003`, owner `FRONTEND`, branch `task/fe-003-diy-loose-bead-workbench`, status `IN_PROGRESS`, and exact paths before implementation.
- Start only from a Codex-accepted `TASK-ASSET-003` candidate that provides `TrayVisual.innerRadiusRatio` and normalized runtime assets.
- Physics coordinates are presentation-only and keyed by `componentId`; never mutate `DesignV1`, `positionIndex`, pricing, inventory or revision.
- Connected layout, ring hit testing, reorder, export and completion continue to use the canonical Bracelet Engine path.
- Use no React state update per frame and add no physics dependency.
- Active simulation targets 60 fps, remains usable at 30 fps, sleeps normally within 1.5 seconds and hard-stops at 3 seconds.
- Use deterministic fallback layout above 48 physical bodies, after persistent low frame rate, with reduced motion, or when required APIs are unavailable. The current offered 6/8/10 mm catalog and 200 mm common-fit ceiling imply at most 34 six-millimetre beads; 48 therefore supplies 41% headroom while bounding mobile work.
- Support current/previous Chrome, Edge, Firefox, macOS Safari and iOS Safari through feature detection rather than user-agent sniffing.
- Do not edit public assets, Backend, Database, Auth, Design Contract, Bracelet Engine, package manifests or lockfile.
- Do not push, deploy or merge to `main`; stop at REVIEW for Codex.

---

## File structure

- Create `apps/frontend/src/features/design/model/loose-bead-physics.ts`: pure particle seeding, collision, boundary, sleep and fallback functions.
- Create `apps/frontend/src/features/design/model/loose-bead-physics.test.tsx`: deterministic and invariant tests.
- Create `apps/frontend/src/features/design/model/loose-bead-motion.ts`: frame accumulator, reduced-motion choice and size-observer fallback.
- Create `apps/frontend/src/features/design/model/loose-bead-motion.test.tsx`: scheduler/degradation tests.
- Create `apps/frontend/src/features/design/components/loose-bead-stage.tsx`: DOM/ref adapter, bead/accessory rendering, live-region result.
- Create `apps/frontend/src/features/design/components/loose-bead-stage.test.tsx`: component structure and reconciliation tests.
- Modify `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`: loose/connected delegation while preserving canonical connected editing.
- Modify `apps/frontend/src/features/design/components/diy-editor.tsx`: launch origins, selected-material strip and right inspector.
- Modify `apps/frontend/src/features/design/model/bracelet-fit.ts`: explicit one-decimal presentation formatter.
- Create `apps/frontend/src/features/design/model/bracelet-fit.test.tsx`: dimension/rounding truth.
- Modify `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`: interaction and authority contract assertions.
- Modify `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`: new desktop/mobile composition copy and absence of duplicate grid.
- Modify only the `TASK-FE-003` row in `docs/tasks/TASK_REGISTRY.md`.
- Store ignored evidence under `output/playwright/task-fe-003/`.

### Task 1: Pure loose-bead geometry

**Files:**
- Create: `apps/frontend/src/features/design/model/loose-bead-physics.ts`
- Create: `apps/frontend/src/features/design/model/loose-bead-physics.test.tsx`

**Interfaces:**
- Consumes: stable component IDs, rendered radii and a circular tray boundary in CSS pixels.
- Produces: deterministic particles and a pure fixed-step solver.

Define these exact public types and constants:

```ts
export type LooseBodyInput = {
  componentId: string;
  radiusPx: number;
  kind: "BEAD" | "INLINE_ACCESSORY";
};

export type LooseParticle = LooseBodyInput & {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  sleepingFrames: number;
};

export type LooseBounds = {
  centerX: number;
  centerY: number;
  innerRadiusPx: number;
};

export type LoosePhysicsState = {
  elapsedMs: number;
  overflowComponentIds: readonly string[];
  particles: readonly LooseParticle[];
  settled: boolean;
};

export const MAX_PHYSICS_BODIES = 48;
export const FIXED_STEP_MS = 1000 / 60;
export const HARD_STOP_MS = 3000;

export function seedLooseParticles(inputs: readonly LooseBodyInput[], bounds: LooseBounds): LoosePhysicsState;
export function injectLooseParticle(state: LoosePhysicsState, input: LooseBodyInput, origin: { x: number; y: number }, bounds: LooseBounds): LoosePhysicsState;
export function stepLoosePhysics(state: LoosePhysicsState, bounds: LooseBounds, stepMs?: number): LoosePhysicsState;
export function deterministicFallbackLayout(inputs: readonly LooseBodyInput[], bounds: LooseBounds): LoosePhysicsState;
```

- [ ] **Step 1: Write failing deterministic-placement tests**

Test that identical ordered inputs yield byte-equal results, reversed inputs still map the same `componentId` to the same seeded region, every center satisfies `distance + radius <= innerRadiusPx`, and 6/8/10 mm-derived radii remain unequal rather than normalized visually. A 49-body input returns at most 48 visible particles and the remaining stable ID in `overflowComponentIds`; no body is silently rescaled.

```ts
assert.deepEqual(seedLooseParticles(inputs, bounds), seedLooseParticles(inputs, bounds));
for (const particle of state.particles) {
  assert.ok(Math.hypot(particle.x - bounds.centerX, particle.y - bounds.centerY) + particle.radiusPx <= bounds.innerRadiusPx);
}
```

- [ ] **Step 2: Run the new test and see the missing module failure**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/loose-bead-physics.test.tsx
```

Expected: FAIL because `loose-bead-physics.ts` does not exist.

- [ ] **Step 3: Implement deterministic seed and fallback placement**

Use a small local string hash over `componentId`, golden-angle candidate positions, and bounded relaxation. Sort internally by `componentId` only for seeding, then return particles in input order. If inputs exceed 48 or their real radii cannot fit without overlap, return the deterministic fallback with zero velocities, `settled: true`, and every unplaced ID in `overflowComponentIds`.

- [ ] **Step 4: Add failing collision and boundary tests**

Cover equal/unequal radii, coincident centers, incoming velocity transfer, damping, circular boundary projection, no `NaN`, sleep after stable frames, and hard stop at 3000 ms. Assert that the input arrays and objects remain deeply unchanged.

- [ ] **Step 5: Implement the minimal solver**

Use circle overlap correction, impulse along the collision normal, mass proportional to `radiusPx ** 2`, velocity damping and a circular boundary projection. Run at most four solver iterations per fixed step. Mark settled after 12 consecutive frames below `0.02 px/ms`; at hard stop return a valid fallback layout with zero velocities.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/loose-bead-physics.test.tsx
git add apps/frontend/src/features/design/model/loose-bead-physics.ts apps/frontend/src/features/design/model/loose-bead-physics.test.tsx
git commit -m "feat(diy): add deterministic loose-bead physics"
```

Expected: focused tests PASS.

### Task 2: Motion scheduler and compatibility fallback

**Files:**
- Create: `apps/frontend/src/features/design/model/loose-bead-motion.ts`
- Create: `apps/frontend/src/features/design/model/loose-bead-motion.test.tsx`

**Interfaces:**
- Consumes: timestamps, `prefers-reduced-motion`, body count, visibility and optional `ResizeObserver`.
- Produces: bounded step counts and deterministic degradation decisions.

Define:

```ts
export type MotionCapabilityInput = {
  bodyCount: number;
  prefersReducedMotion: boolean;
  requestAnimationFrameAvailable: boolean;
};

export type LooseMotionMode = "PHYSICS" | "REDUCED" | "FALLBACK";

export function chooseLooseMotionMode(input: MotionCapabilityInput): LooseMotionMode;
export function consumeFrameDelta(accumulatorMs: number, frameDeltaMs: number): { accumulatorMs: number; steps: number };
export function observeElementSize(element: Element, onResize: () => void, options?: { ResizeObserverCtor?: typeof ResizeObserver; windowTarget?: Pick<Window, "addEventListener" | "removeEventListener"> }): () => void;
```

- [ ] **Step 1: Write failing mode and accumulator tests**

Assert `REDUCED` wins when the media preference is true, `FALLBACK` is used for body count 49 or missing RAF, and `PHYSICS` is used for 48 supported bodies. Assert a 1000 ms frame produces at most four fixed steps and discards excess catch-up time.

- [ ] **Step 2: Write failing observer tests**

With a fake `ResizeObserver`, assert observe/disconnect exactly once. Without it, assert one `resize` listener is installed and the returned cleanup removes the same callback.

- [ ] **Step 3: Implement pure capability and compatibility helpers**

Use `MAX_PHYSICS_BODIES` and `FIXED_STEP_MS` from the physics module. Do not access `window` or `matchMedia` during module evaluation; the React adapter passes detected values after mount.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/loose-bead-motion.test.tsx
git add apps/frontend/src/features/design/model/loose-bead-motion.ts apps/frontend/src/features/design/model/loose-bead-motion.test.tsx
git commit -m "feat(diy): add bounded motion scheduler"
```

### Task 3: Read-only dimension truth and rounding

**Files:**
- Modify: `apps/frontend/src/features/design/model/bracelet-fit.ts`
- Create: `apps/frontend/src/features/design/model/bracelet-fit.test.tsx`

**Interfaces:**
- Consumes: `calculateBraceletCircumferenceMm(design)` including bead length and inline-accessory fallbacks.
- Produces: `formatEstimatedFitCm(circumferenceMm: number): string` and unchanged `BraceletFit.circumferenceCmLabel` shape.

- [ ] **Step 1: Write failing calculation and rounding cases**

Use a copied fixture, not a hand-cast partial. Assert bead `lengthAlongStringMm` precedes diameter, inline accessory length precedes width then diameter, anchored accessories add zero, and:

```ts
assert.equal(formatEstimatedFitCm(144.0), "14.4");
assert.equal(formatEstimatedFitCm(144.49), "14.4");
assert.equal(formatEstimatedFitCm(144.5), "14.5");
assert.equal(formatEstimatedFitCm(145.0), "14.5");
```

- [ ] **Step 2: Run and verify red**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/bracelet-fit.test.tsx
```

Expected: FAIL because the formatter is not exported.

- [ ] **Step 3: Implement explicit half-up presentation**

```ts
export function formatEstimatedFitCm(circumferenceMm: number): string {
  const roundedMillimetres = Math.floor(circumferenceMm + 0.5);
  return (roundedMillimetres / 10).toFixed(1);
}
```

Reject non-finite or negative values with a `RangeError`. Make `evaluateBraceletFit` call this formatter; retain full-precision `circumferenceMm` internally.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/bracelet-fit.test.tsx
git add apps/frontend/src/features/design/model/bracelet-fit.ts apps/frontend/src/features/design/model/bracelet-fit.test.tsx
git commit -m "fix(diy): derive read-only fit label from components"
```

### Task 4: Loose stage DOM adapter

**Files:**
- Create: `apps/frontend/src/features/design/components/loose-bead-stage.tsx`
- Create: `apps/frontend/src/features/design/components/loose-bead-stage.test.tsx`

**Interfaces:**
- Consumes: current components, verified tray metadata, selection callback and queued launch intents.
- Produces: one accessible loose-stage component and launch-consumption callback.

Define:

```ts
export type BeadLaunchIntent = {
  requestId: string;
  componentId: string;
  originClientX: number;
  originClientY: number;
};

export type LooseBeadStageProps = {
  busy: boolean;
  design: PublicDesignV1;
  launchQueue: readonly BeadLaunchIntent[];
  onLaunchConsumed: (requestId: string) => void;
  onSelect: (componentId: string) => void;
  selectedComponentId: string;
  trayMaterial: DisplayTrayMaterial;
};
```

- [ ] **Step 1: Write failing structural tests**

Assert the stage renders `data-loose-bead-stage`, one stable button per visible bead `componentId`, `placementMode: "ANCHORED"` accessories outside the particle layer, real `CrystalBeadImage`, `aria-pressed`, a polite live region, and no business move/remove callback in loose mode. When overflow IDs exist, assert the visible status `托盘空间已满，其他珠子将在成串预览中显示` and keep all items available in the lower selected-material summary.

- [ ] **Step 2: Write failing lifecycle tests**

Inject fake RAF/cancelRAF, `matchMedia`, size observer and clock adapters. Assert only one frame loop, no React state setter from the frame callback, stop on settle/3000 ms/unmount/hidden document, restart safely on visibility return, queue consumption exactly once, missing projected component ignored, removed component particle removed, and reduced-motion placement without collision.

- [ ] **Step 3: Implement the component**

Keep particle state and DOM nodes in refs. Derive physical bead and inline-accessory inputs from `design`; keep anchored accessories in a non-physical visual layer. On a React-level design component-list change, reconcile the map once. In a frame, call the pure solver, then apply only:

```ts
node.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) translate(-50%, -50%)`;
```

Do not read layout after those writes. Measure tray/source once per launch. Use `getTrayVisual(trayMaterial).innerRadiusRatio` for the safe boundary. For inline accessories use half the largest rendered dimension as the collision radius; render overlay accessories in a non-physical layer.

- [ ] **Step 4: Implement degradation**

Reduced motion uses a 150 ms opacity/scale transition. Missing RAF, more than 48 bodies, or 12 consecutive frames slower than 33.4 ms switches to `deterministicFallbackLayout`, cancels RAF and leaves every selection/business control working.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/components/loose-bead-stage.test.tsx src/features/design/model/loose-bead-physics.test.tsx src/features/design/model/loose-bead-motion.test.tsx
git add apps/frontend/src/features/design/components/loose-bead-stage.tsx apps/frontend/src/features/design/components/loose-bead-stage.test.tsx
git commit -m "feat(diy): render accessible loose-bead tray"
```

### Task 5: Preserve canonical connected mode

**Files:**
- Modify: `apps/frontend/src/features/design/components/flat-bracelet-editor.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: `LooseBeadStage`, existing `calculateSizeAwareRingLayout`, existing connected editing callbacks.
- Produces: `FlatBraceletEditor` with mutually exclusive loose and canonical layers.

- [ ] **Step 1: Add failing integration assertions**

Assert `connected=false` renders `LooseBeadStage`; `connected=true` calls/renders the existing size-aware Bracelet Engine layout. Pin that connected mode retains pointer/native drag, slot reflow, ArrowLeft/ArrowRight, Delete/Backspace, outside-tray removal and `componentId` keys. Assert loose mode does not call `onMove` when particles collide.

- [ ] **Step 2: Add launch props without forking the renderer**

Extend `FlatBraceletEditor` props with:

```ts
launchQueue?: readonly BeadLaunchIntent[];
onLaunchConsumed?: (requestId: string) => void;
```

Render `LooseBeadStage` only when `!connected`. Keep current ring JSX and `calculateSizeAwareRingLayout` in the connected branch. The transition class may interpolate transform/opacity for 300 ms, with `motion-reduce:transition-none`.

- [ ] **Step 3: Run regression and commit**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/frontend-ai-flow.test.tsx src/features/design/components/loose-bead-stage.test.tsx
pnpm --filter @mystcrag/bracelet-engine test
git add apps/frontend/src/features/design/components/flat-bracelet-editor.tsx apps/frontend/src/features/design/frontend-ai-flow.test.tsx
git commit -m "feat(diy): separate loose and canonical layouts"
```

### Task 6: Dual-source launch and workbench simplification

**Files:**
- Modify: `apps/frontend/src/features/design/components/diy-editor.tsx`
- Modify: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

**Interfaces:**
- Consumes: `BeadLaunchIntent`, current `submitEdit`, `designSummary`, `braceletFit.circumferenceCmLabel` and diameter replacement.
- Produces: one launch queue, two visual origins, one selected-material strip and one read-only inspector.

- [ ] **Step 1: Write failing copy/layout assertions**

Require `已选用的珠子`, `成品手围与尺寸`, `预计适配手围`, `当前组合长度`, `收缩成串` and `散开到托盘`. Assert the old `常用水晶`, right-grid heading `已选水晶`, pencil glyph and direct circumference input are absent from both desktop and mobile compositions.

- [ ] **Step 2: Write failing launch-origin tests**

Click one left catalog card and one lower grouped card with mocked `getBoundingClientRect`. Assert each creates one `ADD_COMPONENT`, one unique `componentId`, one launch intent with the clicked center, and no second add during reconciliation. Simulate failed optimistic settlement and assert the missing provisional component disappears from the stage.

- [ ] **Step 3: Add the queue and shared command**

Maintain `const [launchQueue, setLaunchQueue] = React.useState<BeadLaunchIntent[]>([])`. Change `addMaterial` to accept the clicked `HTMLElement`, compute its center once, create one request/component ID, enqueue the matching intent and call `submitEdit` once. `onLaunchConsumed` filters exactly that request ID. Both catalog and grouped-card click handlers pass `event.currentTarget`.

- [ ] **Step 4: Recompose the desktop right rail**

Remove the duplicate bead grid. Show `braceletFit.circumferenceCmLabel` as read-only text under `预计适配手围`, with copy `根据当前珠子与直通配饰尺寸自动计算`. Keep selected component artwork, allowed diameter buttons, add/remove, undo/redo, optimization, count, authoritative total and warnings. Do not render the measurement-guide image in this compact inspector.

- [ ] **Step 5: Recompose the lower strip and mobile inspector**

Render `designSummary` as grouped material cards labelled name, diameter, quantity and group subtotal. Clicking the card adds one matching material and launches it. Keep a separate explicit select action only if needed for keyboard users; its label must distinguish `选中已有珠子` from `再加一颗`. Mobile exposes the same read-only fit and selected diameter controls below the stage without horizontal overflow.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/atelier-ui-contract.test.tsx src/features/design/frontend-ai-flow.test.tsx src/features/design/components/loose-bead-stage.test.tsx src/features/design/model/bracelet-fit.test.tsx
git add apps/frontend/src/features/design/components/diy-editor.tsx apps/frontend/src/features/design/atelier-ui-contract.test.tsx apps/frontend/src/features/design/frontend-ai-flow.test.tsx
git commit -m "feat(diy): launch beads from both material rails"
```

### Task 7: Frontend acceptance, performance and compatibility

**Files:**
- Modify: only `TASK-FE-003` acceptance text in `docs/tasks/TASK_REGISTRY.md`
- Store ignored evidence: `output/playwright/task-fe-003/`

**Interfaces:**
- Consumes: accepted implementation and assets.
- Produces: a clean candidate with reproducible unit, browser, performance and compatibility evidence.

- [ ] **Step 1: Run all local gates**

```bash
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend build
pnpm --filter @mystcrag/bracelet-engine test
node --test tests/architecture.test.mjs
pnpm validate
git diff --check
```

Record exact counts and exit codes. The known missing `apps/backend/src/modules/community` baseline may remain red; no other failure is accepted.

- [ ] **Step 2: Exercise desktop and mobile behavior**

At 1440×900 and 390×844, record initial loose positions, left launch, lower launch, visible collisions, selected diameter replacement, connected/loose transitions, rapid add, failed add/retry, resize/orientation, keyboard selection, save and reload. Confirm no overlap at rest, no rim leak, no tray patch, no duplicate add, no horizontal overflow and no unexpected console/network failure.

- [ ] **Step 3: Exercise compatibility modes**

Run Chromium, Firefox and WebKit. In each, cover pointer or touch plus keyboard. Run one context with `prefers-reduced-motion: reduce`, one forced missing-RAF/fallback unit path, and one 49-body fixture. All must preserve the same business result and accessible announcement.

- [ ] **Step 4: Record performance evidence**

Capture a production-build Chromium performance trace for 48 bodies and a constrained mobile/WebKit run. Verify no solver-caused task exceeds 50 ms, active animation maintains at least 30 fps, normal settle is within 1.5 seconds, hard stop within 3 seconds, and the loop is gone after settle/navigation. Compare frontend route chunks before/after; confirm no third-party physics chunk/dependency exists.

- [ ] **Step 5: Mark REVIEW and commit**

Update only the task row with commits, files, red/green history, exact test counts, browser matrix, performance numbers, baseline exception and no push/deploy.

```bash
git add docs/tasks/TASK_REGISTRY.md
git commit -m "docs(tasks): hand off TASK-FE-003"
git status --short
```

Expected: clean worktree. Stop for Codex review and do not begin all-route polish.
