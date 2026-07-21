# Mystcrag Three.js Engine Specification

## Goal

Build premium jewelry-level bracelet visualization.

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

## Package boundary

The `packages/three-engine` package exposes three rendering responsibilities:

- `bracelet-generator`: converts structured bracelet configuration into a scene descriptor.
- `material-system`: resolves reusable crystal material presets.
- `bead-system`: resolves bead geometry and optional asset references.

No production geometry, material shader, GLTF loading, interaction state, or renderer is implemented in Phase 2B. React Three Fiber and Three.js are package peers so the frontend owns the React renderer lifecycle.

## Design Contract V1 boundary

`@mystcrag/design-contract` now defines the canonical ordered bracelet input. Beads and inline accessories share a contiguous main-ring `positionIndex`; anchored accessories reference an inline component and do not occupy the ring. Product, material, model, and texture keys are contract data, while resolved Three.js materials, geometry objects, GPU state, lighting, and scene descriptors remain Three Engine runtime data.

There is intentionally no `threeConfig` duplicate inside `DesignV1`. Phase 2B implements the one-way `designV1ToSceneDescriptor` adapter: it validates the design, orders main-ring components, calculates deterministic numeric transforms, resolves anchored accessories, and reports missing asset keys as structured warnings. Its output is plain serializable runtime data and is not an API DTO.

`BraceletBeadConfiguration` and `BraceletConfiguration` remain temporarily available from the legacy path and root compatibility export with `@deprecated` annotations. New adapters do not use count-grouped data. The adapter does not recalculate price, alter compliance or inventory, mutate its input, or place Three.js instances in shared data.
