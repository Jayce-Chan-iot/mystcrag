# Mystcrag Three.js Engine Specification

## Goal

Build premium jewelry-level bracelet visualization.

The Three.js engine is an optional visualization capability. It is not the primary interaction surface of the DIY editor. The production DIY route uses a 2.5D, front-facing editor built from rendered bead imagery so touch insertion, ordering, and removal remain direct and predictable.

## Technology

-   React Three Fiber
-   Three.js
-   WebGL
-   GLTF
-   Draco Compression

## Design Principle

Use parameterized bracelet generation.

AI should output JSON.

3D engine converts JSON into bracelet.

## Bracelet Data Example

{ bracelet:"", beads:\[ { type:"aquamarine", size:8, count:8 } \] }

## Performance

Target: - Mobile first - 30-60 FPS - Fast loading

Avoid: - expensive physics simulation - unnecessary high polygon models

## Material System

Support: - transparent crystal - gemstone reflection - environment
lighting

## Interaction

User can: - select bead - replace bead - change style - preview lighting

These interactions describe consumers that intentionally mount the 3D viewer. The main DIY editor owns add, move, remove, save, price verification, and ordering without depending on WebGL. Removing the 3D viewer from that route does not change the canonical design contract or delete the reusable Three Engine package.

## Package boundary

The `packages/three-engine` package exposes three rendering responsibilities:

- `bracelet-generator`: converts structured bracelet configuration into a scene descriptor.
- `material-system`: resolves reusable crystal material presets.
- `bead-system`: resolves bead geometry and optional asset references.

Ring transforms consume the size-aware angles from `@mystcrag/bracelet-engine`. Three Engine may add scene-specific radial offsets and Z transforms, but it must not maintain a second equal-angle or footprint-angle solver.

No production geometry, material shader, GLTF loading, interaction state, or renderer is implemented in Phase 2B. React Three Fiber and Three.js are package peers so the frontend owns the React renderer lifecycle.

## Design Contract V1 boundary

`@mystcrag/design-contract` now defines the canonical ordered bracelet input. Beads and inline accessories share a contiguous main-ring `positionIndex`; anchored accessories reference an inline component and do not occupy the ring. Product, material, model, and texture keys are contract data, while resolved Three.js materials, geometry objects, GPU state, lighting, and scene descriptors remain Three Engine runtime data.

There is intentionally no `threeConfig` duplicate inside `DesignV1`. Phase 2B implements the one-way `designV1ToSceneDescriptor` adapter: it validates the design, orders main-ring components, calculates deterministic numeric transforms, resolves anchored accessories, and reports missing asset keys as structured warnings. Its output is plain serializable runtime data and is not an API DTO.

`BraceletBeadConfiguration` and `BraceletConfiguration` remain temporarily available from the legacy path and root compatibility export with `@deprecated` annotations. New adapters do not use count-grouped data. The adapter does not recalculate price, alter compliance or inventory, mutate its input, or place Three.js instances in shared data.

## Lifecycle decision (TASK-3D-001, Product Owner decision 2026-09-10)

The 3D bracelet preview is `EXPERIMENTAL` and is not an MVP release condition. `ThreeBraceletPreview` and `ThreeBraceletSceneClient` are implemented and test-covered but are not mounted by any production DIY route, results page, or navigation; `FlatBraceletEditor` remains the sole production DIY renderer. `ThreeBraceletPreview` exports the machine-verifiable marker `THREE_BRACELET_PREVIEW_LIFECYCLE = "EXPERIMENTAL_NOT_PRODUCTION_MOUNTED"`, and `tests/three-preview-lifecycle.test.mjs` fails if any production composition root (`apps/frontend/app` or non-test files under `apps/frontend/src`) references the 3D components in any form.

Launching 3D in production requires a new dedicated task (not a scope expansion of this one) that passes: WebGL fallback acceptance, a documented performance budget on mobile-first hardware, responsive QA, selection/geometry/asset parity with the production editor and Bracelet Engine semantics, and browser acceptance tests.
