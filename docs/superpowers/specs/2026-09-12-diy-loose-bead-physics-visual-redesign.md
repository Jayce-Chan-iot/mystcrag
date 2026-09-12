# DIY Loose-Bead Physics and Visual Redesign

**Task:** `TASK-UX-001`

**Status:** APPROVED by Product Owner on 2026-09-12

**Date:** 2026-09-12

**Controlling references:** `apps/frontend/DESIGN.md`, `apps/frontend/PRODUCT.md`, `docs/BRACELET_GEOMETRY.md`, `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/MODULE_OWNERS.md`, `docs/superpowers/specs/2026-08-22-full-ui-tray-workbench-design.md`

## 1. Decision summary

The DIY editor will open as a spacious top-down loose-bead workbench. Beads rest naturally inside the display tray instead of being forced into a bracelet ring against the rim. Choosing a bead from either the left catalog or the lower selected-material strip launches it from that visible source into the tray; it then collides with and displaces the other loose beads. `收缩成串` switches the same ordered design into the canonical Bracelet Engine ring layout.

The redesign also:

- renames the lower section from `常用珠子` to `已选用的珠子` and groups entries by product/material and diameter;
- removes the right-side duplicate `已选水晶` thumbnail grid;
- uses the released right column for a read-only fit summary, selected-component sizing, count, assembled length, and price;
- calculates the customer-facing estimate from the actual bead and inline-accessory dimensions, rounds to one decimal place, and does not let the customer type an arbitrary circumference;
- replaces tray imagery with provenance-approved transparent or edge-blended assets so no rectangular patch is visible;
- treats performance, reduced motion, touch behavior, and browser compatibility as acceptance requirements rather than later polish.

This specification supersedes only the conflicting DIY layout and interaction clauses in the 2026-08-22 workbench design. Its contract, authority, accessibility, route, and non-fabrication rules remain in force.

## 2. Goals and non-goals

### Goals

1. Make bead scale, crop, translucency, contact shadow, spacing, and tray integration feel like a premium real-material workbench.
2. Make adding a bead legible and satisfying from both catalog entry points without changing the saved design semantics.
3. Give loose composition and assembled-bracelet preview distinct, understandable modes.
4. Derive all displayed measurements from authoritative component dimensions.
5. Remove duplicate information and reduce density while keeping controls discoverable.
6. Stay smooth on supported desktop and mobile devices and remain usable when animation or collision simulation is unavailable.

### Non-goals

- Do not change `DesignV1`, component identity, `positionIndex`, price, inventory, revision, save, export, order, Auth, or backend contracts.
- Do not replace or fork Bracelet Engine geometry.
- Do not persist physics coordinates to the design or synchronize them between devices.
- Do not infer or overwrite a questionnaire-supplied anatomical wrist measurement.
- Do not copy competitor images, code, or branded visual assets.
- Do not redesign every application route in the same implementation task. Full-site polish is a separately audited program.

## 3. Information architecture

### Desktop

- **Left:** product categories, search and filters, then the bead catalog. Clicking a bead adds it and launches it from the clicked card.
- **Center:** tray selector, generous loose-bead stage, `收缩成串` / `散开到托盘` mode control, save/conflict feedback, then `已选用的珠子`.
- **Right:** `成品手围与尺寸`, selected material/SKU, allowed diameter replacements, component count, assembled length and server-authoritative total price. There is no duplicate bead-thumbnail grid.

The center stage owns the largest share of the viewport. The tray must have visible breathing room around its usable inner boundary. Internal side rails may scroll, but the main stage and primary mode action stay visible at 1440x900.

### Mobile

The same capabilities use the existing mobile composition instead of shrinking the desktop layout. The catalog remains a bottom sheet or mobile catalog surface. A tap on either a catalog card or selected-material card launches from the control's on-screen center toward the tray. The inspector becomes a compact sheet/section below the stage. Acceptance remains 390x844, with no horizontal overflow and no primary action hidden behind browser or app navigation.

## 4. Workbench states

The presentation layer has five explicit states:

| State | Meaning | Required behavior |
| --- | --- | --- |
| `LOOSE` | Stable beads resting in the tray | Beads may be selected; visual positions are not business order |
| `ENTERING` | One newly selected bead is travelling from its source | Existing add request has one optimistic identity; no duplicate add |
| `SETTLING` | Collision solver is resolving motion | Beads stay within the safe tray boundary and do not visibly overlap at rest |
| `CONNECTED` | Canonical assembled bracelet | Render exclusively from Bracelet Engine layout and ordered components |
| `ERROR` | Add/reconcile failed | Remove the provisional bead, preserve prior layout, show the existing inline error/retry treatment |

Opening the editor defaults to `LOOSE`, including when an existing saved design is loaded. Initial loose positions look organic but are deterministic for the same component identities and tray size; they must not jump because of hydration or an unrelated React render. `收缩成串` animates toward the canonical slot coordinates and then becomes `CONNECTED`. `散开到托盘` returns to deterministic loose positions.

## 5. Add, flight, collision, and ordering

### Two equivalent entry points

The left catalog and lower selected-material strip call the same add command and differ only in their measured visual launch origin. The lower strip contains one grouped card per selected product/material and exposes current quantities and available diameter variants; it is not a second source of business data.

### Flight

- Capture the clicked/tapped element center and convert it into tray-local coordinates without forcing layout during every frame.
- Start the new visual particle just outside or at the lower/side edge of the tray along a short curved path toward an unoccupied target region.
- Use transform and opacity only during flight; do not animate layout properties.
- The incoming bead adopts its real diameter-based display size before its first collision.
- Selection follows the newly added component after the authoritative/optimistic identity is available.

### Collision

The required simulation is deliberately small and two-dimensional: circular particles, a circular inner-tray boundary, damping, impulse response and settling. A lightweight feature-local solver is preferred over a general physics dependency unless implementation measurement proves the dependency materially safer and its lazy-loaded cost stays within the budget below.

- Particle radius comes from the same millimetre-to-pixel scale used by the visible renderer, plus a small non-visible collision tolerance to prevent texture overlap.
- The boundary follows the tray's usable **inner** radius, not the asset rectangle or outer rim. A design-tokenized inset keeps beads visibly away from the edge.
- Different bead diameters collide at their actual rendered radii. Decorative shadow does not enlarge geometry.
- Each inline accessory uses a conservative circular collision bound derived from its largest rendered dimension, while retaining its real artwork. Overlay accessories stay in the non-physical center/overlay layer in loose mode. Both return to their canonical Bracelet Engine placement in connected mode.
- Solver results affect only presentation coordinates keyed by `componentId`. They never rewrite `positionIndex`, component order, size, quantity, or Design JSON.
- Existing move/reorder controls operate on business order in `CONNECTED`; loose-mode selection must not imply reorder.

An add operation creates exactly one business mutation. When the current optimistic layer projects the new component, the particle is keyed to that projected `componentId`; the server response reconciles it rather than creating a second particle. Failure removes it and restores the previous stable particles.

## 6. Canonical connected mode

`CONNECTED` uses `FlatBraceletEditor` backed by Bracelet Engine layout. The physics solver must not approximate, cache, or overwrite ring geometry. The transition may interpolate visual transforms from loose particle coordinates to canonical slot coordinates, but hit testing, selection, reorder, removal, export, preview, save and completion continue to use the existing canonical component identities and operations.

Bead artwork must be normalized so equal-diameter SKUs occupy equal visible diameters. Transparent padding in source files must not make one 6 mm bead appear smaller than another. `object-contain` alone is insufficient when alpha bounds differ; the asset/rendering task must prove normalized visible bounds and missing-asset fallback.

## 7. Measurement and size semantics

The right inspector is read-only for overall fit. It must not render a text input, number input, pencil/edit affordance, or mutation that changes circumference directly.

For the current design, reuse the existing dimension truth:

```text
assembledMaterialPathMm =
  sum(bead.lengthAlongStringMm ?? bead.diameterMm)
  + sum(inlineAccessory.lengthAlongStringMm
        ?? inlineAccessory.dimensions.widthMm
        ?? inlineAccessory.dimensions.diameterMm
        ?? 0)

displayedEstimatedFitCm = round(assembledMaterialPathMm / 10, 1 decimal)
```

The code path remains the tested `calculateBraceletCircumferenceMm`/fit view model rather than duplicating the formula in the component. A tested presentation formatter performs explicit one-decimal conventional rounding and emits the trailing decimal. The primary customer label is `预计适配手围`, displayed as for example `14.4 cm`; supporting copy states that it is calculated from the current component combination. `当前组合长度` may expose the same underlying number for clarity, but the UI must not present it as the customer's measured anatomical wrist. A future change to true inner-circumference mechanics requires a separately registered Bracelet Engine task and updated geometry documentation.

Changing the selected bead's allowed 6/8/10 mm SKU uses the existing replace operation, preserves `componentId`, and recomputes the displayed estimate, loose radius, connected layout and authoritative price. Rounding is conventional half-up presentation to one decimal; calculations retain full precision internally.

## 8. Tray and bead asset quality

The square patch around the current tray is an asset defect, not a color-token problem. The asset task must produce provenance-approved runtime assets with one of these verified properties:

1. true alpha outside the tray and contact shadow; or
2. an edge treatment deliberately generated for the exact app background with no visible rectangle across supported themes/viewports.

True alpha is preferred. All four tray choices must share framing, inner usable-circle metadata, neutral lighting, pixel density and crop. Background removal must preserve the rim and natural shadow without a white halo. The renderer uses the asset's defined inner-circle inset for collision boundaries. It must not sample an approximate page color to hide a rectangular JPEG.

Bead images require automated or reviewed alpha-bound normalization, consistent central alignment, restrained contact shadow, and retained material features such as translucency, inclusions and highlights. Competitor media may be used only as visual evaluation evidence, never as a source asset.

## 9. Performance design

### Runtime architecture

- Keep simulation state in a feature-local controller/ref store. Do not call React state setters per animation frame.
- Use one `requestAnimationFrame` loop with a fixed simulation step and bounded catch-up work. Rendering writes batched `transform` values after simulation.
- Start the loop only for `ENTERING`/`SETTLING`; stop it after all bodies sleep or a short bounded timeout. Pause immediately when `document.visibilityState` is hidden and reconcile safely on return.
- Read source/tray bounds once at interaction start and after a debounced resize. Avoid read/write interleaving and forced synchronous layout inside the frame loop.
- Lazy-load the collision implementation only when the DIY editor enters loose mode. It must not inflate unrelated route bundles.
- Reuse particles and cached normalized asset metadata where practical; do not repeatedly decode the same image or create object URLs per frame.
- Bound solver iterations and body count to the product's supported design limit. The implementation task must measure the current maximum realistic component count before fixing the cap; designs above the measured smooth threshold use the deterministic non-collision layout, never a frozen UI.
- An O(n²) narrow phase is acceptable only if profiling at the accepted maximum count meets the frame budget. Otherwise add a simple spatial hash broad phase; do not add it speculatively without measurements.

### Budgets and evidence

- At the representative maximum supported bracelet component count, active motion targets 60 fps and must maintain at least 30 fps on the mobile acceptance device/emulation without long tasks over 50 ms caused by the solver.
- Adding and settling one bead should normally finish within 1.5 seconds and must terminate by 3 seconds, after which particles snap only to the nearest valid non-overlapping stable result.
- DIY interaction must not regress route LCP beyond 2.5 s, INP beyond 200 ms, or CLS beyond 0.1 in the agreed local/staging test conditions.
- Record before/after production bundle sizes. Any new third-party dependency requires explicit justification, lazy chunk proof, license review, and a measured comparison against the feature-local solver.
- Performance evidence includes a desktop Chromium trace and a mobile/WebKit or equivalent constrained run with the representative maximum count, not visual judgment alone.

## 10. Compatibility and graceful degradation

The supported matrix is current and previous major versions of Chrome, Edge, Firefox, Safari on macOS, and Safari on iOS, subject to the repository's browser policy if it is stricter. Browser tests must cover Chromium, Firefox and WebKit at desktop 1440x900 and mobile 390x844 where the harness supports them.

- Use Pointer Events with pointer capture for mouse, pen and touch. Preserve keyboard selection, add, diameter replacement, reorder and removal controls.
- Do not require WebGL. The baseline implementation uses DOM images and CSS transforms; lack of accelerated compositing must reduce smoothness, not break editing.
- Feature-detect optional APIs such as `ResizeObserver`; provide a window-resize fallback rather than user-agent sniffing.
- Server render and first client render must be deterministic. Viewport measurement may enhance placement after mount without hydration warnings or content jumping outside the stage.
- Respect `prefers-reduced-motion: reduce`: replace ballistic flight, collision and ring interpolation with a short fade/scale placement; business mutation, selection and feedback remain identical.
- If the tab is backgrounded, frame rate is persistently below the accepted threshold, the body cap is exceeded, or the required animation APIs are unavailable, switch to the deterministic non-collision loose layout. Display no technical error because editing remains functional.
- Animation is decorative feedback. Screen-reader announcements report the business result (`已添加…`, failure, size and price change), not every collision.
- High-contrast/focus visibility and 44 px mobile targets remain mandatory. Color and motion are never the sole state indicators.

## 11. Failure and edge cases

- Repeated rapid taps are serialized or independently keyed so each accepted command adds once; disabled/pending feedback prevents accidental duplicate commands without blocking the whole catalog.
- A server rejection, inventory conflict or stale revision removes only its provisional particle and uses the existing recovery flow.
- A tray resize, orientation change, font zoom, or side-panel collapse clamps particles into the new inner boundary and settles once.
- Missing/broken images use the existing accessible fallback at the correct geometric size.
- Zero components shows an inviting empty tray and a direct catalog instruction. One component settles stably without pretending to form a bracelet.
- Very large or mixed sizes never cross the rim or visually overlap at rest; if the tray cannot fit them all, use the explicit overflow treatment defined during implementation rather than shrinking their physical scale dishonestly.

## 12. Accessibility and copy

- Mode buttons expose pressed/current state and announce `散珠托盘` or `成串预览`.
- Every bead remains selectable by meaningful product/material, diameter and ordered-position text where ordering applies.
- Focus never follows a moving DOM node unpredictably; the source control retains focus after add, while a separate live region confirms the result.
- Inspector values use semantic definition-list or labelled text structure. The read-only fit estimate must be copyable and must not masquerade as a disabled form field.
- Error, pending, selected and connected states have text/shape treatment independent of violet color.

## 13. Verification gates

### Model and unit coverage

- Deterministic initial placement for stable component identities.
- Circle collision, unequal radii, boundary inset, resize clamping, sleep and hard timeout.
- Visual particle mapping never mutates `DesignV1` ordering or `positionIndex`.
- Both entry points issue exactly one add command and reconcile one particle.
- Failure removes the provisional particle; rapid add and stale revision cases do not duplicate.
- Fit sums beads and inline accessories correctly and displays one rounded decimal after diameter replacement.
- Reduced-motion and performance fallback preserve full editing behavior.

### Browser and visual coverage

- 1440x900 and 390x844: initial loose layout, left-catalog launch, lower-strip launch, collisions, selection, size replacement, connected transition, loosen transition, save, failure/retry and reload.
- Chromium, Firefox and WebKit coverage for click, touch/pointer, keyboard and resize/orientation behavior.
- No rim collision leak, settled overlap, rectangular tray patch, bead padding-scale mismatch, horizontal overflow, clipped action, hydration warning, failed request or unexpected console error.
- Representative opaque, transparent and inclusion-rich bead assets at 6, 8 and 10 mm.
- Performance trace, reduced-motion run, fallback-forced run, bundle comparison and memory/loop cleanup after navigation.

Required handoff gates remain frontend tests, Bracelet Engine regression tests, architecture/lifecycle tests, production build, `pnpm validate`, `git diff --check`, and task-owned screenshot evidence. Existing unrelated baseline failures must be reported precisely and never described as passing.

## 14. Delivery decomposition and ownership

Implementation must be split so path ownership and reviews remain unambiguous:

1. **Proposed `TASK-ASSET-003` — bead/tray asset realism.** ASSET owner. Normalize bead alpha bounds and four tray assets; record provenance and inner-boundary metadata. No UI behavior, contract or Bracelet Engine change.
2. **Proposed `TASK-FE-003` — DIY loose-bead workbench.** FRONTEND owner. Implement workbench composition, two launch origins, isolated physics controller, mode transition, inspector and fit presentation using accepted assets/contracts. No public asset editing or engine fork.
3. **Proposed `TASK-UX-AUDIT-001` — route-by-route visual audit.** SOL/design review. Capture every active route at desktop/mobile, rank crowding and consistency defects, and create evidence-backed polish batches. It changes no runtime code.
4. **Proposed route polish tasks.** FRONTEND owner, one bounded route family and writable set per task. Apply the Taste direction to consumer/editorial pages and the denser product-operation rules to DIY/admin surfaces. Do not perform a blind global CSS rewrite.

If implementation proves a true geometry or fit-contract change is necessary, stop and register a separate Bracelet Engine/contract task before editing `packages/bracelet-engine` or `docs/BRACELET_GEOMETRY.md`.

## 15. Approval gate

No runtime or asset implementation begins from this document until the Product Owner approves the written design. After approval, SOL writes the task-by-task implementation plan and dispatch prompts, registers exact writable paths, and assigns the development work to the designated worker model. SOL independently reviews and integrates accepted candidates; workers do not push, deploy or merge to `main` unless separately authorized.
