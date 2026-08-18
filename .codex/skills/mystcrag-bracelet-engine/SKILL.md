---
name: mystcrag-bracelet-engine
description: Implement, review, or test Mystcrag bracelet geometry, fit, slot hit-testing, editor/export/3D layout consistency, SKU visual placement, and bracelet QA. Use for changes in packages/bracelet-engine or any consumer that positions, edits, exports, or validates bracelet components.
---

# Mystcrag Bracelet Engine

Keep Design JSON and stable `componentId` as business truth. Keep the geometry core free of React, DOM, Canvas, Next.js, and Three.js.

## Workflow

1. Read `docs/INDEX.md`, `docs/BRACELET_GEOMETRY.md`, and the controlling consumer spec.
2. Check whether the behavior already exists in `packages/bracelet-engine` or Design Contract operations.
3. Change the pure engine first for geometry, fit, or hit-testing. Return one `LayoutResult`; do not create consumer-specific angle math.
4. Add unit cases for equal/mixed diameters, tiny spacers, hero beads, invalid geometry, floating precision, and slot resolution as relevant.
5. Update 2.5D, export, thumbnail, or 3D consumers to use the same result without moving pricing, inventory, revision, or persistence authority into the client.
6. Run package tests, affected consumer tests, and browser regression at 390×844 and 1440×900. Check console, network, overflow, touch targets, drag/delete, save, and order invariants.
7. Run `pnpm validate` before handoff. Store screenshots in the planned Playwright artifact directory, never the repository root.

## Guardrails

- Resolve drag targets from slot angular ranges or the nearest physical slot, never `angle / count`.
- Distinguish user wrist, target inner circumference, assembled path, estimated fit, allowance, and delta.
- Preserve anchors and `componentId` on replacement; do not model replace as delete plus add.
- Keep edits in finite Design Contract operations and batch multi-component updates in one request/revision.
- Keep 2.5D primary and 3D optional. Both consume the same geometry projection.
- Do not copy unlicensed/GPL configurator source or third-party visual assets.
