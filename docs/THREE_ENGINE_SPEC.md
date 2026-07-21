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
