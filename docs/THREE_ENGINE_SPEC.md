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

The initial `packages/three-engine` package exposes three independent contracts:

- `bracelet-generator`: converts structured bracelet configuration into a scene descriptor.
- `material-system`: resolves reusable crystal material presets.
- `bead-system`: resolves bead geometry and optional asset references.

No production geometry, material shader, GLTF asset, interaction state, or renderer is implemented during initialization. React Three Fiber and Three.js are package peers so the frontend owns the React renderer lifecycle.

## Design Contract V1 boundary

`@mystcrag/design-contract` now defines the canonical ordered bracelet input. Beads and inline accessories share a contiguous main-ring `positionIndex`; anchored accessories reference an inline component and do not occupy the ring. Product, material, model, and texture keys are contract data, while resolved Three.js materials, geometry objects, GPU state, lighting, and scene descriptors remain Three Engine runtime data.

There is intentionally no `threeConfig` duplicate inside `DesignV1`. Phase 2B should introduce a one-way `DesignV1 -> BraceletSceneDescriptor` adapter. Phase 2A does not change `packages/three-engine`, remove its current initialization types, or implement a scene.
