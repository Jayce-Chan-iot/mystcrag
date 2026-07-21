# Three Engine Phase 3 Handoff Report

Date: 2026-07-21

Branch: `feature/three-bracelet-scene`

Owner: 3D Engine Lead

## 1. Scope delivered

- Implemented the one-way `DesignV1 -> BraceletSceneDescriptor -> React Three Fiber` path for the V1 `CIRCLE` layout.
- Added size-aware parameterized placement for mixed bead diameters, INLINE accessories, and ANCHORED pendants resolved by `anchorComponentId`.
- Added click-to-select by stable `componentId`, a wireframe selection outline, bead-only replacement preview, and deterministic relayout after replacement.
- Added damped orbit rotation and wheel/pinch zoom. Dragging a bead is deliberately not a V1 edit interaction.
- Added LOW/MEDIUM/HIGH quality profiles, mobile LOW default/HIGH clamp, adaptive DPR, lazy scene loading, procedural asset fallback, resource caching/reuse, instancing, and explicit unload disposal.
- Added a standalone `BraceletDemo` export which loads `standardAiDesignFixture`, selects one bead, and previews 6/8/10 mm material replacements.

## 2. Boundary confirmation

The implementation changes only Three Engine runtime data. It does not recalculate price, query or modify inventory, change compliance, redefine `DesignV1`, import database/AI/backend modules, or place Three.js classes in a shared contract. `replacePreviewComponent` produces a new scene descriptor and never writes GPU/runtime choices back into the design.

No cross-module product decision was needed. The requested Phase 3 plan, handoff template, and decision log files were absent from this repository at the start of work; this report follows the existing `ENGINEERING_GUIDE.md` handoff fields.

## 3. Performance implementation and fixture baseline

Runtime `onPerformanceStats` records initialization milliseconds, renderer draw calls, rendered triangles, material count, texture count, active DPR, and resolved quality after warm-up. The Demo displays this record directly.

The shared five-component fixture has five distinct geometry/material pairs and four reused materials, so its unselected baseline is five instanced draw groups; the selection outline adds one draw call while selected. Texture count is zero in LOW and one generated studio environment in MEDIUM/HIGH before catalog textures are introduced. Actual canvas initialization and renderer counters are device/browser dependent and are captured rather than hard-coded.

| Profile | CPU descriptor/resource prep* | Draw groups | Triangles | Materials | Textures | DPR | Sample budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LOW | 1.342 ms | 5 | 1,132 | 4 | 0 | 0.75-1.25 | 1 |
| MEDIUM | 0.508 ms | 5 | 2,308 | 4 | 1 | 0.75-1.75 | 4 |
| HIGH | 0.950 ms | 5 | 4,732 | 4 | 1 | 0.75-2.00 | 8 |

\* One local Node preparation sample on the handoff host, excluding WebGL/context startup. Browser initialization is reported by `onPerformanceStats`. LOW uses 16-segment spheres with simplified transparency and no environment texture; MEDIUM uses 28 segments, base PBR, transmission, and studio environment; HIGH uses 40 segments, higher transmission/index of refraction, and the highest sample budget.

Geometry/material resources are keyed and reused. Equal geometry/material render items share one `InstancedMesh`; selection uses a separate outline so shared materials are not cloned or mutated. All caches, generated environment maps, controls, geometries, and materials dispose during unmount. No physics engine or per-frame physical simulation is used.

## 4. Tests

Package tests cover:

1. main-ring and production order;
2. mixed bead diameters;
3. INLINE accessory placement;
4. ANCHORED pendant placement;
5. `anchorComponentId` resolution;
6. stable `componentId` mapping;
7. replacement relayout;
8. immutable input;
9. deterministic/serializable descriptor;
10. invalid asset warning plus procedural fallback;
11. cache reuse and resource disposal;
12. mobile quality selection and adaptive DPR;
13. production `componentSequence` consistency after preview changes.

Focused result: 14/14 Three Engine tests passed. Final gate: `pnpm validate` passed (7 architecture tests plus all workspace lint, strict typecheck, tests, and builds).

## 5. Demo usage

Import `BraceletDemo` from `@mystcrag/three-engine/demo`, or mount `LazyBraceletScene` from `@mystcrag/three-engine/react` with a descriptor produced by `designV1ToSceneDescriptor`. The application remains responsible for choosing where the dynamically loaded canvas appears in the product flow.

## 6. Deferred work and risks

- Catalog-hosted GLTF/Draco decoding and real crystal texture delivery remain deferred; V1 renders deterministic procedural geometry when assets are unavailable.
- Device GPU results must be sampled on representative iOS Safari and Android Chrome hardware. The runtime metrics callback and adaptive controls are present for that pass.
- A future product editor may submit a validated replace operation to Backend; this engine intentionally does not update `DesignV1`, pricing, inventory, or persistence itself.
